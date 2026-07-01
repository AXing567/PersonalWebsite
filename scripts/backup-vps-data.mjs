import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { Client } from "ssh2";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const env = process.env;
const config = {
  host: env.PERSONAL_SITE_HOST || "",
  password: env.PERSONAL_SITE_PASSWORD || "",
  port: Number(env.PERSONAL_SITE_PORT || 22),
  privateKeyPath: env.PERSONAL_SITE_PRIVATE_KEY || "",
  root: env.PERSONAL_SITE_ROOT || "/var/www/personal-site",
  username: env.PERSONAL_SITE_USER || "root",
};

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const assertConfig = () => {
  if (!config.host || !config.username) throw new Error("Missing PERSONAL_SITE_HOST or PERSONAL_SITE_USER.");
  if (!config.password && !config.privateKeyPath && !env.SSH_AUTH_SOCK) {
    throw new Error("Set PERSONAL_SITE_PASSWORD, PERSONAL_SITE_PRIVATE_KEY, or SSH_AUTH_SOCK before backing up VPS data.");
  }
};

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

const downloadFile = (conn, remotePath, localPath) =>
  new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }

      sftp.fastGet(remotePath, localPath, (downloadError) => {
        sftp.end();
        if (downloadError) {
          reject(downloadError);
          return;
        }
        resolve();
      });
    });
  });

const buildBackupScript = (remoteArchivePath) => `
set -euo pipefail

ROOT=${shellQuote(config.root)}
ARCHIVE=${shellQuote(remoteArchivePath)}
SHARED="$ROOT/shared"
SHARED_PRIVATE="$SHARED/private"

items=()
[ -f "$SHARED/.env" ] && items+=("shared/.env")
[ -e "$SHARED_PRIVATE" ] && items+=("shared/private")

if [ "\${#items[@]}" -eq 0 ]; then
  echo "No shared runtime data found under $SHARED" >&2
  exit 30
fi

rm -f "$ARCHIVE"
(cd "$ROOT" && tar -czf "$ARCHIVE" "\${items[@]}")
chmod 600 "$ARCHIVE"
printf 'archive=%s\\n' "$ARCHIVE"
printf 'items=%s\\n' "\${items[*]}"
`;

const main = async () => {
  assertConfig();

  const backupDir = path.join(projectRoot, "artifacts", "private-data-backups", timestamp);
  const localArchivePath = path.join(backupDir, "personal-site-shared.tar.gz");
  const manifestPath = path.join(backupDir, "manifest.json");
  const remoteArchivePath = `/tmp/personal-site-shared-backup-${timestamp}.tar.gz`;

  mkdirSync(backupDir, { recursive: true });

  const conn = await connect();
  try {
    console.log(`Creating VPS data backup on ${config.host}...`);
    const result = await execRemote(conn, buildBackupScript(remoteArchivePath));
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    console.log(`Downloading backup to ${path.relative(projectRoot, localArchivePath)}...`);
    await downloadFile(conn, remoteArchivePath, localArchivePath);
    await execRemote(conn, `rm -f ${shellQuote(remoteArchivePath)}`);

    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          archive: path.relative(projectRoot, localArchivePath).split(path.sep).join("/"),
          createdAt: new Date().toISOString(),
          host: config.host,
          root: config.root,
          source: "vps-shared-runtime-data",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log(`Local VPS data backup ready: ${path.relative(projectRoot, localArchivePath)}`);
  } catch (error) {
    rmSync(backupDir, { force: true, recursive: true });
    throw error;
  } finally {
    conn.end();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
