import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Connect } from "vite";
import { requireAdminAccess } from "./adminAccess";
import { getClientIp, sendJson } from "./resumeAccess";
import { readSiteSettings } from "./siteContent";

export type AvatarConversationMessage = {
  role: "assistant" | "user";
  text: string;
};

export type AvatarConversationStatus = "completed" | "error" | "insufficient-data" | "streaming";

export type AvatarConversationLogEntry = {
  answer: string;
  attempts: number;
  completedAt?: number;
  durationMs: number;
  error?: string;
  history: AvatarConversationMessage[];
  id: string;
  ip: string;
  question: string;
  startedAt: number;
  status: AvatarConversationStatus;
  updatedAt: number;
  userAgent?: string;
};

type AvatarConversationLogFile = {
  conversations?: Partial<AvatarConversationLogEntry>[];
};

type ConversationUpdate = Partial<
  Pick<AvatarConversationLogEntry, "answer" | "attempts" | "completedAt" | "durationMs" | "error" | "status" | "updatedAt">
>;

const conversationLogPath = path.resolve(process.cwd(), "server/private/avatar-conversations.local.json");

const now = () => Date.now();

const normalizeHeader = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

const normalizeConversationMessage = (value: Partial<AvatarConversationMessage>): AvatarConversationMessage | undefined => {
  const role = value.role === "assistant" || value.role === "user" ? value.role : undefined;
  const text = typeof value.text === "string" ? value.text : "";
  if (!role || !text.trim()) return undefined;
  return {
    role,
    text,
  };
};

const normalizeConversation = (value: Partial<AvatarConversationLogEntry>): AvatarConversationLogEntry | undefined => {
  if (!value.id || !value.question || !value.startedAt) return undefined;

  const status: AvatarConversationStatus =
    value.status === "completed" || value.status === "error" || value.status === "insufficient-data" || value.status === "streaming"
      ? value.status
      : "completed";
  const history = Array.isArray(value.history)
    ? value.history.map(normalizeConversationMessage).filter((message): message is AvatarConversationMessage => Boolean(message))
    : [];

  return {
    answer: typeof value.answer === "string" ? value.answer : "",
    attempts: typeof value.attempts === "number" && Number.isFinite(value.attempts) ? value.attempts : 0,
    completedAt: typeof value.completedAt === "number" && Number.isFinite(value.completedAt) ? value.completedAt : undefined,
    durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : 0,
    error: typeof value.error === "string" ? value.error : undefined,
    history,
    id: value.id,
    ip: typeof value.ip === "string" && value.ip.trim() ? value.ip : "unknown",
    question: value.question,
    startedAt: value.startedAt,
    status,
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : value.startedAt,
    userAgent: typeof value.userAgent === "string" ? value.userAgent : undefined,
  };
};

const sortConversations = (conversations: AvatarConversationLogEntry[]) =>
  [...conversations].sort((left, right) => right.startedAt - left.startedAt);

const readAllAvatarConversations = () => {
  if (!existsSync(conversationLogPath)) return [] as AvatarConversationLogEntry[];

  try {
    const parsed = JSON.parse(readFileSync(conversationLogPath, "utf8")) as AvatarConversationLogFile;
    const conversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
    return sortConversations(conversations.map(normalizeConversation).filter((item): item is AvatarConversationLogEntry => Boolean(item)));
  } catch {
    return [] as AvatarConversationLogEntry[];
  }
};

const writeAvatarConversations = (conversations: AvatarConversationLogEntry[]) => {
  mkdirSync(path.dirname(conversationLogPath), { recursive: true });
  writeFileSync(conversationLogPath, `${JSON.stringify({ conversations: sortConversations(conversations) }, null, 2)}\n`, "utf8");
};

const isExcludedConversationIp = (ip: string) => readSiteSettings().excludedVisitIps.includes(ip);

export const readAvatarConversations = () => {
  const conversations = readAllAvatarConversations();
  const excludedIps = new Set(readSiteSettings().excludedVisitIps);
  const filteredConversations = conversations.filter((conversation) => !excludedIps.has(conversation.ip));

  if (filteredConversations.length !== conversations.length) {
    try {
      writeAvatarConversations(filteredConversations);
    } catch {
      // Conversation cleanup should never break admin reads or analysis.
    }
  }

  return filteredConversations;
};

export const startAvatarConversationLog = (
  req: Connect.IncomingMessage,
  input: {
    history: AvatarConversationMessage[];
    question: string;
  },
) => {
  const currentTime = now();
  const clientIp = getClientIp(req);
  if (isExcludedConversationIp(clientIp)) return undefined;

  const entry: AvatarConversationLogEntry = {
    answer: "",
    attempts: 0,
    durationMs: 0,
    history: input.history,
    id: randomUUID(),
    ip: clientIp,
    question: input.question,
    startedAt: currentTime,
    status: "streaming",
    updatedAt: currentTime,
    userAgent: normalizeHeader(req.headers["user-agent"]),
  };

  try {
    writeAvatarConversations([entry, ...readAvatarConversations()]);
    return entry;
  } catch {
    return undefined;
  }
};

export const updateAvatarConversationLog = (id: string | undefined, update: ConversationUpdate) => {
  if (!id) return;

  try {
    const conversations = readAvatarConversations();
    const nextConversations = conversations.map((conversation) =>
      conversation.id === id
        ? {
            ...conversation,
            ...update,
            durationMs: update.completedAt ? Math.max(0, update.completedAt - conversation.startedAt) : (update.durationMs ?? conversation.durationMs),
            updatedAt: update.updatedAt ?? now(),
          }
        : conversation,
    );
    writeAvatarConversations(nextConversations);
  } catch {
    // Conversation logging must never break the protected AI chat stream.
  }
};

export const handleAdminAvatarConversations: Connect.NextHandleFunction = (req, res) => {
  if (!requireAdminAccess(req, res)) return;

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "只支持 GET 请求" });
    return;
  }

  sendJson(res, 200, {
    conversations: readAvatarConversations(),
    generatedAt: now(),
  });
};
