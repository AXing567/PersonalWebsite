import { type FormEvent, useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import AmbientCanvas from "../components/AmbientCanvas";
import GlassCard from "../components/GlassCard";
import LoadingSignal from "../components/LoadingSignal";
import {
  formatDuration,
  getAdminAccessStatus,
  unlockAdmin,
  type AdminAccessStatus,
} from "../utils/adminAccess";
import AdminArticlesPage from "./admin/AdminArticlesPage";
import AdminAvatarPage from "./admin/AdminAvatarPage";
import AdminFilesPage from "./admin/AdminFilesPage";
import AdminOverviewPage from "./admin/AdminOverviewPage";
import AdminSettingsPage from "./admin/AdminSettingsPage";
import AdminShell, { type AdminSection } from "./admin/AdminShell";
import AdminVisitsPage from "./admin/AdminVisitsPage";

const fallbackAdminStatus: AdminAccessStatus = {
  failedAttempts: 0,
  isLocked: false,
  isUnlocked: false,
  remainingAttempts: 3,
  remainingLockMs: 0,
};

const getAdminRoute = (): AdminSection => {
  const route = window.location.hash.replace("#", "").split("?")[0] || "/admin";
  if (route === "/admin/visits") return "visits";
  if (route === "/admin/articles") return "articles";
  if (route === "/admin/avatar") return "avatar";
  if (route === "/admin/files") return "files";
  if (route === "/admin/settings") return "settings";
  return "overview";
};

const renderAdminSection = (activeSection: AdminSection) => {
  if (activeSection === "visits") return <AdminVisitsPage />;
  if (activeSection === "articles") return <AdminArticlesPage />;
  if (activeSection === "avatar") return <AdminAvatarPage />;
  if (activeSection === "files") return <AdminFilesPage />;
  if (activeSection === "settings") return <AdminSettingsPage />;
  return <AdminOverviewPage />;
};

export default function AdminPage() {
  const [activeSection, setActiveSection] = useState<AdminSection>(getAdminRoute);
  const [accessStatus, setAccessStatus] = useState<AdminAccessStatus>(fallbackAdminStatus);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isUnlocked = accessStatus.isUnlocked;
  const isLocked = accessStatus.isLocked;

  useEffect(() => {
    const handleHashChange = () => {
      setActiveSection(getAdminRoute());
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let isActive = true;

    const checkAccess = async () => {
      try {
        const status = await getAdminAccessStatus();
        if (!isActive) return;

        setAccessStatus(status);
      } catch {
        if (isActive) {
          setError("无法确认管理页访问状态，请稍后再试。");
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPassword = password.trim();
    const currentStatus = await getAdminAccessStatus();
    if (currentStatus.isLocked) {
      setAccessStatus(currentStatus);
      setError(`当前 IP 已被封禁，请 ${formatDuration(currentStatus.remainingLockMs)} 后再试。`);
      return;
    }

    setIsSubmitting(true);
    try {
      const nextStatus = await unlockAdmin(normalizedPassword);
      setAccessStatus(nextStatus);
      setPassword("");
      setError("");
    } catch (unlockError) {
      const nextStatus = await getAdminAccessStatus();
      setAccessStatus(nextStatus);
      setPassword("");
      setError(
        nextStatus.isLocked
          ? "管理页密码错误次数过多，当前 IP 已封禁 30 分钟。"
          : unlockError instanceof Error
            ? unlockError.message
            : `密码不正确，还可重试 ${nextStatus.remainingAttempts} 次。`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="site-shell admin-shell">
      <AmbientCanvas />

      {isCheckingAccess ? (
        <section className="gate-section">
          <GlassCard className="password-card reveal" tone="strong">
            <LoadingSignal label="正在确认管理访问权限" />
            <span className="status-pill">Admin Console</span>
            <h1>正在确认访问状态</h1>
            <p>管理页面没有公开入口，系统正在检查当前设备是否已获得访问权限。</p>
          </GlassCard>
        </section>
      ) : !isUnlocked ? (
        <section className="gate-section">
          <GlassCard className="password-card reveal" tone="strong">
            <div className="gate-icon">
              <KeyRound size={30} />
            </div>
            <span className="status-pill">Admin Console</span>
            <h1>输入密码进入管理后台</h1>
            <p>连续 3 次密码错误会封禁当前 IP 30 分钟。解锁后可以查看访问记录、管理文章和查看 AI 对话分析。</p>
            <form onSubmit={handleSubmit}>
              <label htmlFor="admin-password">管理密码</label>
              <input
                autoComplete="current-password"
                disabled={isLocked || isSubmitting}
                id="admin-password"
                name="admin-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isLocked ? "当前 IP 已封禁" : "请输入管理密码"}
                type="password"
                value={password}
              />
              {error ? <span className="form-error">{error}</span> : null}
              <button className="primary-button" disabled={isLocked || isSubmitting} type="submit">
                <ShieldCheck size={18} />
                {isSubmitting ? "正在验证" : isLocked ? "暂时封禁" : "进入管理后台"}
              </button>
            </form>
          </GlassCard>
        </section>
      ) : (
        <AdminShell activeSection={activeSection}>
          {renderAdminSection(activeSection)}
        </AdminShell>
      )}
    </main>
  );
}
