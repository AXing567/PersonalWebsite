import { useEffect, useState } from "react";
import { Eye, Palette, RefreshCw, Settings } from "lucide-react";
import { applySiteTheme } from "../../hooks/useSiteTheme";
import {
  formatDateTime,
  getAdminSiteSettings,
  updateAdminSiteSettings,
  type SiteSettings,
} from "../../utils/adminAccess";
import { emptySettings, getSiteThemeLabel, siteThemeOptions } from "./adminUtils";

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SiteSettings>(emptySettings);
  const [error, setError] = useState("");
  const [contentMessage, setContentMessage] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshSettings = async () => {
    setIsRefreshing(true);
    try {
      const nextSettings = await getAdminSiteSettings();
      setSettings(nextSettings);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "站点设置读取失败。");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshSettings();
  }, []);

  const handleArticleEntryToggle = async () => {
    setIsSaving(true);
    setContentMessage("");
    try {
      const nextSettings = await updateAdminSiteSettings({
        showArticlesEntry: !settings.showArticlesEntry,
      });
      setSettings(nextSettings);
      setContentMessage(nextSettings.showArticlesEntry ? "首页文章入口已打开。" : "首页文章入口已关闭。");
    } catch (settingError) {
      setContentMessage(settingError instanceof Error ? settingError.message : "首页文章入口保存失败。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleThemeChange = async (siteTheme: SiteSettings["siteTheme"]) => {
    if (siteTheme === settings.siteTheme) return;

    setIsSaving(true);
    setContentMessage("");
    try {
      const nextSettings = await updateAdminSiteSettings({ siteTheme });
      setSettings(nextSettings);
      applySiteTheme(nextSettings.siteTheme);
      setContentMessage(`网站主题已切换为${getSiteThemeLabel(nextSettings.siteTheme)}。`);
    } catch (settingError) {
      setContentMessage(settingError instanceof Error ? settingError.message : "网站主题保存失败。");
    } finally {
      setIsSaving(false);
    }
  };

  const updatePublicProfileField = (key: keyof SiteSettings["publicProfile"], value: string) => {
    setSettings((current) => ({
      ...current,
      publicProfile: {
        ...current.publicProfile,
        [key]: value,
      },
    }));
  };

  const handlePublicProfileSave = async () => {
    setIsSaving(true);
    setProfileMessage("");
    try {
      const nextSettings = await updateAdminSiteSettings({
        publicProfile: settings.publicProfile,
      });
      setSettings(nextSettings);
      setProfileMessage("公开主页信息已保存。");
    } catch (settingError) {
      setProfileMessage(settingError instanceof Error ? settingError.message : "公开主页信息保存失败。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="admin-content">
      <section className="admin-hero reveal">
        <span className="status-pill">Site Settings</span>
        <h1>管理设置</h1>
        <p>这里集中管理影响全站展示的设置。文章内容留在文章管理页，站点入口和主题放在这里统一调整。</p>
        <button className="admin-refresh-button" disabled={isRefreshing} onClick={() => void refreshSettings()} type="button">
          <RefreshCw size={16} />
          {isRefreshing ? "刷新中" : "刷新设置"}
        </button>
      </section>

      {error ? <div className="admin-error">{error}</div> : null}

      <section className="admin-metrics reveal delay-1" aria-label="站点设置概览">
        <article>
          <Eye size={18} />
          <span>文章入口</span>
          <strong>{settings.showArticlesEntry ? "已开" : "已关"}</strong>
        </article>
        <article>
          <Palette size={18} />
          <span>当前主题</span>
          <strong>{getSiteThemeLabel(settings.siteTheme)}</strong>
        </article>
        <article>
          <Settings size={18} />
          <span>设置更新</span>
          <strong>{settings.updatedAt ? "已同步" : "待读取"}</strong>
        </article>
      </section>

      <section className="admin-content-grid admin-settings-grid reveal delay-1" aria-label="站点设置控制">
        <article className="admin-control-panel admin-public-profile-panel">
          <div className="admin-panel-title">
            <span>Public Identity</span>
            <h2>公开主页信息</h2>
          </div>
          <div className="admin-editor-grid">
            <label>
              中文姓名
              <input
                disabled={isSaving}
                onChange={(event) => updatePublicProfileField("name", event.target.value)}
                value={settings.publicProfile.name}
              />
            </label>
            <label>
              英文名
              <input
                disabled={isSaving}
                onChange={(event) => updatePublicProfileField("englishName", event.target.value)}
                value={settings.publicProfile.englishName}
              />
            </label>
            <label>
              品牌缩写
              <input
                disabled={isSaving}
                onChange={(event) => updatePublicProfileField("brandInitials", event.target.value)}
                value={settings.publicProfile.brandInitials}
              />
            </label>
            <label>
              定位标题
              <input
                disabled={isSaving}
                onChange={(event) => updatePublicProfileField("roleTitle", event.target.value)}
                value={settings.publicProfile.roleTitle}
              />
            </label>
          </div>
          <label>
            首页主标题
            <input
              disabled={isSaving}
              onChange={(event) => updatePublicProfileField("heroTitle", event.target.value)}
              value={settings.publicProfile.heroTitle}
            />
          </label>
          <label>
            首页简介
            <textarea
              disabled={isSaving}
              onChange={(event) => updatePublicProfileField("heroSummary", event.target.value)}
              rows={3}
              value={settings.publicProfile.heroSummary}
            />
          </label>
          <div className="admin-editor-grid">
            <label>
              简历按钮文案
              <input
                disabled={isSaving}
                onChange={(event) => updatePublicProfileField("heroPrimaryActionLabel", event.target.value)}
                value={settings.publicProfile.heroPrimaryActionLabel}
              />
            </label>
            <label>
              AI 按钮文案
              <input
                disabled={isSaving}
                onChange={(event) => updatePublicProfileField("heroSecondaryActionLabel", event.target.value)}
                value={settings.publicProfile.heroSecondaryActionLabel}
              />
            </label>
            <label>
              浏览器标题
              <input
                disabled={isSaving}
                onChange={(event) => updatePublicProfileField("browserTitle", event.target.value)}
                value={settings.publicProfile.browserTitle}
              />
            </label>
            <label>
              首页圆心标签
              <input
                disabled={isSaving}
                onChange={(event) => updatePublicProfileField("orbitLabel", event.target.value)}
                value={settings.publicProfile.orbitLabel}
              />
            </label>
          </div>
          <label>
            SEO 描述
            <textarea
              disabled={isSaving}
              onChange={(event) => updatePublicProfileField("metaDescription", event.target.value)}
              rows={3}
              value={settings.publicProfile.metaDescription}
            />
          </label>
          <div className="admin-editor-actions">
            <button className="primary-button" disabled={isSaving} onClick={() => void handlePublicProfileSave()} type="button">
              <Settings size={17} />
              保存公开信息
            </button>
          </div>
          {profileMessage ? <p className="admin-content-message">{profileMessage}</p> : null}
        </article>

        <article className="admin-control-panel">
          <div className="admin-panel-title">
            <span>Homepage Entry</span>
            <h2>首页文章入口</h2>
          </div>
          <button
            className={`admin-toggle-card${settings.showArticlesEntry ? " admin-toggle-card-on" : ""}`}
            disabled={isSaving}
            onClick={handleArticleEntryToggle}
            type="button"
          >
            <span>
              <strong>{settings.showArticlesEntry ? "已打开" : "已关闭"}</strong>
              <em>{settings.showArticlesEntry ? "首页会显示文章入口" : "首页暂不显示文章入口"}</em>
            </span>
            <i />
          </button>
          <div className="admin-article-stats">
            <span>用于控制首页底部是否出现文章入口</span>
            <span>只影响公开展示，不会删除任何文章</span>
            <span>更新 {formatDateTime(settings.updatedAt)}</span>
          </div>
          {contentMessage ? <p className="admin-content-message">{contentMessage}</p> : null}
        </article>

        <article className="admin-control-panel admin-theme-panel">
          <div className="admin-panel-title">
            <span>
              <Palette size={15} />
              Site Theme
            </span>
            <h2>网站主题</h2>
          </div>
          <div className="admin-theme-options" role="list">
            {siteThemeOptions.map((theme) => (
              <button
                className={`admin-theme-option admin-theme-option-${theme.tone}${settings.siteTheme === theme.tone ? " admin-theme-option-active" : ""}`}
                disabled={isSaving}
                key={theme.tone}
                onClick={() => void handleThemeChange(theme.tone)}
                type="button"
              >
                <i aria-hidden="true" />
                <span>
                  <strong>{theme.label}</strong>
                  <em>{theme.description}</em>
                </span>
              </button>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}
