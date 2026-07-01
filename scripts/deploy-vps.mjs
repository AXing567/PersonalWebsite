import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Client } from "ssh2";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "personal-site-deploy-"));
const stageDir = path.join(tempRoot, "stage");
const bundlePath = path.join(tempRoot, "release.tar.gz");
const releaseId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const runLocalNpm = (args) => {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["npm", ...args].join(" ")], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    return;
  }

  execFileSync("npm", args, { cwd: projectRoot, stdio: "inherit" });
};

const env = process.env;
const config = {
  appUser: env.PERSONAL_SITE_APP_USER || "personal-site",
  host: env.PERSONAL_SITE_HOST || "",
  keepReleases: Number(env.PERSONAL_SITE_KEEP_RELEASES || 2),
  password: env.PERSONAL_SITE_PASSWORD || "",
  port: Number(env.PERSONAL_SITE_PORT || 22),
  privateKeyPath: env.PERSONAL_SITE_PRIVATE_KEY || "",
  releaseId: env.PERSONAL_SITE_RELEASE_ID || releaseId,
  root: env.PERSONAL_SITE_ROOT || "/var/www/personal-site",
  service: env.PERSONAL_SITE_SERVICE || "personal-site.service",
  username: env.PERSONAL_SITE_USER || "root",
};

const includeEntries = [
  ".env.example",
  "index.html",
  "package-lock.json",
  "package.json",
  "public",
  "README.md",
  "scripts",
  "server",
  "src",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
];

const excludedPathParts = new Set([".git", "artifacts", "backups", "dist", "node_modules"]);

const toPosix = (value) => value.split(path.sep).join("/");

const shouldCopy = (sourcePath) => {
  const relativePath = toPosix(path.relative(projectRoot, sourcePath));
  if (!relativePath || relativePath === ".") return true;
  if (relativePath === ".env" || relativePath === ".env.local") return false;
  if (relativePath === "server/private" || relativePath.startsWith("server/private/")) return false;
  return !relativePath.split("/").some((part) => excludedPathParts.has(part));
};

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const copyEntry = async (relativePath) => {
  const source = path.join(projectRoot, relativePath);
  if (!existsSync(source) || !shouldCopy(source)) return;

  const destination = path.join(stageDir, relativePath);
  await cp(source, destination, {
    dereference: false,
    filter: shouldCopy,
    force: true,
    recursive: true,
  });
};

const execRemote = (conn, command) =>
  new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      let stdout = "";
      let stderr = "";
      stream.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      stream.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      stream.on("close", (code) => {
        if (code === 0) {
          resolve({ stderr, stdout });
          return;
        }

        const failure = new Error(`Remote command failed with exit code ${code}\n${stderr || stdout}`);
        failure.stdout = stdout;
        failure.stderr = stderr;
        reject(failure);
      });
    });
  });

const uploadFile = (conn, localPath, remotePath) =>
  new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }

      sftp.fastPut(localPath, remotePath, (uploadError) => {
        sftp.end();
        if (uploadError) {
          reject(uploadError);
          return;
        }
        resolve();
      });
    });
  });

const connect = () =>
  new Promise((resolve, reject) => {
    const conn = new Client();
    const connectConfig = {
      host: config.host,
      port: config.port,
      readyTimeout: 20_000,
      username: config.username,
    };

    if (config.privateKeyPath) {
      connectConfig.privateKey = readFileSync(path.resolve(config.privateKeyPath));
    } else if (config.password) {
      connectConfig.password = config.password;
    } else if (env.SSH_AUTH_SOCK) {
      connectConfig.agent = env.SSH_AUTH_SOCK;
    }

    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect(connectConfig);
  });

const assertConfig = () => {
  if (!config.host || !config.username) throw new Error("Missing PERSONAL_SITE_HOST or PERSONAL_SITE_USER.");
  if (!config.password && !config.privateKeyPath && !env.SSH_AUTH_SOCK) {
    throw new Error("Set PERSONAL_SITE_PASSWORD, PERSONAL_SITE_PRIVATE_KEY, or SSH_AUTH_SOCK before deploying.");
  }
  if (!Number.isInteger(config.keepReleases) || config.keepReleases < 2) {
    throw new Error("PERSONAL_SITE_KEEP_RELEASES must be an integer >= 2.");
  }
};

const buildRemoteScript = (remoteArchivePath) => {
  const keepReleases = String(config.keepReleases);

  return `
set -euo pipefail

ROOT=${shellQuote(config.root)}
RELEASE=${shellQuote(config.releaseId)}
SERVICE=${shellQuote(config.service)}
APP_USER=${shellQuote(config.appUser)}
KEEP_RELEASES=${shellQuote(keepReleases)}
ARCHIVE=${shellQuote(remoteArchivePath)}

RELEASES="$ROOT/releases"
RELEASE_DIR="$RELEASES/$RELEASE"
SHARED="$ROOT/shared"
SHARED_PRIVATE="$SHARED/private"
BACKUP_DIR="$ROOT/backups"
BACKUP_FILE="$BACKUP_DIR/shared-data-before-deploy-$RELEASE.tar.gz"

mkdir -p "$RELEASES" "$SHARED_PRIVATE" "$BACKUP_DIR"

backup_items=()
[ -f "$SHARED/.env" ] && backup_items+=("shared/.env")
[ -e "$SHARED_PRIVATE" ] && backup_items+=("shared/private")
if [ "\${#backup_items[@]}" -gt 0 ]; then
  (cd "$ROOT" && tar -czf "$BACKUP_FILE" "\${backup_items[@]}")
  chmod 600 "$BACKUP_FILE"
fi

CURRENT_TARGET="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
if [ ! -f "$SHARED/.env" ] && [ -n "$CURRENT_TARGET" ] && [ -f "$CURRENT_TARGET/.env" ] && [ ! -L "$CURRENT_TARGET/.env" ]; then
  cp "$CURRENT_TARGET/.env" "$SHARED/.env"
fi

if [ -z "$(find "$SHARED_PRIVATE" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ] \
  && [ -n "$CURRENT_TARGET" ] \
  && [ -d "$CURRENT_TARGET/server/private" ] \
  && [ ! -L "$CURRENT_TARGET/server/private" ]; then
  cp -a "$CURRENT_TARGET/server/private/." "$SHARED_PRIVATE/"
fi

if [ ! -f "$SHARED/.env" ]; then
  echo "Missing $SHARED/.env. Refusing to deploy without runtime env." >&2
  exit 20
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"
rm -f "$ARCHIVE"

rm -rf "$RELEASE_DIR/server/private"
mkdir -p "$RELEASE_DIR/server"
ln -sfn "$SHARED_PRIVATE" "$RELEASE_DIR/server/private"
rm -f "$RELEASE_DIR/.env"
ln -sfn "$SHARED/.env" "$RELEASE_DIR/.env"

cd "$RELEASE_DIR"
npm ci
npm run build

chown -R "$APP_USER:$APP_USER" "$RELEASE_DIR" "$SHARED"
find "$SHARED" -type d -exec chmod 700 {} +
find "$SHARED" -type f -exec chmod 600 {} +

ln -sfn "$RELEASE_DIR" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
systemctl restart "$SERVICE"
sleep 2
systemctl is-active "$SERVICE" >/dev/null

PRIVATE_TARGET="$(readlink -f "$ROOT/current/server/private")"
if [ "$PRIVATE_TARGET" != "$SHARED_PRIVATE" ]; then
  echo "server/private does not point to shared private data: $PRIVATE_TARGET" >&2
  exit 21
fi

curl -fsS http://127.0.0.1:4173/api/site-settings >/dev/null
curl -fsS http://127.0.0.1:4173/api/articles >/dev/null

CURRENT_NAME="$(basename "$(readlink -f "$ROOT/current")")"
mapfile -t RELEASE_NAMES < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
KEEP_NAMES=("$CURRENT_NAME")
for name in "\${RELEASE_NAMES[@]}"; do
  [ "\${#KEEP_NAMES[@]}" -ge "$KEEP_RELEASES" ] && break
  [ "$name" = "$CURRENT_NAME" ] && continue
  KEEP_NAMES+=("$name")
done

for release_path in "$RELEASES"/*; do
  [ -d "$release_path" ] || continue
  name="$(basename "$release_path")"
  keep=false
  for keep_name in "\${KEEP_NAMES[@]}"; do
    if [ "$name" = "$keep_name" ]; then
      keep=true
      break
    fi
  done
  if [ "$keep" = false ]; then
    rm -rf "$release_path"
  fi
done

printf 'release=%s\n' "$RELEASE"
printf 'current=%s\n' "$(readlink -f "$ROOT/current")"
printf 'shared_private=%s\n' "$PRIVATE_TARGET"
printf 'backup=%s\n' "$BACKUP_FILE"
printf 'kept_releases=%s\n' "\${KEEP_NAMES[*]}"
`;
};

const main = async () => {
  assertConfig();

  console.log("Running local build...");
  runLocalNpm(["run", "build"]);

  mkdirSync(stageDir, { recursive: true });
  await Promise.all(includeEntries.map(copyEntry));

  console.log("Creating code-only bundle...");
  execFileSync("tar", ["-czf", bundlePath, "-C", stageDir, "."], { stdio: "inherit" });

  const bundleStats = statSync(bundlePath);
  console.log(`Bundle ready: ${Math.round(bundleStats.size / 1024)} KB`);

  const remoteArchivePath = `/tmp/personal-site-release-${config.releaseId}.tar.gz`;
  const conn = await connect();

  try {
    console.log(`Uploading ${remoteArchivePath}...`);
    await uploadFile(conn, bundlePath, remoteArchivePath);

    console.log("Deploying on VPS...");
    const result = await execRemote(conn, buildRemoteScript(remoteArchivePath));
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } finally {
    conn.end();
    rmSync(tempRoot, { force: true, recursive: true });
  }
};

main().catch((error) => {
  rmSync(tempRoot, { force: true, recursive: true });
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
