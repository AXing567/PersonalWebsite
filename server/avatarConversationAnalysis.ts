import type { Connect } from "vite";
import { requireAdminAccess } from "./adminAccess";
import { readAvatarConversations } from "./avatarConversationLog";
import { buildAvatarKnowledgeDigest } from "./avatarKnowledge";
import { sendJson } from "./resumeAccess";

type EndpointCandidate = {
  mode: "chat" | "responses";
  url: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
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
  error?:
    | string
    | {
        message?: string;
      };
  detail?: string;
  message?: string;
};

const ANALYSIS_TIMEOUT_MS = 20_000;
const MAX_ANALYSIS_CONVERSATIONS = 200;
const MAX_QUESTION_LENGTH = 700;

const getEnvValue = (env: Record<string, string>, key: string) => {
  const match = Object.entries(env).find(([envKey]) => envKey.replace(/^\uFEFF/, "") === key);
  return match?.[1]?.trim() || "";
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

const normalizeQuestion = (question: string) => {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_QUESTION_LENGTH ? `${normalized.slice(0, MAX_QUESTION_LENGTH)}...` : normalized;
};

const buildConversationDigest = () => {
  const conversations = readAvatarConversations()
    .filter((conversation) => conversation.question.trim())
    .slice(0, MAX_ANALYSIS_CONVERSATIONS);
  const completedCount = conversations.filter((conversation) => conversation.status === "completed").length;
  const insufficientCount = conversations.filter((conversation) => conversation.status === "insufficient-data").length;
  const errorCount = conversations.filter((conversation) => conversation.status === "error").length;
  const uniqueIpCount = new Set(conversations.map((conversation) => conversation.ip)).size;
  const questions = conversations.map((conversation, index) => {
    const time = new Date(conversation.startedAt).toISOString();
    return `${index + 1}. [${time}] ${normalizeQuestion(conversation.question)}`;
  });

  return {
    conversations,
    promptText: [
      `统计范围：最近 ${conversations.length} 条 AI 分身对话；独立 IP 数：${uniqueIpCount}。`,
      `状态：完成 ${completedCount} 条，资料不足 ${insufficientCount} 条，失败 ${errorCount} 条。`,
      "",
      "用户问题列表：",
      questions.join("\n") || "暂无用户问题。",
    ].join("\n"),
  };
};

const buildAnalysisPrompt = (conversationDigest: string, knowledgeDigest: string) => `你是一个务实的个人主页运营分析助手。

请基于“用户问题列表”和“站点主人的能力/项目/简历资料”，分析访问者在 AI 分身里真正关心什么，以及站点主人可以怎样改进主页、AI 分身资料和自身能力表达。

输出要求：
1. 使用中文 Markdown。
2. 不要提及用户 IP、用户画像推断、隐私身份猜测。
3. 优先从问题文本归纳，不要编造用户没有问过的需求。
4. 建议要结合站点主人现有能力资料，说明“已有优势”“资料缺口”“能力提升方向”。
5. 如果对话数量太少，要明确说明样本不足，但仍给出谨慎观察。
6. 控制在 900 到 1400 字之间。

建议结构：
- 总体判断
- 用户最常问什么
- 用户在乎什么
- 和站点主人当前能力的匹配度
- 建议补充到网站/AI 分身的资料
- 建议提升的能力或表达

用户问题列表：
${conversationDigest}

站点主人的能力/项目/简历资料：
${knowledgeDigest}`;

const callAnalysisModel = async (env: Record<string, string>, prompt: string) => {
  const apiUrl = getEnvValue(env, "AVATAR_API_URL");
  const apiKey = getEnvValue(env, "AVATAR_API_KEY");
  const model = getEnvValue(env, "AVATAR_MODEL");

  if (!apiUrl || !apiKey || !model) {
    throw new Error("模型配置不完整，请检查 AVATAR_API_URL、AVATAR_API_KEY、AVATAR_MODEL。");
  }

  const endpoints = getEndpointCandidates(apiUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  let lastError: Error | undefined;

  try {
    for (const endpoint of endpoints) {
      const body =
        endpoint.mode === "responses"
          ? {
              input: [{ role: "user", content: prompt }],
              instructions: "你负责给个人主页管理者做访客问题洞察分析，输出可执行建议。",
              model,
              stream: false,
              temperature: 0.25,
            }
          : {
              messages: [
                {
                  role: "system",
                  content: "你负责给个人主页管理者做访客问题洞察分析，输出可执行建议。",
                },
                { role: "user", content: prompt },
              ],
              model,
              stream: false,
              temperature: 0.25,
            };

      try {
        const response = await fetch(endpoint.url, {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });
        const rawText = await response.text();
        let data: ChatCompletionResponse = {};

        try {
          data = rawText ? (JSON.parse(rawText) as ChatCompletionResponse) : {};
        } catch {
          data = {};
        }

        if (!response.ok) {
          throw new Error(extractErrorMessage(data, rawText, response.status));
        }

        const analysis = extractModelText(data).trim();
        if (!analysis) throw new Error("模型没有返回可展示的分析内容。");
        return analysis;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("模型分析请求失败。");
      }
    }

    throw lastError ?? new Error("模型分析请求失败。");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`模型分析超过 ${Math.round(ANALYSIS_TIMEOUT_MS / 1000)} 秒未响应。`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const buildAvatarConversationAnalysisMiddleware =
  (env: Record<string, string>): Connect.NextHandleFunction =>
  async (req, res) => {
    if (!requireAdminAccess(req, res)) return;

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "只支持 POST 请求" });
      return;
    }

    const { conversations, promptText } = buildConversationDigest();
    if (!conversations.length) {
      sendJson(res, 200, {
        analysis: "## 样本不足\n\n当前还没有可分析的 AI 分身对话记录。等有用户提问后，再生成分析会更有价值。",
        analyzedCount: 0,
        generatedAt: Date.now(),
      });
      return;
    }

    try {
      const knowledgeDigest = buildAvatarKnowledgeDigest();
      const analysis = await callAnalysisModel(env, buildAnalysisPrompt(promptText, knowledgeDigest));
      sendJson(res, 200, {
        analysis,
        analyzedCount: conversations.length,
        generatedAt: Date.now(),
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "AI 对话分析失败。",
      });
    }
  };
