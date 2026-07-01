import {
  ArrowLeft,
  Blocks,
  BrainCircuit,
  ChartNoAxesCombined,
  CircuitBoard,
  Compass,
  Gauge,
  MapPinned,
  Route,
  ServerCog,
  Target,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import AmbientCanvas from "../components/AmbientCanvas";
import ReadingProgress, { type ProgressSection } from "../components/ReadingProgress";
import { profile } from "../data/profile";

type CapabilityNode = {
  icon: LucideIcon;
  title: string;
  summary: string;
  zone: string;
};

const capabilityMap: CapabilityNode[] = [
  {
    icon: BrainCircuit,
    title: "AI 工程落地",
    zone: "智能引擎",
    summary: "把业务需求拆解成 Prompt、Agent、规则、工作流和系统功能，关注 AI 能力边界、评测、验收和持续迭代。",
  },
  {
    icon: Route,
    title: "业务流程理解",
    zone: "业务航线",
    summary: "理解从需求、执行、数据反馈到复盘优化的完整业务链路，能把经验判断沉淀为可执行规则。",
  },
  {
    icon: Workflow,
    title: "自动化与流程固化",
    zone: "效率通道",
    summary: "将重复性工作转化为脚本、规则引擎或后台系统，减少人工判断和机械操作。",
  },
  {
    icon: Blocks,
    title: "全栈开发与系统实现",
    zone: "工程基建",
    summary: "能够从需求分析、接口设计、前后端开发、数据处理到部署上线，完成业务工具的闭环开发。",
  },
  {
    icon: ServerCog,
    title: "部署运维与基础设施",
    zone: "运行底座",
    summary: "具备服务器搭建、Nginx 反代、图床、UPS 脚本、安全排查、本地服务部署等实践经验。",
  },
  {
    icon: Gauge,
    title: "业务 ROI 与产品判断",
    zone: "价值雷达",
    summary: "关注系统是否真正节省人力、提高效率、降低风险，而不是单纯为了技术而技术。",
  },
  {
    icon: Compass,
    title: "主观能动性",
    zone: "启动信号",
    summary: "面对新问题会主动补齐信息、拆解路径、验证方案，并把经验沉淀为下一次可复用的方法。",
  },
];

const capabilityProgressSections: ProgressSection[] = [
  { id: "capability-top", label: "地图概览" },
  { id: "capability-map", label: "能力节点" },
  { id: "capability-legend", label: "结果验证" },
];

export default function CapabilitiesPage() {
  return (
    <main className="site-shell draft-shell">
      <AmbientCanvas />
      <ReadingProgress sections={capabilityProgressSections} />
      <header className="top-nav">
        <a className="brand-mark" href="#/">
          <span>YOU</span>
          <strong>{profile.name}</strong>
        </a>
        <nav aria-label="能力地图页导航">
          <a className="nav-cta" href="#/">
            <ArrowLeft size={16} />
            返回首页
          </a>
        </nav>
      </header>

      <section className="draft-hero reveal" id="capability-top">
        <span className="status-pill">Capability Map</span>
        <h1>能力地图</h1>
        <p>用一张结构化线稿，快速理解我如何把业务、AI、自动化和工程实现连接起来。</p>
      </section>

      <section className="capability-map-page reveal delay-1" id="capability-map" aria-label="能力地图">
        <div className="capability-map-grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="capability-map-core" aria-label="能力地图核心">
          <CircuitBoard size={24} />
          <strong>AI Native 业务工具化</strong>
          <span>把业务判断转成可运行系统</span>
        </div>

        {capabilityMap.map((item, index) => {
          const Icon = item.icon;

          return (
            <article className="capability-map-node reveal" key={item.title}>
              <span className="capability-map-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="capability-map-icon">
                <Icon size={18} />
              </span>
              <div>
                <em>{item.zone}</em>
                <h2>{item.title}</h2>
                <p>{item.summary}</p>
              </div>
            </article>
          );
        })}

        <div className="capability-map-legend" id="capability-legend" aria-label="能力组合说明">
          <span>
            <MapPinned size={15} />
            能力坐标
          </span>
          <span>
            <Target size={15} />
            业务目标
          </span>
          <span>
            <ChartNoAxesCombined size={15} />
            结果验证
          </span>
          <span>
            <Zap size={15} />
            自动化提效
          </span>
        </div>
      </section>
    </main>
  );
}
