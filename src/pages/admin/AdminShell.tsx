import type { ReactNode } from "react";
import { ArrowLeft, Bot, DatabaseBackup, FileText, Gauge, ListFilter, Settings } from "lucide-react";
import { profile } from "../../data/profile";

export type AdminSection = "articles" | "avatar" | "files" | "overview" | "settings" | "visits";

type AdminShellProps = {
  activeSection: AdminSection;
  children: ReactNode;
};

const adminNavItems: Array<{ href: string; label: string; section: AdminSection }> = [
  { href: "#/admin", label: "总览", section: "overview" },
  { href: "#/admin/visits", label: "访问记录", section: "visits" },
  { href: "#/admin/articles", label: "文章管理", section: "articles" },
  { href: "#/admin/avatar", label: "AI 对话", section: "avatar" },
  { href: "#/admin/files", label: "文件管理", section: "files" },
  { href: "#/admin/settings", label: "设置", section: "settings" },
];

const sectionIcons: Record<AdminSection, ReactNode> = {
  articles: <FileText size={15} />,
  avatar: <Bot size={15} />,
  files: <DatabaseBackup size={15} />,
  overview: <Gauge size={15} />,
  settings: <Settings size={15} />,
  visits: <ListFilter size={15} />,
};

export default function AdminShell({ activeSection, children }: AdminShellProps) {
  return (
    <>
      <header className="top-nav admin-top-nav">
        <a className="brand-mark" href="#/">
          <span>YOU</span>
          <strong>{profile.name}</strong>
        </a>
        <nav aria-label="管理后台导航">
          <a className="nav-cta" href="#/">
            <ArrowLeft size={16} />
            返回首页
          </a>
        </nav>
      </header>

      <nav className="admin-section-nav reveal" aria-label="管理后台功能导航">
        {adminNavItems.map((item) => (
          <a className={activeSection === item.section ? "is-active" : ""} href={item.href} key={item.section}>
            {sectionIcons[item.section]}
            {item.label}
          </a>
        ))}
      </nav>

      {children}
    </>
  );
}
