import {
  ArrowLeft,
  Bot,
  Braces,
  ChartNetwork,
  CloudCog,
  Cpu,
  Database,
  ExternalLink,
  FileBraces,
  FileLock2,
  GitBranch,
  Globe2,
  KeyRound,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Network,
  Rocket,
  SearchCheck,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import AmbientCanvas from "../components/AmbientCanvas";
import ReadingProgress, { type ProgressSection } from "../components/ReadingProgress";
import { profile } from "../data/profile";

type ProjectPoint = {
  icon: LucideIcon;
  title: string;
  summary: string;
};

type ArchitectureNode = ProjectPoint & {
  tone: "public" | "secure" | "core" | "ai" | "ops";
};

type FlowStep = {
  icon: LucideIcon;
  label: string;
  title: string;
  summary: string;
};

const projectPoints: ProjectPoint[] = [
  {
    icon: Globe2,
    title: "公开首页",
    summary: "用一个轻量入口承载个人定位、能力地图、文章思考和当前项目说明。",
  },
  {
    icon: FileLock2,
    title: "加密简历",
    summary: "完整履历通过服务端访问校验保护，避免把私密资料打包进浏览器代码。",
  },
  {
    icon: Bot,
    title: "AI 分身",
    summary: "基于简历、能力盘点和项目经验做检索增强回答，让沟通前置且有依据。",
  },
  {
    icon: ServerCog,
    title: "本地到 VPS",
    summary: "本地优先开发验证，确认后再同步到 VPS，部署时保留私有运行时配置。",
  },
];

const stackItems = ["Vite", "React", "TypeScript", "Hash Router", "Vite Middleware", "AI Avatar RAG"];
const repositoryUrl = "https://github.com/AXing567/PersonalWebsite";

const architectureNodes: ArchitectureNode[] = [
  {
    icon: Globe2,
    tone: "public",
    title: "Public SPA",
    summary: "Hash Router 承载首页、能力、文章和项目介绍，静态托管也能稳定访问。",
  },
  {
    icon: LockKeyhole,
    tone: "secure",
    title: "Resume Gate",
    summary: "简历解锁、PDF、完整履历都走本地中间件校验，不把私密内容放进浏览器包。",
  },
  {
    icon: FileBraces,
    tone: "secure",
    title: "Private Runtime",
    summary: "私有 JSON、环境变量、模型密钥只在服务端边界内工作，前端只拿必要结果。",
  },
  {
    icon: Cpu,
    tone: "core",
    title: "Middleware Core",
    summary: "Vite 中间件承接解锁状态、受保护接口、RAG 装配和模型代理编排。",
  },
  {
    icon: Database,
    tone: "ai",
    title: "Knowledge RAG",
    summary: "从简历、能力盘点、项目经验构建检索上下文，让 AI 分身回答有依据。",
  },
  {
    icon: MessageSquareText,
    tone: "ai",
    title: "Avatar Proxy",
    summary: "浏览器只调用本地 `/api/avatar-chat`，模型配置与降级策略留在服务端。",
  },
  {
    icon: GitBranch,
    tone: "ops",
    title: "Local First",
    summary: "所有内容先在本地验证，确认无误后再进入 VPS 同步和部署流程。",
  },
  {
    icon: CloudCog,
    tone: "ops",
    title: "VPS Runtime",
    summary: "线上运行保留私有配置边界，部署目标清晰，可回滚、可复用、可继续扩展。",
  },
];

const deliveryFlow: FlowStep[] = [
  {
    icon: Braces,
    label: "01",
    title: "本地开发",
    summary: "Vite + React 快速迭代页面、路由和交互，所有变更先停留在本机。",
  },
  {
    icon: KeyRound,
    label: "02",
    title: "访问控制",
    summary: "简历与 PDF 通过服务端口令校验，保护内容不进入公开静态资源。",
  },
  {
    icon: SearchCheck,
    label: "03",
    title: "RAG 装配",
    summary: "服务端聚合私有履历与成长文档，切块后作为 AI 分身检索上下文。",
  },
  {
    icon: Workflow,
    label: "04",
    title: "质量验证",
    summary: "类型检查、生产构建和浏览器布局烟测一起跑，保证桌面与手机都可用。",
  },
  {
    icon: Rocket,
    label: "05",
    title: "按需同步",
    summary: "只有收到明确指令后才同步 VPS，发布节奏和隐私边界都可控。",
  },
];

const projectProgressSections: ProgressSection[] = [
  { id: "project-top", label: "项目概览" },
  { id: "project-positioning", label: "项目定位" },
  { id: "project-architecture", label: "架构交付" },
  { id: "project-modules", label: "项目模块" },
];

export default function PersonalSiteProjectPage() {
  return (
    <main className="site-shell draft-shell project-intro-shell">
      <AmbientCanvas />
      <ReadingProgress sections={projectProgressSections} />
      <header className="top-nav">
        <a className="brand-mark" href="#/">
          <span>YOU</span>
          <strong>{profile.name}</strong>
        </a>
        <nav aria-label="个人主页项目页导航">
          <a className="nav-cta" href="#/">
            <ArrowLeft size={16} />
            返回首页
          </a>
        </nav>
      </header>

      <section className="draft-hero project-intro-hero reveal" id="project-top">
        <span className="status-pill">Current Project</span>
        <h1>个人主页项目</h1>
        <p>
          这个站点是一个面向求职与合作沟通的个人主页实验：前台保持简洁，完整简历和 AI
          分身放在受保护的本地服务边界之后，用工程方式兼顾展示、隐私和可持续迭代。
        </p>
        <div className="project-stack-row" aria-label="项目技术栈">
          {stackItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="project-repo-actions">
          <a className="project-repo-link" href={repositoryUrl} rel="noreferrer" target="_blank">
            <GitBranch size={18} />
            <span>查看 GitHub 仓库</span>
            <ExternalLink size={15} />
          </a>
        </div>
      </section>

      <section className="project-intro-overview reveal delay-1" id="project-positioning" aria-label="项目说明">
        <div>
          <Layers3 size={22} />
          <h2>项目定位</h2>
        </div>
        <p>
          它不是单纯的静态名片，而是把个人介绍、加密履历、AI 问答、部署边界和内容沉淀放在同一个小型系统里。
          对我来说，这个项目也用于持续验证 AI Native 开发流程、私密资料保护、RAG 资料更新和本地到线上部署的协作方式。
        </p>
      </section>

      <section
        className="project-architecture-section reveal delay-1"
        id="project-architecture"
        aria-labelledby="project-architecture-title"
      >
        <div className="project-section-heading">
          <span className="status-pill">
            <ChartNetwork size={14} />
            Architecture
          </span>
          <h2 id="project-architecture-title">架构图与交付流</h2>
          <p>
            这个项目的核心不是“做一个页面”，而是把公开展示、私密资料保护、AI 分身、RAG 语料和部署边界组织成一个可持续演进的个人工作台。
          </p>
        </div>

        <div className="architecture-console" aria-label="个人主页项目架构图">
          <div className="architecture-signal-bar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="architecture-map">
            {architectureNodes.map((node) => {
              const Icon = node.icon;

              return (
                <article className={`architecture-node architecture-node-${node.tone}`} key={node.title}>
                  <span className="architecture-node-icon">
                    <Icon size={18} />
                  </span>
                  <div>
                    <h3>{node.title}</h3>
                    <p>{node.summary}</p>
                  </div>
                </article>
              );
            })}

            <div className="architecture-core" aria-label="AI Native Core">
              <Sparkles size={22} />
              <strong>AI Native Core</strong>
              <span>展示 / 隐私 / RAG / 部署闭环</span>
            </div>
          </div>
        </div>

        <div className="delivery-flow" aria-label="项目交付流程">
          {deliveryFlow.map((step) => {
            const Icon = step.icon;

            return (
              <article className="delivery-flow-step" key={step.label}>
                <span className="delivery-flow-index">{step.label}</span>
                <Icon size={18} />
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.summary}</p>
                </div>
              </article>
            );
          })}
        </div>

        <div className="architecture-proof-strip" aria-label="项目能力标签">
          <span>
            <Network size={15} />
            前端可静态部署
          </span>
          <span>
            <ShieldCheck size={15} />
            私密数据服务端隔离
          </span>
          <span>
            <Bot size={15} />
            AI 分身检索增强
          </span>
          <span>
            <ServerCog size={15} />
            本地验证后再同步 VPS
          </span>
        </div>
      </section>

      <section className="draft-board project-intro-board reveal delay-1" id="project-modules" aria-label="项目模块">
        {projectPoints.map((item) => {
          const Icon = item.icon;

          return (
            <article className="draft-row project-intro-row" key={item.title}>
              <Icon size={18} />
              <div>
                <h2>{item.title}</h2>
                <p>{item.summary}</p>
              </div>
              <ShieldCheck size={17} />
            </article>
          );
        })}
      </section>
    </main>
  );
}
