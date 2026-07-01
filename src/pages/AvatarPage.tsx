import { FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  BrainCircuit,
  FileLock2,
  ShieldCheck,
  LoaderCircle,
  Send,
} from "lucide-react";
import AmbientCanvas from "../components/AmbientCanvas";
import GlassCard from "../components/GlassCard";
import LoadingSignal from "../components/LoadingSignal";
import MarkdownMessage from "../components/MarkdownMessage";
import { createGreeting, suggestedQuestions, type ChatMessage } from "../data/avatarKnowledge";
import { profile } from "../data/profile";
import {
  formatResumeAccessDuration,
  getResumeAccessStatus,
  unlockResume,
  type ResumeAccessStatus,
} from "../utils/resumeAccess";

type AvatarStreamEvent =
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

const createMessageId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const parseStreamLine = (line: string): AvatarStreamEvent | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as AvatarStreamEvent;
  } catch {
    return null;
  }
};

const avatarLoadingSteps = [{ label: "检索资料" }, { label: "组织回答" }, { label: "流式输出" }];

const callAvatarApi = async (
  question: string,
  history: ChatMessage[],
  onEvent: (event: AvatarStreamEvent) => void,
) => {
  const recentHistory = history.filter((message) => message.id !== "assistant-greeting").slice(-10);
  const response = await fetch("/api/avatar-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      question,
      history: recentHistory.map((message) => ({
        role: message.role,
        text: message.text,
      })),
    }),
  });

  if (!response.ok) {
    const rawText = await response.text();
    let message = rawText || `请求失败：HTTP ${response.status}`;

    try {
      const payload = JSON.parse(rawText) as { error?: string };
      message = payload.error || message;
    } catch {
      message = rawText || message;
    }

    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("当前浏览器不支持流式读取，请换用新版浏览器。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseStreamLine(line);
        if (event) onEvent(event);
      }
    }

    const tailEvent = parseStreamLine(buffer);
    if (tailEvent) onEvent(tailEvent);
  } finally {
    reader.releaseLock();
  }
};

export default function AvatarPage() {
  const [accessStatus, setAccessStatus] = useState<ResumeAccessStatus>({
    failedAttempts: 0,
    isLocked: false,
    isUnlocked: false,
    remainingAttempts: 5,
    remainingLockMs: 0,
  });
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createGreeting()]);
  const [input, setInput] = useState("");
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [status, setStatus] = useState("本地 AI 服务已接管模型配置");
  const [isLoading, setIsLoading] = useState(false);
  const isAllowed = accessStatus.isUnlocked;
  const isLocked = accessStatus.isLocked;

  useEffect(() => {
    let isActive = true;

    const checkAccess = async () => {
      try {
        const accessStatus = await getResumeAccessStatus();
        if (isActive) {
          setAccessStatus(accessStatus);
        }
      } finally {
        if (isActive) {
          setIsCheckingAccess(false);
        }
      }
    };

    void checkAccess();
    return () => {
      isActive = false;
    };
  }, []);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      text: trimmed,
    };
    const assistantMessageId = createMessageId();
    const history = messages;
    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        text: "",
      },
    ]);
    setInput("");
    setIsLoading(true);
    setStatus("AI 分身正在建立流式连接...");

    try {
      await callAvatarApi(trimmed, history, (event) => {
        if (event.type === "status") {
          setStatus(event.message);
          return;
        }

        if (event.type === "reset") {
          setMessages((current) =>
            current.map((message) => (message.id === assistantMessageId ? { ...message, text: "" } : message)),
          );
          return;
        }

        if (event.type === "chunk") {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId ? { ...message, text: `${message.text}${event.text}` } : message,
            ),
          );
          return;
        }

        if (event.type === "done") {
          setStatus(event.message);
          return;
        }

        if (event.type === "error") {
          throw new Error(event.message);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "本地 AI 服务调用失败，请检查 .env 配置。";
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantMessageId ? { ...item, text: `调用 AI 分身失败：${message}` } : item,
        ),
      );
      setStatus("调用失败，请检查本地 .env 里的模型配置");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void ask(input);
  };

  const handleUnlockSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedPassword = new FormData(event.currentTarget).get("avatar-password");
    const normalizedPassword = typeof submittedPassword === "string" ? submittedPassword.trim() : "";

    const currentStatus = await getResumeAccessStatus();
    if (currentStatus.isLocked) {
      setAccessStatus(currentStatus);
      setUnlockError(`尝试次数过多，请 ${formatResumeAccessDuration(currentStatus.remainingLockMs)} 后再试。`);
      return;
    }

    setIsSubmittingPassword(true);
    try {
      const nextStatus = await unlockResume(normalizedPassword);
      setAccessStatus(nextStatus);
      setPassword("");
      setUnlockError("");
    } catch (error) {
      const nextStatus = await getResumeAccessStatus();
      setAccessStatus(nextStatus);
      setPassword("");
      setUnlockError(
        nextStatus.isLocked
          ? "密码错误次数过多，已锁定 30 分钟。"
          : error instanceof Error
            ? error.message
            : `密码不正确，还可重试 ${nextStatus.remainingAttempts} 次。`,
      );
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  return (
    <main className="site-shell avatar-shell">
      <AmbientCanvas />
      <header className="top-nav">
        <a className="brand-mark" href="#/">
          <span>YOU</span>
          <strong>{profile.name}</strong>
        </a>
        <nav aria-label="AI 分身页导航">
          <a className="nav-cta" href="#/">
            <ArrowLeft size={16} />
            返回首页
          </a>
        </nav>
      </header>

      {isCheckingAccess ? (
        <section className="gate-section">
          <GlassCard className="password-card reveal" tone="strong">
            <LoadingSignal label="正在确认 AI 分身访问权限" />
            <div className="gate-icon">
              <FileLock2 size={30} />
            </div>
            <span className="status-pill">Resume required</span>
            <h1>正在确认访问状态</h1>
            <p>AI 分身需要简历访问权限，系统正在确认当前会话状态。</p>
          </GlassCard>
        </section>
      ) : !isAllowed ? (
        <section className="gate-section">
          <GlassCard className="password-card reveal" tone="strong">
            <div className="gate-icon">
              <FileLock2 size={30} />
            </div>
            <span className="status-pill">Resume required</span>
            <h1>输入密码访问 AI 分身</h1>
            <p>AI 分身与完整简历共用同一访问密码和错误锁定机制。解锁后 12 小时内可同时查看简历和聊天。</p>
            <form onSubmit={handleUnlockSubmit}>
              <label htmlFor="avatar-password">访问密码</label>
              <input
                autoComplete="current-password"
                disabled={isLocked || isSubmittingPassword}
                id="avatar-password"
                name="avatar-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isLocked ? "访问暂时锁定" : "请输入密码"}
                type="password"
                value={password}
              />
              {unlockError ? <span className="form-error">{unlockError}</span> : null}
              <button className="primary-button" disabled={isLocked || isSubmittingPassword} type="submit">
                <ShieldCheck size={18} />
                {isSubmittingPassword ? "正在验证" : isLocked ? "暂时锁定" : "解锁 AI 分身"}
              </button>
            </form>
          </GlassCard>
        </section>
      ) : (
        <section className="avatar-layout">
          <div className="chat-panel">
            <div className="chat-scroll">
              <div className="chat-header">
                <div>
                  <span>Live LLM Chat</span>
                  <h1>和网站主人的 AI 分身聊聊</h1>
                </div>
                <BrainCircuit size={28} />
              </div>
              <div className="chat-status-bar">
                <span>AI Avatar</span>
                <strong>{status}</strong>
              </div>
              {isLoading ? <LoadingSignal label="AI 分身正在处理问题" steps={avatarLoadingSteps} /> : null}

              <div className="suggestion-row" aria-label="推荐问题">
                {suggestedQuestions.map((question) => (
                  <button disabled={isLoading} key={question} onClick={() => void ask(question)} type="button">
                    {question}
                  </button>
                ))}
              </div>

              <div className="chat-messages" aria-live="polite">
                {messages.map((message) => (
                  <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                    <div className="chat-bubble">
                      {message.role === "assistant" ? (
                        <MarkdownMessage text={message.text || "正在生成..."} />
                      ) : (
                        <p>{message.text}</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <form className="chat-input" onSubmit={handleSubmit}>
              <label htmlFor="avatar-question">向 AI 分身提问</label>
              <div>
                <input
                  disabled={isLoading}
                  id="avatar-question"
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="例如：他为什么适合 AI 工具化方向？"
                  value={input}
                />
                <button aria-label="发送问题" disabled={isLoading} type="submit">
                  {isLoading ? <LoaderCircle size={18} /> : <Send size={18} />}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}
    </main>
  );
}
