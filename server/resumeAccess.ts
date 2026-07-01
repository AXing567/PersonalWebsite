import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Connect } from "vite";

const RESUME_ACCESS_COOKIE = "resume_access";
const RESUME_ACCESS_TTL_MS = 12 * 60 * 60 * 1000;
const RESUME_LOCKOUT_MS = 30 * 60 * 1000;
const RESUME_MAX_FAILED_ATTEMPTS = 5;

type AttemptState = {
  failedAttempts: number;
  lockedUntil?: number;
  expiresAt: number;
};

type SessionState = {
  accessUntil?: number;
  failedAttempts: number;
  lockedUntil?: number;
  sessionExpiresAt: number;
};

const sessions = new Map<string, SessionState>();
const ipAttempts = new Map<string, AttemptState>();

const now = () => Date.now();

export const getResumePassword = (env: Record<string, string>) => env.RESUME_ACCESS_PASSWORD?.trim() || "";

const hashValue = (value: string) => createHash("sha256").update(value).digest();

export const constantTimeEqual = (left: string, right: string) => {
  const leftHash = hashValue(left);
  const rightHash = hashValue(right);
  return timingSafeEqual(leftHash, rightHash);
};

export const readRequestBody = (req: Connect.IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

export const sendJson = (res: Connect.ServerResponse, statusCode: number, payload: unknown) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

export const parseCookies = (header: string | undefined) =>
  Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) return [part, ""];
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );

const normalizeClientIp = (value: string) => value.trim().replace(/^::ffff:/, "") || "unknown";

export const getClientIp = (req: Connect.IncomingMessage) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const realIp = req.headers["x-real-ip"];
  const realIpValue = Array.isArray(realIp) ? realIp[0] : realIp;
  const candidate = forwardedValue?.split(",")[0] || realIpValue || req.socket.remoteAddress || "unknown";

  return normalizeClientIp(candidate);
};

const setAccessCookie = (res: Connect.ServerResponse, token: string, maxAgeSeconds: number) => {
  res.setHeader(
    "Set-Cookie",
    `${RESUME_ACCESS_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`,
  );
};

const createSession = () => {
  const token = randomBytes(32).toString("base64url");
  const sessionExpiresAt = now() + RESUME_ACCESS_TTL_MS;
  sessions.set(token, {
    failedAttempts: 0,
    sessionExpiresAt,
  });
  return { sessionExpiresAt, token };
};

const getSession = (req: Connect.IncomingMessage) => {
  const token = parseCookies(req.headers.cookie)[RESUME_ACCESS_COOKIE];
  if (!token) return undefined;

  const session = sessions.get(token);
  if (!session) return undefined;

  const currentTime = now();
  if (session.sessionExpiresAt <= currentTime) {
    sessions.delete(token);
    return undefined;
  }

  if (session.lockedUntil && session.lockedUntil <= currentTime) {
    session.failedAttempts = 0;
    session.lockedUntil = undefined;
  }

  return { session, token };
};

const getIpAttempt = (req: Connect.IncomingMessage) => {
  const key = getClientIp(req);
  const attempt = ipAttempts.get(key);
  if (!attempt) return undefined;

  const currentTime = now();
  if (attempt.expiresAt <= currentTime || (attempt.lockedUntil && attempt.lockedUntil <= currentTime)) {
    ipAttempts.delete(key);
    return undefined;
  }

  return { attempt, key };
};

const getOrCreateIpAttempt = (req: Connect.IncomingMessage) => {
  const existing = getIpAttempt(req);
  if (existing) return existing;

  const key = getClientIp(req);
  const attempt: AttemptState = {
    expiresAt: now() + RESUME_ACCESS_TTL_MS,
    failedAttempts: 0,
  };
  ipAttempts.set(key, attempt);
  return { attempt, key };
};

const resetIpAttempt = (attempt: AttemptState) => {
  attempt.failedAttempts = 0;
  attempt.lockedUntil = undefined;
  attempt.expiresAt = now() + RESUME_ACCESS_TTL_MS;
};

const recordIpFailure = (attempt: AttemptState) => {
  attempt.failedAttempts = Math.min(attempt.failedAttempts + 1, RESUME_MAX_FAILED_ATTEMPTS);
  if (attempt.failedAttempts >= RESUME_MAX_FAILED_ATTEMPTS) {
    attempt.lockedUntil = now() + RESUME_LOCKOUT_MS;
  }
  attempt.expiresAt = Math.max(now() + RESUME_ACCESS_TTL_MS, attempt.lockedUntil ?? 0);
};

const getOrCreateAttemptSession = (req: Connect.IncomingMessage, res: Connect.ServerResponse) => {
  const existing = getSession(req);
  if (existing) return existing;

  const created = createSession();
  setAccessCookie(res, created.token, Math.ceil(RESUME_ACCESS_TTL_MS / 1000));
  return {
    session: sessions.get(created.token)!,
    token: created.token,
  };
};

export const hasResumeAccess = (req: Connect.IncomingMessage) => {
  const session = getSession(req)?.session;
  const ipAttempt = getIpAttempt(req)?.attempt;
  const currentTime = now();
  const remainingLockMs = Math.max(0, (session?.lockedUntil ?? 0) - currentTime, (ipAttempt?.lockedUntil ?? 0) - currentTime);

  return Boolean(session?.accessUntil && session.accessUntil > currentTime && remainingLockMs === 0);
};

export const buildResumeStatus = (req: Connect.IncomingMessage) => {
  const session = getSession(req)?.session;
  const ipAttempt = getIpAttempt(req)?.attempt;
  return buildStatusFromState(session, ipAttempt);
};

const buildStatusFromState = (session: SessionState | undefined, ipAttempt: AttemptState | undefined) => {
  const currentTime = now();
  const remainingLockMs = Math.max(0, (session?.lockedUntil ?? 0) - currentTime, (ipAttempt?.lockedUntil ?? 0) - currentTime);
  const failedAttempts = Math.max(session?.failedAttempts ?? 0, ipAttempt?.failedAttempts ?? 0);
  const remainingAttempts = Math.min(
    RESUME_MAX_FAILED_ATTEMPTS - (session?.failedAttempts ?? 0),
    RESUME_MAX_FAILED_ATTEMPTS - (ipAttempt?.failedAttempts ?? 0),
  );

  return {
    failedAttempts: Math.min(failedAttempts, RESUME_MAX_FAILED_ATTEMPTS),
    isLocked: remainingLockMs > 0,
    isUnlocked: Boolean(session?.accessUntil && session.accessUntil > currentTime && remainingLockMs === 0),
    remainingAttempts: Math.max(0, remainingAttempts),
    remainingLockMs,
    unlockedUntil: session?.accessUntil,
  };
};

export const handleResumeStatus: Connect.NextHandleFunction = (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "只支持 GET 请求" });
    return;
  }

  sendJson(res, 200, buildResumeStatus(req));
};

export const buildResumeUnlockMiddleware =
  (env: Record<string, string>): Connect.NextHandleFunction =>
  async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "只支持 POST 请求" });
      return;
    }

    const currentStatus = buildResumeStatus(req);
    if (currentStatus.isLocked) {
      sendJson(res, 423, {
        error: "尝试次数过多，请稍后再试。",
        status: currentStatus,
      });
      return;
    }

    const configuredPassword = getResumePassword(env);
    if (!configuredPassword) {
      sendJson(res, 500, { error: "简历访问密码未配置，请在 .env 中设置 RESUME_ACCESS_PASSWORD。" });
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

    const attemptSession = getOrCreateAttemptSession(req, res).session;
    const ipAttempt = getOrCreateIpAttempt(req).attempt;
    if (constantTimeEqual(submittedPassword, configuredPassword)) {
      attemptSession.failedAttempts = 0;
      attemptSession.lockedUntil = undefined;
      attemptSession.accessUntil = now() + RESUME_ACCESS_TTL_MS;
      attemptSession.sessionExpiresAt = attemptSession.accessUntil;
      resetIpAttempt(ipAttempt);
      sendJson(res, 200, { status: buildStatusFromState(attemptSession, ipAttempt) });
      return;
    }

    attemptSession.failedAttempts = Math.min(attemptSession.failedAttempts + 1, RESUME_MAX_FAILED_ATTEMPTS);
    if (attemptSession.failedAttempts >= RESUME_MAX_FAILED_ATTEMPTS) {
      attemptSession.lockedUntil = now() + RESUME_LOCKOUT_MS;
    }
    recordIpFailure(ipAttempt);
    const nextStatus = buildStatusFromState(attemptSession, ipAttempt);

    sendJson(res, nextStatus.isLocked ? 423 : 401, {
      error: nextStatus.isLocked ? "密码错误次数过多，已锁定 30 分钟。" : "密码不正确。",
      status: nextStatus,
    });
  };

export const requireResumeAccess = (req: Connect.IncomingMessage, res: Connect.ServerResponse) => {
  if (hasResumeAccess(req)) return true;

  sendJson(res, 401, { error: "请先解锁简历。" });
  return false;
};
