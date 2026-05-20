import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { initDb, query, usingMemoryDb } from "./db.js";
import {
  buildCommandCenterPayload,
  filterWidgetsByAccess,
  getVisibleWidgetsByRole
} from "./services/dashboard-aggregations.js";

dotenv.config();

const app = express();
const corsOriginRaw = String(process.env.CORS_ORIGIN || "*").trim();
const corsAllowAll = corsOriginRaw === "*" || corsOriginRaw === "";
const corsAllowlist = corsAllowAll
  ? []
  : corsOriginRaw.split(",").map((item) => item.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (corsAllowAll) return callback(null, true);
    // Allow non-browser callers (curl, server-to-server) without Origin header.
    if (!origin) return callback(null, true);
    if (corsAllowlist.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin is not allowed"));
  }
}));
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEDIA_ROOT = process.env.MEDIA_STORAGE_DIR || path.resolve(__dirname, "../storage/media");
const MEDIA_MAX_SIZE_MB = Number.parseInt(process.env.MEDIA_MAX_SIZE_MB || "80", 10);

if (!fs.existsSync(MEDIA_ROOT)) {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

app.use("/media", express.static(MEDIA_ROOT, { maxAge: "7d" }));

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"]);
const MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-matroska": ".mkv"
};
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv"]);

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(1, MEDIA_MAX_SIZE_MB) * 1024 * 1024 }
});

// ── RBAC ─────────────────────────────────────────────────────
const ROLE_PERMISSIONS = {
  "superadmin":  ["read", "write", "approve", "manage"],
  "mudir_aam":  ["read", "write", "approve", "manage"],
  "pengasuh":   ["read", "approve"],
  "ustadz":     ["read", "write"],
  "ustadzah":   ["read", "write"],
  "bendahara":  ["read", "write"],
  "admin_keuangan": ["read", "write", "approve"],
  "kepala_sekolah": ["read", "write", "approve"],
  "staff_umum": ["read", "write"],
  "admin_kesantrian": ["read", "write", "approve"],
  "wali":       ["read"],
  "santri":     ["read"],
  "umum":       ["read"]
};

// ── Constants ─────────────────────────────────────────────────
const ATTENDANCE_STATUS   = new Set(["hadir","izin","sakit","alpa"]);
const BILLING_STATUS      = new Set(["unpaid","partial","paid"]);
const TAHFIDZ_TYPE        = new Set(["ziyadah","murojaah"]);
const TAHFIDZ_QUALITY     = new Set(["mumtaz","jayyid_jiddan","jayyid","maqbul","dhoif"]);
const PERMIT_TYPE         = new Set(["pulang","pesiar","sakit","keperluan"]);
const PERMIT_STATUS       = new Set(["pending","approved","rejected","returned"]);
const STAFF_ROLE          = new Set(["ustadz","ustadzah","admin","bendahara","kepala_sekolah","staff_umum"]);
const STAFF_ATTENDANCE_STATUS = new Set(["hadir","izin","sakit","alpa"]);
const PPDB_STATUS         = new Set(["pending","verified","rejected"]);
const PPDB_SETTING_MAX_ITEMS = 12;
const VIOLATION_SEVERITY  = new Set(["ringan","sedang","berat"]);
const MONTH_FORMAT        = /^\d{4}-\d{2}$/;
const DATE_FORMAT         = /^\d{4}-\d{2}-\d{2}$/;
const CONTENT_STATUS      = new Set(["aktif", "draft", "arsip"]);

const ERP_PUBLIC_ANNOUNCEMENTS = [];
const ERP_PUBLIC_GALLERY = [];
const ERP_PUBLIC_EVENTS = [];

const ROLE_SESSION_TTL_SECONDS = {
  superadmin: 8 * 60 * 60,
  mudir_aam: 8 * 60 * 60,
  pengasuh: 8 * 60 * 60,
  admin_keuangan: 12 * 60 * 60,
  bendahara: 12 * 60 * 60,
  kepala_sekolah: 12 * 60 * 60,
  admin_kesantrian: 12 * 60 * 60,
  staff_umum: 12 * 60 * 60,
  ustadz: 12 * 60 * 60,
  ustadzah: 12 * 60 * 60,
  wali: 24 * 60 * 60,
  umum: 12 * 60 * 60
};

// ── Observability ─────────────────────────────────────────────
const observability = {
  startedAt: Date.now(),
  requestCount: 0,
  errorCount: 0,
  routeStats: new Map()
};
const auditTrail = [];
let auditSeq = 1;

// ── Helpers ───────────────────────────────────────────────────
function asInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function asAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}
function safeSlug(value) {
  return trimText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "file";
}
function getPublicBaseUrl(req) {
  if (trimText(process.env.MEDIA_PUBLIC_BASE_URL)) return trimText(process.env.MEDIA_PUBLIC_BASE_URL).replace(/\/+$/, "");
  const proto = trimText(req.headers["x-forwarded-proto"]) || req.protocol || "http";
  const host = trimText(req.headers["x-forwarded-host"]) || trimText(req.headers.host) || "localhost:3100";
  return `${proto}://${host}`;
}
function saveMediaFile({ buffer, folder, filename, mimeType }) {
  const cleanFolder = safeSlug(folder || "general");
  const targetDir = path.join(MEDIA_ROOT, cleanFolder);
  fs.mkdirSync(targetDir, { recursive: true });

  const ext = path.extname(filename || "");
  const inferredExt = MIME_EXT[mimeType] || "";
  const finalExt = ext || inferredExt || "";
  const stem = safeSlug(path.basename(filename || `media-${Date.now()}`, ext));
  const finalName = `${Date.now()}-${Math.floor(Math.random() * 1e6)}-${stem}${finalExt}`;
  const fullPath = path.join(targetDir, finalName);

  fs.writeFileSync(fullPath, buffer);
  return { folder: cleanFolder, fileName: finalName };
}
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
function nowIso() {
  return new Date().toISOString();
}
function inferRoleFromIdentity(identity = "") {
  const text = trimText(identity).toLowerCase();
  if (!text) return "umum";
  if (text.includes("super")) return "superadmin";
  if (text.includes("pengasuh") || text.includes("mudir") || text.includes("pimpinan")) return "pengasuh";
  if (text.includes("keuangan") || text.includes("bendahara")) return "admin_keuangan";
  if (text.includes("kesantrian") || text.includes("asrama")) return "admin_kesantrian";
  if (text.includes("kepsek") || text.includes("kepala")) return "kepala_sekolah";
  if (text.includes("ustadzah")) return "ustadzah";
  if (text.includes("ustadz")) return "ustadz";
  if (text.includes("staff")) return "staff_umum";
  if (text.includes("wali")) return "wali";
  return "umum";
}
function pushAuditLog(entry = {}) {
  const item = {
    id: auditSeq++,
    at: nowIso(),
    event: entry.event || "action",
    actor: entry.actor || "system",
    method: entry.method || null,
    route: entry.route || null,
    detail: entry.detail || ""
  };
  auditTrail.unshift(item);
  if (auditTrail.length > 200) {
    auditTrail.pop();
  }
}
function normalizeGuardianPhone(value) {
  const raw = trimText(value).replace(/[^\d+]/g, "");
  const canonical = raw.startsWith("+62") ? `62${raw.slice(3)}` : raw;
  const normalized = canonical.startsWith("0") ? `62${canonical.slice(1)}` : canonical;
  return normalized;
}
function isValidGuardianPhone(value) {
  return /^628[1-9][0-9]{7,12}$/.test(value);
}
function buildPpdbEticketNo(row = {}) {
  const created = row.created_at ? new Date(row.created_at) : new Date();
  const safeDate = Number.isNaN(created.getTime()) ? new Date() : created;
  const datePart = safeDate.toISOString().slice(0, 10).replace(/-/g, "");
  const idPart = String(row.id || 0).padStart(6, "0");
  return `ETK-${datePart}-${idPart}`;
}
function withPpdbDerivedFields(row = {}) {
  return {
    ...row,
    eticket_no: buildPpdbEticketNo(row)
  };
}
const DEFAULT_PPDB_SETTINGS = {
  registration_open: true,
  year_label: "PPDB / SPMB 2026",
  period_start: "2026-05-01",
  period_end: "2026-06-30",
  quota_total: 200,
  quota_remaining: 144,
  schedule_waves: [
    { gelombang: "Gelombang I", tanggal: "15 Juni 2026", kuota: 80, sisa: 24, status: "Buka" },
    { gelombang: "Gelombang II", tanggal: "29 Juni 2026", kuota: 80, sisa: 80, status: "Buka" },
    { gelombang: "Gelombang III", tanggal: "13 Juli 2026", kuota: 40, sisa: 40, status: "Buka" }
  ],
  timeline: [
    { fase: "Isi Formulir Online", tanggal: "1 Mei - 30 Juni 2026" },
    { fase: "Generate E-Ticket", tanggal: "Instan setelah submit" },
    { fase: "Verifikasi Berkas", tanggal: "1 - 7 Juli 2026" },
    { fase: "Tes Tulis & Wawancara", tanggal: "15 - 17 Juli 2026" },
    { fase: "Pengumuman Hasil", tanggal: "20 Juli 2026" }
  ],
  biaya_items: [
    { item: "Formulir Pendaftaran", nominal: 50000, keterangan: "Tidak dapat dikembalikan" },
    { item: "Uang Pangkal", nominal: 3500000, keterangan: "Dibayar setelah diterima" },
    { item: "Seragam Lengkap", nominal: 1200000, keterangan: "3 pasang seragam + perlengkapan" },
    { item: "SPP Bulan Pertama", nominal: 750000, keterangan: "Dibayar di awal masuk" }
  ],
  contacts: [
    { label: "WhatsApp", val: "0812-xxxx-xxxx" },
    { label: "Email", val: "ppdb@asy-syifaa.sch.id" },
    { label: "Layanan", val: "Senin - Sabtu, 08.00 - 15.00 WIB" }
  ]
};

function trimDeep(value) {
  if (typeof value === "string") return trimText(value);
  if (Array.isArray(value)) return value.map(trimDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = trimDeep(v);
    return out;
  }
  return value;
}

function normalizePpdbSettings(payload = {}) {
  const raw = trimDeep(payload);
  const merged = { ...DEFAULT_PPDB_SETTINGS, ...(raw || {}) };
  const toBoolean = (value, fallback = true) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    const text = trimText(value).toLowerCase();
    if (text === "true" || text === "1" || text === "yes" || text === "on") return true;
    if (text === "false" || text === "0" || text === "no" || text === "off") return false;
    return fallback;
  };
  const listOrDefault = (list, fallback) => Array.isArray(list) && list.length ? list.slice(0, PPDB_SETTING_MAX_ITEMS) : fallback;
  return {
    registration_open: toBoolean(merged.registration_open, DEFAULT_PPDB_SETTINGS.registration_open),
    year_label: trimText(merged.year_label) || DEFAULT_PPDB_SETTINGS.year_label,
    period_start: trimText(merged.period_start) || DEFAULT_PPDB_SETTINGS.period_start,
    period_end: trimText(merged.period_end) || DEFAULT_PPDB_SETTINGS.period_end,
    quota_total: Math.max(0, Number.parseInt(merged.quota_total, 10) || 0),
    quota_remaining: Math.max(0, Number.parseInt(merged.quota_remaining, 10) || 0),
    schedule_waves: listOrDefault(merged.schedule_waves, DEFAULT_PPDB_SETTINGS.schedule_waves).map((row, idx) => ({
      gelombang: trimText(row?.gelombang) || `Gelombang ${idx + 1}`,
      tanggal: trimText(row?.tanggal) || "-",
      kuota: Math.max(0, Number.parseInt(row?.kuota, 10) || 0),
      sisa: Math.max(0, Number.parseInt(row?.sisa, 10) || 0),
      status: trimText(row?.status) || "Buka"
    })),
    timeline: listOrDefault(merged.timeline, DEFAULT_PPDB_SETTINGS.timeline).map((row) => ({
      fase: trimText(row?.fase) || "-",
      tanggal: trimText(row?.tanggal) || "-"
    })),
    biaya_items: listOrDefault(merged.biaya_items, DEFAULT_PPDB_SETTINGS.biaya_items).map((row) => ({
      item: trimText(row?.item) || "-",
      nominal: Math.max(0, Number.parseInt(row?.nominal, 10) || 0),
      keterangan: trimText(row?.keterangan) || "-"
    })),
    contacts: listOrDefault(merged.contacts, DEFAULT_PPDB_SETTINGS.contacts).map((row) => ({
      label: trimText(row?.label) || "-",
      val: trimText(row?.val) || "-"
    }))
  };
}

async function readLatestPpdbSettings() {
  const rows = await query("SELECT * FROM ppdb_settings ORDER BY id DESC");
  const latest = rows.rows?.[0];
  if (!latest) {
    return { settings: normalizePpdbSettings(DEFAULT_PPDB_SETTINGS), updated_at: null, updated_by: null };
  }
  return {
    settings: normalizePpdbSettings(latest.payload || {}),
    updated_at: latest.updated_at || latest.created_at || null,
    updated_by: latest.updated_by || null
  };
}
function isPpdbWaNotifyEnabled() {
  return trimText(process.env.PPDB_WA_NOTIFY_ENABLED).toLowerCase() === "true";
}
function getPpdbWaNotifyProvider() {
  const provider = trimText(process.env.PPDB_WA_NOTIFY_PROVIDER).toLowerCase();
  if (!provider) return "generic";
  if (provider === "fonnte" || provider === "wablas" || provider === "waha" || provider === "generic") return provider;
  return "generic";
}
function getPpdbWaNotifyEndpoint() {
  return trimText(process.env.PPDB_WA_NOTIFY_ENDPOINT);
}
function resolvePpdbWaNotifyEndpoint(provider) {
  const explicitEndpoint = getPpdbWaNotifyEndpoint();
  if (explicitEndpoint) return explicitEndpoint;
  if (provider === "fonnte") return "https://api.fonnte.com/send";
  if (provider === "waha") return "https://waha.devlike.pro/api/sendText";
  return "";
}
function buildWahaChatId(phone) {
  const normalized = normalizeGuardianPhone(phone);
  if (!normalized) return "";
  return normalized.includes("@") ? normalized : `${normalized}@c.us`;
}
function buildPpdbWaRequest({ provider, endpoint, token, payload }) {
  if (provider === "fonnte") {
    const body = new URLSearchParams({
      target: payload.to,
      message: payload.message
    }).toString();
    return {
      url: endpoint,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(token ? { Authorization: token } : {})
        },
        body
      }
    };
  }

  if (provider === "wablas") {
    return {
      url: endpoint,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: token } : {})
        },
        body: JSON.stringify({
          phone: payload.to,
          message: payload.message
        })
      }
    };
  }

  if (provider === "waha") {
    const session = trimText(process.env.PPDB_WA_SESSION || "default") || "default";
    const chatId = buildWahaChatId(payload.to);
    return {
      url: endpoint,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Api-Key": token } : {})
        },
        body: JSON.stringify({
          session,
          chatId,
          text: payload.message
        })
      }
    };
  }

  return {
    url: endpoint,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    }
  };
}
function buildPpdbWaMessage(registration) {
  const baseUrl = trimText(process.env.PPDB_PUBLIC_WEBSITE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const ticket = registration?.eticket_no || buildPpdbEticketNo(registration);
  const link = `${baseUrl}/hasil-seleksi.html?ticket=${encodeURIComponent(ticket)}`;
  const studentName = trimText(registration?.student_name) || "Calon Santri";
  return [
    "Assalamu'alaikum warahmatullahi wabarakatuh.",
    "",
    `Pendaftaran PPDB untuk ${studentName} telah diterima.`,
    `E-Ticket: ${ticket}`,
    "Status awal: Menunggu Verifikasi",
    `Cek hasil seleksi: ${link}`,
    "",
    "Panitia PPDB Asy-Syifaa Wal Mahmuudiyyah"
  ].join("\n");
}
async function sendPpdbWaNotification(registration) {
  const provider = getPpdbWaNotifyProvider();
  const endpoint = resolvePpdbWaNotifyEndpoint(provider);
  const timeoutMs = Number.parseInt(trimText(process.env.PPDB_WA_NOTIFY_TIMEOUT_MS || "6000"), 10);
  const token = trimText(process.env.PPDB_WA_NOTIFY_TOKEN);
  const payload = {
    to: registration?.guardian_phone || "",
    message: buildPpdbWaMessage(registration),
    eticket_no: registration?.eticket_no || buildPpdbEticketNo(registration),
    student_name: registration?.student_name || "",
    source: "ppdb_register"
  };
  const request = buildPpdbWaRequest({ provider, endpoint, token, payload });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 6000);
  try {
    const response = await fetch(request.url, { ...request.init, signal: controller.signal });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(`wa_gateway_http_${response.status}${raw ? `:${raw.slice(0, 120)}` : ""}`);
    }
    pushAuditLog({
      event: "ppdb_wa_notify_success",
      actor: "system",
      method: "POST",
      route: "/api/ppdb/register",
      detail: `ticket=${payload.eticket_no};provider=${provider}`
    });
    return { ok: true, provider };
  } finally {
    clearTimeout(timeout);
  }
}
function triggerPpdbWaNotification(registration) {
  const enabled = isPpdbWaNotifyEnabled();
  const provider = getPpdbWaNotifyProvider();
  const endpoint = resolvePpdbWaNotifyEndpoint(provider);
  const token = trimText(process.env.PPDB_WA_NOTIFY_TOKEN);
  if (!enabled) {
    return { queued: false, reason: "disabled" };
  }
  if (!endpoint) {
    return { queued: false, reason: "missing_endpoint" };
  }
  if ((provider === "fonnte" || provider === "wablas") && !token) {
    return { queued: false, reason: "missing_token" };
  }

  void sendPpdbWaNotification(registration).catch((error) => {
    console.error("PPDB WA notify failed:", error.message);
    pushAuditLog({
      event: "ppdb_wa_notify_failed",
      actor: "system",
      method: "POST",
      route: "/api/ppdb/register",
      detail: String(error.message || "unknown_error").slice(0, 180)
    });
  });

  return {
    queued: true,
    reason: "scheduled",
    provider
  };
}
function resolveRole(req) {
  const authHeader  = trimText(req.headers.authorization);
  const roleHeader  = trimText(req.headers["x-role"]).toLowerCase();
  if (roleHeader) return roleHeader;
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "ustadz";
  const token = authHeader.slice(7).trim();
  const tokenLower = token.toLowerCase();

  // New token format: asf.<role>.<expUnix>.<nonce>
  if (tokenLower.startsWith("asf.")) {
    const parts = tokenLower.split(".");
    if (parts.length >= 4) {
      const role = trimText(parts[1]).toLowerCase();
      const exp = Number.parseInt(parts[2], 10);
      if (ROLE_PERMISSIONS[role] && Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000)) {
        return role;
      }
      return "umum";
    }
  }
  return "umum";
}
function requirePermission(permission) {
  return (req, res, next) => {
    const role = resolveRole(req);
    const permissions = ROLE_PERMISSIONS[role] || [];
    if (!permissions.includes(permission)) {
      return res.status(403).json({ ok: false, message: "Akses ditolak untuk role ini", required_permission: permission, role });
    }
    req.auth = { role, permissions };
    next();
  };
}
function hijriFromDate(date) {
  const formatter = new Intl.DateTimeFormat("en-TN-u-ca-islamic", { day: "2-digit", month: "2-digit", year: "numeric" });
  const parts = formatter.formatToParts(date);
  const day   = parts.find((p) => p.type === "day")?.value   || "";
  const month = parts.find((p) => p.type === "month")?.value || "";
  const year  = parts.find((p) => p.type === "year")?.value  || "";
  return { year, month, day, iso_like: `${year}-${month}-${day}` };
}
async function checkStudentExists(studentId) {
  const rows = await query("SELECT * FROM students ORDER BY id DESC");
  return rows.rows.some((row) => Number(row.id) === Number(studentId));
}

// ── Observability middleware ───────────────────────────────────
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  observability.requestCount += 1;
  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const key = `${req.method} ${req.route?.path || req.path}`;
    const existing = observability.routeStats.get(key) || { count: 0, totalMs: 0, maxMs: 0, lastStatus: 0 };
    existing.count   += 1;
    existing.totalMs += elapsedMs;
    existing.maxMs    = Math.max(existing.maxMs, elapsedMs);
    existing.lastStatus = res.statusCode;
    observability.routeStats.set(key, existing);
    if (res.statusCode >= 500) observability.errorCount += 1;

    if (res.statusCode < 400 && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const actorByHeader = trimText(req.headers["x-role"]).toLowerCase();
      const bodyRole = trimText(req.body?.role).toLowerCase();
      const actor = actorByHeader || bodyRole || inferRoleFromIdentity(req.body?.username || req.body?.name || "");
      pushAuditLog({
        event: req.path === "/api/auth/login" ? "login" : "mutation",
        actor: actor || "system",
        method: req.method,
        route: req.path,
        detail: req.path === "/api/auth/login" ? "Login berhasil" : "Data diperbarui"
      });
    }
  });
  next();
});

// ════════════════════════════════════════════════════════════
// SYSTEM ENDPOINTS
// ════════════════════════════════════════════════════════════

app.get("/api/health", asyncHandler(async (_req, res) => {
  await query("SELECT 1");
  return res.json({ ok: true, service: "backend", db: usingMemoryDb() ? "memory" : "postgres", timestamp: nowIso(), uptime_seconds: Math.floor(process.uptime()) });
}));

app.get("/api/ready", asyncHandler(async (_req, res) => {
  await query("SELECT 1");
  return res.json({ ok: true, ready: true, timestamp: nowIso() });
}));

app.get("/api/metrics", (_req, res) => {
  const routes = [];
  for (const [route, stats] of observability.routeStats.entries()) {
    routes.push({ route, count: stats.count, avg_ms: Number((stats.totalMs / stats.count).toFixed(2)), max_ms: Number(stats.maxMs.toFixed(2)), last_status: stats.lastStatus });
  }
  return res.json({ ok: true, service: "backend", started_at: new Date(observability.startedAt).toISOString(), uptime_seconds: Math.floor(process.uptime()), request_count: observability.requestCount, error_count: observability.errorCount, error_rate: observability.requestCount ? Number((observability.errorCount / observability.requestCount).toFixed(4)) : 0, routes });
});

app.post("/api/auth/login", (req, res) => {
  const { role = "", name = "Operator", username = "", password = "" } = req.body || {};
  if (!trimText(username) || !trimText(password)) {
    return res.status(400).json({ ok: false, message: "username dan password wajib diisi" });
  }
  const cleanUsername = trimText(username).toLowerCase();
  const cleanPassword = trimText(password);
  const requestedRole = trimText(role).toLowerCase();
  const inferredRole = inferRoleFromIdentity(username || name);
  const cleanRole = requestedRole || inferredRole;
  if (!ROLE_PERMISSIONS[cleanRole]) {
    return res.status(400).json({ ok: false, message: "Role tidak dikenali" });
  }

  // Hard lock untuk akun superadmin sementara.
  if (cleanRole === "superadmin") {
    if (cleanUsername !== "superadmin" || cleanPassword !== "bismillah") {
      return res.status(401).json({ ok: false, message: "Kredensial superadmin tidak valid" });
    }
  }
  const sessionTtlSeconds = ROLE_SESSION_TTL_SECONDS[cleanRole] || ROLE_SESSION_TTL_SECONDS.umum;
  const expUnix = Math.floor(Date.now() / 1000) + sessionTtlSeconds;
  const nonce = Math.random().toString(36).slice(2, 10);
  const token = `asf.${cleanRole}.${expUnix}.${nonce}`;
  return res.json({
    ok: true,
    token,
    session_ttl_seconds: sessionTtlSeconds,
    user: {
      name: trimText(name) || "Operator",
      role: cleanRole,
      permissions: ROLE_PERMISSIONS[cleanRole]
    }
  });
});

app.get("/api/auth/session-policy", (_req, res) => {
  const policy = Object.entries(ROLE_SESSION_TTL_SECONDS).map(([role, ttlSeconds]) => ({
    role,
    session_ttl_seconds: ttlSeconds,
    session_ttl_hours: Number((ttlSeconds / 3600).toFixed(2))
  }));
  return res.json({
    ok: true,
    policy,
    updated_at: nowIso()
  });
});

app.get("/api/system/roles", (_req, res) => {
  return res.json({ ok: true, roles: ROLE_PERMISSIONS });
});

app.get("/api/system/calendar/convert", (req, res) => {
  const dateParam = trimText(req.query.date) || nowIso().slice(0, 10);
  if (!DATE_FORMAT.test(dateParam)) return res.status(400).json({ ok: false, message: "format date harus YYYY-MM-DD" });
  const baseDate = new Date(`${dateParam}T00:00:00.000Z`);
  if (Number.isNaN(baseDate.getTime())) return res.status(400).json({ ok: false, message: "Tanggal tidak valid" });
  return res.json({ ok: true, gregorian: dateParam, hijri: hijriFromDate(baseDate) });
});

app.post("/api/media/upload", requirePermission("write"), mediaUpload.single("file"), (req, res) => {
  const file = req.file;
  const mediaType = trimText(req.body?.type || req.query?.type).toLowerCase() || "image";
  const folder = trimText(req.body?.folder || req.query?.folder) || mediaType;
  const actor = req.auth?.role || "system";

  if (!file) {
    return res.status(400).json({ ok: false, message: "File wajib diisi pada field 'file'" });
  }

  const mime = trimText(file.mimetype).toLowerCase();
  const allowed = mediaType === "video" ? ALLOWED_VIDEO_MIME : ALLOWED_IMAGE_MIME;
  const ext = path.extname(file.originalname || "").toLowerCase();
  const extAllowed = mediaType === "video" ? VIDEO_EXT.has(ext) : IMAGE_EXT.has(ext);
  const mimeAllowed = allowed.has(mime);
  if (!mimeAllowed && !(mime === "application/octet-stream" && extAllowed)) {
    return res.status(400).json({
      ok: false,
      message: `Tipe file tidak didukung untuk ${mediaType}`,
      mime_type: mime,
      extension: ext || null
    });
  }

  const saved = saveMediaFile({
    buffer: file.buffer,
    folder,
    filename: file.originalname || "upload",
    mimeType: mime
  });
  const relativePath = `/media/${saved.folder}/${saved.fileName}`;
  const url = `${getPublicBaseUrl(req)}${relativePath}`;

  pushAuditLog({
    event: "media_upload",
    actor,
    method: req.method,
    route: req.path,
    detail: `${mediaType}:${relativePath}`
  });

  return res.json({
    ok: true,
    data: {
      type: mediaType,
      mime_type: mime,
      original_name: file.originalname,
      size_bytes: file.size,
      relative_path: relativePath,
      url
    }
  });
});

// ════════════════════════════════════════════════════════════
// PUBLIC READ ENDPOINTS (Website Integration)
// ════════════════════════════════════════════════════════════

app.get("/api/public/ppdb/results", asyncHandler(async (req, res) => {
  const cleanStatus = trimText(req.query.status).toLowerCase();
  const cleanQuery = trimText(req.query.q).toLowerCase();
  if (cleanStatus && !PPDB_STATUS.has(cleanStatus)) {
    return res.status(400).json({ ok: false, message: "status PPDB tidak valid" });
  }
  const rows = await query("SELECT * FROM ppdb_registrations ORDER BY id DESC");
  let data = cleanStatus ? rows.rows.filter((row) => String(row.status).toLowerCase() === cleanStatus) : rows.rows;
  if (cleanQuery) {
    data = data.filter((row) => {
      const ticket = buildPpdbEticketNo(row).toLowerCase();
      const name = String(row.student_name || "").toLowerCase();
      const school = String(row.origin_school || "").toLowerCase();
      const guardian = String(row.guardian_name || "").toLowerCase();
      const phone = String(row.guardian_phone || "").toLowerCase();
      return ticket.includes(cleanQuery) || name.includes(cleanQuery) || school.includes(cleanQuery) || guardian.includes(cleanQuery) || phone.includes(cleanQuery);
    });
  }
  return res.json({ ok: true, data: data.map(withPpdbDerivedFields) });
}));

app.get("/api/public/students", asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM students ORDER BY id DESC");
  const cleanStatus = trimText(req.query.status).toLowerCase();
  const cleanGender = trimText(req.query.gender).toUpperCase();
  const allowedStatus = new Set(["aktif", "alumni", "keluar"]);
  const allowedGender = new Set(["L", "P"]);
  if (cleanStatus && !allowedStatus.has(cleanStatus)) return res.status(400).json({ ok: false, message: "status tidak valid" });
  if (cleanGender && !allowedGender.has(cleanGender)) return res.status(400).json({ ok: false, message: "gender tidak valid" });

  let data = rows.rows.filter((row) => {
    if (cleanStatus && String(row.status).toLowerCase() !== cleanStatus) return false;
    if (cleanGender && String(row.gender || "").toUpperCase() !== cleanGender) return false;
    return true;
  });
  let fallbackApplied = false;
  if (cleanGender && data.length === 0) {
    // Fallback awal integrasi: jika gender belum terisi di master, tetap kirim data aktif dulu.
    data = rows.rows.filter((row) => (cleanStatus ? String(row.status).toLowerCase() === cleanStatus : true));
    fallbackApplied = true;
  }
  return res.json({ ok: true, fallback_applied: fallbackApplied, data });
}));

app.get("/api/public/staff", asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM staff ORDER BY id DESC");
  const cleanRole = trimText(req.query.role).toLowerCase();
  const cleanStatus = trimText(req.query.status).toLowerCase();
  const data = rows.rows.filter((row) => {
    if (cleanRole && String(row.role || "").toLowerCase() !== cleanRole) return false;
    if (cleanStatus && String(row.status || "").toLowerCase() !== cleanStatus) return false;
    return true;
  });
  return res.json({ ok: true, data });
}));

app.get("/api/public/guardians", asyncHandler(async (_req, res) => {
  const [studentsRes, ppdbRes] = await Promise.all([
    query("SELECT * FROM students ORDER BY id DESC"),
    query("SELECT * FROM ppdb_registrations ORDER BY id DESC")
  ]);

  const map = new Map();
  for (const row of studentsRes.rows) {
    const name = trimText(row.guardian_name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        guardian_name: name,
        guardian_phone: null,
        source: "students",
        linked_students: 0
      });
    }
    map.get(key).linked_students += 1;
  }
  for (const row of ppdbRes.rows) {
    const name = trimText(row.guardian_name);
    if (!name) continue;
    const key = name.toLowerCase();
    const phone = trimText(row.guardian_phone) || null;
    if (!map.has(key)) {
      map.set(key, {
        guardian_name: name,
        guardian_phone: phone,
        source: "ppdb",
        linked_students: 0
      });
    } else if (!map.get(key).guardian_phone && phone) {
      map.get(key).guardian_phone = phone;
    }
  }

  return res.json({ ok: true, data: [...map.values()] });
}));

app.get("/api/public/content/announcements", asyncHandler(async (req, res) => {
  const cleanStatus = trimText(req.query.status).toLowerCase();
  const cleanCategory = trimText(req.query.category);
  if (cleanStatus && !CONTENT_STATUS.has(cleanStatus)) {
    return res.status(400).json({ ok: false, message: "status konten tidak valid" });
  }
  const data = ERP_PUBLIC_ANNOUNCEMENTS
    .filter((item) => (cleanStatus ? item.status === cleanStatus : true))
    .filter((item) => (cleanCategory ? String(item.category).toLowerCase() === cleanCategory.toLowerCase() : true))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return res.json({ ok: true, data });
}));

app.get("/api/public/content/gallery", asyncHandler(async (req, res) => {
  const cleanCategory = trimText(req.query.category);
  const data = ERP_PUBLIC_GALLERY
    .filter((item) => (cleanCategory ? String(item.category).toLowerCase() === cleanCategory.toLowerCase() : true))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return res.json({ ok: true, data });
}));

app.get("/api/public/content/events", asyncHandler(async (req, res) => {
  const cleanStatus = trimText(req.query.status);
  const cleanType = trimText(req.query.type);
  const data = ERP_PUBLIC_EVENTS
    .filter((item) => (cleanStatus ? String(item.status).toLowerCase() === cleanStatus.toLowerCase() : true))
    .filter((item) => (cleanType ? String(item.type).toLowerCase() === cleanType.toLowerCase() : true))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return res.json({ ok: true, data });
}));

app.post("/api/cms/content/announcements", requirePermission("manage"), asyncHandler(async (req, res) => {
  const title = trimText(req.body?.title);
  const date = trimText(req.body?.date);
  const category = trimText(req.body?.category) || "general";
  const status = trimText(req.body?.status).toLowerCase() || "draft";
  const author = trimText(req.body?.author) || "Admin";
  const content = trimText(req.body?.content);
  const excerpt = trimText(req.body?.excerpt);
  const cover_url = trimText(req.body?.cover_url);
  const content_html = trimText(req.body?.content_html);
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map((tag) => trimText(String(tag)).toLowerCase()).filter(Boolean)
    : [];
  if (!title || !date || !content) return res.status(400).json({ ok: false, message: "title, date, content wajib diisi" });
  if (!DATE_FORMAT.test(date)) return res.status(400).json({ ok: false, message: "format date harus YYYY-MM-DD" });
  if (!CONTENT_STATUS.has(status)) return res.status(400).json({ ok: false, message: "status konten tidak valid" });
  const id = ERP_PUBLIC_ANNOUNCEMENTS.length ? Math.max(...ERP_PUBLIC_ANNOUNCEMENTS.map((row) => Number(row.id) || 0)) + 1 : 1;
  const row = { id, title, date, category, status, author, tags, excerpt, cover_url, content, content_html };
  ERP_PUBLIC_ANNOUNCEMENTS.push(row);
  return res.status(201).json({ ok: true, data: row });
}));

app.put("/api/cms/content/announcements/:id", requirePermission("manage"), asyncHandler(async (req, res) => {
  const id = asInt(req.params.id);
  const idx = ERP_PUBLIC_ANNOUNCEMENTS.findIndex((row) => Number(row.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "Pengumuman tidak ditemukan" });
  const next = { ...ERP_PUBLIC_ANNOUNCEMENTS[idx] };
  if (req.body?.title !== undefined) next.title = trimText(req.body.title);
  if (req.body?.date !== undefined) next.date = trimText(req.body.date);
  if (req.body?.category !== undefined) next.category = trimText(req.body.category);
  if (req.body?.status !== undefined) next.status = trimText(req.body.status).toLowerCase();
  if (req.body?.author !== undefined) next.author = trimText(req.body.author);
  if (req.body?.content !== undefined) next.content = trimText(req.body.content);
  if (req.body?.excerpt !== undefined) next.excerpt = trimText(req.body.excerpt);
  if (req.body?.cover_url !== undefined) next.cover_url = trimText(req.body.cover_url);
  if (req.body?.content_html !== undefined) next.content_html = trimText(req.body.content_html);
  if (req.body?.tags !== undefined) {
    next.tags = Array.isArray(req.body.tags)
      ? req.body.tags.map((tag) => trimText(String(tag)).toLowerCase()).filter(Boolean)
      : [];
  }
  if (!next.title || !next.date || !next.content) return res.status(400).json({ ok: false, message: "title, date, content wajib diisi" });
  if (!DATE_FORMAT.test(next.date)) return res.status(400).json({ ok: false, message: "format date harus YYYY-MM-DD" });
  if (!CONTENT_STATUS.has(next.status)) return res.status(400).json({ ok: false, message: "status konten tidak valid" });
  ERP_PUBLIC_ANNOUNCEMENTS[idx] = next;
  return res.json({ ok: true, data: next });
}));

app.delete("/api/cms/content/announcements/:id", requirePermission("manage"), asyncHandler(async (req, res) => {
  const id = asInt(req.params.id);
  const idx = ERP_PUBLIC_ANNOUNCEMENTS.findIndex((row) => Number(row.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "Pengumuman tidak ditemukan" });
  const removed = ERP_PUBLIC_ANNOUNCEMENTS.splice(idx, 1)[0];
  return res.json({ ok: true, data: removed });
}));

app.post("/api/cms/content/events", requirePermission("manage"), asyncHandler(async (req, res) => {
  const title = trimText(req.body?.title);
  const date = trimText(req.body?.date);
  const endDate = trimText(req.body?.endDate) || date;
  const type = trimText(req.body?.type) || "Kegiatan";
  const status = trimText(req.body?.status) || "Mendatang";
  const desc = trimText(req.body?.desc) || "";
  const wajib = Boolean(req.body?.wajib);
  if (!title || !date) return res.status(400).json({ ok: false, message: "title dan date wajib diisi" });
  if (!DATE_FORMAT.test(date) || !DATE_FORMAT.test(endDate)) return res.status(400).json({ ok: false, message: "format date/endDate harus YYYY-MM-DD" });
  const id = ERP_PUBLIC_EVENTS.length ? Math.max(...ERP_PUBLIC_EVENTS.map((row) => Number(row.id) || 0)) + 1 : 1;
  const row = { id, title, date, endDate, type, status, desc, wajib };
  ERP_PUBLIC_EVENTS.push(row);
  return res.status(201).json({ ok: true, data: row });
}));

app.put("/api/cms/content/events/:id", requirePermission("manage"), asyncHandler(async (req, res) => {
  const id = asInt(req.params.id);
  const idx = ERP_PUBLIC_EVENTS.findIndex((row) => Number(row.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "Agenda tidak ditemukan" });
  const next = { ...ERP_PUBLIC_EVENTS[idx] };
  if (req.body?.title !== undefined) next.title = trimText(req.body.title);
  if (req.body?.date !== undefined) next.date = trimText(req.body.date);
  if (req.body?.endDate !== undefined) next.endDate = trimText(req.body.endDate);
  if (req.body?.type !== undefined) next.type = trimText(req.body.type);
  if (req.body?.status !== undefined) next.status = trimText(req.body.status);
  if (req.body?.desc !== undefined) next.desc = trimText(req.body.desc);
  if (req.body?.wajib !== undefined) next.wajib = Boolean(req.body.wajib);
  if (!next.title || !next.date) return res.status(400).json({ ok: false, message: "title dan date wajib diisi" });
  if (!DATE_FORMAT.test(next.date) || !DATE_FORMAT.test(next.endDate || next.date)) return res.status(400).json({ ok: false, message: "format date/endDate harus YYYY-MM-DD" });
  ERP_PUBLIC_EVENTS[idx] = next;
  return res.json({ ok: true, data: next });
}));

app.delete("/api/cms/content/events/:id", requirePermission("manage"), asyncHandler(async (req, res) => {
  const id = asInt(req.params.id);
  const idx = ERP_PUBLIC_EVENTS.findIndex((row) => Number(row.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "Agenda tidak ditemukan" });
  const removed = ERP_PUBLIC_EVENTS.splice(idx, 1)[0];
  return res.json({ ok: true, data: removed });
}));

app.post("/api/cms/content/gallery", requirePermission("manage"), asyncHandler(async (req, res) => {
  const title = trimText(req.body?.title);
  const date = trimText(req.body?.date);
  const category = trimText(req.body?.category) || "Kegiatan";
  const cover = trimText(req.body?.cover) || "🖼️";
  const count = asInt(req.body?.count) || 0;
  const desc = trimText(req.body?.desc) || "";
  if (!title || !date) return res.status(400).json({ ok: false, message: "title dan date wajib diisi" });
  if (!DATE_FORMAT.test(date)) return res.status(400).json({ ok: false, message: "format date harus YYYY-MM-DD" });
  const id = ERP_PUBLIC_GALLERY.length ? Math.max(...ERP_PUBLIC_GALLERY.map((row) => Number(row.id) || 0)) + 1 : 1;
  const row = { id, title, date, category, cover, count, desc };
  ERP_PUBLIC_GALLERY.push(row);
  return res.status(201).json({ ok: true, data: row });
}));

app.put("/api/cms/content/gallery/:id", requirePermission("manage"), asyncHandler(async (req, res) => {
  const id = asInt(req.params.id);
  const idx = ERP_PUBLIC_GALLERY.findIndex((row) => Number(row.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "Galeri tidak ditemukan" });
  const next = { ...ERP_PUBLIC_GALLERY[idx] };
  if (req.body?.title !== undefined) next.title = trimText(req.body.title);
  if (req.body?.date !== undefined) next.date = trimText(req.body.date);
  if (req.body?.category !== undefined) next.category = trimText(req.body.category);
  if (req.body?.cover !== undefined) next.cover = trimText(req.body.cover);
  if (req.body?.count !== undefined) next.count = asInt(req.body.count) || 0;
  if (req.body?.desc !== undefined) next.desc = trimText(req.body.desc);
  if (!next.title || !next.date) return res.status(400).json({ ok: false, message: "title dan date wajib diisi" });
  if (!DATE_FORMAT.test(next.date)) return res.status(400).json({ ok: false, message: "format date harus YYYY-MM-DD" });
  ERP_PUBLIC_GALLERY[idx] = next;
  return res.json({ ok: true, data: next });
}));

app.delete("/api/cms/content/gallery/:id", requirePermission("manage"), asyncHandler(async (req, res) => {
  const id = asInt(req.params.id);
  const idx = ERP_PUBLIC_GALLERY.findIndex((row) => Number(row.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "Galeri tidak ditemukan" });
  const removed = ERP_PUBLIC_GALLERY.splice(idx, 1)[0];
  return res.json({ ok: true, data: removed });
}));

// ════════════════════════════════════════════════════════════
// DASHBOARD SUMMARY
// ════════════════════════════════════════════════════════════

app.get("/api/dashboard/summary", requirePermission("read"), asyncHandler(async (_req, res) => {
  const [studentsRes, attendanceRes, billingRes, tahfidzRes, permitsRes, staffRes, ppdbRes] = await Promise.all([
    query("SELECT * FROM students ORDER BY id DESC"),
    query("SELECT * FROM attendance ORDER BY id DESC"),
    query("SELECT * FROM billing ORDER BY id DESC"),
    query("SELECT * FROM tahfidz_records ORDER BY id DESC"),
    query("SELECT * FROM student_permits ORDER BY id DESC"),
    query("SELECT * FROM staff ORDER BY id DESC"),
    query("SELECT * FROM ppdb_registrations ORDER BY id DESC")
  ]);

  const students   = studentsRes.rows;
  const attendance = attendanceRes.rows;
  const billing    = billingRes.rows;
  const permits    = permitsRes.rows;
  const staff      = staffRes.rows;
  const ppdb       = ppdbRes.rows;

  const today = nowIso().slice(0, 10);
  const currentMonth = nowIso().slice(0, 7);

  const attendanceToday = attendance.filter((a) => String(a.attendance_date).slice(0, 10) === today);
  const billingThisMonth = billing.filter((b) => String(b.month) === currentMonth);
  const unpaidBilling = billing.filter((b) => b.status !== "paid");
  const pendingPermits = permits.filter((p) => p.status === "pending");

  return res.json({
    ok: true,
    summary: {
      students: { total: students.length, aktif: students.filter((s) => s.status === "aktif").length },
      attendance: { today: attendanceToday.length, hadir: attendanceToday.filter((a) => a.status === "hadir").length },
      billing: {
        this_month: billingThisMonth.length,
        unpaid_count: unpaidBilling.length,
        unpaid_total: unpaidBilling.reduce((s, b) => s + Number(b.amount || 0), 0),
        collected_total: billing.filter((b) => b.status === "paid").reduce((s, b) => s + Number(b.amount || 0), 0)
      },
      tahfidz: { total_records: tahfidzRes.rows.length },
      permits: { pending: pendingPermits.length },
      staff: { total: staff.length, aktif: staff.filter((s) => s.status === "aktif").length },
      ppdb: {
        total: ppdb.length,
        pending: ppdb.filter((p) => p.status === "pending").length,
        verified: ppdb.filter((p) => p.status === "verified").length
      }
    }
  });
}));

app.get("/api/dashboard/command-center", requirePermission("read"), asyncHandler(async (req, res) => {
  const role = req.auth?.role || resolveRole(req);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentMonth = now.toISOString().slice(0, 7);
  const [
    studentsRes,
    ppdbRes,
    billingRes,
    roomsRes,
    assignmentsRes,
    permitsRes,
    tahfidzRes,
    staffRes,
    staffAttendanceRes,
    violationsRes
  ] = await Promise.all([
    query("SELECT * FROM students ORDER BY id DESC"),
    query("SELECT * FROM ppdb_registrations ORDER BY id DESC"),
    query("SELECT * FROM billing ORDER BY id DESC"),
    query("SELECT * FROM dormitory_rooms ORDER BY id DESC"),
    query("SELECT * FROM dormitory_assignments ORDER BY id DESC"),
    query("SELECT * FROM student_permits ORDER BY id DESC"),
    query("SELECT * FROM tahfidz_records ORDER BY id DESC"),
    query("SELECT * FROM staff ORDER BY id DESC"),
    query("SELECT * FROM staff_attendance ORDER BY id DESC"),
    query("SELECT * FROM student_violations ORDER BY id DESC")
  ]);

  const payload = buildCommandCenterPayload({
    students: studentsRes.rows,
    ppdb: ppdbRes.rows,
    billing: billingRes.rows,
    rooms: roomsRes.rows,
    assignments: assignmentsRes.rows,
    permits: permitsRes.rows,
    tahfidz: tahfidzRes.rows,
    staff: staffRes.rows,
    staffAttendance: staffAttendanceRes.rows,
    violations: violationsRes.rows
  });

  const students = studentsRes.rows;
  const billing = billingRes.rows;
  const staff = staffRes.rows;
  const ppdb = ppdbRes.rows;

  const activeStudents = students.filter((row) => String(row.status || "").toLowerCase() === "aktif");
  const alumniStudents = students.filter((row) => String(row.status || "").toLowerCase() === "alumni");
  const activeStaff = staff.filter((row) => String(row.status || "").toLowerCase() === "aktif");

  const payrollExpense = activeStaff.reduce((sum, row) => sum + Number(row.salary || 0), 0);
  const monthlyBills = billing.filter((row) => String(row.month) === currentMonth);
  const dueAlerts = monthlyBills
    .filter((row) => String(row.status || "").toLowerCase() !== "paid")
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      student_id: row.student_id,
      amount: Number(row.amount || 0),
      paid_amount: Number(row.paid_amount || 0),
      status: row.status,
      due_date: `${currentMonth}-10`
    }));

  const transactionsToday = billing
    .filter((row) => {
      const paidAt = String(row.paid_at || "").slice(0, 10);
      const createdAt = String(row.created_at || "").slice(0, 10);
      return paidAt === today || (createdAt === today && Number(row.paid_amount || 0) > 0);
    })
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      student_id: row.student_id,
      status: row.status,
      amount: Number(row.amount || 0),
      paid_amount: Number(row.paid_amount || 0),
      paid_at: row.paid_at || row.created_at
    }));

  const ppdbPending = ppdb
    .filter((row) => {
      const status = String(row.status || "").toLowerCase();
      return status === "pending" || status === "verified";
    })
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      student_name: row.student_name,
      guardian_name: row.guardian_name,
      guardian_phone: row.guardian_phone,
      status: row.status,
      created_at: row.created_at
    }));

  const executiveCashflow = [
    { label: "Pemasukan", value: Number(payload.finance_cashflow?.total_receipts || 0) },
    { label: "Pengeluaran", value: payrollExpense }
  ];
  const avgZiyadah = activeStudents.length > 0
    ? Number((Number(payload.tahfidz_weekly?.total_ziyadah || 0) / activeStudents.length).toFixed(2))
    : 0;

  const superAdminOverview = {
    uptime_seconds: Math.floor((Date.now() - observability.startedAt) / 1000),
    total_user_aktif: activeStaff.length + activeStudents.length,
    audit_logs: auditTrail.slice(0, 5),
    helpdesk: {
      phone: "+6283851114491",
      label: "IT Support Desk"
    }
  };

  const visibleWidgetKeys = getVisibleWidgetsByRole(role);
  const filtered = filterWidgetsByAccess(payload, visibleWidgetKeys);
  return res.json({
    ok: true,
    role,
    ...filtered,
    role_panels: {
      super_admin: superAdminOverview,
      executive: {
        active_vs_alumni: {
          active: activeStudents.length,
          alumni: alumniStudents.length
        },
        cashflow_monthly: executiveCashflow,
        tahfidz_progress: {
          total_ziyadah_weekly: Number(payload.tahfidz_weekly?.total_ziyadah || 0),
          average_ziyadah_per_active_student: avgZiyadah
        },
        sdm_attendance: payload.sdm_attendance
      },
      finance_ops: {
        due_alerts: dueAlerts,
        paid_vs_arrears: {
          paid: Number(payload.finance_cashflow?.paid_count || 0),
          arrears: Number(payload.finance_cashflow?.arrears_count || 0)
        },
        transactions_today: transactionsToday,
        quick_actions: [
          { label: "Buat Invoice Baru", href: "/keuangan?action=invoice-baru" },
          { label: "Validasi Pembayaran", href: "/keuangan?action=validasi-pembayaran" }
        ]
      },
      kesantrian_ops: {
        dormitory_occupancy: payload.dormitory_occupancy,
        live_permits: payload.permits_live,
        top_violations: payload.violations_top5,
        ppdb_waiting_list: ppdbPending
      }
    }
  });
}));

// ════════════════════════════════════════════════════════════
// WEBSITE-INTERNAL DATA INTEGRATION
// ════════════════════════════════════════════════════════════

app.get("/api/integration/website-sync", requirePermission("read"), asyncHandler(async (_req, res) => {
  const [studentsRes, attendanceRes, billingRes, staffRes, ppdbRes] = await Promise.all([
    query("SELECT * FROM students ORDER BY id DESC"),
    query("SELECT * FROM attendance ORDER BY id DESC"),
    query("SELECT * FROM billing ORDER BY id DESC"),
    query("SELECT * FROM staff ORDER BY id DESC"),
    query("SELECT * FROM ppdb_registrations ORDER BY id DESC")
  ]);

  const ppdb = ppdbRes.rows;
  return res.json({
    ok: true,
    source: "website_ppdb",
    synced_at: nowIso(),
    modules: {
      santri: { total: studentsRes.rows.length },
      akademik: { attendance_records: attendanceRes.rows.length },
      transaksi: {
        total_billing_rows: billingRes.rows.length,
        total_nominal: billingRes.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
      },
      pengajar: { total_staff: staffRes.rows.length },
      ppdb: {
        total: ppdb.length,
        pending: ppdb.filter((p) => p.status === "pending").length,
        latest: ppdb[0] || null
      }
    }
  });
}));

// ════════════════════════════════════════════════════════════
// PPDB
// ════════════════════════════════════════════════════════════

app.get("/api/public/ppdb/settings", asyncHandler(async (_req, res) => {
  const settings = await readLatestPpdbSettings();
  return res.json({ ok: true, ...settings });
}));

app.get("/api/ppdb/settings", requirePermission("read"), asyncHandler(async (_req, res) => {
  const settings = await readLatestPpdbSettings();
  return res.json({ ok: true, ...settings });
}));

app.put("/api/ppdb/settings", requirePermission("write"), asyncHandler(async (req, res) => {
  const clean = normalizePpdbSettings(req.body || {});
  const actor = trimText(req.headers["x-role"]) || trimText(req.body?.updated_by) || "system";
  const saved = await query(
    "INSERT INTO ppdb_settings (payload, updated_by) VALUES ($1,$2) RETURNING *",
    [clean, actor]
  );
  return res.json({
    ok: true,
    message: "Pengaturan PPDB berhasil diperbarui",
    settings: clean,
    updated_at: saved.rows?.[0]?.updated_at || saved.rows?.[0]?.created_at || nowIso(),
    updated_by: actor
  });
}));

app.post("/api/ppdb/register", asyncHandler(async (req, res) => {
  const {
    student_name,
    origin_school,
    guardian_name,
    guardian_phone,
    notes,
    source_page
  } = req.body || {};

  const cleanName = trimText(student_name);
  const cleanSchool = trimText(origin_school);
  const cleanGuardianName = trimText(guardian_name);
  const normalizedPhone = normalizeGuardianPhone(guardian_phone);

  if (!cleanName || !cleanSchool || !normalizedPhone) {
    return res.status(400).json({ ok: false, message: "student_name, origin_school, guardian_phone wajib diisi" });
  }
  if (!isValidGuardianPhone(normalizedPhone)) {
    return res.status(400).json({ ok: false, message: "Nomor wali tidak valid. Gunakan nomor WhatsApp Indonesia aktif." });
  }
  const ppdbSettings = await readLatestPpdbSettings();
  if (!ppdbSettings.settings.registration_open) {
    return res.status(403).json({ ok: false, message: "Pendaftaran PPDB sedang ditutup sementara" });
  }

  const result = await query(
    "INSERT INTO ppdb_registrations (student_name, origin_school, guardian_name, guardian_phone, notes, source_page) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [cleanName, cleanSchool, cleanGuardianName || null, normalizedPhone, trimText(notes) || null, trimText(source_page) || "/ppdb"]
  );
  const registration = withPpdbDerivedFields(result.rows[0]);
  const notification = triggerPpdbWaNotification(registration);

  return res.status(201).json({
    ok: true,
    message: "Pendaftaran awal berhasil dikirim",
    data: registration,
    notification
  });
}));

app.get("/api/ppdb/queue", requirePermission("read"), asyncHandler(async (req, res) => {
  const { status } = req.query;
  const cleanStatus = trimText(status).toLowerCase();
  if (cleanStatus && !PPDB_STATUS.has(cleanStatus)) {
    return res.status(400).json({ ok: false, message: "status PPDB tidak valid" });
  }
  const rows = await query("SELECT * FROM ppdb_registrations ORDER BY id DESC");
  const filtered = cleanStatus ? rows.rows.filter((row) => String(row.status).toLowerCase() === cleanStatus) : rows.rows;
  return res.json(filtered.map(withPpdbDerivedFields));
}));

app.patch("/api/ppdb/queue/:id/status", requirePermission("approve"), asyncHandler(async (req, res) => {
  const parsedId = asInt(req.params.id);
  const { status, verified_by } = req.body || {};
  const cleanStatus = trimText(status).toLowerCase();
  if (!PPDB_STATUS.has(cleanStatus)) {
    return res.status(400).json({ ok: false, message: "status PPDB tidak valid" });
  }

  const verifiedAt = cleanStatus === "verified" ? nowIso() : null;
  const updated = await query(
    "UPDATE ppdb_registrations SET status = $1, verified_by = $2, verified_at = $3 WHERE id = $4 RETURNING *",
    [cleanStatus, trimText(verified_by) || null, verifiedAt, parsedId]
  );
  if (!updated.rows.length) {
    return res.status(404).json({ ok: false, message: "Data PPDB tidak ditemukan" });
  }
  return res.json({ ok: true, data: withPpdbDerivedFields(updated.rows[0]) });
}));

// ════════════════════════════════════════════════════════════
// STUDENTS
// ════════════════════════════════════════════════════════════

app.get("/api/students", requirePermission("read"), asyncHandler(async (_req, res) => {
  const rows = await query("SELECT * FROM students ORDER BY id DESC");
  return res.json(rows.rows);
}));

app.post("/api/students", requirePermission("write"), asyncHandler(async (req, res) => {
  const { nis, full_name, class_name, guardian_name } = req.body || {};
  const cleanNis = trimText(nis), cleanName = trimText(full_name), cleanClass = trimText(class_name);
  if (!cleanNis || !cleanName || !cleanClass) {
    return res.status(400).json({ ok: false, message: "nis, full_name, class_name wajib diisi" });
  }
  try {
    const result = await query(
      "INSERT INTO students (nis, full_name, class_name, guardian_name) VALUES ($1,$2,$3,$4) RETURNING *",
      [cleanNis, cleanName, cleanClass, trimText(guardian_name) || null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}));

app.patch("/api/students/:id/status", requirePermission("write"), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const validStatus = new Set(["aktif","alumni","keluar"]);
  if (!validStatus.has(status)) return res.status(400).json({ ok: false, message: "status tidak valid" });
  const result = await query("UPDATE students SET status = $1 WHERE id = $2 RETURNING *", [status, asInt(id)]);
  if (!result.rows.length) return res.status(404).json({ ok: false, message: "Santri tidak ditemukan" });
  return res.json(result.rows[0]);
}));

// ════════════════════════════════════════════════════════════
// ATTENDANCE
// ════════════════════════════════════════════════════════════

app.get("/api/attendance", requirePermission("read"), asyncHandler(async (req, res) => {
  const { student_id, status, date } = req.query;
  const rows = await query("SELECT * FROM attendance ORDER BY id DESC");
  const cleanStatus = trimText(status).toLowerCase();
  const parsedStudentId = student_id ? asInt(student_id) : null;
  const cleanDate = trimText(date);
  if (cleanStatus && !ATTENDANCE_STATUS.has(cleanStatus)) return res.status(400).json({ ok: false, message: "status presensi tidak valid" });
  if (cleanDate && !DATE_FORMAT.test(cleanDate)) return res.status(400).json({ ok: false, message: "format date harus YYYY-MM-DD" });
  const filtered = rows.rows.filter((row) => {
    if (parsedStudentId && Number(row.student_id) !== parsedStudentId) return false;
    if (cleanStatus && String(row.status).toLowerCase() !== cleanStatus) return false;
    if (cleanDate && String(row.attendance_date).slice(0, 10) !== cleanDate) return false;
    return true;
  });
  return res.json(filtered);
}));

app.post("/api/attendance", requirePermission("write"), asyncHandler(async (req, res) => {
  const { student_id, attendance_date, status, note } = req.body || {};
  const parsedStudentId = asInt(student_id);
  const cleanStatus = trimText(status).toLowerCase();
  const cleanDate = trimText(attendance_date);
  if (!parsedStudentId || !cleanDate || !cleanStatus) return res.status(400).json({ ok: false, message: "student_id, attendance_date, status wajib diisi" });
  if (!ATTENDANCE_STATUS.has(cleanStatus)) return res.status(400).json({ ok: false, message: "status presensi tidak valid" });
  if (!DATE_FORMAT.test(cleanDate)) return res.status(400).json({ ok: false, message: "format attendance_date harus YYYY-MM-DD" });
  if (!(await checkStudentExists(parsedStudentId))) return res.status(404).json({ ok: false, message: "Santri tidak ditemukan" });
  const result = await query(
    "INSERT INTO attendance (student_id, attendance_date, status, note) VALUES ($1,$2,$3,$4) RETURNING *",
    [parsedStudentId, cleanDate, cleanStatus, trimText(note) || null]
  );
  return res.status(201).json(result.rows[0]);
}));

// ════════════════════════════════════════════════════════════
// BILLING
// ════════════════════════════════════════════════════════════

app.get("/api/billing", requirePermission("read"), asyncHandler(async (req, res) => {
  const { student_id, month, status } = req.query;
  const rows = await query("SELECT * FROM billing ORDER BY id DESC");
  const parsedStudentId = student_id ? asInt(student_id) : null;
  const cleanMonth = trimText(month), cleanStatus = trimText(status).toLowerCase();
  if (cleanStatus && !BILLING_STATUS.has(cleanStatus)) return res.status(400).json({ ok: false, message: "status billing tidak valid" });
  if (cleanMonth && !MONTH_FORMAT.test(cleanMonth)) return res.status(400).json({ ok: false, message: "format month harus YYYY-MM" });
  const filtered = rows.rows.filter((row) => {
    if (parsedStudentId && Number(row.student_id) !== parsedStudentId) return false;
    if (cleanMonth && String(row.month) !== cleanMonth) return false;
    if (cleanStatus && String(row.status).toLowerCase() !== cleanStatus) return false;
    return true;
  });
  return res.json(filtered);
}));

app.post("/api/billing", requirePermission("write"), asyncHandler(async (req, res) => {
  const { student_id, month, amount } = req.body || {};
  const parsedStudentId = asInt(student_id), cleanMonth = trimText(month), parsedAmount = asAmount(amount);
  if (!parsedStudentId || !cleanMonth || !Number.isFinite(parsedAmount)) return res.status(400).json({ ok: false, message: "student_id, month, amount wajib diisi" });
  if (!MONTH_FORMAT.test(cleanMonth)) return res.status(400).json({ ok: false, message: "format month harus YYYY-MM" });
  if (parsedAmount <= 0) return res.status(400).json({ ok: false, message: "amount harus lebih dari 0" });
  if (!(await checkStudentExists(parsedStudentId))) return res.status(404).json({ ok: false, message: "Santri tidak ditemukan" });
  try {
    const result = await query(
      "INSERT INTO billing (student_id, month, amount) VALUES ($1,$2,$3) RETURNING *",
      [parsedStudentId, cleanMonth, parsedAmount]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}));

app.patch("/api/billing/:id", requirePermission("write"), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { paid_amount, status } = req.body || {};
  const parsedId = asInt(id);
  if (!parsedId) return res.status(400).json({ ok: false, message: "id tidak valid" });

  // Cek billing exists
  const existing = await query("SELECT * FROM billing WHERE id = $1", [parsedId]);
  if (!existing.rows.length) return res.status(404).json({ ok: false, message: "Billing tidak ditemukan" });
  const row = existing.rows[0];

  const newPaidAmount = paid_amount !== undefined ? asAmount(paid_amount) : Number(row.paid_amount);
  const totalAmount = Number(row.amount);

  let newStatus = status || row.status;
  if (paid_amount !== undefined) {
    if (newPaidAmount <= 0) newStatus = "unpaid";
    else if (newPaidAmount >= totalAmount) newStatus = "paid";
    else newStatus = "partial";
  }

  if (!BILLING_STATUS.has(newStatus)) return res.status(400).json({ ok: false, message: "status billing tidak valid" });
  const paidAt = newStatus === "paid" ? nowIso() : (row.paid_at || null);

  const result = await query(
    "UPDATE billing SET paid_amount = $1, status = $2, paid_at = $3 WHERE id = $4 RETURNING *",
    [newPaidAmount, newStatus, paidAt, parsedId]
  );
  return res.json(result.rows[0]);
}));

app.get("/api/billing/summary", requirePermission("read"), asyncHandler(async (_req, res) => {
  const rows = await query("SELECT * FROM billing ORDER BY id DESC");
  const all = rows.rows;
  const currentMonth = nowIso().slice(0, 7);

  const summary = {
    total_tagihan:  all.length,
    total_nominal:  all.reduce((s, b) => s + Number(b.amount || 0), 0),
    total_terkumpul: all.filter((b) => b.status === "paid").reduce((s, b) => s + Number(b.amount || 0), 0),
    total_belum_lunas: all.filter((b) => b.status !== "paid").reduce((s, b) => s + Number(b.amount || 0), 0),
    bulan_ini: {
      tagihan: all.filter((b) => b.month === currentMonth).length,
      lunas:   all.filter((b) => b.month === currentMonth && b.status === "paid").length,
      belum:   all.filter((b) => b.month === currentMonth && b.status !== "paid").length
    },
    by_status: {
      unpaid:  all.filter((b) => b.status === "unpaid").length,
      partial: all.filter((b) => b.status === "partial").length,
      paid:    all.filter((b) => b.status === "paid").length
    }
  };
  return res.json({ ok: true, summary });
}));

// ════════════════════════════════════════════════════════════
// TAHFIDZ
// ════════════════════════════════════════════════════════════

app.get("/api/tahfidz", requirePermission("read"), asyncHandler(async (req, res) => {
  const { student_id, type, date_from, date_to } = req.query;
  const rows = await query("SELECT * FROM tahfidz_records ORDER BY id DESC");
  const parsedStudentId = student_id ? asInt(student_id) : null;
  const cleanType = trimText(type).toLowerCase();

  const filtered = rows.rows.filter((row) => {
    if (parsedStudentId && Number(row.student_id) !== parsedStudentId) return false;
    if (cleanType && row.type !== cleanType) return false;
    if (date_from && String(row.record_date).slice(0, 10) < date_from) return false;
    if (date_to && String(row.record_date).slice(0, 10) > date_to) return false;
    return true;
  });
  return res.json(filtered);
}));

app.post("/api/tahfidz", requirePermission("write"), asyncHandler(async (req, res) => {
  const { student_id, record_date, type, surah_from, ayat_from, surah_to, ayat_to, juz, quality, note } = req.body || {};
  const parsedStudentId = asInt(student_id);
  const cleanType = trimText(type).toLowerCase();
  const cleanDate = trimText(record_date) || nowIso().slice(0, 10);

  if (!parsedStudentId) return res.status(400).json({ ok: false, message: "student_id wajib diisi" });
  if (!TAHFIDZ_TYPE.has(cleanType)) return res.status(400).json({ ok: false, message: "type harus ziyadah atau murojaah" });
  if (!trimText(surah_from) || !trimText(surah_to)) return res.status(400).json({ ok: false, message: "surah_from dan surah_to wajib diisi" });
  if (!asInt(ayat_from) || !asInt(ayat_to)) return res.status(400).json({ ok: false, message: "ayat_from dan ayat_to wajib diisi" });
  if (!(await checkStudentExists(parsedStudentId))) return res.status(404).json({ ok: false, message: "Santri tidak ditemukan" });

  const cleanQuality = trimText(quality) || "jayyid";
  if (!TAHFIDZ_QUALITY.has(cleanQuality)) return res.status(400).json({ ok: false, message: "quality tidak valid" });

  const result = await query(
    "INSERT INTO tahfidz_records (student_id, record_date, type, surah_from, ayat_from, surah_to, ayat_to, juz, quality, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
    [parsedStudentId, cleanDate, cleanType, trimText(surah_from), asInt(ayat_from), trimText(surah_to), asInt(ayat_to), juz ? asInt(juz) : null, cleanQuality, trimText(note) || null]
  );
  return res.status(201).json(result.rows[0]);
}));

app.get("/api/tahfidz/summary/:student_id", requirePermission("read"), asyncHandler(async (req, res) => {
  const parsedStudentId = asInt(req.params.student_id);
  if (!parsedStudentId) return res.status(400).json({ ok: false, message: "student_id tidak valid" });
  if (!(await checkStudentExists(parsedStudentId))) return res.status(404).json({ ok: false, message: "Santri tidak ditemukan" });

  const rows = await query("SELECT * FROM tahfidz_records ORDER BY id DESC");
  const records = rows.rows.filter((r) => Number(r.student_id) === parsedStudentId);

  return res.json({
    ok: true,
    student_id: parsedStudentId,
    summary: {
      total_ziyadah: records.filter((r) => r.type === "ziyadah").length,
      total_murojaah: records.filter((r) => r.type === "murojaah").length,
      latest_record: records[0] || null,
      quality_breakdown: Object.fromEntries(
        [...TAHFIDZ_QUALITY].map((q) => [q, records.filter((r) => r.quality === q).length])
      )
    }
  });
}));

// ════════════════════════════════════════════════════════════
// DORMITORY
// ════════════════════════════════════════════════════════════

app.get("/api/dormitory/rooms", requirePermission("read"), asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM dormitory_rooms ORDER BY id DESC");
  const { gender, building } = req.query;
  const filtered = rows.rows.filter((row) => {
    if (gender && row.gender !== gender) return false;
    if (building && !String(row.building).toLowerCase().includes(building.toLowerCase())) return false;
    return true;
  });
  return res.json(filtered);
}));

app.post("/api/dormitory/rooms", requirePermission("write"), asyncHandler(async (req, res) => {
  const { room_code, building, floor, capacity, gender } = req.body || {};
  const cleanCode = trimText(room_code), cleanBuilding = trimText(building);
  const cleanGender = trimText(gender).toUpperCase();

  if (!cleanCode || !cleanBuilding) return res.status(400).json({ ok: false, message: "room_code dan building wajib diisi" });
  if (!["L","P"].includes(cleanGender)) return res.status(400).json({ ok: false, message: "gender harus L atau P" });

  try {
    const result = await query(
      "INSERT INTO dormitory_rooms (room_code, building, floor, capacity, gender) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [cleanCode, cleanBuilding, asInt(floor) || 1, asInt(capacity) || 10, cleanGender]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }
}));

app.get("/api/dormitory/assignments", requirePermission("read"), asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM dormitory_assignments ORDER BY id DESC");
  const { student_id, room_id } = req.query;
  const filtered = rows.rows.filter((row) => {
    if (student_id && Number(row.student_id) !== asInt(student_id)) return false;
    if (room_id && Number(row.room_id) !== asInt(room_id)) return false;
    return true;
  });
  return res.json(filtered);
}));

app.post("/api/dormitory/assignments", requirePermission("write"), asyncHandler(async (req, res) => {
  const { student_id, room_id, assigned_at, note } = req.body || {};
  const parsedStudentId = asInt(student_id), parsedRoomId = asInt(room_id);
  const cleanDate = trimText(assigned_at) || nowIso().slice(0, 10);

  if (!parsedStudentId || !parsedRoomId) return res.status(400).json({ ok: false, message: "student_id dan room_id wajib diisi" });
  if (!(await checkStudentExists(parsedStudentId))) return res.status(404).json({ ok: false, message: "Santri tidak ditemukan" });

  const result = await query(
    "INSERT INTO dormitory_assignments (student_id, room_id, assigned_at, note) VALUES ($1,$2,$3,$4) RETURNING *",
    [parsedStudentId, parsedRoomId, cleanDate, trimText(note) || null]
  );
  return res.status(201).json(result.rows[0]);
}));

// ════════════════════════════════════════════════════════════
// PERMITS (Izin Santri)
// ════════════════════════════════════════════════════════════

app.get("/api/permits", requirePermission("read"), asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM student_permits ORDER BY id DESC");
  const { student_id, status, permit_type } = req.query;
  const filtered = rows.rows.filter((row) => {
    if (student_id && Number(row.student_id) !== asInt(student_id)) return false;
    if (status && row.status !== status) return false;
    if (permit_type && row.permit_type !== permit_type) return false;
    return true;
  });
  return res.json(filtered);
}));

app.post("/api/permits", requirePermission("write"), asyncHandler(async (req, res) => {
  const { student_id, permit_type, reason, start_date, end_date } = req.body || {};
  const parsedStudentId = asInt(student_id);
  const cleanType = trimText(permit_type);
  const cleanReason = trimText(reason);

  if (!parsedStudentId || !cleanType || !cleanReason || !trimText(start_date) || !trimText(end_date)) {
    return res.status(400).json({ ok: false, message: "student_id, permit_type, reason, start_date, end_date wajib diisi" });
  }
  if (!PERMIT_TYPE.has(cleanType)) return res.status(400).json({ ok: false, message: "permit_type tidak valid" });
  if (!(await checkStudentExists(parsedStudentId))) return res.status(404).json({ ok: false, message: "Santri tidak ditemukan" });

  const result = await query(
    "INSERT INTO student_permits (student_id, permit_type, reason, start_date, end_date) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [parsedStudentId, cleanType, cleanReason, trimText(start_date), trimText(end_date)]
  );
  return res.status(201).json(result.rows[0]);
}));

app.patch("/api/permits/:id/status", requirePermission("approve"), asyncHandler(async (req, res) => {
  const parsedId = asInt(req.params.id);
  const { status, approved_by } = req.body || {};
  if (!PERMIT_STATUS.has(status)) return res.status(400).json({ ok: false, message: "status tidak valid" });

  const approvedAt = ["approved","rejected"].includes(status) ? nowIso() : null;
  const result = await query(
    "UPDATE student_permits SET status = $1, approved_by = $2, approved_at = $3 WHERE id = $4 RETURNING *",
    [status, trimText(approved_by) || null, approvedAt, parsedId]
  );
  if (!result.rows.length) return res.status(404).json({ ok: false, message: "Izin tidak ditemukan" });
  return res.json(result.rows[0]);
}));

// ════════════════════════════════════════════════════════════
// HR / STAFF
// ════════════════════════════════════════════════════════════

app.get("/api/staff", requirePermission("read"), asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM staff ORDER BY id DESC");
  const { role, status } = req.query;
  const filtered = rows.rows.filter((row) => {
    if (role && row.role !== role) return false;
    if (status && row.status !== status) return false;
    return true;
  });
  return res.json(filtered);
}));

app.post("/api/staff", requirePermission("write"), asyncHandler(async (req, res) => {
  const { nip, full_name, role, subject, phone, address, join_date } = req.body || {};
  const cleanName = trimText(full_name), cleanRole = trimText(role);

  if (!cleanName || !cleanRole) return res.status(400).json({ ok: false, message: "full_name dan role wajib diisi" });
  if (!STAFF_ROLE.has(cleanRole)) return res.status(400).json({ ok: false, message: `role tidak valid. Pilihan: ${[...STAFF_ROLE].join(", ")}` });

  const result = await query(
    "INSERT INTO staff (nip, full_name, role, subject, phone, address, join_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [trimText(nip) || null, cleanName, cleanRole, trimText(subject) || null, trimText(phone) || null, trimText(address) || null, trimText(join_date) || null]
  );
  return res.status(201).json(result.rows[0]);
}));

app.patch("/api/staff/:id/salary", requirePermission("manage"), asyncHandler(async (req, res) => {
  const parsedId = asInt(req.params.id);
  const { salary } = req.body || {};
  const parsedSalary = asAmount(salary);
  if (!parsedSalary || parsedSalary < 0) return res.status(400).json({ ok: false, message: "salary tidak valid" });

  const result = await query("UPDATE staff SET salary = $1 WHERE id = $2 RETURNING *", [parsedSalary, parsedId]);
  if (!result.rows.length) return res.status(404).json({ ok: false, message: "Staff tidak ditemukan" });
  return res.json(result.rows[0]);
}));

app.get("/api/staff/attendance", requirePermission("read"), asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM staff_attendance ORDER BY id DESC");
  const { staff_id, date, status } = req.query;
  const cleanDate = trimText(date);
  const cleanStatus = trimText(status).toLowerCase();

  if (cleanDate && !DATE_FORMAT.test(cleanDate)) {
    return res.status(400).json({ ok: false, message: "format date harus YYYY-MM-DD" });
  }
  if (cleanStatus && !STAFF_ATTENDANCE_STATUS.has(cleanStatus)) {
    return res.status(400).json({ ok: false, message: "status presensi SDM tidak valid" });
  }

  const filtered = rows.rows.filter((row) => {
    if (staff_id && Number(row.staff_id) !== asInt(staff_id)) return false;
    if (cleanDate && String(row.attendance_date).slice(0, 10) !== cleanDate) return false;
    if (cleanStatus && String(row.status).toLowerCase() !== cleanStatus) return false;
    return true;
  });
  return res.json(filtered);
}));

app.post("/api/staff/attendance", requirePermission("write"), asyncHandler(async (req, res) => {
  const { staff_id, attendance_date, status, note } = req.body || {};
  const parsedStaffId = asInt(staff_id);
  const cleanDate = trimText(attendance_date) || nowIso().slice(0, 10);
  const cleanStatus = trimText(status).toLowerCase();

  if (!parsedStaffId || !cleanStatus) {
    return res.status(400).json({ ok: false, message: "staff_id dan status wajib diisi" });
  }
  if (!STAFF_ATTENDANCE_STATUS.has(cleanStatus)) {
    return res.status(400).json({ ok: false, message: "status presensi SDM tidak valid" });
  }
  if (!DATE_FORMAT.test(cleanDate)) {
    return res.status(400).json({ ok: false, message: "format attendance_date harus YYYY-MM-DD" });
  }

  const result = await query(
    "INSERT INTO staff_attendance (staff_id, attendance_date, status, note) VALUES ($1,$2,$3,$4) RETURNING *",
    [parsedStaffId, cleanDate, cleanStatus, trimText(note) || null]
  );
  return res.status(201).json(result.rows[0]);
}));

app.get("/api/violations", requirePermission("read"), asyncHandler(async (req, res) => {
  const rows = await query("SELECT * FROM student_violations ORDER BY id DESC");
  const { student_id, severity, month } = req.query;
  const cleanSeverity = trimText(severity).toLowerCase();
  const cleanMonth = trimText(month);

  if (cleanSeverity && !VIOLATION_SEVERITY.has(cleanSeverity)) {
    return res.status(400).json({ ok: false, message: "severity tidak valid" });
  }
  if (cleanMonth && !MONTH_FORMAT.test(cleanMonth)) {
    return res.status(400).json({ ok: false, message: "format month harus YYYY-MM" });
  }

  const filtered = rows.rows.filter((row) => {
    if (student_id && Number(row.student_id) !== asInt(student_id)) return false;
    if (cleanSeverity && String(row.severity).toLowerCase() !== cleanSeverity) return false;
    if (cleanMonth && String(row.occurred_at).slice(0, 7) !== cleanMonth) return false;
    return true;
  });
  return res.json(filtered);
}));

app.post("/api/violations", requirePermission("write"), asyncHandler(async (req, res) => {
  const { student_id, violation_type, severity, occurred_at, note } = req.body || {};
  const parsedStudentId = asInt(student_id);
  const cleanType = trimText(violation_type);
  const cleanSeverity = trimText(severity).toLowerCase() || "ringan";
  const cleanDate = trimText(occurred_at) || nowIso().slice(0, 10);

  if (!parsedStudentId || !cleanType) {
    return res.status(400).json({ ok: false, message: "student_id dan violation_type wajib diisi" });
  }
  if (!VIOLATION_SEVERITY.has(cleanSeverity)) {
    return res.status(400).json({ ok: false, message: "severity tidak valid" });
  }
  if (!DATE_FORMAT.test(cleanDate)) {
    return res.status(400).json({ ok: false, message: "format occurred_at harus YYYY-MM-DD" });
  }
  if (!(await checkStudentExists(parsedStudentId))) {
    return res.status(404).json({ ok: false, message: "Santri tidak ditemukan" });
  }

  const result = await query(
    "INSERT INTO student_violations (student_id, violation_type, severity, occurred_at, note) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [parsedStudentId, cleanType, cleanSeverity, cleanDate, trimText(note) || null]
  );
  return res.status(201).json(result.rows[0]);
}));

// ════════════════════════════════════════════════════════════
// ERROR HANDLER
// ════════════════════════════════════════════════════════════

app.use((error, _req, res, _next) => {
  console.error("Unhandled API error:", error.message);
  observability.errorCount += 1;
  return res.status(500).json({ ok: false, message: "Terjadi error di server" });
});

// ── Start ─────────────────────────────────────────────────────
const port = Number(process.env.PORT || 4000);

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend running on http://localhost:${port} (db: ${usingMemoryDb() ? "memory" : "postgres"})`);
      console.log("Modules: students, attendance, billing, tahfidz, dormitory, permits, staff, ppdb, dashboard, integration");
    });
  })
  .catch((error) => {
    console.error("Init failed:", error.message);
    process.exit(1);
  });
