import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { initDb, query, usingMemoryDb } from "../src/db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const storageRoot = process.env.MEDIA_STORAGE_DIR
  ? path.resolve(process.env.MEDIA_STORAGE_DIR)
  : path.resolve(backendRoot, "storage", "media");
const backupRoot = path.resolve(backendRoot, "storage", "backup");
const logRoot = path.resolve(backendRoot, "storage", "logs");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function main() {
  ensureDir(storageRoot);
  ensureDir(backupRoot);
  ensureDir(logRoot);

  await initDb();
  await query("SELECT 1");

  const dbMode = usingMemoryDb() ? "memory" : "postgres";
  const summary = [
    `infra.prepare.ok=true`,
    `db.mode=${dbMode}`,
    `media.storage=${storageRoot}`,
    `backup.storage=${backupRoot}`,
    `logs.storage=${logRoot}`
  ].join("\n");

  process.stdout.write(`${summary}\n`);
}

main().catch((error) => {
  process.stderr.write(`infra.prepare.ok=false\nerror=${error.message}\n`);
  process.exitCode = 1;
});
