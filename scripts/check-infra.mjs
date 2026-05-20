import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { query, usingMemoryDb } from "../src/db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const mediaRoot = process.env.MEDIA_STORAGE_DIR
  ? path.resolve(process.env.MEDIA_STORAGE_DIR)
  : path.resolve(backendRoot, "storage", "media");

async function main() {
  const checks = [];

  checks.push({
    name: "media_dir_exists",
    ok: fs.existsSync(mediaRoot),
    detail: mediaRoot
  });

  try {
    await query("SELECT 1");
    checks.push({
      name: "db_connection",
      ok: true,
      detail: usingMemoryDb() ? "memory" : "postgres"
    });
  } catch (error) {
    checks.push({
      name: "db_connection",
      ok: false,
      detail: error.message
    });
  }

  const failed = checks.filter((item) => !item.ok);
  process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, checks }, null, 2)}\n`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.stderr.write("\n");
  process.exitCode = 1;
});
