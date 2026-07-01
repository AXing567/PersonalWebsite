import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import type { Connect } from "vite";
import { requireAdminAccess } from "./adminAccess";
import { readRequestBody, sendJson } from "./resumeAccess";
import { createRuntimeBackup } from "./runtimeBackups";

const settingsPath = path.resolve(process.cwd(), "server/private/site-settings.local.json");
const articlesPath = path.resolve(process.cwd(), "server/private/articles.local.json");
const DEFAULT_EXCLUDED_VISIT_IPS = ["127.0.0.1"];
const MAX_ARTICLE_CONTENT_LENGTH = 240_000;
const MAX_ARTICLE_COUNT = 120;
const MAX_EXCLUDED_VISIT_IPS = 80;

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

export type SiteArticle = {
  content: string;
  createdAt: number;
  isPublished: boolean;
  publishedAt?: number;
  slug: string;
  summary: string;
  title: string;
  updatedAt: number;
};

type SiteSettingsPayload = {
  avatarKnowledgeMode?: unknown;
  excludedVisitIps?: unknown;
  publicProfile?: unknown;
  siteTheme?: unknown;
  showArticlesEntry?: unknown;
};

type ArticlePayload = {
  content?: unknown;
  isPublished?: unknown;
  originalSlug?: unknown;
  slug?: unknown;
  summary?: unknown;
  title?: unknown;
};

const fallbackSettings: SiteSettings = {
  avatarKnowledgeMode: "full-context",
  excludedVisitIps: DEFAULT_EXCLUDED_VISIT_IPS,
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

const now = () => Date.now();

const ensurePrivateDir = () => {
  mkdirSync(path.dirname(settingsPath), { recursive: true });
};

const normalizeText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
};

const createSlug = (value: string) => {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return slug || `article-${now().toString(36)}`;
};

const normalizeSlug = (value: unknown, title: string) => {
  const rawSlug = normalizeText(value, 96);
  return createSlug(rawSlug || title);
};

const parseTimestamp = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const normalizeAvatarKnowledgeMode = (value: unknown): SiteSettings["avatarKnowledgeMode"] =>
  value === "rag" || value === "full-context" ? value : fallbackSettings.avatarKnowledgeMode;

const normalizeSiteTheme = (value: unknown): SiteSettings["siteTheme"] =>
  value === "frost" || value === "moss" || value === "aurora" ? value : fallbackSettings.siteTheme;

const normalizePublicProfile = (value: unknown, current = fallbackSettings.publicProfile): PublicProfileSettings => {
  const payload = typeof value === "object" && value ? (value as Partial<Record<keyof PublicProfileSettings, unknown>>) : {};

  return {
    brandInitials: normalizeText(payload.brandInitials, 12) || current.brandInitials,
    browserTitle: normalizeText(payload.browserTitle, 80) || current.browserTitle,
    englishName: normalizeText(payload.englishName, 80) || current.englishName,
    heroPrimaryActionLabel: normalizeText(payload.heroPrimaryActionLabel, 40) || current.heroPrimaryActionLabel,
    heroSecondaryActionLabel: normalizeText(payload.heroSecondaryActionLabel, 40) || current.heroSecondaryActionLabel,
    heroSummary: normalizeText(payload.heroSummary, 260) || current.heroSummary,
    heroTitle: normalizeText(payload.heroTitle, 120) || current.heroTitle,
    metaDescription: normalizeText(payload.metaDescription, 180) || current.metaDescription,
    name: normalizeText(payload.name, 60) || current.name,
    orbitLabel: normalizeText(payload.orbitLabel, 40) || current.orbitLabel,
    roleTitle: normalizeText(payload.roleTitle, 80) || current.roleTitle,
  };
};

export const normalizeVisitIpList = (value: unknown) => {
  const rawItems = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,\uFF0C\s]+/) : [];
  const normalizedIps = rawItems
    .map((item) => (typeof item === "string" ? item.trim().replace(/^::ffff:/, "") : ""))
    .filter((ip) => ip && isIP(ip));

  return Array.from(new Set(normalizedIps)).slice(0, MAX_EXCLUDED_VISIT_IPS);
};

const normalizeArticle = (value: Partial<SiteArticle>): SiteArticle | undefined => {
  const title = normalizeText(value.title, 120);
  const content = typeof value.content === "string" ? value.content.slice(0, MAX_ARTICLE_CONTENT_LENGTH) : "";
  const slug = normalizeSlug(value.slug, title);
  if (!title || !content || !slug) return undefined;

  const createdAt = parseTimestamp(value.createdAt) ?? now();
  const updatedAt = parseTimestamp(value.updatedAt) ?? createdAt;
  const isPublished = Boolean(value.isPublished);
  const publishedAt = isPublished ? parseTimestamp(value.publishedAt) ?? updatedAt : undefined;

  return {
    content,
    createdAt,
    isPublished,
    publishedAt,
    slug,
    summary: normalizeText(value.summary, 220),
    title,
    updatedAt,
  };
};

const sortArticles = (articles: SiteArticle[]) =>
  [...articles].sort((left, right) => (right.publishedAt ?? right.updatedAt) - (left.publishedAt ?? left.updatedAt));

export const readSiteSettings = (): SiteSettings => {
  if (!existsSync(settingsPath)) return fallbackSettings;

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as Partial<SiteSettings>;
    return {
      avatarKnowledgeMode: normalizeAvatarKnowledgeMode(parsed.avatarKnowledgeMode),
      excludedVisitIps: Array.isArray(parsed.excludedVisitIps)
        ? normalizeVisitIpList(parsed.excludedVisitIps)
        : fallbackSettings.excludedVisitIps,
      publicProfile: normalizePublicProfile(parsed.publicProfile),
      siteTheme: normalizeSiteTheme(parsed.siteTheme),
      showArticlesEntry: Boolean(parsed.showArticlesEntry),
      updatedAt: parseTimestamp(parsed.updatedAt) ?? fallbackSettings.updatedAt,
    };
  } catch {
    return fallbackSettings;
  }
};

const writeSiteSettings = (settings: SiteSettings) => {
  ensurePrivateDir();
  createRuntimeBackup("runtime-settings", settingsPath, "settings-save");
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
};

export const readArticles = () => {
  if (!existsSync(articlesPath)) return [] as SiteArticle[];

  try {
    const parsed = JSON.parse(readFileSync(articlesPath, "utf8")) as { articles?: Array<Partial<SiteArticle>> };
    const articles = Array.isArray(parsed.articles) ? parsed.articles : [];
    return sortArticles(articles.map(normalizeArticle).filter((article): article is SiteArticle => Boolean(article))).slice(
      0,
      MAX_ARTICLE_COUNT,
    );
  } catch {
    return [] as SiteArticle[];
  }
};

const writeArticles = (articles: SiteArticle[]) => {
  ensurePrivateDir();
  createRuntimeBackup("articles", articlesPath, "articles-save");
  writeFileSync(articlesPath, `${JSON.stringify({ articles: sortArticles(articles).slice(0, MAX_ARTICLE_COUNT) }, null, 2)}\n`, "utf8");
};

const toArticleSummary = (article: SiteArticle) => ({
  createdAt: article.createdAt,
  isPublished: article.isPublished,
  publishedAt: article.publishedAt,
  slug: article.slug,
  summary: article.summary,
  title: article.title,
  updatedAt: article.updatedAt,
});

const readJsonPayload = async <T>(req: Connect.IncomingMessage): Promise<T> => {
  const rawBody = await readRequestBody(req);
  return rawBody ? (JSON.parse(rawBody) as T) : ({} as T);
};

export const handlePublicSiteSettings: Connect.NextHandleFunction = (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "只支持 GET 请求" });
    return;
  }

  const settings = readSiteSettings();
  sendJson(res, 200, {
    publicProfile: settings.publicProfile,
    showArticlesEntry: settings.showArticlesEntry,
    siteTheme: settings.siteTheme,
    updatedAt: settings.updatedAt,
  } satisfies PublicSiteSettings);
};

export const handleAdminSiteSettings: Connect.NextHandleFunction = async (req, res) => {
  if (!requireAdminAccess(req, res)) return;

  if (req.method === "GET") {
    sendJson(res, 200, readSiteSettings());
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "只支持 GET 或 POST 请求" });
    return;
  }

  try {
    const payload = await readJsonPayload<SiteSettingsPayload>(req);
    const currentSettings = readSiteSettings();
    const settings = {
      avatarKnowledgeMode:
        payload.avatarKnowledgeMode === undefined
          ? currentSettings.avatarKnowledgeMode
          : normalizeAvatarKnowledgeMode(payload.avatarKnowledgeMode),
      excludedVisitIps:
        payload.excludedVisitIps === undefined ? currentSettings.excludedVisitIps : normalizeVisitIpList(payload.excludedVisitIps),
      publicProfile:
        payload.publicProfile === undefined
          ? currentSettings.publicProfile
          : normalizePublicProfile(payload.publicProfile, currentSettings.publicProfile),
      siteTheme: payload.siteTheme === undefined ? currentSettings.siteTheme : normalizeSiteTheme(payload.siteTheme),
      showArticlesEntry: typeof payload.showArticlesEntry === "boolean" ? payload.showArticlesEntry : currentSettings.showArticlesEntry,
      updatedAt: now(),
    };
    writeSiteSettings(settings);
    sendJson(res, 200, settings);
  } catch {
    sendJson(res, 400, { error: "站点设置保存失败，请检查请求内容。" });
  }
};

export const handlePublicArticles: Connect.NextHandleFunction = (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "只支持 GET 请求" });
    return;
  }

  const requestUrl = new URL(req.url ?? "/", "http://local");
  const slug = requestUrl.searchParams.get("slug")?.trim();
  const publishedArticles = readArticles().filter((article) => article.isPublished);

  if (slug) {
    const article = publishedArticles.find((item) => item.slug === slug);
    if (!article) {
      sendJson(res, 404, { error: "文章不存在或暂未发布。" });
      return;
    }

    sendJson(res, 200, article);
    return;
  }

  sendJson(res, 200, {
    articles: publishedArticles.map(toArticleSummary),
    generatedAt: now(),
  });
};

export const handleAdminArticles: Connect.NextHandleFunction = async (req, res) => {
  if (!requireAdminAccess(req, res)) return;

  if (req.method === "GET") {
    sendJson(res, 200, {
      articles: readArticles(),
      generatedAt: now(),
    });
    return;
  }

  if (req.method === "POST") {
    try {
      const payload = await readJsonPayload<ArticlePayload>(req);
      const title = normalizeText(payload.title, 120);
      const content = typeof payload.content === "string" ? payload.content.slice(0, MAX_ARTICLE_CONTENT_LENGTH) : "";
      const slug = normalizeSlug(payload.slug, title);
      const originalSlug = normalizeText(payload.originalSlug, 96);
      const articles = readArticles();
      const existing = originalSlug ? articles.find((article) => article.slug === originalSlug) : undefined;
      const duplicate = articles.find((article) => article.slug === slug && article.slug !== existing?.slug);

      if (!title || !content) {
        sendJson(res, 400, { error: "文章标题和正文不能为空。" });
        return;
      }

      if (duplicate) {
        sendJson(res, 409, { error: "文章路径已存在，请换一个英文路径。" });
        return;
      }

      const currentTime = now();
      const isPublished = Boolean(payload.isPublished);
      const nextArticle: SiteArticle = {
        content,
        createdAt: existing?.createdAt ?? currentTime,
        isPublished,
        publishedAt: isPublished ? existing?.publishedAt ?? currentTime : undefined,
        slug,
        summary: normalizeText(payload.summary, 220),
        title,
        updatedAt: currentTime,
      };
      const nextArticles = articles.filter((article) => article.slug !== originalSlug && article.slug !== existing?.slug);
      nextArticles.push(nextArticle);
      writeArticles(nextArticles);
      sendJson(res, 200, { article: nextArticle, articles: sortArticles(nextArticles) });
    } catch {
      sendJson(res, 400, { error: "文章保存失败，请检查请求内容。" });
    }
    return;
  }

  if (req.method === "DELETE") {
    try {
      const payload = await readJsonPayload<{ slug?: unknown }>(req);
      const slug = normalizeText(payload.slug, 96);
      if (!slug) {
        sendJson(res, 400, { error: "缺少要删除的文章路径。" });
        return;
      }

      const articles = readArticles();
      const nextArticles = articles.filter((article) => article.slug !== slug);
      if (nextArticles.length === articles.length) {
        sendJson(res, 404, { error: "文章不存在。" });
        return;
      }

      writeArticles(nextArticles);
      sendJson(res, 200, { articles: sortArticles(nextArticles) });
    } catch {
      sendJson(res, 400, { error: "文章删除失败，请稍后再试。" });
    }
    return;
  }

  sendJson(res, 405, { error: "只支持 GET、POST 或 DELETE 请求" });
};
