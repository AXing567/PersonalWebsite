import { useEffect, useState } from "react";
import { ArrowRight, Bot, FileLock2, GitBranch, PanelsTopLeft, PenLine } from "lucide-react";
import AmbientCanvas from "../components/AmbientCanvas";
import { profile } from "../data/profile";
import { fallbackPublicProfile, getPublicSiteSettings } from "../utils/adminAccess";

export default function HomePage() {
  const [pointer, setPointer] = useState({ x: 50, y: 50 });
  const [publicProfile, setPublicProfile] = useState(fallbackPublicProfile);
  const [showArticlesEntry, setShowArticlesEntry] = useState(false);
  const [kickedMessage, setKickedMessage] = useState("");

  useEffect(() => {
    let isActive = true;

    const loadSettings = async () => {
      const settings = await getPublicSiteSettings();
      if (isActive) {
        setPublicProfile(settings.publicProfile ?? fallbackPublicProfile);
        setShowArticlesEntry(settings.showArticlesEntry);
        document.title = settings.publicProfile?.browserTitle || fallbackPublicProfile.browserTitle;
        document.querySelector('meta[name="description"]')?.setAttribute(
          "content",
          settings.publicProfile?.metaDescription || fallbackPublicProfile.metaDescription,
        );
      }
    };

    void loadSettings();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const message = window.sessionStorage.getItem("personal-site-kicked-message");
    if (!message) return;

    window.sessionStorage.removeItem("personal-site-kicked-message");
    setKickedMessage(message);
  }, []);

  return (
    <main
      className="site-shell home-shell"
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPointer({
          x: ((event.clientX - rect.left) / rect.width) * 100,
          y: ((event.clientY - rect.top) / rect.height) * 100,
        });
      }}
      style={{ "--pointer-x": `${pointer.x}%`, "--pointer-y": `${pointer.y}%` } as React.CSSProperties}
    >
      <AmbientCanvas />
      <div className="interactive-aura" aria-hidden="true" />
      <header className="top-nav">
        <a className="brand-mark" href="#/">
          <span>{publicProfile.brandInitials}</span>
          <strong>{publicProfile.name || profile.name}</strong>
        </a>
        <nav aria-label="首页导航">
          <a className="nav-cta" href="#/resume">
            <FileLock2 size={16} />
            简历
          </a>
        </nav>
      </header>

      <section className="hero-section">
        <div className="hero-copy reveal">
          {kickedMessage ? <p className="home-session-alert">{kickedMessage}</p> : null}
          <h1>{publicProfile.name || profile.name}</h1>
          <p className="hero-title">{publicProfile.heroTitle}</p>
          <p className="hero-summary">{publicProfile.heroSummary}</p>
          <div className="hero-actions">
            <a className="primary-button" href="#/resume">
              {publicProfile.heroPrimaryActionLabel}
              <ArrowRight size={18} />
            </a>
            <a className="avatar-link home-avatar-entry" href="#/avatar">
              <Bot size={18} />
              <span>{publicProfile.heroSecondaryActionLabel}</span>
            </a>
          </div>
        </div>

        <div className="hero-panel reveal delay-1" aria-hidden="true">
          <div className="profile-orbit">
            <div className="profile-core">
              <span>{publicProfile.englishName}</span>
              <strong>{publicProfile.orbitLabel}</strong>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`home-entry-section reveal reveal-sharp delay-1${showArticlesEntry ? " home-entry-section-three" : ""}`}
        aria-label="探索入口"
      >
        <a className="home-entry" href="#/capabilities">
          <GitBranch size={20} />
          <span>
            <strong>能力地图</strong>
            <em>快速理解我怎样把业务、AI 和工程连成闭环</em>
          </span>
          <ArrowRight size={18} />
        </a>
        {showArticlesEntry ? (
          <a className="home-entry" href="#/articles">
            <PenLine size={20} />
            <span>
              <strong>文章与思考</strong>
              <em>阅读 AI 工具化、流程复盘和工程交付相关沉淀</em>
            </span>
            <ArrowRight size={18} />
          </a>
        ) : null}
        <a className="home-entry" href="#/personal-site">
          <PanelsTopLeft size={20} />
          <span>
            <strong>个人主页项目</strong>
            <em>了解这个站点如何结合加密简历、AI 分身和本地部署</em>
          </span>
          <ArrowRight size={18} />
        </a>
      </section>
    </main>
  );
}
