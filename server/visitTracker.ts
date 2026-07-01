import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import type { Connect } from "vite";
import { getClientIp, readRequestBody, sendJson } from "./resumeAccess";
import { requireAdminAccess } from "./adminAccess";
import { readSiteSettings } from "./siteContent";

const HEARTBEAT_TIMEOUT_MS = 45 * 1000;
const MAX_VISIT_RECORDS = 500;
const GEO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GEO_FAILURE_TTL_MS = 60 * 60 * 1000;
const GEO_LOOKUP_TIMEOUT_MS = 2600;
const MAX_GEO_LOOKUPS_PER_DASHBOARD = 8;
const GEO_CACHE_SCHEMA_VERSION = 2;

type VisitRecord = {
  durationMs: number;
  endedAt?: number;
  id: string;
  ip: string;
  kickedAt?: number;
  lastSeenAt: number;
  page: string;
  referrer?: string;
  startedAt: number;
  userAgent?: string;
};

type VisitPayload = {
  event?: unknown;
  id?: unknown;
  page?: unknown;
  referrer?: unknown;
  startedAt?: unknown;
};

type KickVisitPayload = {
  id?: unknown;
};

export type IpGeoInfo = {
  asn?: number;
  city?: string;
  country?: string;
  countryCode?: string;
  isp?: string;
  latitude?: number;
  longitude?: number;
  region?: string;
  source: "cache" | "local" | "lookup";
  status: "hit" | "local" | "miss" | "unknown";
  summary: string;
  timezone?: string;
  updatedAt: number;
};

type CachedGeoInfo = IpGeoInfo & {
  expiresAt: number;
  provider?: string;
  schemaVersion: number;
};

type IpWhoisResponse = {
  city?: string;
  connection?: {
    asn?: number;
    isp?: string;
    org?: string;
  };
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  message?: string;
  region?: string;
  success?: boolean;
  timezone?: {
    id?: string;
  };
};

type IpApiResponse = {
  as?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  isp?: string;
  lat?: number;
  lon?: number;
  message?: string;
  org?: string;
  regionName?: string;
  status?: "fail" | "success";
  timezone?: string;
};

type IpApiCoResponse = {
  asn?: string;
  city?: string;
  country_code?: string;
  country_name?: string;
  error?: boolean;
  latitude?: number;
  longitude?: number;
  org?: string;
  reason?: string;
  region?: string;
  timezone?: string;
};

export type VisitDashboard = {
  activeCount: number;
  generatedAt: number;
  totalDurationMs: number;
  totalVisits: number;
  visits: Array<VisitRecord & { geo?: IpGeoInfo; isActive: boolean }>;
};

const visitLogPath = path.resolve(process.cwd(), "server/private/visit-log.local.json");
const geoCachePath = path.resolve(process.cwd(), "server/private/ip-geo-cache.local.json");

const now = () => Date.now();

const readPersistedVisits = () => {
  if (!existsSync(visitLogPath)) return new Map<string, VisitRecord>();

  try {
    const rawText = readFileSync(visitLogPath, "utf8");
    const parsed = JSON.parse(rawText) as { visits?: VisitRecord[] };
    const records = Array.isArray(parsed.visits) ? parsed.visits : [];
    return new Map(
      records
        .filter((visit) => typeof visit.id === "string" && typeof visit.ip === "string" && typeof visit.page === "string")
        .slice(-MAX_VISIT_RECORDS)
        .map((visit) => [visit.id, visit]),
    );
  } catch {
    return new Map<string, VisitRecord>();
  }
};

const visits = readPersistedVisits();

const readPersistedGeoCache = () => {
  if (!existsSync(geoCachePath)) return new Map<string, CachedGeoInfo>();

  try {
    const rawText = readFileSync(geoCachePath, "utf8");
    const parsed = JSON.parse(rawText) as { items?: Array<CachedGeoInfo & { ip?: string }> };
    const records = Array.isArray(parsed.items) ? parsed.items : [];
    const currentTime = now();
    return new Map(
      records
        .filter(
          (record) =>
            typeof record.ip === "string" &&
            record.expiresAt > currentTime &&
            record.schemaVersion === GEO_CACHE_SCHEMA_VERSION,
        )
        .map((record) => {
          const { ip, ...geo } = record;
          return [ip!, geo];
        }),
    );
  } catch {
    return new Map<string, CachedGeoInfo>();
  }
};

const geoCache = readPersistedGeoCache();

const persistVisits = () => {
  try {
    mkdirSync(path.dirname(visitLogPath), { recursive: true });
    const records = Array.from(visits.values())
      .sort((left, right) => left.startedAt - right.startedAt)
      .slice(-MAX_VISIT_RECORDS);
    writeFileSync(visitLogPath, `${JSON.stringify({ visits: records }, null, 2)}\n`, "utf8");
  } catch {
    // Visit analytics should never break the public site.
  }
};

const persistGeoCache = () => {
  try {
    mkdirSync(path.dirname(geoCachePath), { recursive: true });
    const items = Array.from(geoCache.entries()).map(([ip, geo]) => ({
      ip,
      ...geo,
    }));
    writeFileSync(geoCachePath, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");
  } catch {
    // IP geo enrichment should not break visit analytics.
  }
};

const appendSetCookie = (res: Connect.ServerResponse, cookie: string) => {
  const current = res.getHeader("Set-Cookie");
  const cookies = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
  res.setHeader("Set-Cookie", [...cookies, cookie]);
};

const clearClientAccessCookies = (res: Connect.ServerResponse) => {
  appendSetCookie(res, "resume_access=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  appendSetCookie(res, "admin_access=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
};

const normalizePage = (value: unknown) => {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  if (!trimmed) return "/";
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
};

const normalizeOptionalString = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const normalizeStartedAt = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return now();
  const currentTime = now();
  if (value > currentTime + 60_000 || value < currentTime - 24 * 60 * 60 * 1000) return currentTime;
  return Math.floor(value);
};

const isActiveVisit = (visit: VisitRecord, currentTime = now()) =>
  !visit.endedAt && !visit.kickedAt && currentTime - visit.lastSeenAt <= HEARTBEAT_TIMEOUT_MS;

const isExcludedVisitIp = (ip: string) => readSiteSettings().excludedVisitIps.includes(ip);

const removeExcludedVisitIps = () => {
  const excludedIps = new Set(readSiteSettings().excludedVisitIps);
  let removedCount = 0;

  visits.forEach((visit, id) => {
    if (!excludedIps.has(visit.ip)) return;
    visits.delete(id);
    removedCount += 1;
  });

  if (removedCount > 0) {
    persistVisits();
  }
};

const getVisitDuration = (visit: VisitRecord, currentTime = now()) =>
  Math.max(0, (visit.endedAt ?? Math.min(currentTime, visit.lastSeenAt + HEARTBEAT_TIMEOUT_MS)) - visit.startedAt);

const isLocalIp = (ip: string) => {
  const normalized = ip.trim().toLowerCase();
  if (!isIP(normalized)) return true;
  if (normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost") return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true;
  if (normalized.startsWith("169.254.")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  return false;
};

const toGeoSummary = (geo: Pick<IpGeoInfo, "city" | "country" | "isp" | "region">) => {
  const location = [geo.country, geo.region, geo.city].filter(Boolean).join(" ");
  return [location, geo.isp].filter(Boolean).join(" · ") || "未知位置";
};

const toPublicGeoInfo = (geo: CachedGeoInfo, source: IpGeoInfo["source"]): IpGeoInfo => {
  const { expiresAt: _expiresAt, ...publicGeo } = geo;
  return {
    ...publicGeo,
    source,
  };
};

const createLocalGeoInfo = (ip: string): CachedGeoInfo => ({
  expiresAt: now() + GEO_CACHE_TTL_MS,
  provider: "local",
  schemaVersion: GEO_CACHE_SCHEMA_VERSION,
  source: "local",
  status: "local",
  summary: ip === "unknown" ? "未知 IP" : "本地/内网地址",
  updatedAt: now(),
});

const createUnknownGeoInfo = (summary: string, provider = "unknown"): CachedGeoInfo => ({
  expiresAt: now() + GEO_FAILURE_TTL_MS,
  provider,
  schemaVersion: GEO_CACHE_SCHEMA_VERSION,
  source: "lookup",
  status: "unknown",
  summary,
  updatedAt: now(),
});

const readCachedGeo = (ip: string) => {
  const cached = geoCache.get(ip);
  if (!cached) return undefined;

  if (cached.expiresAt <= now()) {
    geoCache.delete(ip);
    persistGeoCache();
    return undefined;
  }

  return toPublicGeoInfo(cached, "cache");
};

const lookupIpGeo = async (ip: string) => {
  const cached = readCachedGeo(ip);
  if (cached) return cached;

  if (isLocalIp(ip)) {
    const localGeo = createLocalGeoInfo(ip);
    geoCache.set(ip, localGeo);
    persistGeoCache();
    return toPublicGeoInfo(localGeo, "local");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEO_LOOKUP_TIMEOUT_MS);

  try {
    const lookupAttempts: Array<{
      provider: string;
      read: (response: Response) => Promise<CachedGeoInfo>;
      url: string;
    }> = [
      {
        provider: "ipapi.co",
        url: `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
        read: async (response) => {
          const data = (await response.json()) as IpApiCoResponse;
          if (data.error) throw new Error(data.reason || "ipapi.co 解析失败");
          return {
            city: data.city,
            country: data.country_name,
            countryCode: data.country_code,
            expiresAt: now() + GEO_CACHE_TTL_MS,
            isp: data.org,
            latitude: typeof data.latitude === "number" ? data.latitude : undefined,
            longitude: typeof data.longitude === "number" ? data.longitude : undefined,
            provider: "ipapi.co",
            region: data.region,
            schemaVersion: GEO_CACHE_SCHEMA_VERSION,
            source: "lookup",
            status: "hit",
            summary: toGeoSummary({
              city: data.city,
              country: data.country_name,
              isp: data.org,
              region: data.region,
            }),
            timezone: data.timezone,
            updatedAt: now(),
          };
        },
      },
      {
        provider: "ipwho.is",
        url: `https://ipwho.is/${encodeURIComponent(ip)}?lang=zh-CN`,
        read: async (response) => {
          const data = (await response.json()) as IpWhoisResponse;
          if (data.success === false) throw new Error(data.message || "ipwho.is 解析失败");
          return {
            asn: typeof data.connection?.asn === "number" ? data.connection.asn : undefined,
            city: data.city,
            country: data.country,
            countryCode: data.country_code,
            expiresAt: now() + GEO_CACHE_TTL_MS,
            isp: data.connection?.isp || data.connection?.org,
            latitude: typeof data.latitude === "number" ? data.latitude : undefined,
            longitude: typeof data.longitude === "number" ? data.longitude : undefined,
            provider: "ipwho.is",
            region: data.region,
            schemaVersion: GEO_CACHE_SCHEMA_VERSION,
            source: "lookup",
            status: "hit",
            summary: toGeoSummary({
              city: data.city,
              country: data.country,
              isp: data.connection?.isp || data.connection?.org,
              region: data.region,
            }),
            timezone: data.timezone?.id,
            updatedAt: now(),
          };
        },
      },
      {
        provider: "ip-api.com",
        url: `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,query&lang=zh-CN`,
        read: async (response) => {
          const data = (await response.json()) as IpApiResponse;
          if (data.status !== "success") throw new Error(data.message || "ip-api.com 解析失败");
          const asnText = data.as?.match(/AS(\d+)/)?.[1];
          return {
            asn: asnText ? Number(asnText) : undefined,
            city: data.city,
            country: data.country,
            countryCode: data.countryCode,
            expiresAt: now() + GEO_CACHE_TTL_MS,
            isp: data.isp || data.org,
            latitude: typeof data.lat === "number" ? data.lat : undefined,
            longitude: typeof data.lon === "number" ? data.lon : undefined,
            provider: "ip-api.com",
            region: data.regionName,
            schemaVersion: GEO_CACHE_SCHEMA_VERSION,
            source: "lookup",
            status: "hit",
            summary: toGeoSummary({
              city: data.city,
              country: data.country,
              isp: data.isp || data.org,
              region: data.regionName,
            }),
            timezone: data.timezone,
            updatedAt: now(),
          };
        },
      },
    ];

    const errors: string[] = [];
    for (const attempt of lookupAttempts) {
      try {
        const response = await fetch(attempt.url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const geo = await attempt.read(response);
        geoCache.set(ip, geo);
        persistGeoCache();
        return toPublicGeoInfo(geo, "lookup");
      } catch (error) {
        errors.push(`${attempt.provider}: ${error instanceof Error ? error.message : "解析失败"}`);
      }
    }

    const unknownGeo = createUnknownGeoInfo(`地址解析失败：${errors.join("；") || "服务不可用"}`);
    geoCache.set(ip, unknownGeo);
    persistGeoCache();
    return toPublicGeoInfo(unknownGeo, "lookup");
  } finally {
    clearTimeout(timeoutId);
  }
};

const enrichVisitsWithGeo = async (dashboardVisits: Array<VisitRecord & { isActive: boolean }>) => {
  const uniqueIps = Array.from(new Set(dashboardVisits.map((visit) => visit.ip)));
  const geoByIp = new Map<string, IpGeoInfo>();
  let lookupBudget = MAX_GEO_LOOKUPS_PER_DASHBOARD;

  for (const ip of uniqueIps) {
    const cached = readCachedGeo(ip);
    if (cached) {
      geoByIp.set(ip, cached);
      continue;
    }

    if (lookupBudget <= 0) {
      geoByIp.set(ip, {
        source: "lookup",
        status: "miss",
        summary: "等待下一轮解析",
        updatedAt: now(),
      });
      continue;
    }

    lookupBudget -= 1;
    geoByIp.set(ip, await lookupIpGeo(ip));
  }

  return dashboardVisits.map((visit) => ({
    ...visit,
    geo: geoByIp.get(visit.ip),
  }));
};

const compactVisits = () => {
  if (visits.size <= MAX_VISIT_RECORDS) return;

  const overflow = visits.size - MAX_VISIT_RECORDS;
  const oldestIds = Array.from(visits.values())
    .sort((left, right) => left.startedAt - right.startedAt)
    .slice(0, overflow)
    .map((visit) => visit.id);

  oldestIds.forEach((id) => visits.delete(id));
};

const createVisitId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const upsertVisit = (req: Connect.IncomingMessage, payload: VisitPayload) => {
  const currentTime = now();
  const id = normalizeOptionalString(payload.id, 120) || createVisitId();
  const existing = visits.get(id);
  const clientIp = existing?.ip ?? getClientIp(req);
  if (isExcludedVisitIp(clientIp)) {
    if (existing) {
      visits.delete(id);
      persistVisits();
    }
    return undefined;
  }

  const event = payload.event === "end" ? "end" : "heartbeat";
  const startedAt = existing?.startedAt ?? normalizeStartedAt(payload.startedAt);
  const lastSeenAt = currentTime;
  const nextVisit: VisitRecord = {
    durationMs: 0,
    id,
    ip: clientIp,
    kickedAt: existing?.kickedAt,
    lastSeenAt,
    page: normalizePage(payload.page ?? existing?.page),
    referrer: normalizeOptionalString(payload.referrer ?? existing?.referrer, 240),
    startedAt,
    userAgent: normalizeOptionalString(req.headers["user-agent"], 240),
  };

  if (event === "end") {
    nextVisit.endedAt = currentTime;
  } else if (existing?.endedAt) {
    nextVisit.endedAt = existing.endedAt;
  }

  nextVisit.durationMs = getVisitDuration(nextVisit, currentTime);
  visits.set(id, nextVisit);
  compactVisits();
  persistVisits();
  return nextVisit;
};

const kickVisit = (id: string) => {
  const existing = visits.get(id);
  if (!existing) return undefined;

  const currentTime = now();
  const kickedVisit: VisitRecord = {
    ...existing,
    endedAt: existing.endedAt ?? currentTime,
    kickedAt: existing.kickedAt ?? currentTime,
  };
  kickedVisit.durationMs = getVisitDuration(kickedVisit, currentTime);
  visits.set(id, kickedVisit);
  persistVisits();
  return kickedVisit;
};

export const buildVisitDashboard = async (): Promise<VisitDashboard> => {
  removeExcludedVisitIps();

  const currentTime = now();
  const dashboardVisits = await enrichVisitsWithGeo(
    Array.from(visits.values())
    .map((visit) => {
      const durationMs = getVisitDuration(visit, currentTime);
      return {
        ...visit,
        durationMs,
        isActive: isActiveVisit(visit, currentTime),
      };
    })
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt),
  );

  return {
    activeCount: dashboardVisits.filter((visit) => visit.isActive).length,
    generatedAt: currentTime,
    totalDurationMs: dashboardVisits.reduce((sum, visit) => sum + visit.durationMs, 0),
    totalVisits: dashboardVisits.length,
    visits: dashboardVisits,
  };
};

export const handleVisitTrack: Connect.NextHandleFunction = async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "只支持 POST 请求" });
    return;
  }

  let payload: VisitPayload = {};
  try {
    payload = JSON.parse(await readRequestBody(req)) as VisitPayload;
  } catch {
    sendJson(res, 400, { error: "请求体不是有效 JSON" });
    return;
  }

  const visit = upsertVisit(req, payload);
  if (!visit) {
    sendJson(res, 200, { ignored: true });
    return;
  }

  if (visit.kickedAt) {
    clearClientAccessCookies(res);
    sendJson(res, 200, {
      id: visit.id,
      kicked: true,
      message: "当前访问会话已被管理员结束。",
    });
    return;
  }

  sendJson(res, 200, { id: visit.id });
};

export const handleKickVisit: Connect.NextHandleFunction = async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "只支持 POST 请求" });
    return;
  }

  if (!requireAdminAccess(req, res)) {
    return;
  }

  let payload: KickVisitPayload = {};
  try {
    payload = JSON.parse(await readRequestBody(req)) as KickVisitPayload;
  } catch {
    sendJson(res, 400, { error: "请求体不是有效 JSON" });
    return;
  }

  const id = normalizeOptionalString(payload.id, 120);
  if (!id) {
    sendJson(res, 400, { error: "缺少访问会话 ID。" });
    return;
  }

  const visit = kickVisit(id);
  if (!visit) {
    sendJson(res, 404, { error: "访问会话不存在或已被清理。" });
    return;
  }

  sendJson(res, 200, {
    id: visit.id,
    kickedAt: visit.kickedAt,
  });
};

export const handleVisitDashboard: Connect.NextHandleFunction = async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "只支持 GET 请求" });
    return;
  }

  if (!requireAdminAccess(req, res)) {
    return;
  }

  sendJson(res, 200, await buildVisitDashboard());
};
