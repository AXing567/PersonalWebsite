import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpenText, Clock3, Eye, MessageSquareText, Palette, RefreshCw, Wifi } from "lucide-react";
import {
  formatDateTime,
  formatDuration,
  getAdminArticles,
  getAdminSiteSettings,
  getAvatarConversationDashboard,
  getVisitDashboard,
  type AvatarConversationDashboard,
  type SiteArticle,
  type SiteSettings,
  type VisitDashboard,
} from "../../utils/adminAccess";
import {
  calculateVisitQualityStats,
  emptyConversationDashboard,
  emptyDashboard,
  emptySettings,
  formatPageName,
  getSiteThemeLabel,
} from "./adminUtils";

export default function AdminOverviewPage() {
  const [dashboard, setDashboard] = useState<VisitDashboard>(emptyDashboard);
  const [conversationDashboard, setConversationDashboard] = useState<AvatarConversationDashboard>(emptyConversationDashboard);
  const [settings, setSettings] = useState<SiteSettings>(emptySettings);
  const [articles, setArticles] = useState<SiteArticle[]>([]);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const publishedCount = useMemo(() => articles.filter((article) => article.isPublished).length, [articles]);
  const draftCount = Math.max(0, articles.length - publishedCount);
  const qualityStats = useMemo(() => calculateVisitQualityStats(dashboard.visits), [dashboard.visits]);
  const topPage = useMemo(() => {
    const counts = new Map<string, number>();
    dashboard.visits.forEach((visit) => {
      counts.set(visit.page, (counts.get(visit.page) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([page, visits]) => ({ page, visits }))
      .sort((left, right) => right.visits - left.visits)[0];
  }, [dashboard.visits]);

  const refreshOverview = async () => {
    setIsRefreshing(true);
    try {
      const [nextDashboard, nextConversationDashboard, nextSettings, nextArticles] = await Promise.all([
        getVisitDashboard(),
        getAvatarConversationDashboard(),
        getAdminSiteSettings(),
        getAdminArticles(),
      ]);
      setDashboard(nextDashboard);
      setConversationDashboard(nextConversationDashboard);
      setSettings(nextSettings);
      setArticles(nextArticles);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "管理数据读取失败。");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshOverview();
  }, []);

  return (
    <section className="admin-content">
      <section className="admin-hero reveal">
        <span className="status-pill">Private Console</span>
        <h1>管理后台总览</h1>
        <p>总览只保留关键状态和入口。访问明细、文章编辑、AI 对话和站点设置已经拆到独立页面，日常查看会更清楚。</p>
        <button className="admin-refresh-button" disabled={isRefreshing} onClick={() => void refreshOverview()} type="button">
          <RefreshCw size={16} />
          {isRefreshing ? "刷新中" : "刷新数据"}
        </button>
      </section>

      {error ? <div className="admin-error">{error}</div> : null}

      <section className="admin-metrics reveal delay-1" aria-label="管理后台概览">
        <article>
          <Eye size={18} />
          <span>总访问</span>
          <strong>{dashboard.totalVisits}</strong>
        </article>
        <article>
          <Wifi size={18} />
          <span>当前在线</span>
          <strong>{dashboard.activeCount}</strong>
        </article>
        <article>
          <Clock3 size={18} />
          <span>平均停留</span>
          <strong>{formatDuration(qualityStats.trimmedAverageDurationMs)}</strong>
        </article>
        <article>
          <BookOpenText size={18} />
          <span>发布文章</span>
          <strong>{publishedCount}</strong>
        </article>
        <article>
          <MessageSquareText size={18} />
          <span>AI 对话</span>
          <strong>{conversationDashboard.conversations.length}</strong>
        </article>
        <article>
          <Palette size={18} />
          <span>站点主题</span>
          <strong>{getSiteThemeLabel(settings.siteTheme)}</strong>
        </article>
      </section>

      <section className="admin-overview-grid reveal delay-1" aria-label="管理入口">
        <a className="admin-overview-card" href="#/admin/visits">
          <span>
            <BarChart3 size={17} />
            访问记录
          </span>
          <strong>{topPage ? formatPageName(topPage.page) : "暂无访问"}</strong>
          <p>{topPage ? `访问最多页面：${topPage.visits} 次。点击查看图表、筛选列表和在线会话。` : "查看访客页面、地区、停留时间和在线状态。"}</p>
        </a>
        <a className="admin-overview-card" href="#/admin/articles">
          <span>
            <BookOpenText size={17} />
            文章管理
          </span>
          <strong>{articles.length} 篇文章</strong>
          <p>{publishedCount} 篇已发布，{draftCount} 篇草稿。上传、编辑、发布和删除文章都在这里处理。</p>
        </a>
        <a className="admin-overview-card" href="#/admin/avatar">
          <span>
            <MessageSquareText size={17} />
            AI 对话
          </span>
          <strong>{settings.avatarKnowledgeMode === "full-context" ? "全量上下文" : "RAG 检索"}</strong>
          <p>{conversationDashboard.conversations.length} 条历史对话。查看用户问题、对话分析和 AI 分身知识模式。</p>
        </a>
        <a className="admin-overview-card" href="#/admin/settings">
          <span>
            <Palette size={17} />
            管理设置
          </span>
          <strong>{getSiteThemeLabel(settings.siteTheme)}</strong>
          <p>首页文章入口当前{settings.showArticlesEntry ? "已打开" : "已关闭"}。点击切换站点主题和公开入口。</p>
        </a>
      </section>

      <section className="admin-overview-activity reveal delay-1" aria-label="最近动态">
        <div className="admin-table-head">
          <div>
            <span>Recent Signals</span>
            <h2>最近动态</h2>
          </div>
          <strong>更新 {formatDateTime(dashboard.generatedAt)}</strong>
        </div>
        <div className="admin-overview-activity-list">
          <article>
            <span>访问</span>
            <p>{dashboard.visits[0] ? `${dashboard.visits[0].ip} 正在/曾经查看 ${formatPageName(dashboard.visits[0].page)}` : "暂无访问记录。"}</p>
          </article>
          <article>
            <span>文章</span>
            <p>{articles[0] ? `最近文章：《${articles[0].title}》` : "暂无文章，可以在文章管理页上传或编辑。"}</p>
          </article>
          <article>
            <span>AI</span>
            <p>
              {conversationDashboard.conversations[0]
                ? `最近问题：${conversationDashboard.conversations[0].question}`
                : "暂无 AI 分身对话记录。"}
            </p>
          </article>
        </div>
      </section>
    </section>
  );
}
