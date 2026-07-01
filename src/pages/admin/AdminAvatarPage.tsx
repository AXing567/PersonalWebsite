import { useEffect, useMemo, useState } from "react";
import { Lightbulb, MapPin, MessageSquareText, RefreshCw } from "lucide-react";
import LoadingSignal from "../../components/LoadingSignal";
import MarkdownMessage from "../../components/MarkdownMessage";
import {
  analyzeAvatarConversations,
  formatDateTime,
  formatDuration,
  getAdminSiteSettings,
  getAvatarConversationDashboard,
  updateAdminSiteSettings,
  type AvatarConversationAnalysis,
  type AvatarConversationDashboard,
  type SiteSettings,
} from "../../utils/adminAccess";
import { emptyConversationDashboard, emptySettings, getConversationStatusText } from "./adminUtils";

const emptyConversationAnalysis: AvatarConversationAnalysis = {
  analysis: "",
  analyzedCount: 0,
  generatedAt: 0,
};

export default function AdminAvatarPage() {
  const [conversationDashboard, setConversationDashboard] = useState<AvatarConversationDashboard>(emptyConversationDashboard);
  const [conversationAnalysis, setConversationAnalysis] = useState<AvatarConversationAnalysis>(emptyConversationAnalysis);
  const [settings, setSettings] = useState<SiteSettings>(emptySettings);
  const [error, setError] = useState("");
  const [contentMessage, setContentMessage] = useState("");
  const [isAnalyzingConversations, setIsAnalyzingConversations] = useState(false);
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const recentConversations = useMemo(() => conversationDashboard.conversations.slice(0, 120), [conversationDashboard.conversations]);
  const conversationIpCount = useMemo(
    () => new Set(conversationDashboard.conversations.map((conversation) => conversation.ip)).size,
    [conversationDashboard.conversations],
  );

  const refreshAvatarData = async () => {
    setIsRefreshing(true);
    try {
      const [nextSettings, nextConversationDashboard] = await Promise.all([getAdminSiteSettings(), getAvatarConversationDashboard()]);
      setSettings(nextSettings);
      setConversationDashboard(nextConversationDashboard);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "AI 对话数据读取失败。");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshAvatarData();
  }, []);

  const handleKnowledgeModeChange = async (avatarKnowledgeMode: SiteSettings["avatarKnowledgeMode"]) => {
    if (avatarKnowledgeMode === settings.avatarKnowledgeMode) return;

    setIsSavingContent(true);
    setContentMessage("");
    try {
      const nextSettings = await updateAdminSiteSettings({
        avatarKnowledgeMode,
      });
      setSettings(nextSettings);
      setContentMessage(
        nextSettings.avatarKnowledgeMode === "full-context" ? "AI 分身已切换为全量上下文模式。" : "AI 分身已切换为 RAG 检索模式。",
      );
    } catch (settingError) {
      setContentMessage(settingError instanceof Error ? settingError.message : "AI 分身知识模式保存失败。");
    } finally {
      setIsSavingContent(false);
    }
  };

  const handleAnalyzeConversations = async () => {
    setIsAnalyzingConversations(true);
    setError("");
    try {
      const nextAnalysis = await analyzeAvatarConversations();
      setConversationAnalysis(nextAnalysis);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "AI 对话分析失败。");
    } finally {
      setIsAnalyzingConversations(false);
    }
  };

  return (
    <section className="admin-content">
      <section className="admin-hero reveal">
        <span className="status-pill">Avatar Console</span>
        <h1>AI 对话相关</h1>
        <p>这里集中查看 AI 分身历史对话、用户关注点分析，以及 RAG / 全量上下文模式切换。</p>
        <button className="admin-refresh-button" disabled={isRefreshing} onClick={() => void refreshAvatarData()} type="button">
          <RefreshCw size={16} />
          {isRefreshing ? "刷新中" : "刷新 AI 数据"}
        </button>
      </section>

      {error ? <div className="admin-error">{error}</div> : null}

      <section className="admin-metrics reveal delay-1" aria-label="AI 对话概览">
        <article>
          <MessageSquareText size={18} />
          <span>历史对话</span>
          <strong>{conversationDashboard.conversations.length}</strong>
        </article>
        <article>
          <MapPin size={18} />
          <span>访问 IP</span>
          <strong>{conversationIpCount}</strong>
        </article>
        <article>
          <Lightbulb size={18} />
          <span>知识模式</span>
          <strong>{settings.avatarKnowledgeMode === "full-context" ? "全量" : "RAG"}</strong>
        </article>
      </section>

      <section className="admin-content-grid admin-avatar-control-grid reveal delay-1" aria-label="AI 分身设置">
        <article className="admin-control-panel">
          <div className="admin-panel-title">
            <span>Knowledge Mode</span>
            <h2>AI 分身知识模式</h2>
          </div>
          <div className="admin-mode-panel admin-mode-panel-standalone" aria-label="AI 分身知识模式">
            <div className="admin-mode-title">
              <strong>当前模式</strong>
              <span>{settings.avatarKnowledgeMode === "full-context" ? "全量上下文" : "RAG 检索"}</span>
            </div>
            <div className="admin-segmented-control">
              <button
                className={settings.avatarKnowledgeMode === "full-context" ? "is-active" : ""}
                disabled={isSavingContent}
                onClick={() => void handleKnowledgeModeChange("full-context")}
                type="button"
              >
                全量上下文
              </button>
              <button
                className={settings.avatarKnowledgeMode === "rag" ? "is-active" : ""}
                disabled={isSavingContent}
                onClick={() => void handleKnowledgeModeChange("rag")}
                type="button"
              >
                RAG 检索
              </button>
            </div>
            <p>
              {settings.avatarKnowledgeMode === "full-context"
                ? "每次回答都会读取完整核心资料，更适合当前个人分身。"
                : "先检索相关片段再回答，适合以后资料量很大时使用。"}
            </p>
          </div>
          {contentMessage ? <p className="admin-content-message">{contentMessage}</p> : null}
        </article>

        <article className="admin-control-panel">
          <div className="admin-panel-title">
            <span>Conversation Insight</span>
            <h2>AI 分析</h2>
          </div>
          <p className="admin-avatar-note">分析会汇总用户常问问题、关注点，并结合你的资料给出补充和提升建议。</p>
          <button
            className="admin-analysis-button"
            disabled={!recentConversations.length || isAnalyzingConversations}
            onClick={() => void handleAnalyzeConversations()}
            type="button"
          >
            <Lightbulb size={15} />
            {isAnalyzingConversations ? "分析中" : "AI 分析"}
          </button>
        </article>
      </section>

      <section className="admin-conversation-panel reveal delay-1" id="admin-conversations" aria-label="AI 分身历史对话记录">
        <div className="admin-table-head">
          <div>
            <span>Avatar Conversations</span>
            <h2>历史对话记录</h2>
          </div>
          <div className="admin-table-actions">
            <strong>
              {recentConversations.length} 条 / {conversationIpCount} 个 IP
            </strong>
            <button
              className="admin-analysis-button"
              disabled={!recentConversations.length || isAnalyzingConversations}
              onClick={() => void handleAnalyzeConversations()}
              type="button"
            >
              <Lightbulb size={15} />
              {isAnalyzingConversations ? "分析中" : "AI 分析"}
            </button>
          </div>
        </div>
        <div className="admin-conversation-analysis">
          {isAnalyzingConversations ? (
            <LoadingSignal label="AI 正在分析访客问题" />
          ) : conversationAnalysis.analysis ? (
            <>
              <div className="admin-analysis-meta">
                <span>已分析 {conversationAnalysis.analyzedCount} 条对话</span>
                <span>{formatDateTime(conversationAnalysis.generatedAt)}</span>
              </div>
              <MarkdownMessage text={conversationAnalysis.analysis} />
            </>
          ) : (
            <p>点击 AI 分析，可以汇总用户常问问题、关注点，以及结合你的资料给出补充和提升建议。</p>
          )}
        </div>
        <div className="admin-conversation-list">
          {recentConversations.length ? (
            recentConversations.map((conversation) => (
              <article className={`admin-conversation-card admin-conversation-${conversation.status}`} key={conversation.id}>
                <div className="admin-conversation-meta">
                  <span className={`conversation-status conversation-status-${conversation.status}`}>
                    {getConversationStatusText(conversation.status)}
                  </span>
                  <span title={conversation.ip}>
                    <MapPin size={14} />
                    {conversation.ip}
                  </span>
                  <span>{formatDateTime(conversation.startedAt)}</span>
                  <span>{formatDuration(conversation.durationMs)}</span>
                  <span>{conversation.attempts ? `${conversation.attempts} 轮` : "未调用"}</span>
                </div>
                <div className="admin-conversation-body">
                  <section>
                    <strong>用户问题</strong>
                    <p>{conversation.question}</p>
                  </section>
                  {conversation.history.length ? (
                    <section>
                      <strong>携带上下文</strong>
                      <p>
                        {conversation.history
                          .slice(-4)
                          .map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.text}`)
                          .join("\n")}
                      </p>
                    </section>
                  ) : null}
                  <section>
                    <strong>{conversation.error ? "错误信息" : "AI 回答"}</strong>
                    <p>{conversation.error || conversation.answer || "暂无回答内容。"}</p>
                  </section>
                </div>
              </article>
            ))
          ) : (
            <div className="admin-empty">暂时还没有 AI 分身对话记录。</div>
          )}
        </div>
      </section>
    </section>
  );
}
