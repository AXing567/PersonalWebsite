import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type RuntimeBackupCategory =
  | "articles"
  | "avatar-notes"
  | "resume-data"
  | "resume-pdf"
  | "runtime-settings"
  | "site-assets";

export type RuntimeBackupMeta = {
  action: string;
  category: RuntimeBackupCategory;
  createdAt: number;
  id: string;
  isDirectory: boolean;
  itemName: string;
  originalPath: string;
  size: number;
};

const projectRoot = process.cwd();
const privateRoot = path.resolve(projectRoot, "server/private");
const backupRoot = path.join(privateRoot, "runtime-backups");
const HISTORY_LIMIT = 2;

const toPosix = (value: string) => value.split(path.sep).join("/");

const toRelativePath = (absolutePath: string) => toPosix(path.relative(projectRoot, absolutePath));

const assertRestorablePath = (absolutePath: string) => {
  const resolved = path.resolve(absolutePath);
  const envPath = path.resolve(projectRoot, ".env");
  if (resolved === envPath) return resolved;

  const relativeToPrivate = path.relative(privateRoot, resolved);
  if (relativeToPrivate && !relativeToPrivate.startsWith("..") && !path.isAbsolute(relativeToPrivate)) {
    return resolved;
  }

  throw new Error("Refusing to back up a path outside server/private or .env.");
};

const getPathSize = (targetPath: string): number => {
  if (!existsSync(targetPath)) return 0;

  const stats = statSync(targetPath);
  if (!stats.isDirectory()) return stats.size;

  return readdirSync(targetPath).reduce((sum, item) => sum + getPathSize(path.join(targetPath, item)), 0);
};

const getCategoryDir = (category: RuntimeBackupCategory) => path.join(backupRoot, category);

const readBackupManifest = (category: RuntimeBackupCategory, id: string): RuntimeBackupMeta | undefined => {
  const manifestPath = path.join(getCategoryDir(category), id, "manifest.json");
  if (!existsSync(manifestPath)) return undefined;

  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as RuntimeBackupMeta;
  } catch {
    return undefined;
  }
};

export const listRuntimeBackups = (category: RuntimeBackupCategory) => {
  const categoryDir = getCategoryDir(category);
  if (!existsSync(categoryDir)) return [] as RuntimeBackupMeta[];

  return readdirSync(categoryDir, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => readBackupManifest(category, item.name))
    .filter((item): item is RuntimeBackupMeta => Boolean(item))
    .sort((left, right) => right.createdAt - left.createdAt);
};

const pruneRuntimeBackups = (category: RuntimeBackupCategory, originalPath: string, preservedIds: string[] = []) => {
  const backups = listRuntimeBackups(category);
  backups
    .filter((backup) => backup.originalPath === originalPath)
    .filter((backup) => !preservedIds.includes(backup.id))
    .slice(HISTORY_LIMIT)
    .forEach((backup) => {
      rmSync(path.join(getCategoryDir(category), backup.id), { force: true, recursive: true });
    });
};

const createBackupId = (action: string) => {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Date.now().toString(36);
  return `${timestamp}-${suffix}-${action.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`;
};

export const createRuntimeBackup = (
  category: RuntimeBackupCategory,
  sourcePath: string,
  action = "replace",
  preservedIds: string[] = [],
): RuntimeBackupMeta | undefined => {
  const resolvedSource = assertRestorablePath(sourcePath);
  if (!existsSync(resolvedSource)) return undefined;

  const stats = statSync(resolvedSource);
  const id = createBackupId(action);
  const backupDir = path.join(getCategoryDir(category), id);
  const itemName = path.basename(resolvedSource);
  const backupItemPath = path.join(backupDir, itemName);

  mkdirSync(backupDir, { recursive: true });
  cpSync(resolvedSource, backupItemPath, { force: true, recursive: true });

  const meta: RuntimeBackupMeta = {
    action,
    category,
    createdAt: Date.now(),
    id,
    isDirectory: stats.isDirectory(),
    itemName,
    originalPath: toRelativePath(resolvedSource),
    size: getPathSize(resolvedSource),
  };

  writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  pruneRuntimeBackups(category, meta.originalPath, preservedIds);
  return meta;
};

export const restoreRuntimeBackup = (category: RuntimeBackupCategory, id: string) => {
  const backup = readBackupManifest(category, id);
  if (!backup) throw new Error("Backup not found.");

  const targetPath = assertRestorablePath(path.resolve(projectRoot, backup.originalPath));
  const backupItemPath = path.join(getCategoryDir(category), id, backup.itemName);
  if (!existsSync(backupItemPath)) throw new Error("Backup file is missing.");

  createRuntimeBackup(category, targetPath, "pre-restore", [id]);
  rmSync(targetPath, { force: true, recursive: true });
  mkdirSync(path.dirname(targetPath), { recursive: true });
  cpSync(backupItemPath, targetPath, { force: true, recursive: true });
  pruneRuntimeBackups(category, backup.originalPath);
  return backup;
};

export const getRuntimePathMeta = (targetPath: string) => {
  const resolvedPath = path.resolve(targetPath);
  const exists = existsSync(resolvedPath);
  if (!exists) {
    return {
      exists,
      isDirectory: false,
      name: path.basename(resolvedPath),
      path: toRelativePath(resolvedPath),
      size: 0,
    };
  }

  const stats = statSync(resolvedPath);
  return {
    exists,
    isDirectory: stats.isDirectory(),
    name: path.basename(resolvedPath),
    path: toRelativePath(resolvedPath),
    size: getPathSize(resolvedPath),
    updatedAt: stats.mtimeMs,
  };
};
