import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import { buildAdminUnlockMiddleware, handleAdminStatus } from "./server/adminAccess";
import { buildAvatarConversationAnalysisMiddleware } from "./server/avatarConversationAnalysis";
import {
  handleAdminAvatarConversations,
  startAvatarConversationLog,
  updateAvatarConversationLog,
} from "./server/avatarConversationLog";
import { buildAvatarSystemPrompt, formatSourceAppendix, type RetrievedKnowledgeSource } from "./server/avatarKnowledge";
import { handleAdminManagedFiles, handlePublicSiteAsset } from "./server/runtimeFileManager";
import { PrivateResumeDataError, readPrivateResumeData } from "./server/privateResumeData";
import {
  buildResumeUnlockMiddleware,
  handleResumeStatus,
  readRequestBody,
  requireResumeAccess,
  sendJson,
} from "./server/resumeAccess";
import { handleAdminArticles, handleAdminSiteSettings, handlePublicArticles, handlePublicSiteSettings, readSiteSettings } from "./server/siteContent";
import { handleKickVisit, handleVisitDashboard, handleVisitTrack } from "./server/visitTracker";

type AvatarClientMessage = {
  role: "assistant" | "user";
  text: string;
};

type AvatarChatRequest = {
  question?: string;
  history?: AvatarClientMessage[];
};

type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ResponseInputMessage = {
  role: "user" | "assistant";
  content: string;
};

type ModelPayload = {
  body: unknown;
  hasRelevantSources: boolean;
  sources: RetrievedKnowledgeSource[];
};

type EndpointCandidate = {
  mode: "chat" | "responses";
  url: string;
};

type RetryProfile = {
  label: string;
  maxHistory: number;
  model: string;
  temperature: number;
  concise: boolean;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
    delta?: {
      content?: string;
    };
  }>;
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  delta?: string;
  text?: string;
  type?: string;
  error?:
    | string
    | {
        message?: string;
      };
  detail?: string;
  message?: string;
};

type StreamEvent =
  | {
      type: "status";
      message: string;
      attempt: number;
    }
  | {
      type: "reset";
      attempt: number;
    }
  | {
      type: "chunk";
      text: string;
    }
  | {
      type: "done";
      message: string;
      attempt: number;
    }
  | {
      type: "error";
      message: string;
    };

const textEncoder = new TextEncoder();
const MODEL_STREAM_IDLE_TIMEOUT_MS = 45000;
const resumePdfPath = path.resolve(process.cwd(), "server/private/resume-demo.pdf");
const resumePdfDownloadNameFallback = "resume.pdf";
const resumePdfDownloadName = "resume.pdf";

const getEnvValue = (env: Record<string, string>, key: string) => {
  const match = Object.entries(env).find(([envKey]) => envKey.replace(/^\uFEFF/, "") === key);
  return match?.[1]?.trim() || "";
};

const sendStreamEvent = (res: Connect.ServerResponse, event: StreamEvent) => {
  res.write(textEncoder.encode(`${JSON.stringify(event)}\n`));
};

const toEndpointCandidate = (url: string): EndpointCandidate => ({
  mode: url.endsWith("/responses") ? "responses" : "chat",
  url,
});

const getEndpointCandidates = (endpoint: string) => {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) return [];

  const candidates = [];

  if (trimmed.endsWith("/chat/completions") || trimmed.endsWith("/responses")) {
    candidates.push(trimmed);
  } else if (trimmed.endsWith("/v1")) {
    candidates.push(`${trimmed}/chat/completions`);
  } else {
    candidates.push(trimmed, `${trimmed}/v1/chat/completions`, `${trimmed}/chat/completions`);
  }

  return Array.from(new Set(candidates)).map(toEndpointCandidate);
};

const extractModelText = (data: ChatCompletionResponse) => {
  const chatText = data.choices?.[0]?.message?.content;
  if (chatText) return chatText;

  if (data.output_text) return data.output_text;

  const responseText = data.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n");

  return responseText || "";
};

const extractErrorMessage = (data: ChatCompletionResponse, rawText: string, status: number) => {
  if (typeof data.error === "string") return data.error;
  return data.error?.message || data.detail || data.message || rawText || `请求失败：HTTP ${status}`;
};

const parseStreamPayload = (line: string) => {
  const normalized = line.trim();
  if (!normalized || normalized === "data: [DONE]" || normalized === "[DONE]") return "";

  const jsonText = normalized.startsWith("data:") ? normalized.slice(5).trim() : normalized;
  if (!jsonText || jsonText === "[DONE]") return "";

  try {
    const data = JSON.parse(jsonText) as ChatCompletionResponse;
    return data.choices?.[0]?.delta?.content || data.delta || data.text || extractModelText(data);
  } catch {
    return "";
  }
};

const buildRetryProfiles = (model: string, fallbackModel?: string): RetryProfile[] => [
  {
    label: "标准上下文",
    maxHistory: 10,
    model,
    temperature: 0.35,
    concise: false,
  },
  {
    label: "降级 1：缩短对话历史",
    maxHistory: 6,
    model,
    temperature: 0.3,
    concise: false,
  },
  {
    label: "降级 2：精简上下文生成",
    maxHistory: 3,
    model: fallbackModel || model,
    temperature: 0.25,
    concise: true,
  },
  {
    label: "降级 3：最小历史兜底",
    maxHistory: 0,
    model: fallbackModel || model,
    temperature: 0.2,
    concise: true,
  },
];

const createModelPayload = (
  endpoint: EndpointCandidate,
  profile: RetryProfile,
  question: string,
  history: AvatarClientMessage[],
): ModelPayload => {
  const promptContext = buildAvatarSystemPrompt({
    concise: profile.concise,
    history,
    question,
  });
  const { hasRelevantSources, sources, systemPrompt } = promptContext;
  const recentHistory = history.slice(-profile.maxHistory);
  const conversationMessages: ModelMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map((message) => ({
      role: message.role,
      content: message.text,
    })),
    { role: "user", content: question },
  ];
  const responseInput: ResponseInputMessage[] = [
    ...recentHistory.map((message) => ({
      role: message.role,
      content: message.text,
    })),
    { role: "user", content: question },
  ];

  if (endpoint.mode === "responses") {
    return {
      body: {
        model: profile.model,
        instructions: systemPrompt,
        input: responseInput,
        temperature: profile.temperature,
        stream: true,
      },
      hasRelevantSources,
      sources,
    };
  }

  return {
    body: {
      model: profile.model,
      messages: conversationMessages,
      temperature: profile.temperature,
      stream: true,
    },
    hasRelevantSources,
    sources,
  };
};

const streamModelResponse = async (
  endpoint: EndpointCandidate,
  apiKey: string,
  body: unknown,
  onChunk: (chunk: string) => void,
) => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortReason = "模型请求长时间没有响应，已自动中止。";

  const refreshIdleTimeout = (reason = "模型请求长时间没有响应，已自动中止。") => {
    abortReason = reason;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      controller.abort();
    }, MODEL_STREAM_IDLE_TIMEOUT_MS);
  };

  refreshIdleTimeout(`模型请求超过 ${Math.round(MODEL_STREAM_IDLE_TIMEOUT_MS / 1000)} 秒未建立连接，已自动中止。`);

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    refreshIdleTimeout(`模型流式响应超过 ${Math.round(MODEL_STREAM_IDLE_TIMEOUT_MS / 1000)} 秒没有新内容，已自动中止。`);

    if (!response.ok) {
      const rawText = await response.text();
      let data: ChatCompletionResponse = {};

      try {
        data = rawText ? (JSON.parse(rawText) as ChatCompletionResponse) : {};
      } catch {
        data = {};
      }

      throw new Error(extractErrorMessage(data, rawText, response.status));
    }

    if (!response.body) {
      const rawText = await response.text();
      refreshIdleTimeout();
      let data: ChatCompletionResponse = {};

      try {
        data = rawText ? (JSON.parse(rawText) as ChatCompletionResponse) : {};
      } catch {
        data = {};
      }

      const text = extractModelText(data).trim();
      if (!text) throw new Error("模型没有返回可展示的文本。");
      onChunk(text);
      refreshIdleTimeout();
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        refreshIdleTimeout(`模型流式响应超过 ${Math.round(MODEL_STREAM_IDLE_TIMEOUT_MS / 1000)} 秒没有新内容，已自动中止。`);

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const chunk = parseStreamPayload(line);
          if (!chunk) continue;

          fullText += chunk;
          onChunk(chunk);
          refreshIdleTimeout(`模型流式响应超过 ${Math.round(MODEL_STREAM_IDLE_TIMEOUT_MS / 1000)} 秒没有新内容，已自动中止。`);
        }
      }

      const tail = parseStreamPayload(buffer);
      if (tail) {
        fullText += tail;
        onChunk(tail);
        refreshIdleTimeout();
      }
    } finally {
      reader.releaseLock();
    }

    const trimmed = fullText.trim();
    if (!trimmed) throw new Error("模型流式响应为空。");

    return trimmed;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(abortReason);
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const buildAvatarMiddleware =
  (env: Record<string, string>): Connect.NextHandleFunction =>
  async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "只支持 POST 请求" });
      return;
    }

    if (!requireResumeAccess(req, res)) {
      return;
    }

    const apiUrl = getEnvValue(env, "AVATAR_API_URL");
    const apiKey = getEnvValue(env, "AVATAR_API_KEY");
    const model = getEnvValue(env, "AVATAR_MODEL");
    const fallbackModel = getEnvValue(env, "AVATAR_FALLBACK_MODEL");

    if (!apiUrl || !apiKey || !model) {
      sendJson(res, 500, {
        error: "本地模型配置不完整，请在 .env 中配置 AVATAR_API_URL、AVATAR_API_KEY、AVATAR_MODEL。",
      });
      return;
    }

    let payload: AvatarChatRequest;

    try {
      payload = JSON.parse(await readRequestBody(req)) as AvatarChatRequest;
    } catch {
      sendJson(res, 400, { error: "请求体不是有效 JSON" });
      return;
    }

    const question = payload.question?.trim();
    if (!question) {
      sendJson(res, 400, { error: "问题不能为空" });
      return;
    }

    const history = (payload.history ?? [])
      .filter((message) => message.role === "assistant" || message.role === "user")
      .filter((message) => message.text.trim())
      .slice(-10);
    const conversationLog = startAvatarConversationLog(req, { history, question });
    let answerText = "";
    const endpointCandidates = getEndpointCandidates(apiUrl);
    const retryProfiles = buildRetryProfiles(model, fallbackModel);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let lastError: Error | null = null;

    for (let attemptIndex = 0; attemptIndex < retryProfiles.length; attemptIndex += 1) {
      const retryProfile = retryProfiles[attemptIndex];
      const attempt = attemptIndex + 1;

      if (attempt > 1) {
        answerText = "";
        sendStreamEvent(res, { type: "reset", attempt });
      }

      sendStreamEvent(res, {
        type: "status",
        message:
          attempt === 1
            ? "AI 分身正在流式生成回答..."
            : `${retryProfile.label}，正在重新生成回答...`,
        attempt,
      });

      for (const endpoint of endpointCandidates) {
        try {
          const { body, hasRelevantSources, sources } = createModelPayload(endpoint, retryProfile, question, history);

          if (!hasRelevantSources) {
            const sourceAppendix = formatSourceAppendix(sources);
            const insufficientText = `当前知识库资料不足以回答这个问题。请补充更具体的项目、经历、岗位或能力资料后再问。${sourceAppendix}`;
            sendStreamEvent(res, {
              type: "chunk",
              text: insufficientText,
            });
            sendStreamEvent(res, {
              type: "done",
              message: "回答完成（资料不足）",
              attempt,
            });
            updateAvatarConversationLog(conversationLog?.id, {
              answer: insufficientText,
              attempts: attempt,
              completedAt: Date.now(),
              status: "insufficient-data",
            });
            res.end();
            return;
          }

          await streamModelResponse(endpoint, apiKey, body, (chunk) => {
            answerText += chunk;
            sendStreamEvent(res, { type: "chunk", text: chunk });
          });

          const sourceAppendix = formatSourceAppendix(sources, answerText);
          sendStreamEvent(res, { type: "chunk", text: sourceAppendix });
          answerText += sourceAppendix;

          sendStreamEvent(res, {
            type: "done",
            message: attempt === 1 ? "回答完成" : `回答完成（${retryProfile.label}）`,
            attempt,
          });
          updateAvatarConversationLog(conversationLog?.id, {
            answer: answerText,
            attempts: attempt,
            completedAt: Date.now(),
            status: "completed",
          });
          res.end();
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("模型请求失败，请检查本地模型配置。");
        }
      }
    }

    const finalErrorMessage = `AI 分身连续 4 轮请求失败（含 3 次降级重试）：${lastError?.message ?? "模型请求失败"}`;
    sendStreamEvent(res, {
      type: "error",
      message: finalErrorMessage,
    });
    updateAvatarConversationLog(conversationLog?.id, {
      answer: answerText,
      attempts: retryProfiles.length,
      completedAt: Date.now(),
      error: finalErrorMessage,
      status: "error",
    });
    res.end();
  };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const adminUnlockMiddleware = buildAdminUnlockMiddleware(env);
  const avatarConversationAnalysisMiddleware = buildAvatarConversationAnalysisMiddleware(env);
  const avatarMiddleware = buildAvatarMiddleware(env);
  const resumeUnlockMiddleware = buildResumeUnlockMiddleware(env);
  const resumeDataMiddleware: Connect.NextHandleFunction = (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "只支持 GET 请求" });
      return;
    }

    if (!requireResumeAccess(req, res)) {
      return;
    }

    try {
      sendJson(res, 200, readPrivateResumeData());
    } catch (error) {
      sendJson(res, error instanceof PrivateResumeDataError ? 500 : 500, {
        error: error instanceof PrivateResumeDataError ? error.message : "私有简历数据读取失败。",
      });
    }
  };
  const resumePdfMiddleware: Connect.NextHandleFunction = (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "只支持 GET 请求" });
      return;
    }

    if (!requireResumeAccess(req, res)) {
      return;
    }

    if (!existsSync(resumePdfPath)) {
      sendJson(res, 404, { error: "PDF 简历文件不存在。" });
      return;
    }

    const fileStats = statSync(resumePdfPath);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(fileStats.size));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${resumePdfDownloadNameFallback}"; filename*=UTF-8''${encodeURIComponent(resumePdfDownloadName)}`,
    );

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    createReadStream(resumePdfPath).pipe(res);
  };

  return {
    plugins: [
      react(),
      {
        name: "local-avatar-api",
        configureServer(server) {
          server.middlewares.use("/api/admin-status", handleAdminStatus);
          server.middlewares.use("/api/admin-unlock", adminUnlockMiddleware);
          server.middlewares.use("/api/admin-site-settings", handleAdminSiteSettings);
          server.middlewares.use("/api/admin-managed-files", handleAdminManagedFiles);
          server.middlewares.use("/api/admin-articles", handleAdminArticles);
          server.middlewares.use("/api/admin-avatar-conversations", handleAdminAvatarConversations);
          server.middlewares.use("/api/admin-avatar-conversation-analysis", avatarConversationAnalysisMiddleware);
          server.middlewares.use("/api/admin-visits", handleVisitDashboard);
          server.middlewares.use("/api/admin-kick-visit", handleKickVisit);
          server.middlewares.use("/api/site-settings", handlePublicSiteSettings);
          server.middlewares.use("/api/site-asset", handlePublicSiteAsset);
          server.middlewares.use("/api/articles", handlePublicArticles);
          server.middlewares.use("/api/visit-track", handleVisitTrack);
          server.middlewares.use("/api/resume-status", handleResumeStatus);
          server.middlewares.use("/api/resume-unlock", resumeUnlockMiddleware);
          server.middlewares.use("/api/resume-data", resumeDataMiddleware);
          server.middlewares.use("/api/resume-pdf", resumePdfMiddleware);
          server.middlewares.use("/api/avatar-chat", avatarMiddleware);
        },
        configurePreviewServer(server) {
          server.middlewares.use("/api/admin-status", handleAdminStatus);
          server.middlewares.use("/api/admin-unlock", adminUnlockMiddleware);
          server.middlewares.use("/api/admin-site-settings", handleAdminSiteSettings);
          server.middlewares.use("/api/admin-managed-files", handleAdminManagedFiles);
          server.middlewares.use("/api/admin-articles", handleAdminArticles);
          server.middlewares.use("/api/admin-avatar-conversations", handleAdminAvatarConversations);
          server.middlewares.use("/api/admin-avatar-conversation-analysis", avatarConversationAnalysisMiddleware);
          server.middlewares.use("/api/admin-visits", handleVisitDashboard);
          server.middlewares.use("/api/admin-kick-visit", handleKickVisit);
          server.middlewares.use("/api/site-settings", handlePublicSiteSettings);
          server.middlewares.use("/api/site-asset", handlePublicSiteAsset);
          server.middlewares.use("/api/articles", handlePublicArticles);
          server.middlewares.use("/api/visit-track", handleVisitTrack);
          server.middlewares.use("/api/resume-status", handleResumeStatus);
          server.middlewares.use("/api/resume-unlock", resumeUnlockMiddleware);
          server.middlewares.use("/api/resume-data", resumeDataMiddleware);
          server.middlewares.use("/api/resume-pdf", resumePdfMiddleware);
          server.middlewares.use("/api/avatar-chat", avatarMiddleware);
        },
      },
    ],
  };
});
