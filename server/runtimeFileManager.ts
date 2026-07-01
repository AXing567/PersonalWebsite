import { execFileSync } from "node:child_process";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Connect } from "vite";
import { requireAdminAccess } from "./adminAccess";
import { readRequestBody, sendJson } from "./resumeAccess";
import {
  createRuntimeBackup,
  getRuntimePathMeta,
  listRuntimeBackups,
  restoreRuntimeBackup,
  type RuntimeBackupCategory,
} from "./runtimeBackups";

type ManagedFileCategory =
  | "articles"
  | "avatar-notes"
  | "resume-data"
  | "resume-pdf"
  | "runtime-settings"
  | "site-assets";

type ManagedFilePayload = {
  contentBase64?: unknown;
  fileName?: unknown;
  id?: unknown;
  kind?: unknown;
  settings?: unknown;
};

const projectRoot = process.cwd();
const privateRoot = path.resolve(projectRoot, "server/private");
const avatarNotesRoot = path.join(privateRoot, "avatar-notes");
const siteAssetsRoot = path.join(privateRoot, "site-assets");
const publicFaviconPath = path.resolve(projectRoot, "public/favicon.svg");
const resumeDataPath = path.join(privateRoot, "resume-data.local.json");
const resumePdfPath = path.join(privateRoot, "resume-demo.pdf");
const articlesPath = path.join(privateRoot, "articles.local.json");
const siteSettingsPath = path.join(privateRoot, "site-settings.local.json");
const envPath = path.resolve(projectRoot, ".env");
const importBackupRoot = path.resolve(projectRoot, "artifacts/private-data-backups/admin-imports");
const MAX_TEXT_FILE_BYTES = 700_000;
const MAX_BINARY_FILE_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_ARCHIVE_BYTES = 80 * 1024 * 1024;

const backupCategoryByFileCategory: Record<ManagedFileCategory, RuntimeBackupCategory> = {
  articles: "articles",
  "avatar-notes": "avatar-notes",
  "resume-data": "resume-data",
  "resume-pdf": "resume-pdf",
  "runtime-settings": "runtime-settings",
  "site-assets": "site-assets",
};

const allowedRuntimeSecretKeys = new Set([
  "ADMIN_ACCESS_PASSWORD",
  "AVATAR_API_KEY",
  "AVATAR_API_URL",
  "AVATAR_FALLBACK_MODEL",
  "AVATAR_MODEL",
  "RESUME_ACCESS_PASSWORD",
]);

const normalizeText = (value: unknown, maxLength: number) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
};

const getSafeFileName = (value: unknown, fallback: string) => {
  const fileName = normalizeText(value, 120)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/[^\w.\-\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return fileName || fallback;
};

const shellSafeDownloadName = (value: string) => value.replace(/[\r\n"]/g, "").trim() || "download";

const readPayload = async (req: Connect.IncomingMessage) => {
  const rawBody = await readRequestBody(req);
  return rawBody ? (JSON.parse(rawBody) as ManagedFilePayload) : {};
};

const readBase64Buffer = (value: unknown, maxBytes: number) => {
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing file content.");
  const buffer = Buffer.from(value, "base64");
  if (!buffer.length) throw new Error("File content is empty.");
  if (buffer.byteLength > maxBytes) throw new Error("File is too large.");
  return buffer;
};

const sendFileDownload = (req: Connect.IncomingMessage, res: Connect.ServerResponse, filePath: string, downloadName?: string) => {
  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: "File not found." });
    return;
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    sendJson(res, 400, { error: "Requested path is not a file." });
    return;
  }

  const finalName = shellSafeDownloadName(downloadName || path.basename(filePath));
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(stats.size));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(finalName)}"; filename*=UTF-8''${encodeURIComponent(finalName)}`);

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
};

const writeFileWithBackup = (category: RuntimeBackupCategory, targetPath: string, data: string | Buffer, action: string) => {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  createRuntimeBackup(category, targetPath, action);
  writeFileSync(targetPath, data);
};

const validateResumeData = (buffer: Buffer) => {
  const text = buffer.toString("utf8");
  const parsed = JSON.parse(text) as {
    capabilities?: unknown;
    education?: unknown;
    featuredProjects?: unknown;
    profile?: { name?: unknown; title?: unknown };
    skillGroups?: unknown;
  };

  if (
    !parsed.profile ||
    typeof parsed.profile.name !== "string" ||
    typeof parsed.profile.title !== "string" ||
    !Array.isArray(parsed.capabilities) ||
    !Array.isArray(parsed.education) ||
    !Array.isArray(parsed.featuredProjects) ||
    !Array.isArray(parsed.skillGroups)
  ) {
    throw new Error("Resume JSON shape is invalid.");
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
};

const validateArticlesData = (buffer: Buffer) => {
  const text = buffer.toString("utf8");
  const parsed = JSON.parse(text) as { articles?: unknown };
  if (!Array.isArray(parsed.articles)) throw new Error("Articles JSON must contain an articles array.");
  return `${JSON.stringify(parsed, null, 2)}\n`;
};

const validateMarkdown = (buffer: Buffer) => {
  const text = buffer.toString("utf8").replace(/\r\n/g, "\n");
  if (!text.trim()) throw new Error("Markdown content is empty.");
  return text;
};

const validateSvg = (buffer: Buffer) => {
  const text = buffer.toString("utf8").trim();
  if (!/^<svg[\s>]/i.test(text)) throw new Error("SVG file must start with an <svg> element.");
  return text.endsWith("\n") ? text : `${text}\n`;
};

const validatePdf = (buffer: Buffer) => {
  if (!buffer.subarray(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new Error("Uploaded resume file is not a valid PDF.");
  }
  return buffer;
};

const parseEnvText = (text: string) => {
  const map = new Map<string, string>();
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    map.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  });
  return map;
};

const serializeEnv = (values: Map<string, string>) =>
  Array.from(values.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
    .concat("\n");

const getSecretStatus = () => {
  const values = existsSync(envPath) ? parseEnvText(readFileSync(envPath, "utf8")) : new Map<string, string>();
  return Array.from(allowedRuntimeSecretKeys).map((key) => ({
    isConfigured: Boolean(values.get(key)?.trim()),
    key,
    value: values.get(key) ?? "",
  }));
};

const updateRuntimeSecrets = (settings: unknown) => {
  if (!settings || typeof settings !== "object") throw new Error("Missing runtime settings payload.");
  const payload = settings as Record<string, unknown>;
  const values = existsSync(envPath) ? parseEnvText(readFileSync(envPath, "utf8")) : new Map<string, string>();
  let changed = false;

  Object.entries(payload).forEach(([key, value]) => {
    if (!allowedRuntimeSecretKeys.has(key)) return;
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (!normalized) return;
    values.set(key, normalized);
    changed = true;
  });

  if (!changed) throw new Error("No valid runtime setting was provided.");
  writeFileWithBackup("runtime-settings", envPath, serializeEnv(values), "env-save");
};

const createRuntimeExportArchive = () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "personal-site-runtime-export-"));
  const archivePath = path.join(tempDir, `personal-site-runtime-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.tar.gz`);
  const items: string[] = [];

  if (existsSync(envPath)) items.push(".env");
  if (existsSync(privateRoot)) items.push("server/private");
  if (!items.length) throw new Error("No runtime data found to export.");

  execFileSync("tar", ["-czhf", archivePath, "-C", projectRoot, ...items], { stdio: "ignore" });
  return {
    archivePath,
    cleanup: () => rmSync(tempDir, { force: true, recursive: true }),
  };
};

const createPreImportBackup = () => {
  const backupDir = path.join(importBackupRoot, new Date().toISOString().replace(/\D/g, "").slice(0, 14));
  const archivePath = path.join(backupDir, "personal-site-pre-import-runtime.tar.gz");
  const items: string[] = [];

  if (existsSync(envPath)) items.push(".env");
  if (existsSync(privateRoot)) items.push("server/private");
  if (!items.length) return undefined;

  mkdirSync(backupDir, { recursive: true });
  execFileSync("tar", ["-czhf", archivePath, "-C", projectRoot, ...items], { stdio: "ignore" });
  return archivePath;
};

const validateArchiveEntries = (archivePath: string) => {
  const rawList = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const entries = rawList
    .split(/\r?\n/)
    .map((entry) => entry.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter(Boolean);

  if (!entries.length) throw new Error("Import archive is empty.");

  entries.forEach((entry) => {
    if (entry.startsWith("/") || entry.includes("..") || /^[a-z]:/i.test(entry)) {
      throw new Error("Import archive contains unsafe paths.");
    }

    const normalized = entry.replace(/\/$/, "");
    const isAllowed =
      normalized === ".env" ||
      normalized === "server" ||
      normalized === "server/private" ||
      normalized.startsWith("server/private/");

    if (!isAllowed) {
      throw new Error("Import archive may only contain .env and server/private.");
    }
  });
};

const importRuntimeArchive = (payload: ManagedFilePayload) => {
  const buffer = readBase64Buffer(payload.contentBase64, MAX_IMPORT_ARCHIVE_BYTES);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "personal-site-runtime-import-"));
  const archivePath = path.join(tempDir, "runtime-import.tar.gz");
  const extractDir = path.join(tempDir, "extract");

  try {
    writeFileSync(archivePath, buffer);
    validateArchiveEntries(archivePath);
    mkdirSync(extractDir, { recursive: true });
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: "ignore" });
    createPreImportBackup();

    const importedEnvPath = path.join(extractDir, ".env");
    if (existsSync(importedEnvPath)) {
      createRuntimeBackup("runtime-settings", envPath, "pre-import");
      mkdirSync(path.dirname(envPath), { recursive: true });
      cpSync(importedEnvPath, envPath, { force: true });
    }

    const importedPrivatePath = path.join(extractDir, "server/private");
    if (existsSync(importedPrivatePath)) {
      copyDirectoryContents(importedPrivatePath, privateRoot);
    }
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
};

const copyDirectoryContents = (sourceDir: string, targetDir: string) => {
  mkdirSync(targetDir, { recursive: true });
  readdirSync(sourceDir, { withFileTypes: true }).forEach((item) => {
    cpSync(path.join(sourceDir, item.name), path.join(targetDir, item.name), {
      force: true,
      recursive: true,
    });
  });
};

const getDirectoryFiles = (directoryPath: string) => {
  if (!existsSync(directoryPath)) return [];

  return readdirSync(directoryPath, { withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => getRuntimePathMeta(path.join(directoryPath, item.name)))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const getManagedCategorySummary = (category: ManagedFileCategory) => {
  if (category === "resume-data") return { category, current: getRuntimePathMeta(resumeDataPath), files: [] };
  if (category === "resume-pdf") return { category, current: getRuntimePathMeta(resumePdfPath), files: [] };
  if (category === "articles") return { category, current: getRuntimePathMeta(articlesPath), files: [] };
  if (category === "avatar-notes") return { category, current: getRuntimePathMeta(avatarNotesRoot), files: getDirectoryFiles(avatarNotesRoot) };
  if (category === "site-assets") return { category, current: getRuntimePathMeta(siteAssetsRoot), files: getDirectoryFiles(siteAssetsRoot) };

  return {
    category,
    current: getRuntimePathMeta(envPath),
    files: [getRuntimePathMeta(siteSettingsPath)],
    secretStatus: getSecretStatus(),
  };
};

const getDownloadTarget = (category: ManagedFileCategory, fileName: string | null) => {
  if (category === "resume-data") return { name: "resume-data.local.json", path: resumeDataPath };
  if (category === "resume-pdf") return { name: "resume.pdf", path: resumePdfPath };
  if (category === "articles") return { name: "articles.local.json", path: articlesPath };

  if (category === "runtime-settings") {
    if (fileName === "site-settings.local.json") {
      return { name: "site-settings.local.json", path: siteSettingsPath };
    }
    return { name: ".env", path: envPath };
  }

  if (category === "avatar-notes") {
    const safeName = getSafeFileName(fileName, "");
    if (!safeName) return undefined;
    return { name: safeName, path: path.join(avatarNotesRoot, safeName) };
  }

  if (category === "site-assets") {
    const safeName = getSafeFileName(fileName, "");
    if (!safeName) return undefined;
    return { name: safeName, path: path.join(siteAssetsRoot, safeName) };
  }

  return undefined;
};

const handleCategoryDownload = (
  req: Connect.IncomingMessage,
  res: Connect.ServerResponse,
  category: ManagedFileCategory,
  fileName: string | null,
) => {
  const target = getDownloadTarget(category, fileName);
  if (!target) {
    sendJson(res, 400, { error: "Missing downloadable file name." });
    return;
  }

  sendFileDownload(req, res, target.path, target.name);
};

const listManagedFiles = () => {
  const categories = Object.keys(backupCategoryByFileCategory) as ManagedFileCategory[];

  return {
    categories: categories.map((category) => ({
      ...getManagedCategorySummary(category),
      backups: listRuntimeBackups(backupCategoryByFileCategory[category]),
    })),
    generatedAt: Date.now(),
  };
};

const deleteManagedFile = (category: ManagedFileCategory, fileName: unknown) => {
  if (category !== "avatar-notes" && category !== "site-assets") {
    throw new Error("This category does not support deleting individual files.");
  }

  const safeName = getSafeFileName(fileName, "");
  if (!safeName) throw new Error("Missing file name.");
  const directory = category === "avatar-notes" ? avatarNotesRoot : siteAssetsRoot;
  const targetPath = path.join(directory, safeName);
  if (!existsSync(targetPath)) throw new Error("File not found.");
  createRuntimeBackup(backupCategoryByFileCategory[category], targetPath, "delete");
  rmSync(targetPath, { force: true });
};

const writeManagedFile = (category: ManagedFileCategory, payload: ManagedFilePayload) => {
  if (category === "runtime-settings") {
    updateRuntimeSecrets(payload.settings);
    return;
  }

  const backupCategory = backupCategoryByFileCategory[category];

  if (category === "resume-data") {
    const buffer = readBase64Buffer(payload.contentBase64, MAX_TEXT_FILE_BYTES);
    writeFileWithBackup(backupCategory, resumeDataPath, validateResumeData(buffer), "upload");
    return;
  }

  if (category === "resume-pdf") {
    const buffer = readBase64Buffer(payload.contentBase64, MAX_BINARY_FILE_BYTES);
    writeFileWithBackup(backupCategory, resumePdfPath, validatePdf(buffer), "upload");
    return;
  }

  if (category === "articles") {
    const buffer = readBase64Buffer(payload.contentBase64, MAX_TEXT_FILE_BYTES);
    writeFileWithBackup(backupCategory, articlesPath, validateArticlesData(buffer), "upload");
    return;
  }

  if (category === "avatar-notes") {
    const buffer = readBase64Buffer(payload.contentBase64, MAX_TEXT_FILE_BYTES);
    const fileName = getSafeFileName(payload.fileName, "note.md");
    if (!/\.(md|markdown|txt)$/i.test(fileName)) throw new Error("Only Markdown/text files are supported.");
    writeFileWithBackup(backupCategory, path.join(avatarNotesRoot, fileName), validateMarkdown(buffer), "upload");
    return;
  }

  if (category === "site-assets") {
    const buffer = readBase64Buffer(payload.contentBase64, MAX_TEXT_FILE_BYTES);
    const kind = payload.kind === "logo" ? "logo" : "favicon";
    const fileName = `${kind}.svg`;
    writeFileWithBackup(backupCategory, path.join(siteAssetsRoot, fileName), validateSvg(buffer), "upload");
  }
};

const normalizeCategory = (value: string | null): ManagedFileCategory | undefined => {
  if (
    value === "articles" ||
    value === "avatar-notes" ||
    value === "resume-data" ||
    value === "resume-pdf" ||
    value === "runtime-settings" ||
    value === "site-assets"
  ) {
    return value;
  }
  return undefined;
};

export const handleAdminManagedFiles: Connect.NextHandleFunction = async (req, res) => {
  if (!requireAdminAccess(req, res)) return;

  const requestUrl = new URL(req.url ?? "/", "http://local");
  const action = requestUrl.searchParams.get("action")?.trim();
  const category = normalizeCategory(requestUrl.searchParams.get("category"));

  if ((req.method === "GET" || req.method === "HEAD") && action === "export") {
    try {
      const { archivePath, cleanup } = createRuntimeExportArchive();
      res.on("finish", cleanup);
      res.on("close", cleanup);
      sendFileDownload(req, res, archivePath, path.basename(archivePath));
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Runtime export failed." });
    }
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && action === "download") {
    if (!category) {
      sendJson(res, 400, { error: "Unknown managed file category." });
      return;
    }

    handleCategoryDownload(req, res, category, requestUrl.searchParams.get("fileName"));
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, listManagedFiles());
    return;
  }

  if (req.method === "POST" && action === "import") {
    try {
      importRuntimeArchive(await readPayload(req));
      sendJson(res, 200, listManagedFiles());
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Runtime import failed." });
    }
    return;
  }

  if (!category) {
    sendJson(res, 400, { error: "Unknown managed file category." });
    return;
  }

  try {
    const payload = await readPayload(req);

    if (req.method === "POST") {
      writeManagedFile(category, payload);
      sendJson(res, 200, listManagedFiles());
      return;
    }

    if (req.method === "DELETE") {
      deleteManagedFile(category, payload.fileName);
      sendJson(res, 200, listManagedFiles());
      return;
    }

    if (req.method === "PATCH") {
      const id = normalizeText(payload.id, 160);
      if (!id) throw new Error("Missing backup id.");
      restoreRuntimeBackup(backupCategoryByFileCategory[category], id);
      sendJson(res, 200, listManagedFiles());
      return;
    }

    sendJson(res, 405, { error: "Unsupported managed file request method." });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Managed file operation failed." });
  }
};

export const handlePublicSiteAsset: Connect.NextHandleFunction = (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Only GET requests are supported." });
    return;
  }

  const requestUrl = new URL(req.url ?? "/", "http://local");
  const kind = requestUrl.searchParams.get("kind") === "logo" ? "logo" : "favicon";
  const privateAssetPath = path.join(siteAssetsRoot, `${kind}.svg`);
  const assetPath = existsSync(privateAssetPath) ? privateAssetPath : kind === "favicon" ? publicFaviconPath : "";

  if (!assetPath || !existsSync(assetPath)) {
    sendJson(res, 404, { error: "Site asset not found." });
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(assetPath).pipe(res);
};
