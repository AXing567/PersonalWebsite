import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const backupDir = path.join(projectRoot, "artifacts", "private-data-backups", `local-${timestamp}`);
const archivePath = path.join(backupDir, "personal-site-local-runtime.tar.gz");
const manifestPath = path.join(backupDir, "manifest.json");

const includeItems = [];
if (existsSync(path.join(projectRoot, ".env"))) includeItems.push(".env");
if (existsSync(path.join(projectRoot, "server/private"))) includeItems.push("server/private");

if (!includeItems.length) {
  console.error("No local runtime data found. Expected .env and/or server/private.");
  process.exitCode = 1;
} else {
  mkdirSync(backupDir, { recursive: true });
  execFileSync("tar", ["-czf", archivePath, "-C", projectRoot, ...includeItems], { stdio: "inherit" });
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        archive: path.relative(projectRoot, archivePath).split(path.sep).join("/"),
        createdAt: new Date().toISOString(),
        includes: includeItems,
        source: "local-complete-runtime-data",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`Local runtime backup ready: ${path.relative(projectRoot, archivePath)}`);
}
