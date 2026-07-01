import { FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  Code2,
  Download,
  GraduationCap,
  KeyRound,
  Mail,
  Phone,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import AmbientCanvas from "../components/AmbientCanvas";
import GlassCard from "../components/GlassCard";
import LoadingSignal from "../components/LoadingSignal";
import ReadingProgress, { type ProgressSection } from "../components/ReadingProgress";
import SectionHeader from "../components/SectionHeader";
import Timeline from "../components/Timeline";
import { profile } from "../data/profile";
import type { ResumeData } from "../data/resumeTypes";
import {
  formatResumeAccessDuration,
  getResumeData,
  getResumeAccessStatus,
  unlockResume,
  type ResumeAccessStatus,
} from "../utils/resumeAccess";

const TYPE_SPEED_MS = 86;
const DELETE_SPEED_MS = 42;
const HOLD_MS = 980;
const RESUME_PDF_FILENAME = "\u5173\u65b0\u661f-1\u5e74\u7ecf\u9a8c-AI\u5168\u6808\u5f00\u53d1\u5de5\u7a0b\u5e08.pdf";

const getPhoneHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

const resumeProgressSections: ProgressSection[] = [
  { id: "resume-top", label: "简历概览" },
  { id: "resume-experience", label: "工作经历" },
  { id: "resume-projects", label: "项目经历" },
  { id: "resume-skills", label: "技术栈" },
  { id: "resume-education", label: "教育背景" },
  { id: "resume-strengths", label: "个人优势" },
  { id: "resume-contact", label: "联系与协作" },
];

export default function ResumePage() {
  const [password, setPassword] = useState("");
  const [accessStatus, setAccessStatus] = useState<ResumeAccessStatus>({
    failedAttempts: 0,
    isLocked: false,
    isUnlocked: false,
    remainingAttempts: 5,
    remainingLockMs: 0,
  });
  const [error, setError] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [typedRole, setTypedRole] = useState("");
  const [typingIndex, setTypingIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const resumePdfHref = "/api/resume-pdf";
  const isUnlocked = accessStatus.isUnlocked;
  const isLocked = accessStatus.isLocked;
  const resolvedProfile = resumeData?.profile ?? profile;
  const typingRoles = resumeData?.typingRoles ?? [];

  const handleScrollCueClick = () => {
    document.getElementById("resume-metrics")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  useEffect(() => {
    let isActive = true;

    const checkAccess = async () => {
      try {
        const status = await getResumeAccessStatus();
        if (!isActive) return;

        setAccessStatus(status);
        if (status.isUnlocked) {
          setResumeData(await getResumeData());
        }
      } catch {
        if (isActive) {
          setError("无法确认简历访问状态，请稍后再试。");
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

  useEffect(() => {
    if (!isUnlocked) {
      return undefined;
    }

    if (!typingRoles.length) {
      return undefined;
    }

    const fullText = typingRoles[typingIndex % typingRoles.length];
    const isFullyTyped = !isDeleting && typedRole === fullText;
    const isFullyDeleted = isDeleting && typedRole === "";
    const delay = isFullyTyped ? HOLD_MS : isDeleting ? DELETE_SPEED_MS : TYPE_SPEED_MS;

    const timeoutId = window.setTimeout(() => {
      if (isFullyTyped) {
        setIsDeleting(true);
        return;
      }

      if (isFullyDeleted) {
        setIsDeleting(false);
        setTypingIndex((current) => (current + 1) % typingRoles.length);
        return;
      }

      setTypedRole((current) => {
        const nextLength = current.length + (isDeleting ? -1 : 1);
        return fullText.slice(0, nextLength);
      });
    }, delay);

    return () => window.clearTimeout(timeoutId);
  }, [isDeleting, isUnlocked, typedRole, typingIndex, typingRoles]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedPassword = new FormData(event.currentTarget).get("resume-password");
    const normalizedPassword = typeof submittedPassword === "string" ? submittedPassword.trim() : "";

    const currentStatus = await getResumeAccessStatus();
    if (currentStatus.isLocked) {
      setAccessStatus(currentStatus);
      setError(`尝试次数过多，请 ${formatResumeAccessDuration(currentStatus.remainingLockMs)} 后再试。`);
      return;
    }

    setIsSubmitting(true);
    try {
      const nextStatus = await unlockResume(normalizedPassword);
      const nextResumeData = await getResumeData();
      setAccessStatus(nextStatus);
      setResumeData(nextResumeData);
      setError("");
      setPassword("");
      return;
    } catch (unlockError) {
      const nextStatus = await getResumeAccessStatus();
      setAccessStatus(nextStatus);
      setPassword("");
      setError(
        nextStatus.isLocked
          ? "密码错误次数过多，已锁定 30 分钟。"
          : unlockError instanceof Error
            ? unlockError.message
            : `密码不正确，还可重试 ${nextStatus.remainingAttempts} 次。`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResumePdfDownload = async () => {
    setIsDownloadingPdf(true);
    setError("");

    try {
      const response = await fetch(resumePdfHref, {
        cache: "no-store",
        credentials: "include",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "" }));
        throw new Error(payload.error || "PDF 简历下载失败。");
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = RESUME_PDF_FILENAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "PDF 简历下载失败。");
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <main className="site-shell resume-shell">
      <AmbientCanvas />
      <header className="top-nav">
        <a className="brand-mark" href="#/">
          <span>YOU</span>
          <strong>{resolvedProfile.name}</strong>
        </a>
        <nav aria-label="简历页导航">
          <a className="nav-cta" href="#/">
            <ArrowLeft size={16} />
            返回首页
          </a>
        </nav>
      </header>

      {isCheckingAccess ? (
        <section className="gate-section">
          <GlassCard className="password-card reveal" tone="strong">
            <LoadingSignal label="正在确认简历访问权限" />
            <span className="status-pill">Resume access</span>
            <h1>正在确认访问状态</h1>
            <p>请稍候，系统正在检查当前设备是否已获得简历访问权限。</p>
          </GlassCard>
        </section>
      ) : !isUnlocked || !resumeData ? (
        <section className="gate-section">
          <GlassCard className="password-card reveal" tone="strong">
            <div className="gate-icon">
              <KeyRound size={30} />
            </div>
            <span className="status-pill">Resume access</span>
            <h1>请输入密码查看简历</h1>
            <p>
              此页面用于给 HR、技术负责人和合作伙伴查看更完整的履历信息。解锁后 12 小时内有效。
            </p>
            <form onSubmit={handleSubmit}>
              <label htmlFor="resume-password">访问密码</label>
              <input
                autoComplete="current-password"
                disabled={isLocked || isSubmitting}
                id="resume-password"
                name="resume-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isLocked ? "访问暂时锁定" : "请输入密码"}
                type="password"
                value={password}
              />
              {error ? <span className="form-error">{error}</span> : null}
              <button className="primary-button" disabled={isLocked || isSubmitting} type="submit">
                <ShieldCheck size={18} />
                {isSubmitting ? "正在验证" : isLocked ? "暂时锁定" : "解锁简历"}
              </button>
            </form>
          </GlassCard>
        </section>
      ) : (
        <section className="resume-content">
          <ReadingProgress sections={resumeProgressSections} />
          <section className="resume-hero reveal" id="resume-top">
            <div className="resume-hero-copy">
              <span className="status-pill">Personal Resume</span>
              <h1>
                你好，我是
                <strong>{resumeData.profile.name}</strong>
              </h1>
              <div className="typewriter-line" aria-label={typingRoles.join(" / ")}>
                <span>{typedRole || "\u00a0"}</span>
              </div>
              <p className="resume-summary">{resumeData.profile.heroSummary}</p>
              <div className="resume-actions">
                <a className="avatar-link" href="#/avatar">
                  <Bot size={16} />
                  <span>和 AI 分身聊聊</span>
                </a>
                <button
                  className="download-link"
                  disabled={isDownloadingPdf}
                  onClick={() => void handleResumePdfDownload()}
                  type="button"
                >
                  <Download size={16} />
                  {isDownloadingPdf ? "正在下载" : "下载 PDF 简历"}
                </button>
              </div>
            </div>
            <button
              aria-label="继续向下查看简历内容"
              className="resume-scroll-cue"
              onClick={handleScrollCueClick}
              type="button"
            >
              <span />
            </button>
          </section>

          <section className="resume-metrics reveal delay-1" id="resume-metrics" aria-label="核心亮点">
            {resumeData.metrics.map((metric) => (
              <article key={`${metric.value}-${metric.label}`}>
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
              </article>
            ))}
          </section>

          <div className="resume-grid">
            <section className="resume-section resume-section-story reveal" id="resume-experience">
              <SectionHeader eyebrow="Experience" title="工作经历" />
              <Timeline items={resumeData.experience} />
            </section>

            <section className="resume-section resume-section-projects reveal delay-1" id="resume-projects">
              <SectionHeader eyebrow="Projects" title="项目经历" />
              <div className="resume-projects">
                {resumeData.featuredProjects.map((project, index) => (
                  <article className="resume-project-card reveal" key={project.name}>
                    <div className="resume-project-head">
                      <span className="project-index">{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <span>{project.subtitle}</span>
                        <h3>{project.name}</h3>
                        <p className="timeline-period">{project.period}</p>
                      </div>
                    </div>
                    <p className="resume-project-role">{project.role}</p>
                    <p className="project-result">{project.result}</p>
                    <div className="project-tags">
                      {project.stack.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                    <ul>
                      {project.highlights.map((highlight) => (
                        <li key={highlight}>{highlight}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>

            <section className="resume-section reveal delay-1" id="resume-skills">
              <SectionHeader eyebrow="Skills" title="技术栈" />
              <div className="resume-skill-grid">
                {resumeData.skillGroups.map((group) => (
                  <div className="skill-group resume-skill-group reveal" key={group.title}>
                    <Code2 size={18} />
                    <h3>{group.title}</h3>
                    <div className="tag-row">
                      {group.items.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="resume-section reveal" id="resume-profile">
              <SectionHeader eyebrow="Profile" title="个人定位" />
              <div className="resume-profile-panel">
                <p>{resumeData.profile.shortPitch}</p>
                <p>{resumeData.profile.current}</p>
                <p>求职方向：{resumeData.profile.intent}</p>
              </div>
            </section>

            <section className="resume-section reveal delay-1" id="resume-core-capabilities">
              <SectionHeader eyebrow="Strengths" title="核心能力" />
              <div className="compact-list">
                {resumeData.capabilities.map((capability) => (
                  <article className="reveal" key={capability.title}>
                    <Sparkles size={16} />
                    <h3>{capability.title}</h3>
                    <p>{capability.summary}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="resume-section reveal" id="resume-education">
              <SectionHeader eyebrow="Education" title="教育背景" />
              <div className="education-title">
                <GraduationCap size={20} />
                <div>
                  <h3>{resumeData.education[0].title}</h3>
                  <p>{resumeData.education[0].organization} · {resumeData.education[0].period}</p>
                </div>
              </div>
              <ul className="education-list">
                {resumeData.educationHonors.map((honor) => (
                  <li key={`${honor.date}-${honor.text}`}>
                    <strong>{honor.date}</strong>
                    <span>{honor.text}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="resume-section reveal delay-1" id="resume-more-projects">
              <SectionHeader eyebrow="More" title="其他项目" />
              <div className="tag-row">
                {resumeData.otherProjects.map((project) => (
                  <span key={project}>{project}</span>
                ))}
              </div>
            </section>

            <section className="resume-section reveal" id="resume-strengths">
              <SectionHeader eyebrow="Strengths" title="个人优势" />
              <ul>
                {resumeData.softStrengths.map((strength) => (
                  <li key={strength}>{strength}</li>
                ))}
              </ul>
            </section>

            <GlassCard className="resume-section resume-contact-card reveal" id="resume-contact">
              <SectionHeader eyebrow="Contact" title="联系与动作" />
              <div className="resume-contact">
                <a href={getPhoneHref(resumeData.profile.phone)}>
                  <Phone size={16} />
                  {resumeData.profile.phone}
                </a>
                <a href={`mailto:${resumeData.profile.email}`}>
                  <Mail size={16} />
                  {resumeData.profile.email}
                </a>
                <span>
                  <BriefcaseBusiness size={16} />
                  {resumeData.profile.company}
                </span>
              </div>
              <div className="resume-actions">
                <a className="avatar-link" href="#/avatar">
                  <Bot size={16} />
                  <span>和 AI 分身聊聊</span>
                </a>
                <button
                  className="download-link"
                  disabled={isDownloadingPdf}
                  onClick={() => void handleResumePdfDownload()}
                  type="button"
                >
                  <Download size={16} />
                  {isDownloadingPdf ? "正在下载" : "下载 PDF 简历"}
                </button>
              </div>
            </GlassCard>
          </div>
        </section>
      )}
    </main>
  );
}
