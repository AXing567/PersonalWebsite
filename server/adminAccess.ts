import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Connect } from "vite";
import { constantTimeEqual, getClientIp, parseCookies, readRequestBody, sendJson } from "./resumeAccess";

const ADMIN_ACCESS_COOKIE = "admin_access";
const ADMIN_ACCESS_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_LOCKOUT_MS = 30 * 60 * 1000;
const ADMIN_MAX_FAILED_ATTEMPTS = 3;

type AdminSession = {
  accessUntil: number;
};

type AdminIpAttempt = {
  failedAttempts: number;
  lockedUntil?: number;
  expiresAt: number;
};

export type AdminAccessStatus = {
  failedAttempts: number;
  isLocked: boolean;
  isUnlocked: boolean;
  remainingAttempts: number;
  remainingLockMs: number;
  unlockedUntil?: number;
};

const now = () => Date.now();
const adminLockoutPath = path.resolve(process.cwd(), "server/private/admin-lockout.local.json");

const readPersistedIpAttempts = () => {
  if (!existsSync(adminLockoutPath)) return new Map<string, AdminIpAttempt>();

  try {
    const rawText = readFileSync(adminLockoutPath, "utf8");
    const parsed = JSON.parse(rawText) as { attempts?: Array<AdminIpAttempt & { ip?: string }> };
    const records = Array.isArray(parsed.attempts) ? parsed.attempts : [];
    const currentTime = now();
    return new Map(
      records
        .filter((record) => typeof record.ip === "string" && record.expiresAt > currentTime)
        .map((record) => [
          record.ip!,
          {
            failedAttempts: Math.min(Math.max(0, record.failedAttempts), ADMIN_MAX_FAILED_ATTEMPTS),
            lockedUntil: record.lockedUntil,
            expiresAt: record.expiresAt,
          },
        ]),
    );
  } catch {
    return new Map<string, AdminIpAttempt>();
  }
};

const adminSessions = new Map<string, AdminSession>();
const adminIpAttempts = readPersistedIpAttempts();

const persistIpAttempts = () => {
  try {
    mkdirSync(path.dirname(adminLockoutPath), { recursive: true });
    const attempts = Array.from(adminIpAttempts.entries()).map(([ip, attempt]) => ({
      ip,
      ...attempt,
    }));
    writeFileSync(adminLockoutPath, `${JSON.stringify({ attempts }, null, 2)}\n`, "utf8");
  } catch {
    // Admin lockout persistence should not make the public site unavailable.
  }
};

const getAdminPassword = (env: Record<string, string>) => env.ADMIN_ACCESS_PASSWORD?.trim() || "";

const setAdminCookie = (res: Connect.ServerResponse, token: string, maxAgeSeconds: number) => {
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_ACCESS_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`,
  );
};

const getAdminSession = (req: Connect.IncomingMessage) => {
  const token = parseCookies(req.headers.cookie)[ADMIN_ACCESS_COOKIE];
  if (!token) return undefined;

  const session = adminSessions.get(token);
  if (!session) return undefined;

  if (session.accessUntil <= now()) {
    adminSessions.delete(token);
    return undefined;
  }

  return { session, token };
};

const createAdminSession = (res: Connect.ServerResponse) => {
  const token = randomBytes(32).toString("base64url");
  const accessUntil = now() + ADMIN_ACCESS_TTL_MS;
  adminSessions.set(token, { accessUntil });
  setAdminCookie(res, token, Math.ceil(ADMIN_ACCESS_TTL_MS / 1000));
  return adminSessions.get(token)!;
};

const getAdminIpAttempt = (req: Connect.IncomingMessage) => {
  const ip = getClientIp(req);
  const attempt = adminIpAttempts.get(ip);
  if (!attempt) return undefined;

  const currentTime = now();
  if (attempt.expiresAt <= currentTime || (attempt.lockedUntil && attempt.lockedUntil <= currentTime)) {
    adminIpAttempts.delete(ip);
    persistIpAttempts();
    return undefined;
  }

  return { attempt, ip };
};

const getOrCreateAdminIpAttempt = (req: Connect.IncomingMessage) => {
  const existing = getAdminIpAttempt(req);
  if (existing) return existing;

  const ip = getClientIp(req);
  const attempt: AdminIpAttempt = {
    failedAttempts: 0,
    expiresAt: now() + ADMIN_ACCESS_TTL_MS,
  };
  adminIpAttempts.set(ip, attempt);
  return { attempt, ip };
};

const resetAdminIpAttempt = (attempt: AdminIpAttempt) => {
  attempt.failedAttempts = 0;
  attempt.lockedUntil = undefined;
  attempt.expiresAt = now() + ADMIN_ACCESS_TTL_MS;
  persistIpAttempts();
};

const recordAdminIpFailure = (attempt: AdminIpAttempt) => {
  const currentTime = now();
  attempt.failedAttempts = Math.min(attempt.failedAttempts + 1, ADMIN_MAX_FAILED_ATTEMPTS);
  if (attempt.failedAttempts >= ADMIN_MAX_FAILED_ATTEMPTS) {
    attempt.lockedUntil = currentTime + ADMIN_LOCKOUT_MS;
  }
  attempt.expiresAt = Math.max(currentTime + ADMIN_ACCESS_TTL_MS, attempt.lockedUntil ?? 0);
  persistIpAttempts();
};

const buildAdminStatusFromState = (
  session: AdminSession | undefined,
  attempt: AdminIpAttempt | undefined,
): AdminAccessStatus => {
  const currentTime = now();
  const remainingLockMs = Math.max(0, (attempt?.lockedUntil ?? 0) - currentTime);
  const failedAttempts = Math.min(attempt?.failedAttempts ?? 0, ADMIN_MAX_FAILED_ATTEMPTS);

  return {
    failedAttempts,
    isLocked: remainingLockMs > 0,
    isUnlocked: Boolean(session?.accessUntil && session.accessUntil > currentTime && remainingLockMs === 0),
    remainingAttempts: Math.max(0, ADMIN_MAX_FAILED_ATTEMPTS - failedAttempts),
    remainingLockMs,
    unlockedUntil: session?.accessUntil,
  };
};

export const buildAdminStatus = (req: Connect.IncomingMessage) =>
  buildAdminStatusFromState(getAdminSession(req)?.session, getAdminIpAttempt(req)?.attempt);

export const hasAdminAccess = (req: Connect.IncomingMessage) => buildAdminStatus(req).isUnlocked;

export const requireAdminAccess = (req: Connect.IncomingMessage, res: Connect.ServerResponse) => {
  if (hasAdminAccess(req)) return true;

  sendJson(res, 401, { error: "请先解锁管理页面。", status: buildAdminStatus(req) });
  return false;
};

export const handleAdminStatus: Connect.NextHandleFunction = (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "只支持 GET 请求" });
    return;
  }

  sendJson(res, 200, buildAdminStatus(req));
};

export const buildAdminUnlockMiddleware =
  (env: Record<string, string>): Connect.NextHandleFunction =>
  async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "只支持 POST 请求" });
      return;
    }

    const currentStatus = buildAdminStatus(req);
    if (currentStatus.isLocked) {
      sendJson(res, 423, {
        error: "管理页密码错误次数过多，请 30 分钟后再试。",
        status: currentStatus,
      });
      return;
    }

    const configuredPassword = getAdminPassword(env);
    if (!configuredPassword) {
      sendJson(res, 500, { error: "管理页访问密码未配置，请在 .env 中设置 ADMIN_ACCESS_PASSWORD。" });
      return;
    }

    let submittedPassword = "";
    try {
      const payload = JSON.parse(await readRequestBody(req)) as { password?: unknown };
      submittedPassword = typeof payload.password === "string" ? payload.password.trim() : "";
    } catch {
      sendJson(res, 400, { error: "请求体不是有效 JSON" });
      return;
    }

    const ipAttempt = getOrCreateAdminIpAttempt(req).attempt;
    if (constantTimeEqual(submittedPassword, configuredPassword)) {
      resetAdminIpAttempt(ipAttempt);
      const session = createAdminSession(res);
      sendJson(res, 200, { status: buildAdminStatusFromState(session, ipAttempt) });
      return;
    }

    recordAdminIpFailure(ipAttempt);
    const nextStatus = buildAdminStatusFromState(getAdminSession(req)?.session, ipAttempt);
    sendJson(res, nextStatus.isLocked ? 423 : 401, {
      error: nextStatus.isLocked ? "管理页密码错误次数过多，已封禁当前 IP 30 分钟。" : "管理页密码不正确。",
      status: nextStatus,
    });
  };
