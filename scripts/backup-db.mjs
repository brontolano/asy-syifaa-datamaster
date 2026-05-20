import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const backupRoot = path.resolve(backendRoot, "storage", "backup");
const keepDays = Number.parseInt(process.env.DB_BACKUP_KEEP_DAYS || "14", 10);
const dbUrl = process.env.DATABASE_URL || "";

function stamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function pruneOldBackups(dirPath, maxAgeDays) {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return [];
  const deleted = [];
  const threshold = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  for (const name of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, name);
    const stat = fs.statSync(full);
    if (!stat.isFile()) continue;
    if (!name.endsWith(".sql")) continue;
    if (stat.mtimeMs < threshold) {
      fs.unlinkSync(full);
      deleted.push(name);
    }
  }
  return deleted;
}

function runPgDump({ outputPath, databaseUrl }) {
  return new Promise((resolve, reject) => {
    const args = ["--no-owner", "--no-privileges", "-d", databaseUrl, "-f", outputPath];
    const proc = spawn("pg_dump", args, { stdio: ["ignore", "pipe", "pipe"], shell: false });

    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exit code ${code}: ${stderr.trim()}`));
    });
  });
}

async function main() {
  if (!dbUrl) {
    throw new Error("DATABASE_URL belum diatur. Backup DB butuh koneksi PostgreSQL.");
  }

  fs.mkdirSync(backupRoot, { recursive: true });
  const fileName = `asy-syifaa-backup-${stamp()}.sql`;
  const outputPath = path.join(backupRoot, fileName);

  await runPgDump({ outputPath, databaseUrl: dbUrl });
  const deleted = pruneOldBackups(backupRoot, keepDays);

  process.stdout.write(`backup.ok=true\n`);
  process.stdout.write(`backup.file=${outputPath}\n`);
  process.stdout.write(`backup.retention_days=${keepDays}\n`);
  process.stdout.write(`backup.deleted_old=${deleted.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`backup.ok=false\nerror=${error.message}\n`);
  process.exitCode = 1;
});
