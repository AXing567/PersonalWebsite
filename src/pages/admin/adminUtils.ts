import type { AvatarConversationDashboard, SiteArticle, SiteSettings, VisitDashboard } from "../../utils/adminAccess";

export type ArticleFormState = {
  content: string;
  isPublished: boolean;
  originalSlug?: string;
  slug: string;
  summary: string;
  title: string;
};

export type VisitStatusFilter = "all" | "offline" | "online";

export type VisitFilters = {
  ipQuery: string;
  page: string;
  region: string;
  status: VisitStatusFilter;
};

export const emptyDashboard: VisitDashboard = {
  activeCount: 0,
  generatedAt: Date.now(),
  totalDurationMs: 0,
  totalVisits: 0,
  visits: [],
};

export const emptyConversationDashboard: AvatarConversationDashboard = {
  conversations: [],
  generatedAt: Date.now(),
};

export const emptySettings: SiteSettings = {
  avatarKnowledgeMode: "full-context",
  excludedVisitIps: ["127.0.0.1"],
  publicProfile: {
    brandInitials: "YOU",
    browserTitle: "个人主页模板",
    englishName: "Your English Name",
    heroPrimaryActionLabel: "输入密码查看简历",
    heroSecondaryActionLabel: "和 AI 分身聊聊",
    heroSummary: "一个保持学习、关注 AI 与工程交付的个人主页。完整信息已放入加密简历页。",
    heroTitle: "把复杂问题，做成清晰可用的工具。",
    metaDescription: "可配置个人网站模板，聚焦个人主页、简历展示、AI 分身与后台管理。",
    name: "Your Name",
    orbitLabel: "AI Tooling",
    roleTitle: "AI Native Builder",
  },
  siteTheme: "aurora",
  showArticlesEntry: false,
  updatedAt: Date.now(),
};

export const emptyArticleForm: ArticleFormState = {
  content: "",
  isPublished: false,
  slug: "",
  summary: "",
  title: "",
};

export const siteThemeOptions: Array<{
  description: string;
  label: string;
  tone: SiteSettings["siteTheme"];
}> = [
  {
    description: "当前默认的深色科技感主题。",
    label: "极光蓝",
    tone: "aurora",
  },
  {
    description: "更轻、更透明，适合白天查看。",
    label: "冷光白",
    tone: "frost",
  },
  {
    description: "更沉稳，偏自然和长期阅读。",
    label: "苔原绿",
    tone: "moss",
  },
];

export const getSiteThemeLabel = (siteTheme: SiteSettings["siteTheme"]) =>
  siteThemeOptions.find((option) => option.tone === siteTheme)?.label ?? "默认主题";

export const emptyVisitFilters: VisitFilters = {
  ipQuery: "",
  page: "all",
  region: "all",
  status: "all",
};

const routeNameMap: Record<string, string> = {
  "/": "首页",
  "/admin": "管理页面",
  "/admin/articles": "文章管理",
  "/admin/avatar": "AI 对话",
  "/admin/files": "文件管理",
  "/admin/settings": "管理设置",
  "/admin/visits": "访问记录",
  "/articles": "文章页",
  "/avatar": "AI 分身",
  "/capabilities": "能力地图",
  "/personal-site": "个人主页项目",
  "/resume": "简历页",
};

export const formatPageName = (page: string) => routeNameMap[page] ?? page;

export const getPageTone = (page: string) => {
  const normalized = page.replace(/^\//, "").replace(/[^a-z-]/g, "");
  return normalized || "home";
};

export const toSlug = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

export const getAverageDuration = (totalDurationMs: number, totalVisits: number) =>
  totalVisits > 0 ? Math.round(totalDurationMs / totalVisits) : 0;

const QUICK_EXIT_MS = 5 * 1000;
const EFFECTIVE_VISIT_MS = 10 * 1000;
const DEEP_VISIT_MS = 60 * 1000;
const DURATION_SCORE_CAP_MS = 90 * 1000;
const TRIM_RATIO = 0.05;

export type VisitQualityStats = {
  averageDurationMs: number;
  deepVisitRate: number;
  effectiveVisitRate: number;
  medianDurationMs: number;
  qualityScore: number;
  quickExitRate: number;
  reliabilityLabel: string;
  sampleSize: number;
  trimmedAverageDurationMs: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getRate = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

const getMedianDuration = (durations: number[]) => {
  if (!durations.length) return 0;

  const middle = Math.floor(durations.length / 2);
  if (durations.length % 2 === 1) return durations[middle];

  return Math.round((durations[middle - 1] + durations[middle]) / 2);
};

const getTrimmedAverageDuration = (durations: number[]) => {
  if (!durations.length) return 0;

  const trimCount = durations.length >= 20 ? Math.floor(durations.length * TRIM_RATIO) : 0;
  const trimmedDurations = durations.slice(trimCount, durations.length - trimCount);
  const finalDurations = trimmedDurations.length ? trimmedDurations : durations;

  return Math.round(finalDurations.reduce((sum, duration) => sum + duration, 0) / finalDurations.length);
};

export const formatPercent = (value: number) => `${clamp(Math.round(value), 0, 100)}%`;

export const calculateVisitQualityStats = (
  visits: VisitDashboard["visits"],
  options: { volumeScore?: number } = {},
): VisitQualityStats => {
  const durations = visits.map((visit) => Math.max(0, visit.durationMs)).sort((left, right) => left - right);
  const sampleSize = durations.length;
  if (!sampleSize) {
    return {
      averageDurationMs: 0,
      deepVisitRate: 0,
      effectiveVisitRate: 0,
      medianDurationMs: 0,
      qualityScore: 0,
      quickExitRate: 0,
      reliabilityLabel: "暂无样本",
      sampleSize: 0,
      trimmedAverageDurationMs: 0,
    };
  }

  const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);
  const averageDurationMs = Math.round(totalDurationMs / sampleSize);
  const medianDurationMs = getMedianDuration(durations);
  const trimmedAverageDurationMs = getTrimmedAverageDuration(durations);
  const quickExitRate = getRate(durations.filter((duration) => duration < QUICK_EXIT_MS).length, sampleSize);
  const effectiveVisitRate = getRate(durations.filter((duration) => duration >= EFFECTIVE_VISIT_MS).length, sampleSize);
  const deepVisitRate = getRate(durations.filter((duration) => duration >= DEEP_VISIT_MS).length, sampleSize);
  const durationScore = clamp(Math.round((trimmedAverageDurationMs / DURATION_SCORE_CAP_MS) * 100), 0, 100);
  const engagementScore = Math.round(
    effectiveVisitRate * 0.34 + deepVisitRate * 0.22 + (100 - quickExitRate) * 0.18 + durationScore * 0.26,
  );
  const qualityScore =
    options.volumeScore === undefined
      ? engagementScore
      : Math.round(engagementScore * 0.78 + clamp(options.volumeScore, 0, 100) * 0.22);

  return {
    averageDurationMs,
    deepVisitRate,
    effectiveVisitRate,
    medianDurationMs,
    qualityScore: clamp(qualityScore, 0, 100),
    quickExitRate,
    reliabilityLabel: sampleSize >= 30 ? "样本稳定" : sampleSize >= 8 ? "样本可参考" : "样本偏少",
    sampleSize,
    trimmedAverageDurationMs,
  };
};

export const getVisitRegionLabel = (visit: VisitDashboard["visits"][number]) => {
  const geo = visit.geo;
  return (
    geo?.city ||
    [geo?.country, geo?.region].filter(Boolean).join(" ") ||
    geo?.summary ||
    (visit.ip === "unknown" ? "未知来源" : "本地/内网")
  );
};

export const formatGeoTitle = (visit: VisitDashboard["visits"][number]) => {
  const geo = visit.geo;
  if (!geo) return "等待地址解析";

  const lines = [
    geo.summary,
    geo.countryCode ? `国家代码：${geo.countryCode}` : "",
    geo.timezone ? `时区：${geo.timezone}` : "",
    geo.asn ? `ASN：${geo.asn}` : "",
    geo.latitude !== undefined && geo.longitude !== undefined ? `坐标：${geo.latitude}, ${geo.longitude}` : "",
  ].filter(Boolean);

  return lines.join("\n");
};

export const createArticleFormFromArticle = (article: SiteArticle): ArticleFormState => ({
  content: article.content,
  isPublished: article.isPublished,
  originalSlug: article.slug,
  slug: article.slug,
  summary: article.summary,
  title: article.title,
});

export const getConversationStatusText = (status: AvatarConversationDashboard["conversations"][number]["status"]) => {
  if (status === "completed") return "完成";
  if (status === "insufficient-data") return "资料不足";
  if (status === "error") return "失败";
  return "生成中";
};
