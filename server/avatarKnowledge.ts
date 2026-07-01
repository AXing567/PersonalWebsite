import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ResumeData } from "../src/data/resumeTypes";
import { readPrivateResumeData } from "./privateResumeData";
import { readSiteSettings, type SiteSettings } from "./siteContent";

type AvatarClientMessage = {
  role: "assistant" | "user";
  text: string;
};

export type RetrievedKnowledgeSource = {
  id: string;
  isRelevant: boolean;
  score: number;
  source: string;
  title: string;
};

export type AvatarPromptContext = {
  hasRelevantSources: boolean;
  sources: RetrievedKnowledgeSource[];
  systemPrompt: string;
};

type KnowledgeChunk = {
  content: string;
  id: string;
  isBaseline?: boolean;
  priority: number;
  source: string;
  title: string;
};

type BuildAvatarPromptOptions = {
  concise?: boolean;
  history?: AvatarClientMessage[];
  question: string;
};

const TOP_K = 7;
const BASELINE_CHUNK_IDS = new Set(["profile", "skills"]);
const MIN_SCORE = 1.6;
const MAX_CHUNK_LENGTH = 1400;
const EXTERNAL_MARKDOWN_CHUNK_LENGTH = 1800;

const externalMarkdownSources = [
  {
    id: "capability-inventory",
    source: "个人能力盘点",
    title: "个人能力盘点",
    fileName: "个人能力盘点.md",
    priority: 1.7,
  },
  {
    id: "project-experience",
    source: "项目经验",
    title: "项目经验",
    fileName: "项目经验.md",
    priority: 1.8,
  },
];

type ResolvedExternalMarkdownSource = (typeof externalMarkdownSources)[number] & {
  content: string;
};

const stopWords = new Set([
  "什么",
  "怎么",
  "为什么",
  "是否",
  "可以",
  "一下",
  "介绍",
  "说明",
  "以及",
  "这个",
  "那个",
  "他的",
  "你",
  "我",
  "他",
  "吗",
  "呢",
]);

const synonymGroups = [
  ["岗位", "职位", "求职", "方向", "定位", "适合", "候选人"],
  ["是谁", "姓名", "名字", "候选人", "基础", "信息", "介绍", "个人"],
  ["优势", "能力", "强项", "擅长", "亮点", "特点"],
  ["项目", "经历", "案例", "经验", "负责", "成果"],
  ["技术", "技能", "技术栈", "工程", "开发", "系统"],
  ["教育", "学校", "学历", "在校", "奖学金", "竞赛"],
  ["电商", "运营", "复盘", "诊断", "经营"],
  ["RPA", "自动化", "脚本", "流程"],
  ["AI", "模型", "工具", "分身", "智能", "生成"],
  ["联系方式", "电话", "手机", "邮箱", "微信", "联系"],
];

const formatList = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

const truncateChunk = (content: string) => {
  if (content.length <= MAX_CHUNK_LENGTH) return content;
  return `${content.slice(0, MAX_CHUNK_LENGTH)}\n- 内容已截断，仅保留最相关部分。`;
};

const formatChunkContent = (content: string, shouldTruncate: boolean) => (shouldTruncate ? truncateChunk(content) : content);

const getExternalKnowledgeRoot = () => {
  const configuredRoot = process.env.AVATAR_KNOWLEDGE_NOTE_DIR?.trim();
  if (configuredRoot) return configuredRoot;

  const privateNotesRoot = path.resolve(process.cwd(), "server/private/avatar-notes");
  if (existsSync(privateNotesRoot)) return privateNotesRoot;

  return "";
};

const readExternalMarkdownSources = (): ResolvedExternalMarkdownSource[] => {
  const root = getExternalKnowledgeRoot();
  if (!root) return [];

  return externalMarkdownSources.flatMap((source) => {
    const filePath = path.join(root, source.fileName);
    if (!existsSync(filePath)) return [];

    try {
      const content = readFileSync(filePath, "utf8").trim();
      return content ? [{ ...source, content }] : [];
    } catch {
      return [];
    }
  });
};

const splitLongMarkdownSection = (section: string) => {
  if (section.length <= EXTERNAL_MARKDOWN_CHUNK_LENGTH) return [section];

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of section.split(/\n{2,}/)) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;

    if (next.length <= EXTERNAL_MARKDOWN_CHUNK_LENGTH) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= EXTERNAL_MARKDOWN_CHUNK_LENGTH) {
      current = paragraph;
      continue;
    }

    for (let index = 0; index < paragraph.length; index += EXTERNAL_MARKDOWN_CHUNK_LENGTH) {
      chunks.push(paragraph.slice(index, index + EXTERNAL_MARKDOWN_CHUNK_LENGTH));
    }
  }

  if (current) chunks.push(current);
  return chunks;
};

const splitMarkdownIntoChunks = (content: string) => {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  return normalized
    .split(/(?=^#{1,3}\s+)/m)
    .flatMap((section) => splitLongMarkdownSection(section.trim()))
    .filter(Boolean);
};

const getMarkdownChunkTitle = (content: string, fallback: string, index: number) => {
  const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return heading || (index === 0 ? fallback : `${fallback} ${index + 1}`);
};

const buildExternalMarkdownChunks = () =>
  readExternalMarkdownSources().flatMap((source) =>
    splitMarkdownIntoChunks(source.content).map((chunk, index) => ({
      content: chunk,
      id: `external-${source.id}-${index + 1}`,
      priority: source.priority,
      source: source.source,
      title: getMarkdownChunkTitle(chunk, source.title, index),
    })),
  );

const compact = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

const cjkBigrams = (text: string) => {
  const units = new Set<string>();
  const groups = text.match(/[\u4e00-\u9fff]+/g) ?? [];

  for (const group of groups) {
    if (group.length <= 4) {
      units.add(group);
    }

    for (let index = 0; index < group.length - 1; index += 1) {
      units.add(group.slice(index, index + 2));
    }

    for (let index = 0; index < group.length - 2; index += 1) {
      units.add(group.slice(index, index + 3));
    }
  }

  return units;
};

const createSearchTokens = (text: string) => {
  const tokens = new Set<string>();
  const lower = compact(text);

  for (const token of lower.match(/[a-z0-9+#.-]{2,}/gi) ?? []) {
    tokens.add(token.toLowerCase());
  }

  for (const token of cjkBigrams(text)) {
    if (!stopWords.has(token)) {
      tokens.add(token);
    }
  }

  for (const group of synonymGroups) {
    if (group.some((word) => lower.includes(word.toLowerCase()))) {
      group.forEach((word) => tokens.add(word.toLowerCase()));
    }
  }

  return Array.from(tokens).filter((token) => token.length >= 2 && !stopWords.has(token));
};

const addChunk = (
  chunks: KnowledgeChunk[],
  id: string,
  source: string,
  title: string,
  lines: Array<string | undefined | null | false>,
  priority = 1,
  isBaseline = false,
) => {
  const content = lines.filter(Boolean).join("\n").trim();
  if (!content) return;

  chunks.push({
    content,
    id,
    isBaseline,
    priority,
    source,
    title,
  });
};

const buildKnowledgeChunks = (resumeData: ResumeData) => {
  const chunks: KnowledgeChunk[] = [];
  const {
    capabilities,
    education,
    educationHonors,
    experience,
    featuredProjects,
    metrics,
    otherProjects,
    profile,
    skillGroups,
    softStrengths,
  } = resumeData;

  addChunk(
    chunks,
    "profile",
    "简历基础资料",
    "候选人基础信息与求职方向",
    [
      `姓名: ${profile.name}`,
      `英文名: ${profile.englishName}`,
      `定位: ${profile.title}`,
      `当前状态: ${profile.current}`,
      `当前单位: ${profile.company}`,
      `求职方向: ${profile.intent}`,
      `所在地/到岗: ${profile.location}`,
      `手机: ${profile.phone}`,
      `邮箱: ${profile.email}`,
      `简短介绍: ${profile.shortPitch}`,
      `页面摘要: ${profile.heroSummary}`,
      metrics.length ? `核心指标: ${metrics.map((metric) => `${metric.label} ${metric.value}`).join("；")}` : "",
    ],
    2,
    true,
  );

  capabilities.forEach((capability, index) => {
    addChunk(
      chunks,
      `capability-${index + 1}`,
      "个人能力盘点",
      capability.title,
      [
        `能力: ${capability.title}`,
        `概述: ${capability.summary}`,
        `要点:\n${formatList(capability.points)}`,
        `熟练度参考: ${capability.level}/100`,
      ],
      1.5,
    );
  });

  featuredProjects.forEach((project, index) => {
    addChunk(
      chunks,
      `project-${index + 1}`,
      "项目经验",
      project.name,
      [
        `项目: ${project.name}`,
        `时间: ${project.period}`,
        `定位: ${project.subtitle}`,
        `角色: ${project.role}`,
        `结果: ${project.result}`,
        `技术/关键词: ${project.stack.join("、")}`,
        `关键动作:\n${formatList(project.highlights)}`,
      ],
      1.8,
    );
  });

  experience.forEach((item, index) => {
    addChunk(
      chunks,
      `experience-${index + 1}`,
      "工作经历",
      `${item.organization} · ${item.title}`,
      [`经历: ${item.title}`, `时间: ${item.period}`, `组织: ${item.organization}`, `工作内容:\n${formatList(item.details)}`],
      1.4,
      true,
    );
  });

  if (otherProjects.length) {
    addChunk(chunks, "other-projects", "项目经验", "其他项目与工具实践", ["其他项目:", formatList(otherProjects)], 1.1);
  }

  if (skillGroups.length) {
    addChunk(
      chunks,
      "skills",
      "技能清单",
      "技术栈与工具能力",
      skillGroups.map((group) => `- ${group.title}: ${group.items.join("、")}`),
      1.4,
    );
  }

  if (education[0]) {
    addChunk(
      chunks,
      "education",
      "教育背景",
      `${education[0].organization} · ${education[0].title}`,
      [
        `教育: ${education[0].organization} ${education[0].title}`,
        `时间: ${education[0].period}`,
        `说明:\n${formatList(education[0].details)}`,
        `在校奖项/经历:\n${educationHonors.map((honor) => `- ${honor.date}: ${honor.text}`).join("\n")}`,
      ],
      1.2,
    );
  }

  if (softStrengths.length) {
    addChunk(chunks, "soft-strengths", "协作方式", "软性优势与工作方式", [formatList(softStrengths)], 1);
  }

  chunks.push(...buildExternalMarkdownChunks());

  return chunks;
};

const scoreChunk = (chunk: KnowledgeChunk, tokens: string[], rawQuery: string) => {
  const title = compact(chunk.title);
  const source = compact(chunk.source);
  const content = compact(chunk.content);
  const haystack = `${source}\n${title}\n${content}`;
  const normalizedQuery = compact(rawQuery);
  let score = 0;

  if (normalizedQuery.length >= 4 && haystack.includes(normalizedQuery)) {
    score += 8;
  }

  for (const token of tokens) {
    if (title.includes(token)) score += 3.5;
    if (source.includes(token)) score += 2;
    if (content.includes(token)) score += 1;
  }

  return score * chunk.priority;
};

const getRetrievalQuery = (question: string, history: AvatarClientMessage[]) => {
  const recentUserMessages = history
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.text)
    .join("\n");

  return [recentUserMessages, question].filter(Boolean).join("\n");
};

const retrieveKnowledge = (chunks: KnowledgeChunk[], question: string, history: AvatarClientMessage[]) => {
  const query = getRetrievalQuery(question, history);
  const tokens = createSearchTokens(query);
  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, tokens, query),
    }))
    .sort((left, right) => right.score - left.score);
  const relevant = scored.filter((item) => item.score >= MIN_SCORE);
  const selected = relevant.slice(0, TOP_K).map((item) => item.chunk);

  for (const baselineChunk of chunks.filter((chunk) => BASELINE_CHUNK_IDS.has(chunk.id))) {
    if (!selected.some((chunk) => chunk.id === baselineChunk.id)) {
      selected.push(baselineChunk);
    }
  }

  return selected.slice(0, TOP_K).map((chunk, index) => ({
    chunk,
    id: `S${index + 1}`,
    isRelevant: relevant.some((item) => item.chunk.id === chunk.id),
    score: scored.find((item) => item.chunk.id === chunk.id)?.score ?? 0,
  }));
};

const formatRetrievedContext = (
  retrieved: Array<{
    chunk: KnowledgeChunk;
    id: string;
    isRelevant: boolean;
    score: number;
  }>,
  shouldTruncate = true,
) =>
  retrieved
    .map(
      ({ chunk, id }) =>
        `[${id}] ${chunk.source} / ${chunk.title}\n${formatChunkContent(chunk.content, shouldTruncate)}`,
    )
    .join("\n\n");

const buildFullContextKnowledge = (chunks: KnowledgeChunk[]) =>
  chunks.map((chunk, index) => ({
    chunk,
    id: `S${index + 1}`,
    isRelevant: true,
    score: chunk.priority,
  }));

export const buildAvatarKnowledgeDigest = (maxLength = 24_000) => {
  const privateResumeData = readPrivateResumeData();
  const chunks = buildKnowledgeChunks(privateResumeData);
  const context = formatRetrievedContext(buildFullContextKnowledge(chunks), false);

  if (context.length <= maxLength) return context;

  return `${context.slice(0, maxLength)}\n\n[知识资料过长，已截断到前 ${maxLength} 字符。]`;
};

const extractCitedSourceIds = (answerText: string) => {
  const citedIds = new Set<string>();

  for (const match of answerText.matchAll(/\[S(\d+)\]/g)) {
    citedIds.add(`S${Number(match[1])}`);
  }

  return citedIds;
};

export const formatSourceAppendix = (sources: RetrievedKnowledgeSource[], answerText?: string) => {
  const relevantSources = sources.filter((source) => source.isRelevant);
  const citedIds = typeof answerText === "string" ? extractCitedSourceIds(answerText) : undefined;
  const displayedSources =
    citedIds
      ? relevantSources.filter((source) => citedIds.has(source.id))
      : relevantSources;

  if (citedIds && !citedIds.size) {
    return "\n\n**引用来源**\n- 回答正文未标注具体来源。";
  }

  if (citedIds && citedIds.size && !displayedSources.length) {
    return "\n\n**引用来源**\n- 回答正文引用的来源编号未命中当前知识片段。";
  }

  if (!displayedSources.length) {
    return "\n\n**引用来源**\n- 当前知识库没有检索到足够来源。";
  }

  return `\n\n**引用来源**\n${displayedSources.map((source) => `- [${source.id}] ${source.source}：${source.title}`).join("\n")}`;
};

export function buildAvatarSystemPrompt({ concise = false, history = [], question }: BuildAvatarPromptOptions): AvatarPromptContext {
  const privateResumeData = readPrivateResumeData();
  const { profile } = privateResumeData;
  const settings = readSiteSettings();
  const knowledgeMode: SiteSettings["avatarKnowledgeMode"] = settings.avatarKnowledgeMode;
  const chunks = buildKnowledgeChunks(privateResumeData);
  const retrieved =
    knowledgeMode === "full-context" ? buildFullContextKnowledge(chunks) : retrieveKnowledge(chunks, question, history);
  const hasRelevantSources = retrieved.some((item) => item.isRelevant);
  const sources = retrieved.map(({ chunk, id, isRelevant, score }) => ({
    id,
    isRelevant,
    score,
    source: chunk.source,
    title: chunk.title,
  }));
  const retrievedContext = formatRetrievedContext(retrieved, knowledgeMode !== "full-context");

  const conciseRule = concise
    ? "\n降级回答要求：当前处于降级兜底阶段，回答控制在 4 到 6 个要点内；不确定的信息仍然明确说明“当前知识库资料不足”。"
    : "";
  const contextLabel = knowledgeMode === "full-context" ? "完整知识库上下文" : "检索到的知识库片段";
  const groundingRule =
    knowledgeMode === "full-context"
      ? "8. 当前模式为“全量上下文”：下方已经提供完整核心知识库资料，可以综合不同片段回答；如果完整资料里仍没有问题所需事实，必须说明“当前知识库资料不足以回答这个问题”。"
      : `8. 当前检索${
          hasRelevantSources
            ? "已命中相关知识片段，可以在证据足够时回答。"
            : "没有命中足够相关的知识片段；除非问题只是在确认候选人基础身份，否则必须回答“当前知识库资料不足以回答这个问题”。"
        }`;

  return {
    hasRelevantSources,
    sources,
    systemPrompt: `你是${profile.name}的 AI 分身，用于帮助 HR、技术负责人和合作伙伴更全面地了解候选人。

必须遵守：
1. 只能基于下方“${contextLabel}”回答，不能编造不存在的公司、项目、时间、成绩、职责、联系方式或结论。
2. 每个关键判断都必须能被至少一个来源片段支持，并在句末标注来源编号，例如 [S1]。
3. 如果知识库资料不足以回答问题，必须明确说“当前知识库资料不足以回答这个问题”，并说明还缺少哪类资料；不要用常识或猜测补齐。
4. 回答末尾会由系统自动追加“引用来源”清单；你不要自造来源编号，也不要引用未出现在片段里的资料。
5. 语气专业、真诚、克制，优先给结论，再给依据；中文回答，必要时使用短标题和要点。
6. 涉及隐私或联系方式时，只能在知识库片段明确出现时回答。
7. 如果用户询问“是否适合某岗位”或“最适合什么岗位”，只能基于求职方向、能力盘点、项目经历和技术栈给出判断；证据不足时要说资料不足。${conciseRule}
${groundingRule}

${contextLabel}：
${retrievedContext}`,
  };
}
