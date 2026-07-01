export type AdminAccessStatus = {
  failedAttempts: number;
  isLocked: boolean;
  isUnlocked: boolean;
  remainingAttempts: number;
  remainingLockMs: number;
  unlockedUntil?: number;
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

export type VisitRecord = {
  durationMs: number;
  endedAt?: number;
  geo?: IpGeoInfo;
  id: string;
  ip: string;
  isActive: boolean;
  kickedAt?: number;
  lastSeenAt: number;
  page: string;
  referrer?: string;
  startedAt: number;
  userAgent?: string;
};

export type VisitDashboard = {
  activeCount: number;
  generatedAt: number;
  totalDurationMs: number;
  totalVisits: number;
  visits: VisitRecord[];
};

export type AvatarConversationMessage = {
  role: "assistant" | "user";
  text: string;
};

export type AvatarConversationRecord = {
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
  status: "completed" | "error" | "insufficient-data" | "streaming";
  updatedAt: number;
  userAgent?: string;
};

export type AvatarConversationDashboard = {
  conversations: AvatarConversationRecord[];
  generatedAt: number;
};

export type AvatarConversationAnalysis = {
  analysis: string;
  analyzedCount: number;
  generatedAt: number;
};

export type SiteSettings = {
  avatarKnowledgeMode: "full-context" | "rag";
  excludedVisitIps: string[];
  publicProfile: PublicProfileSettings;
  siteTheme: "aurora" | "frost" | "moss";
  showArticlesEntry: boolean;
  updatedAt: number;
};

export type PublicProfileSettings = {
  brandInitials: string;
  browserTitle: string;
  englishName: string;
  heroPrimaryActionLabel: string;
  heroSecondaryActionLabel: string;
  heroSummary: string;
  heroTitle: string;
  metaDescription: string;
  name: string;
  orbitLabel: string;
  roleTitle: string;
};

export type PublicSiteSettings = Pick<SiteSettings, "publicProfile" | "showArticlesEntry" | "siteTheme" | "updatedAt">;

export type SiteArticleSummary = {
  createdAt: number;
  isPublished: boolean;
  publishedAt?: number;
  slug: string;
  summary: string;
  title: string;
  updatedAt: number;
};

export type SiteArticle = SiteArticleSummary & {
  content: string;
};

export type ArticleInput = {
  content: string;
  isPublished: boolean;
  originalSlug?: string;
  slug: string;
  summary: string;
  title: string;
};

export type ManagedFileCategory =
  | "articles"
  | "avatar-notes"
  | "resume-data"
  | "resume-pdf"
  | "runtime-settings"
  | "site-assets";

export type ManagedFileMeta = {
  exists: boolean;
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt?: number;
};

export type RuntimeSecretStatus = {
  isConfigured: boolean;
  key: string;
  value: string;
};

export type RuntimeBackupMeta = {
  action: string;
  category: ManagedFileCategory;
  createdAt: number;
  id: string;
  isDirectory: boolean;
  itemName: string;
  originalPath: string;
  size: number;
};

export type ManagedFileCategorySummary = {
  backups: RuntimeBackupMeta[];
  category: ManagedFileCategory;
  current: ManagedFileMeta;
  files: ManagedFileMeta[];
  secretStatus?: RuntimeSecretStatus[];
};

export type ManagedFilesDashboard = {
  categories: ManagedFileCategorySummary[];
  generatedAt: number;
};

type AdminAccessResponse = {
  error?: string;
  status?: AdminAccessStatus;
};

type ArticlesResponse = {
  article?: SiteArticle;
  articles?: SiteArticle[];
  error?: string;
  generatedAt?: number;
};

const fallbackStatus: AdminAccessStatus = {
  failedAttempts: 0,
  isLocked: false,
  isUnlocked: false,
  remainingAttempts: 3,
  remainingLockMs: 0,
};

export const fallbackPublicProfile: PublicProfileSettings = {
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
};

const readJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
};

export const getAdminAccessStatus = async () => {
  const response = await fetch("/api/admin-status", {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    return fallbackStatus;
  }

  return readJson<AdminAccessStatus>(response);
};

export const unlockAdmin = async (password: string) => {
  const response = await fetch("/api/admin-unlock", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const payload = await readJson<AdminAccessResponse>(response);

  if (!response.ok) {
    throw new Error(payload.error || "管理页面解锁失败。");
  }

  return payload.status ?? fallbackStatus;
};

export const getVisitDashboard = async () => {
  const response = await fetch("/api/admin-visits", {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await readJson<AdminAccessResponse>(response);
    throw new Error(payload.error || "访问统计读取失败。");
  }

  return readJson<VisitDashboard>(response);
};

export const kickVisitSession = async (id: string) => {
  const response = await fetch("/api/admin-kick-visit", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id }),
  });
  const payload = await readJson<{ error?: string; kickedAt?: number }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "踢出访问会话失败。");
  }

  return payload;
};

export const getAvatarConversationDashboard = async () => {
  const response = await fetch("/api/admin-avatar-conversations", {
    cache: "no-store",
    credentials: "include",
  });
  const payload = await readJson<AvatarConversationDashboard & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "历史对话记录读取失败。");
  }

  return {
    conversations: payload.conversations ?? [],
    generatedAt: payload.generatedAt ?? Date.now(),
  } satisfies AvatarConversationDashboard;
};

export const analyzeAvatarConversations = async () => {
  const response = await fetch("/api/admin-avatar-conversation-analysis", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
  });
  const payload = await readJson<Partial<AvatarConversationAnalysis> & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "AI 对话分析失败。");
  }

  return {
    analysis: payload.analysis ?? "",
    analyzedCount: payload.analyzedCount ?? 0,
    generatedAt: payload.generatedAt ?? Date.now(),
  } satisfies AvatarConversationAnalysis;
};

export const getPublicSiteSettings = async () => {
  const response = await fetch("/api/site-settings", {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    return {
      siteTheme: "aurora",
      publicProfile: fallbackPublicProfile,
      showArticlesEntry: false,
      updatedAt: Date.now(),
    } satisfies PublicSiteSettings;
  }

  return readJson<PublicSiteSettings>(response);
};

export const getAdminSiteSettings = async () => {
  const response = await fetch("/api/admin-site-settings", {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await readJson<{ error?: string }>(response);
    throw new Error(payload.error || "站点设置读取失败。");
  }

  return readJson<SiteSettings>(response);
};

export const updateAdminSiteSettings = async (
  settings: Partial<Pick<SiteSettings, "avatarKnowledgeMode" | "excludedVisitIps" | "publicProfile" | "showArticlesEntry" | "siteTheme">>,
) => {
  const response = await fetch("/api/admin-site-settings", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
  const payload = await readJson<SiteSettings & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "站点设置保存失败。");
  }

  return payload;
};

export const getManagedFilesDashboard = async () => {
  const response = await fetch("/api/admin-managed-files", {
    cache: "no-store",
    credentials: "include",
  });
  const payload = await readJson<ManagedFilesDashboard & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "文件管理数据读取失败。");
  }

  return payload;
};

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    });
    reader.addEventListener("error", () => reject(new Error("文件读取失败。")));
    reader.readAsDataURL(file);
  });

export const uploadManagedFile = async (
  category: ManagedFileCategory,
  file: File,
  options: { kind?: "favicon" | "logo" } = {},
) => {
  const response = await fetch(`/api/admin-managed-files?category=${encodeURIComponent(category)}`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentBase64: await fileToBase64(file),
      fileName: file.name,
      kind: options.kind,
    }),
  });
  const payload = await readJson<ManagedFilesDashboard & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "文件上传失败。");
  }

  return payload;
};

export const getRuntimeExportUrl = () => "/api/admin-managed-files?action=export";

export const getManagedFileDownloadUrl = (category: ManagedFileCategory, fileName?: string) => {
  const params = new URLSearchParams({
    action: "download",
    category,
  });
  if (fileName) params.set("fileName", fileName);
  return `/api/admin-managed-files?${params.toString()}`;
};

export const importRuntimeArchive = async (file: File) => {
  const response = await fetch("/api/admin-managed-files?action=import", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentBase64: await fileToBase64(file),
      fileName: file.name,
    }),
  });
  const payload = await readJson<ManagedFilesDashboard & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "运行数据导入失败。");
  }

  return payload;
};

export const deleteManagedFile = async (category: ManagedFileCategory, fileName: string) => {
  const response = await fetch(`/api/admin-managed-files?category=${encodeURIComponent(category)}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fileName }),
  });
  const payload = await readJson<ManagedFilesDashboard & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "文件删除失败。");
  }

  return payload;
};

export const restoreManagedBackup = async (category: ManagedFileCategory, id: string) => {
  const response = await fetch(`/api/admin-managed-files?category=${encodeURIComponent(category)}`, {
    method: "PATCH",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id }),
  });
  const payload = await readJson<ManagedFilesDashboard & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "备份恢复失败。");
  }

  return payload;
};

export const updateRuntimeSecrets = async (settings: Record<string, string>) => {
  const response = await fetch("/api/admin-managed-files?category=runtime-settings", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ settings }),
  });
  const payload = await readJson<ManagedFilesDashboard & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "运行配置保存失败。");
  }

  return payload;
};

export const getAdminArticles = async () => {
  const response = await fetch("/api/admin-articles", {
    cache: "no-store",
    credentials: "include",
  });
  const payload = await readJson<ArticlesResponse>(response);

  if (!response.ok) {
    throw new Error(payload.error || "文章列表读取失败。");
  }

  return payload.articles ?? [];
};

export const saveAdminArticle = async (article: ArticleInput) => {
  const response = await fetch("/api/admin-articles", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(article),
  });
  const payload = await readJson<ArticlesResponse>(response);

  if (!response.ok) {
    throw new Error(payload.error || "文章保存失败。");
  }

  return payload;
};

export const deleteAdminArticle = async (slug: string) => {
  const response = await fetch("/api/admin-articles", {
    method: "DELETE",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slug }),
  });
  const payload = await readJson<ArticlesResponse>(response);

  if (!response.ok) {
    throw new Error(payload.error || "文章删除失败。");
  }

  return payload.articles ?? [];
};

export const getPublicArticles = async () => {
  const response = await fetch("/api/articles", {
    cache: "no-store",
    credentials: "include",
  });
  const payload = await readJson<{ articles?: SiteArticleSummary[]; error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "文章列表读取失败。");
  }

  return payload.articles ?? [];
};

export const getPublicArticle = async (slug: string) => {
  const response = await fetch(`/api/articles?slug=${encodeURIComponent(slug)}`, {
    cache: "no-store",
    credentials: "include",
  });
  const payload = await readJson<SiteArticle & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "文章读取失败。");
  }

  return payload;
};

export const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
};

export const formatDateTime = (timestamp?: number) => {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(timestamp));
};
