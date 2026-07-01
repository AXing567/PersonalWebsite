import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { BookOpenText, FileUp, PencilLine, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  deleteAdminArticle,
  formatDateTime,
  getAdminArticles,
  saveAdminArticle,
  type SiteArticle,
} from "../../utils/adminAccess";
import { createArticleFormFromArticle, emptyArticleForm, toSlug, type ArticleFormState } from "./adminUtils";

export default function AdminArticlesPage() {
  const [articles, setArticles] = useState<SiteArticle[]>([]);
  const [articleForm, setArticleForm] = useState<ArticleFormState>(emptyArticleForm);
  const [error, setError] = useState("");
  const [contentMessage, setContentMessage] = useState("");
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const publishedCount = useMemo(() => articles.filter((article) => article.isPublished).length, [articles]);
  const draftCount = Math.max(0, articles.length - publishedCount);

  const refreshContent = async () => {
    setIsRefreshing(true);
    try {
      const nextArticles = await getAdminArticles();
      setArticles(nextArticles);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "文章数据读取失败。");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshContent();
  }, []);

  const updateArticleForm = (nextPartial: Partial<ArticleFormState>) => {
    setArticleForm((current) => ({ ...current, ...nextPartial }));
  };

  const handleTitleChange = (title: string) => {
    setArticleForm((current) => ({
      ...current,
      slug: current.originalSlug || current.slug ? current.slug : toSlug(title),
      title,
    }));
  };

  const handleMarkdownUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const titleFromFile = file.name.replace(/\.(md|markdown|txt)$/i, "");
      setArticleForm((current) => ({
        ...current,
        content: text,
        slug: current.slug || toSlug(titleFromFile),
        title: current.title || titleFromFile,
      }));
      setContentMessage("Markdown 文件已读取，可以继续编辑后保存。");
    } catch {
      setContentMessage("Markdown 文件读取失败，请换一个文件再试。");
    }
  };

  const handleSaveArticle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingContent(true);
    setContentMessage("");
    try {
      const payload = await saveAdminArticle(articleForm);
      setArticles(payload.articles ?? []);
      setArticleForm(payload.article ? createArticleFormFromArticle(payload.article) : emptyArticleForm);
      setContentMessage(articleForm.isPublished ? "文章已保存并发布。" : "文章已保存为草稿。");
    } catch (articleError) {
      setContentMessage(articleError instanceof Error ? articleError.message : "文章保存失败。");
    } finally {
      setIsSavingContent(false);
    }
  };

  const handleDeleteArticle = async (article: SiteArticle) => {
    const confirmed = window.confirm(`确定删除《${article.title}》吗？删除后不可恢复。`);
    if (!confirmed) return;

    setIsSavingContent(true);
    setContentMessage("");
    try {
      const nextArticles = await deleteAdminArticle(article.slug);
      setArticles(nextArticles);
      if (articleForm.originalSlug === article.slug || articleForm.slug === article.slug) {
        setArticleForm(emptyArticleForm);
      }
      setContentMessage("文章已删除。");
    } catch (deleteError) {
      setContentMessage(deleteError instanceof Error ? deleteError.message : "文章删除失败。");
    } finally {
      setIsSavingContent(false);
    }
  };

  return (
    <section className="admin-content">
      <section className="admin-hero reveal">
        <span className="status-pill">Content Desk</span>
        <h1>文章管理</h1>
        <p>这里专门管理文章内容。支持上传 Markdown，也可以直接在后台编辑、发布或删除。</p>
        <button className="admin-refresh-button" disabled={isRefreshing} onClick={() => void refreshContent()} type="button">
          <RefreshCw size={16} />
          {isRefreshing ? "刷新中" : "刷新文章数据"}
        </button>
      </section>

      {error ? <div className="admin-error">{error}</div> : null}

      <section className="admin-metrics reveal delay-1" aria-label="文章概览">
        <article>
          <BookOpenText size={18} />
          <span>全部文章</span>
          <strong>{articles.length}</strong>
        </article>
        <article>
          <BookOpenText size={18} />
          <span>已发布</span>
          <strong>{publishedCount}</strong>
        </article>
        <article>
          <PencilLine size={18} />
          <span>草稿</span>
          <strong>{draftCount}</strong>
        </article>
      </section>

      <section className="admin-content-grid admin-article-manage-grid reveal delay-1" aria-label="文章内容管理">
        <form className="admin-article-editor" onSubmit={handleSaveArticle}>
          <div className="admin-panel-title">
            <span>Writing Desk</span>
            <h2>{articleForm.originalSlug ? "编辑文章" : "新增文章"}</h2>
          </div>
          <div className="admin-editor-grid">
            <label>
              标题
              <input
                disabled={isSavingContent}
                onChange={(event) => handleTitleChange(event.target.value)}
                placeholder="例如：AI 工具化复盘"
                value={articleForm.title}
              />
            </label>
            <label>
              英文路径
              <input
                disabled={isSavingContent}
                onChange={(event) => updateArticleForm({ slug: toSlug(event.target.value) })}
                placeholder="ai-tooling-review"
                value={articleForm.slug}
              />
            </label>
          </div>
          <label>
            摘要
            <input
              disabled={isSavingContent}
              onChange={(event) => updateArticleForm({ summary: event.target.value })}
              placeholder="一句话说明这篇文章讲什么"
              value={articleForm.summary}
            />
          </label>
          <label>
            正文 Markdown
            <textarea
              disabled={isSavingContent}
              onChange={(event) => updateArticleForm({ content: event.target.value })}
              placeholder="# 标题&#10;&#10;这里写正文，也可以上传 Markdown 文件后继续编辑。"
              rows={13}
              value={articleForm.content}
            />
          </label>
          <div className="admin-editor-actions">
            <label className="admin-file-button">
              <FileUp size={16} />
              上传 Markdown
              <input accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={handleMarkdownUpload} type="file" />
            </label>
            <label className="admin-publish-check">
              <input
                checked={articleForm.isPublished}
                disabled={isSavingContent}
                onChange={(event) => updateArticleForm({ isPublished: event.target.checked })}
                type="checkbox"
              />
              发布
            </label>
            <button className="admin-refresh-button" disabled={isSavingContent} type="button" onClick={() => setArticleForm(emptyArticleForm)}>
              <PencilLine size={16} />
              新建
            </button>
            <button className="primary-button" disabled={isSavingContent} type="submit">
              <Save size={17} />
              {isSavingContent ? "保存中" : "保存文章"}
            </button>
          </div>
        </form>
      </section>

      <section className="admin-article-list reveal delay-1" aria-label="文章列表">
        <div className="admin-table-head">
          <div>
            <span>Articles</span>
            <h2>文章列表</h2>
          </div>
          <strong>{articles.length} 篇</strong>
        </div>
        {articles.length ? (
          articles.map((article) => (
            <article className="admin-article-row" key={article.slug}>
              <div>
                <span className={article.isPublished ? "article-status-published" : "article-status-draft"}>
                  {article.isPublished ? "已发布" : "草稿"}
                </span>
                <h3>{article.title}</h3>
                <p>{article.summary || "暂无摘要"}</p>
                <small>
                  /{article.slug} · 更新 {formatDateTime(article.updatedAt)}
                </small>
              </div>
              <div>
                <button type="button" onClick={() => setArticleForm(createArticleFormFromArticle(article))}>
                  <PencilLine size={16} />
                  编辑
                </button>
                <button type="button" onClick={() => void handleDeleteArticle(article)}>
                  <Trash2 size={16} />
                  删除
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="admin-empty">暂时还没有文章，可以上传 Markdown 或直接编辑正文。</div>
        )}
      </section>
    </section>
  );
}
