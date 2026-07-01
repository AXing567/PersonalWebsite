import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpenText, CalendarDays, Clock3, PenLine } from "lucide-react";
import AmbientCanvas from "../components/AmbientCanvas";
import MarkdownMessage from "../components/MarkdownMessage";
import { profile } from "../data/profile";
import { formatDateTime, getPublicArticle, getPublicArticles, type SiteArticle, type SiteArticleSummary } from "../utils/adminAccess";

const getArticleSlug = () => {
  const hash = window.location.hash.replace(/^#\/articles/, "");
  const params = new URLSearchParams(hash.startsWith("?") ? hash : "");
  return params.get("slug") ?? "";
};

const estimateReadingMinutes = (content: string) => Math.max(1, Math.ceil(content.trim().length / 500));

export default function ArticlesPage() {
  const [articles, setArticles] = useState<SiteArticleSummary[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<SiteArticle | null>(null);
  const [selectedSlug, setSelectedSlug] = useState(getArticleSlug);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const hasSelectedArticle = Boolean(selectedSlug);
  const heroSummary = hasSelectedArticle
    ? selectedArticle?.summary || "一篇关于 AI 工具化、流程沉淀或工程交付的记录。"
    : "这里收纳 AI 工具化、流程复盘、自动化沉淀和工程交付相关的文章。";
  const featuredArticles = useMemo(() => articles.slice(0, 6), [articles]);

  useEffect(() => {
    const handleHashChange = () => {
      setSelectedSlug(getArticleSlug());
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadArticles = async () => {
      setIsLoading(true);
      setError("");
      try {
        const list = await getPublicArticles();
        if (!isActive) return;
        setArticles(list);

        if (selectedSlug) {
          const article = await getPublicArticle(selectedSlug);
          if (isActive) {
            setSelectedArticle(article);
          }
        } else {
          setSelectedArticle(null);
        }
      } catch (loadError) {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : "文章读取失败。");
          setSelectedArticle(null);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadArticles();
    return () => {
      isActive = false;
    };
  }, [selectedSlug]);

  return (
    <main className="site-shell draft-shell articles-shell">
      <AmbientCanvas />
      <header className="top-nav">
        <a className="brand-mark" href="#/">
          <span>YOU</span>
          <strong>{profile.name}</strong>
        </a>
        <nav aria-label="文章页导航">
          <a className="nav-cta" href="#/">
            <ArrowLeft size={16} />
            返回首页
          </a>
        </nav>
      </header>

      <section className="draft-hero article-hero reveal">
        <span className="status-pill">Writing Desk</span>
        <h1>{selectedArticle?.title ?? "文章与思考"}</h1>
        <p>{heroSummary}</p>
        {selectedArticle ? (
          <div className="article-meta-row">
            <span>
              <CalendarDays size={15} />
              {formatDateTime(selectedArticle.publishedAt ?? selectedArticle.updatedAt)}
            </span>
            <span>
              <Clock3 size={15} />
              约 {estimateReadingMinutes(selectedArticle.content)} 分钟
            </span>
          </div>
        ) : null}
      </section>

      {error ? <div className="admin-error">{error}</div> : null}

      {isLoading ? (
        <section className="article-empty reveal delay-1">
          <BookOpenText size={20} />
          <p>正在读取文章...</p>
        </section>
      ) : selectedArticle ? (
        <article className="article-detail reveal delay-1">
          <a className="article-back-link" href="#/articles">
            <ArrowLeft size={16} />
            返回文章列表
          </a>
          <MarkdownMessage text={selectedArticle.content} />
        </article>
      ) : featuredArticles.length ? (
        <section className="article-list reveal delay-1" aria-label="文章列表">
          {featuredArticles.map((article) => (
            <a className="article-card" href={`#/articles?slug=${encodeURIComponent(article.slug)}`} key={article.slug}>
              <span className="article-card-icon">
                <PenLine size={18} />
              </span>
              <div>
                <h2>{article.title}</h2>
                <p>{article.summary || "一篇新的文章沉淀。"}</p>
                <small>{formatDateTime(article.publishedAt ?? article.updatedAt)}</small>
              </div>
              <ArrowRight size={18} />
            </a>
          ))}
        </section>
      ) : (
        <section className="article-empty reveal delay-1">
          <BookOpenText size={20} />
          <h2>还没有发布文章</h2>
          <p>文章入口已经准备好，发布第一篇文章后这里会自动展示。</p>
        </section>
      )}
    </main>
  );
}
