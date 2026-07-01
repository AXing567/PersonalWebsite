export type KnowledgeSource = "个人能力盘点" | "项目经验" | "简历表格";

export type KnowledgeSourceMeta = {
  name: KnowledgeSource;
  path: string;
  summary: string;
};

export type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  sources?: KnowledgeSource[];
};

export const suggestedQuestions = [
  "你最核心的优势是什么？",
  "你做过哪些 AI 工具项目？",
  "代表项目里你负责什么？",
  "流程复盘类系统有什么价值？",
  "你最适合什么岗位？",
  "工程能力在你的定位里怎么用？",
];

export function createGreeting(name = "网站主人"): ChatMessage {
  return {
    id: "assistant-greeting",
    role: "assistant",
    text: `你好，我是${name}的 AI 分身。你可以问我核心优势、项目经历、技术栈、工作方式，或直接问“为什么他适合这个岗位”。`,
  };
}
