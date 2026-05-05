import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { mergeRhWclGuess, normalizeRhWclGuildRole, sortRhWclLinkRows } from "./lib/rh-wcl-guess.mjs";

dotenv.config({ override: true });

const app = express();
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 8787);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1) || 1);
}

app.disable("x-powered-by");

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
  imgSrc: ["'self'", "data:", "https:"],
  connectSrc: ["'self'"],
};
if (isProd) {
  cspDirectives.upgradeInsecureRequests = [];
}

app.use(
  helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  compression({
    threshold: 1024,
    level: 6,
  })
);

const corsOriginsEnv = process.env.CORS_ORIGINS?.trim();
app.use(
  cors(
    !corsOriginsEnv || corsOriginsEnv === "*"
      ? {}
      : { origin: corsOriginsEnv.split(",").map((o) => o.trim()).filter(Boolean) }
  )
);

app.use(express.json({ limit: "8mb" }));

const apiPerMinute = Math.max(
  30,
  Math.min(5000, Number(process.env.API_RATE_LIMIT_PER_MIN || (isProd ? 180 : 2500)))
);
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    max: apiPerMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a moment." },
    skipSuccessfulRequests: false,
    skip: (req) => req.method === "GET" && req.path === "/health",
  })
);

/**
 * Must be registered before `express.static`: otherwise `/admin.html` is served from disk with auth bypass + long cache,
 * and deploys can leave browsers on stale markup (missing newer admin sections).
 */
app.get("/admin.html", (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) {
    return res.redirect("/auth/discord/login?next=%2Fadmin.html");
  }
  if (!isP2Editor(session)) {
    return res.status(403).send("Admin access required.");
  }
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.sendFile(path.join(publicDir, "admin.html"));
});

app.use(
  express.static(publicDir, {
    etag: true,
    lastModified: true,
    index: false,
    maxAge: isProd ? "1d" : 0,
    immutable: false,
  })
);

const WCL_TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const WCL_GRAPHQL_URL = "https://www.warcraftlogs.com/api/v2/client";
const BLIZZARD_TOKEN_URL = "https://oauth.battle.net/token";
const WOWHEAD_TBC_NETHER_VORTEX_URL = "https://www.wowhead.com/tbc/item=30183/nether-vortex#reagent-for";
const NETHER_VORTEX_WOW_ITEM_ID = 30183;
const NETHER_VORTEX_CRAFTABLES_CACHE_KEY = "nether-vortex-craftables-v6";
const netherVortexCraftablesFallbackPath = path.join(__dirname, "data", "nether-vortex-craftables-fallback.json");
const RAID_HELPER_API_URL = "https://raid-helper.xyz/api/v4";
const DEFAULT_TBC_ZONES = [
  "Karazhan",
  "Gruul's Lair",
  "Magtheridon's Lair",
  "Serpentshrine Cavern",
  "Tempest Keep",
  "Hyjal Summit",
  "Black Temple",
  "Sunwell Plateau",
  "Zul'Aman",
];
const TRACKED_RAIDS = {
  Karazhan: [
    "Attumen the Huntsman",
    "Moroes",
    "Maiden of Virtue",
    "Opera Hall",
    "The Curator",
    "Terestian Illhoof",
    "Shade of Aran",
    "Netherspite",
    "Chess Event",
    "Prince Malchezaar",
    "Nightbane",
  ],
  "Gruul's Lair": ["High King Maulgar", "Gruul the Dragonkiller"],
  "Magtheridon's Lair": ["Magtheridon"],
};

/** 10-player raids — omitted from guild attendance % (`attendancePercentMetrics` mode only). */
const WCL_ATTENDANCE_EXCLUDED_RAIDS = new Set(["Karazhan", "Zul'Aman"]);

/**
 * TBC items that only exist in 10-player raids (Karazhan / ZA). Gargul lines often have no
 * “Karazhan” in the title; zone-based filters miss them — drop by `itemId` (Wowhead TBC).
 */
const TBC_TEN_PLAYER_EXCLUSIVE_LOOT_ITEM_IDS = new Set([
  28504, // Steelhawk Crossbow — Karazhan
  28545, // Edgewalker Longboots — Karazhan
  28740, // Rip-Flayer Leggings — Karazhan
]);

/**
 * Exclude from “25-player loot” aggregations: Kara / ZA by zone label, apostrophe variants,
 * cues in report title when `reportRaidName` is missing or mis-attributed, or by itemId for
 * known 10-player-only drops.
 */
function isTenPlayerTbcLootRow(row) {
  if (!row || typeof row !== "object") return false;

  const iid = Number(row.itemId ?? row.itemID ?? 0);
  if (Number.isInteger(iid) && iid > 0 && TBC_TEN_PLAYER_EXCLUSIVE_LOOT_ITEM_IDS.has(iid)) return true;

  const raidRaw = String(row.reportRaidName || "").trim();
  if (raidRaw) {
    if (WCL_ATTENDANCE_EXCLUDED_RAIDS.has(raidRaw)) return true;
    const apos = raidRaw.replace(/\u2019/g, "'").replace(/\u2018/g, "'");
    if (WCL_ATTENDANCE_EXCLUDED_RAIDS.has(apos)) return true;
    const rNorm = normalizeWclLabel(raidRaw).toLowerCase();
    for (const ex of WCL_ATTENDANCE_EXCLUDED_RAIDS) {
      if (rNorm === normalizeWclLabel(ex).toLowerCase()) return true;
    }
  }

  const hay = normalizeWclLabel(`${row.reportRaidName || ""} ${row.reportTitle || ""}`)
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (hay.includes("karazhan")) return true;
  if (hay.includes("zul'aman") || hay.includes("zul aman") || hay.includes("zulaman")) return true;
  return false;
}
const allowedTbcZones = new Set(
  (process.env.WCL_ALLOWED_GAME_ZONES || DEFAULT_TBC_ZONES.join(","))
    .split(",")
    .map((zone) => zone.trim())
    .filter(Boolean)
);

let cachedToken = null;
let cachedTokenExpiresAt = 0;
let cachedBlizzardToken = null;
let cachedBlizzardTokenExpiresAt = 0;
const DISCORD_API_BASE = "https://discord.com/api/v10";
const discordClientId = process.env.DISCORD_CLIENT_ID?.trim() || "";
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET?.trim() || "";
const discordGuildId =
  process.env.DISCORD_GUILD_ID?.trim() || process.env.RAID_HELPER_SERVER_ID?.trim() || "";

/** Raid Helper’s “server id” is your Discord guild id — optional duplicate of {@link discordGuildId}. */
function raidHelperDiscordGuildId() {
  return (
    String(process.env.RAID_HELPER_SERVER_ID || "").trim() ||
    String(process.env.DISCORD_GUILD_ID || "").trim() ||
    ""
  );
}

const publicBaseUrl =
  process.env.PUBLIC_BASE_URL?.trim() || `http://localhost:${Number(process.env.PORT || 8787)}`;
const discordRedirectUri =
  process.env.DISCORD_REDIRECT_URI?.trim() || `${publicBaseUrl}/auth/discord/callback`;
/** Dev-only: set DISCORD_SKIP_GUILD_CHECK=1 if your Discord user is not in DISCORD_GUILD_ID while testing locally. */
const discordSkipGuildCheck =
  !isProd && String(process.env.DISCORD_SKIP_GUILD_CHECK || "").trim() === "1";
const sessionCookieName = "plb_session";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const oauthStateTtlMs = 1000 * 60 * 10;
const authSessionSecret = process.env.AUTH_SESSION_SECRET?.trim() || randomBytes(32).toString("hex");
const authSessions = new Map();
const oauthStates = new Map();

function discordAuthHelpHtml(title, lines) {
  const inner = lines.map((t) => `<p>${String(t)}</p>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;line-height:1.5;padding:0 1rem">${inner}</body>`;
}
const votingGuildId = Number(process.env.VOTING_GUILD_ID || 817080);

/** Raid Helper ↔ WCL heuristic: signup names from this many most recent posted Raid Helper events (default 6). */
function rhWclLinkRaidHelperEventScanCount() {
  const raw = process.env.RH_WCL_LINK_RAID_HELPER_EVENTS;
  const n = raw !== undefined && String(raw).trim() !== "" ? Number(raw) : 6;
  return Number.isFinite(n) ? Math.min(40, Math.max(1, Math.floor(n))) : 6;
}

/** Raid Helper ↔ WCL heuristic: union log characters from rankings across this many recent tracked raid reports (default 6). */
function rhWclLinkWclReportDetailCount() {
  const raw = process.env.RH_WCL_LINK_WCL_REPORT_DETAILS;
  const n = raw !== undefined && String(raw).trim() !== "" ? Number(raw) : 6;
  return Number.isFinite(n) ? Math.min(100, Math.max(1, Math.floor(n))) : 6;
}

/** Second pass: map leftover log names onto closest RH signup when below main minScore (default 62). */
function rhWclOrphanGuessMinScore() {
  const raw = process.env.RH_WCL_ORPHAN_MIN_SCORE;
  const n = raw !== undefined && String(raw).trim() !== "" ? Number(raw) : 62;
  return Number.isFinite(n) ? Math.max(55, Math.min(79, Math.floor(n))) : 62;
}

const renderDiskMountPath = process.env.RENDER_DISK_MOUNT_PATH?.trim() || "";
const configuredDataDir = process.env.DATA_DIR?.trim() || "";
const defaultDataDir = path.join(__dirname, "data");
const tmpFallbackDataDir = path.join(process.env.TMPDIR || "/tmp", "fallen-tacticians-data");
function pickWritableDataDir() {
  const candidates = [configuredDataDir, renderDiskMountPath, defaultDataDir, tmpFallbackDataDir]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    try {
      mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return defaultDataDir;
}
const dataDir = pickWritableDataDir();
const votingStorePath = path.join(dataDir, "mvp-votes.json");
let votingStoreReady = null;
let votingWriteChain = Promise.resolve();
let votingStoreState = { votes: [] };
const p2MaterialsPath = path.join(dataDir, "p2-materials.json");
const joinNeedsPath = path.join(dataDir, "join-current-needs.json");
const discordDmSubscribersPath = path.join(dataDir, "discord-dm-subscribers.json");
const gargulLootHistoryPath = path.join(dataDir, "gargul-loot-history.json");
const netherVortexNeedsPath = path.join(dataDir, "nether-vortex-needs.json");
/** Primary on-disk guild character roster: Raid Helper signup identity ↔ Warcraft Logs names (mains + alts). Drives attendance linking, Events name resolution, and admin tooling. */
const rhWclCharacterLinksPath = path.join(dataDir, "rh-wcl-character-links.json");
const apiCacheDir = path.join(dataDir, "cache");
const apiResponseCache = new Map();
const apiResponseInflight = new Map();
const eventsKpiMicroCache = new Map();
const eventsKpiInflight = new Map();
let p2MaterialsReady = null;
let p2MaterialsWriteChain = Promise.resolve();
let joinNeedsReady = null;
let joinNeedsWriteChain = Promise.resolve();
let discordDmSubscribersReady = null;
let discordDmSubscribersWriteChain = Promise.resolve();
let gargulLootReady = null;
let gargulLootWriteChain = Promise.resolve();
let netherVortexReady = null;
let netherVortexWriteChain = Promise.resolve();
let gargulLootState = { entries: [], selectedReportCodes: [] };
let netherVortexState = { entries: [] };
let rhWclLinksReady = null;
/** In-memory mirror of {@link rhWclCharacterLinksPath} — one of the main character databases for this deployment. */
let rhWclLinksState = { links: [] };
let rhWclLinksWriteChain = Promise.resolve();
const P2_MATERIALS = [
  { id: "fel_iron_bar", name: "Fel Iron Bar", required: 84, defaultCurrent: 60 },
  { id: "eternium_bar", name: "Eternium Bar", required: 56, defaultCurrent: 40 },
  { id: "primal_life", name: "Primal Life", required: 46, defaultCurrent: 74 },
  { id: "primal_shadow", name: "Primal Shadow", required: 48, defaultCurrent: 190 },
  { id: "mercurial_adamantite", name: "Mercurial Adamantite", required: 5, defaultCurrent: 5 },
  { id: "primal_nether", name: "Primal Nether", required: 3, defaultCurrent: 0 },
];
const DEFAULT_JOIN_NEEDS = [
  { className: "Shaman", specFocus: "Enhancer", priority: "high", color: "#0070dd" },
  { className: "Druid", specFocus: "Boomkin", priority: "high", color: "#ff7d0a" },
  { className: "Paladin", specFocus: "Retri Pala", priority: "high", color: "#f58cba" },
  { className: "Hunter", specFocus: "Hunter", priority: "medium", color: "#abd473" },
];
let p2MaterialsState = {
  currentById: Object.fromEntries(P2_MATERIALS.map((m) => [m.id, Number(m.defaultCurrent || 0)])),
};
let joinNeedsState = { rows: DEFAULT_JOIN_NEEDS.map((row) => ({ ...row })) };
let discordDmSubscribersState = { subscribersByUserId: {}, notifiedEventIds: [] };
let raidHelperDmPollTimer = null;
let raidHelperDmPollRunning = false;

function parseCookieHeader(cookieHeader) {
  const out = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = value;
  }
  return out;
}

function fileSafeCacheKey(cacheKey) {
  return String(cacheKey || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .slice(0, 140);
}

function apiCacheFilePath(cacheKey) {
  return path.join(apiCacheDir, `${fileSafeCacheKey(cacheKey)}.json`);
}

async function readApiCacheEntry(cacheKey) {
  try {
    const raw = await readFile(apiCacheFilePath(cacheKey), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.at !== "number" || parsed?.data == null) return null;
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

async function writeApiCacheEntry(cacheKey, entry) {
  await mkdir(apiCacheDir, { recursive: true });
  const tmpPath = `${apiCacheFilePath(cacheKey)}.tmp`;
  await writeFile(tmpPath, JSON.stringify(entry, null, 2), "utf8");
  await rename(tmpPath, apiCacheFilePath(cacheKey));
}

async function invalidateLootHistoryCacheEntries() {
  for (const key of [...apiResponseCache.keys()]) {
    if (String(key).startsWith("loot-history-v2-")) apiResponseCache.delete(key);
  }
  for (const key of [...apiResponseInflight.keys()]) {
    if (String(key).startsWith("loot-history-v2-")) apiResponseInflight.delete(key);
  }
  try {
    const files = await readdir(apiCacheDir);
    const tasks = files
      .filter((name) => String(name).startsWith("loot-history-v2-"))
      .map((name) => unlink(path.join(apiCacheDir, name)).catch(() => {}));
    await Promise.all(tasks);
  } catch {
    // Cache dir may not exist yet; nothing to invalidate.
  }
}

function lootHistoryCacheTtlMs() {
  const n = Number(process.env.LOOT_HISTORY_CACHE_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(3600_000, n);
  return 120_000;
}

function votingRoundCacheTtlMs() {
  const n = Number(process.env.VOTING_ROUND_CACHE_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(15 * 60_000, n);
  return 90_000;
}

function eventsKpiCacheTtlMs() {
  const n = Number(process.env.EVENTS_KPI_CACHE_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(5 * 60_000, n);
  return 60_000;
}

function eventsKpiCacheKey({ guildId, maxPastEvents, wclLimit }) {
  return `events-kpi-v1:${Number(guildId)}:${Number(maxPastEvents)}:${Number(wclLimit)}`;
}

async function getEventsKpiCached(cacheKey, loader) {
  const ttlMs = eventsKpiCacheTtlMs();
  const now = Date.now();
  const cached = eventsKpiMicroCache.get(cacheKey);
  if (cached && now - Number(cached.at || 0) < ttlMs) return cached.data;
  const running = eventsKpiInflight.get(cacheKey);
  if (running) return running;
  const task = (async () => {
    const data = await loader();
    eventsKpiMicroCache.set(cacheKey, { at: Date.now(), data });
    return data;
  })().finally(() => {
    eventsKpiInflight.delete(cacheKey);
  });
  eventsKpiInflight.set(cacheKey, task);
  return task;
}

function wowClassicRegion() {
  const region = String(process.env.BLIZZARD_REGION || "eu")
    .trim()
    .toLowerCase();
  return region || "eu";
}

function wowClassicLocale() {
  return String(process.env.BLIZZARD_LOCALE || "en_GB").trim() || "en_GB";
}

function wowClassicNamespace() {
  const configured = String(process.env.BLIZZARD_CLASSIC_NAMESPACE || "").trim();
  if (configured) return configured;
  return `static-classic-${wowClassicRegion()}`;
}

/** Realm/name slug for Blizzard profile URLs (e.g. "Nethergarde Keep" -> "nethergarde-keep"). */
function slugifyWowSlug(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function blizzardApiBaseUrl() {
  return `https://${wowClassicRegion()}.api.blizzard.com`;
}

function itemMetadataCacheTtlMs() {
  const n = Number(process.env.ITEM_METADATA_CACHE_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(7 * 24 * 3600_000, n);
  return 24 * 3600_000;
}

function wowheadTooltipEnabled() {
  return String(process.env.WOWHEAD_TOOLTIP_ENABLED || "1").trim() !== "0";
}

function wowheadFlavorPath() {
  const flavor = String(process.env.WOWHEAD_GAME_FLAVOR || "tbc")
    .trim()
    .toLowerCase();
  return flavor && flavor !== "retail" ? `/${flavor}` : "";
}

function wowheadTooltipLocaleKey() {
  const locale = wowClassicLocale().toLowerCase();
  if (locale.startsWith("de")) return "tooltip_dede";
  if (locale.startsWith("fr")) return "tooltip_frfr";
  if (locale.startsWith("es")) return "tooltip_eses";
  if (locale.startsWith("ru")) return "tooltip_ruru";
  return "tooltip_enus";
}

function extractWowheadTooltipHtml(html, itemId, preferredKey) {
  const keyCandidates = [preferredKey, "tooltip_enus", "tooltip_dede", "tooltip_frfr", "tooltip_eses", "tooltip_ruru"];
  for (const key of keyCandidates) {
    const rx = new RegExp(`g_items\\[${Number(itemId)}\\]\\.${key}\\s*=\\s*\"((?:\\\\.|[^\"\\\\])*)\";`);
    const m = String(html || "").match(rx);
    if (!m?.[1]) continue;
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      continue;
    }
  }
  return "";
}

function lootHistoryMaxStaleMs() {
  return 1000 * 60 * 60 * 12;
}

function lootHistoryCacheKey(guildId, reportLimit) {
  return `loot-history-v2-${Number(guildId)}-${Number(reportLimit)}`;
}

async function getOrRefreshCachedPayload(cacheKey, { ttlMs, maxStaleMs = ttlMs, loader }) {
  const now = Date.now();
  const mem = apiResponseCache.get(cacheKey);
  if (mem && now - Number(mem.at || 0) <= ttlMs) return mem.data;

  const triggerRefresh = () => {
    const existing = apiResponseInflight.get(cacheKey);
    if (existing) return existing;
    const run = (async () => {
      const data = await loader();
      const entry = { at: Date.now(), data };
      apiResponseCache.set(cacheKey, entry);
      await writeApiCacheEntry(cacheKey, entry).catch(() => {});
      return data;
    })().finally(() => {
      apiResponseInflight.delete(cacheKey);
    });
    apiResponseInflight.set(cacheKey, run);
    return run;
  };

  if (mem && now - Number(mem.at || 0) <= maxStaleMs) {
    void triggerRefresh();
    return mem.data;
  }

  const disk = await readApiCacheEntry(cacheKey);
  if (disk && now - Number(disk.at || 0) <= maxStaleMs) {
    apiResponseCache.set(cacheKey, disk);
    if (now - Number(disk.at || 0) > ttlMs) void triggerRefresh();
    return disk.data;
  }

  return triggerRefresh();
}

async function forceRefreshCachedPayload(cacheKey, loader) {
  const data = await loader();
  const entry = { at: Date.now(), data };
  apiResponseCache.set(cacheKey, entry);
  await writeApiCacheEntry(cacheKey, entry).catch(() => {});
  return data;
}

function signSessionId(sessionId) {
  return createHmac("sha256", authSessionSecret).update(sessionId).digest("hex");
}

function serializeSessionCookie(sessionId, maxAgeSec) {
  const value = `${sessionId}.${signSessionId(sessionId)}`;
  const attrs = [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
  ];
  if (isProd) attrs.push("Secure");
  return attrs.join("; ");
}

function getSessionFromRequest(req) {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const raw = String(cookies[sessionCookieName] || "");
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const sessionId = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = signSessionId(sessionId);
  const valid =
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return null;
  const session = authSessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) authSessions.delete(sessionId);
    return null;
  }
  return { sessionId, ...session };
}

function pruneAuthMaps() {
  const now = Date.now();
  for (const [k, v] of authSessions) {
    if (!v || v.expiresAt <= now) authSessions.delete(k);
  }
  for (const [k, v] of oauthStates) {
    if (!v || v.expiresAt <= now) oauthStates.delete(k);
  }
}

function discordApiMaxRetries() {
  const n = Number(process.env.DISCORD_API_MAX_RETRIES);
  if (Number.isFinite(n) && n >= 1) return Math.min(8, n);
  return 4;
}

async function fetchDiscordJson(pathname, accessToken) {
  const maxAttempts = discordApiMaxRetries();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(`${DISCORD_API_BASE}${pathname}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) return payload;

    const detail =
      typeof payload?.error_description === "string"
        ? payload.error_description
        : typeof payload?.message === "string"
          ? payload.message
          : "Discord API error";

    const retryable =
      res.status === 429 ||
      res.status === 408 ||
      res.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const retryAfterRaw = res.headers.get("retry-after");
      const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
      let delayMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(120_000, Math.round(retryAfterSec * 1000))
          : Math.min(15_000, 350 * 2 ** (attempt - 1));
      delayMs += Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    const hint =
      res.status >= 500
        ? " (Discord may be temporarily unavailable — try again in a minute.)"
        : "";
    throw new Error(`Discord request failed (${res.status}): ${detail}${hint}`);
  }
  throw new Error("Discord request failed after retries.");
}

async function persistVotingStore() {
  const tmpPath = `${votingStorePath}.tmp`;
  const json = JSON.stringify(votingStoreState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, votingStorePath);
}

async function ensureVotingStore() {
  if (votingStoreReady) return votingStoreReady;
  votingStoreReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(votingStorePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.votes)) {
        votingStoreState = {
          votes: parsed.votes
            .map((vote) => ({
              roundKey: String(vote?.roundKey || ""),
              raidCode: String(vote?.raidCode || ""),
              raidStartTime: Number(vote?.raidStartTime || 0),
              userId: String(vote?.userId || ""),
              candidateName: String(vote?.candidateName || ""),
              createdAt: Number(vote?.createdAt || 0),
              updatedAt: Number(vote?.updatedAt || 0),
            }))
            .filter((vote) => vote.roundKey && vote.userId && vote.candidateName),
        };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      votingStoreState = { votes: [] };
      await persistVotingStore();
    }
  })();
  return votingStoreReady;
}

function getVotingTallies(roundKey) {
  const counts = new Map();
  for (const vote of votingStoreState.votes) {
    if (vote.roundKey !== roundKey) continue;
    const key = vote.candidateName;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function getUserVote(roundKey, userId) {
  return votingStoreState.votes.find((vote) => vote.roundKey === roundKey && vote.userId === userId) || null;
}

function votingHallOfFame(currentRoundKey, limit = 8) {
  const rounds = new Map();
  for (const vote of votingStoreState.votes) {
    const roundKey = String(vote.roundKey || "");
    if (!roundKey || roundKey === currentRoundKey) continue;
    if (!rounds.has(roundKey)) {
      rounds.set(roundKey, {
        roundKey,
        raidCode: String(vote.raidCode || ""),
        raidStartTime: Number(vote.raidStartTime || 0),
        counts: new Map(),
      });
    }
    const row = rounds.get(roundKey);
    const candidateName = String(vote.candidateName || "").trim();
    if (!candidateName) continue;
    row.counts.set(candidateName, (row.counts.get(candidateName) || 0) + 1);
  }

  return [...rounds.values()]
    .map((round) => {
      const ordered = [...round.counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const winner = ordered[0];
      return {
        roundKey: round.roundKey,
        raidCode: round.raidCode,
        raidStartTime: round.raidStartTime,
        winnerName: winner?.[0] || "Unknown",
        winnerVotes: Number(winner?.[1] || 0),
      };
    })
    .sort((a, b) => Number(b.raidStartTime || 0) - Number(a.raidStartTime || 0))
    .slice(0, limit);
}

const HOF_REPORT_FIGHTS_QUERY = `
  query HofReportFights($code: String!) {
    reportData {
      report(code: $code) {
        zone { name }
        fights {
          id
          encounterID
          gameZone { name }
        }
      }
    }
  }
`;

const HOF_PARSE_RANKINGS_QUERY = `
  query HofParseRankings($code: String!, $fightIds: [Int!]) {
    reportData {
      report(code: $code) {
        dpsRankings: rankings(fightIDs: $fightIds, playerMetric: dps)
        hpsRankings: rankings(fightIDs: $fightIds, playerMetric: hps)
      }
    }
  }
`;

function trackedBossFightIdsFromHallOfFameReport(report) {
  if (!report?.fights?.length) return [];
  return report.fights
    .filter((f) => Number(f?.encounterID || 0) > 0 && resolvedTrackedRaidForFight(f, report))
    .map((f) => Number(f.id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function trackedBossFightIdsForHallOfFameReport(raidCode) {
  const code = String(raidCode || "").trim();
  if (!code) return [];
  const data = await queryWcl(HOF_REPORT_FIGHTS_QUERY, { code });
  const report = data?.reportData?.report;
  return trackedBossFightIdsFromHallOfFameReport(report);
}

/** Mirrors Events roster bucket labels for parse bracket selection. */
function rosterBucketRoleNameForHallOfFame(roleName) {
  const low = String(roleName || "").trim().toLowerCase();
  if (low === "tank" || low === "tanks" || low === "schutz") return "Tanks";
  if (low === "healer" || low === "healers") return "Healers";
  if (low === "melee" || low === "mdps") return "Melee";
  if (low === "ranged" || low === "rdps" || low === "caster" || low === "casters") return "Ranged";
  const r = String(roleName || "").trim();
  return ["Tanks", "Healers", "Melee", "Ranged"].includes(r) ? r : "Ranged";
}

function hallOfFameBracketFromRosterPlayer(player) {
  if (!player) return "unk";
  const b = rosterBucketRoleNameForHallOfFame(player.roleName);
  if (b === "Healers") return "heal";
  if (b === "Tanks") return "tank";
  return "dps";
}

function matchHallOfFameRosterPlayer(players, winnerName) {
  const target = normalizeRaidHelperDisplayKey(winnerName);
  if (!target) return null;
  for (const p of players || []) {
    const candidates = [
      p?.characterName,
      p?.name,
      p?.rioProfileLookupName,
      ...(Array.isArray(p?.wclCharacters) ? p.wclCharacters : []),
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    for (const c of candidates) {
      if (normalizeRaidHelperDisplayKey(c) === target) return p;
    }
  }
  return null;
}

function hallOfFamePeakParseSource(raidCode, metric, pick, winnerName) {
  if (!pick || pick.rankPercent == null || !Number.isFinite(Number(pick.rankPercent))) return null;
  return {
    reportCode: String(raidCode || "").trim(),
    fightId: pick.fightId ?? null,
    encounterName: String(pick.bossName || "").trim(),
    metric: String(metric || "").trim(),
    wclCharacterName: String(winnerName || "").trim(),
  };
}

function pickHallOfFamePeakParse(mergedDps, mergedHps, raidCode, winnerName, bracket) {
  const n = String(winnerName || "").trim();
  if (!n) return { value: null, source: null };

  const healBest = bestRoleParse(mergedHps, "healers", n);
  const tankBest = bestRoleParse(mergedDps, "tanks", n);
  const dpsBest = bestRoleParse(mergedDps, "dps", n);

  const hVal = healBest?.rankPercent;
  const tVal = tankBest?.rankPercent;
  const dVal = dpsBest?.rankPercent;

  if (bracket === "heal") {
    const hasHeal = hVal != null && Number(hVal) > 0;
    if (hasHeal) {
      return {
        value: Number(hVal),
        source: hallOfFamePeakParseSource(raidCode, "HPS", healBest, n),
      };
    }
    if (dVal != null && Number(dVal) > 0) {
      return {
        value: Number(dVal),
        source: hallOfFamePeakParseSource(raidCode, "DPS", dpsBest, n),
      };
    }
    return { value: null, source: null };
  }
  if (bracket === "tank") {
    const hasTank = tVal != null && Number(tVal) > 0;
    if (hasTank) {
      return {
        value: Number(tVal),
        source: hallOfFamePeakParseSource(raidCode, "DPS", tankBest, n),
      };
    }
    if (dVal != null && Number(dVal) > 0) {
      return {
        value: Number(dVal),
        source: hallOfFamePeakParseSource(raidCode, "DPS", dpsBest, n),
      };
    }
    return { value: null, source: null };
  }
  if (bracket === "dps") {
    if (dVal != null && Number(dVal) > 0) {
      return {
        value: Number(dVal),
        source: hallOfFamePeakParseSource(raidCode, "DPS", dpsBest, n),
      };
    }
    return { value: null, source: null };
  }

  const candidates = [
    { v: hVal, src: healBest, m: "HPS" },
    { v: tVal, src: tankBest, m: "DPS" },
    { v: dVal, src: dpsBest, m: "DPS" },
  ].filter((x) => x.v != null && Number.isFinite(Number(x.v)) && Number(x.v) > 0);
  if (!candidates.length) return { value: null, source: null };
  const best = candidates.reduce((a, b) => (Number(b.v) > Number(a.v) ? b : a));
  return {
    value: Number(best.v),
    source: hallOfFamePeakParseSource(raidCode, best.m, best.src, n),
  };
}

async function loadMergedRankingsBundleForHallOfFameUncached(raidCode) {
  const code = String(raidCode || "").trim();
  if (!code) return null;
  const fightIds = await trackedBossFightIdsForHallOfFameReport(code);
  if (!fightIds.length) return { mergedDps: null, mergedHps: null, classByNameLower: {} };

  const chunks = chunkPositiveInts(fightIds, wclMaxFightIdsPerQuery());
  const damageParts = [];
  const dpsRankParts = [];
  const hpsRankParts = [];

  for (const ids of chunks) {
    const [dmgData, rankData] = await Promise.all([
      queryWcl(VOTING_ROUND_QUERY, { code, fightIds: ids }),
      queryWcl(HOF_PARSE_RANKINGS_QUERY, { code, fightIds: ids }),
    ]);
    damageParts.push(dmgData?.reportData?.report?.damageDone);
    const r = rankData?.reportData?.report || {};
    dpsRankParts.push(r.dpsRankings);
    hpsRankParts.push(r.hpsRankings);
  }

  const mergedDps = mergeWclRankingsPayloads(dpsRankParts);
  const mergedHps = mergeWclRankingsPayloads(hpsRankParts);
  const damageTable = mergeWclTableValuesFromApi(damageParts);
  const classByNameLower = {};
  for (const e of damageTable.entries || []) {
    const nk = String(e?.name || "").trim().toLowerCase();
    if (nk && e?.type) classByNameLower[nk] = String(e.type);
  }
  return { mergedDps, mergedHps, classByNameLower };
}

/**
 * Shared builder for `GET /api/wcl/guild/:guildId/active-roster` and hall-of-fame roster matching.
 */
async function buildActiveRosterPlayersForGuild(guildId, { reportLimit = 40, top = 250, maxRhPastEvents = 80 } = {}) {
  const rhSignupCounts = await countRaidHelperPrimarySignupsPerRhKey(maxRhPastEvents);
  await ensureRhWclLinksStore();
  const { raidSnapshots, wclDisplayByLower, raidRankingPayloads } = await gatherAttendanceRaidSnapshots(
    guildId,
    reportLimit,
    {
      attendancePercentMetrics: true,
    }
  );

  const linkedPayload = buildRhWclLinkedAttendanceLeaderboard(
    raidSnapshots,
    rhWclLinksState,
    top,
    wclDisplayByLower,
    raidRankingPayloads
  );

  const activeRows = linkedPayload.leaderboard.filter((r) => Number(r?.raidsAttended || 0) > 0);
  const pairs = [];
  for (const attRow of activeRows) {
    const name = String(attRow.raidHelperName || attRow.name || "").trim();
    if (!name) continue;
    pairs.push({
      attRow,
      base: {
        name,
        rioLookupCharacterName: "",
        className: "",
        specName: "",
        raidHelperClassName: "",
        raidHelperSpecName: "",
        roleName: "Ranged",
        race: "",
        gender: "",
        specIconUrl: "",
        realm: defaultWowRealmForRoster(),
      },
    });
  }

  const rosterBase = pairs.map((p) => p.base);
  let enriched = await enrichConfirmedRosterExternalSpecs(rosterBase);
  if (blizzardProfileClientConfigured()) {
    const conc = Math.min(16, Math.max(1, Number(process.env.WOW_EXTERNAL_SPEC_CONCURRENCY || 6) || 6));
    const region = wowClassicRegion();
    enriched = await mapWithConcurrency(enriched, conc, async (row, idx) => {
      if (String(row?.specName || "").trim() || String(row?.raiderIoSpecName || "").trim()) return row;
      const attRow = pairs[idx]?.attRow || {};
      const realmSlug = slugifyWowSlug(row?.realm || defaultWowRealmForRoster());
      if (!realmSlug) return row;
      const candidates = [
        ...(Array.isArray(attRow?.wclCharacters) ? attRow.wclCharacters : []),
        attRow?.name,
        row?.characterName,
        row?.rioProfileLookupName,
        row?.name,
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean);
      const uniq = [...new Set(candidates)];
      for (const cand of uniq) {
        const key = `bnet-classic-active-spec-v3-${region}-${realmSlug}-${slugifyLocaleText(cand)}`;
        try {
          const specName = await getOrRefreshCachedPayload(key, {
            ttlMs: 24 * 60 * 60 * 1000,
            maxStaleMs: 14 * 24 * 60 * 60 * 1000,
            loader: () => fetchBlizzardClassicActiveSpecName(realmSlug, cand),
          });
          if (String(specName || "").trim()) {
            return {
              ...row,
              specName: String(specName).trim(),
              blizzardSpecName: String(specName).trim(),
              raiderIoSpecName: String(row?.raiderIoSpecName || "").trim() || String(specName).trim(),
            };
          }
        } catch {
          /* try next candidate */
        }
      }
      return row;
    });
  }
  enriched = enriched.map((row) => {
    const inferred = inferActiveRosterRoleNameFromSpec(row);
    return inferred ? { ...row, roleName: inferred } : row;
  });
  enriched = await Promise.all(enriched.map((row) => attachClassicSpecSpellIconIfNeeded(row)));
  enriched = await enrichConfirmedRosterWithWclSpecIcons(enriched);

  const players = enriched.map((row, i) => {
    const att = pairs[i].attRow;
    const stripped = stripInternalRosterFields(row);
    const rhKey = normalizeRaidHelperDisplayKey(String(stripped?.name || ""));
    const rhPastEventCount = rhKey ? rhSignupCounts.counts.get(rhKey) || 0 : 0;
    return {
      ...stripped,
      guildRole: normalizeRhWclGuildRole(att.guildRole),
      raidsAttended: att.raidsAttended,
      attendanceRate: att.attendanceRate,
      wclCharacters: att.wclCharacters,
      parseSummaries: att.parseSummaries,
      attendanceHistory: att.attendanceHistory,
      rhPastEventCount,
    };
  });

  players.sort((a, b) =>
    String(a?.characterName || a?.name || "").localeCompare(String(b?.characterName || b?.name || ""))
  );

  return {
    guildId,
    consideredRaids: linkedPayload.consideredRaids,
    activeCount: players.length,
    raids: raidSnapshots.map((raid) => ({ reportCode: raid.reportCode, startTime: raid.startTime })),
    attendanceScope: {
      only25PlayerRaids: true,
      excludedRaids: [...WCL_ATTENDANCE_EXCLUDED_RAIDS],
      recentRaidCap: wclAttendanceRecentRaidCount(),
    },
    parseScope: {
      sameRaidsAsAttendance: true,
      metricNote:
        "Peak parse columns: best single-boss percentile per raid log, then max across recent capped raids (tooltip = encounter + report + fight). Parsing badge: tied for best percentile among linked raiders on that boss for your bracket (tank / healer / DPS) in any raid in the window.",
    },
    raidHelperEventScope: {
      maxPastEvents: maxRhPastEvents,
      pastEventsScanned: rhSignupCounts.pastEventsScanned,
      note:
        "rhPastEventCount: primary signups in past Raid Helper events (scanned up to maxPastEvents, newest first).",
    },
    players,
  };
}

async function enrichHallOfFameRows(guildId, rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  let players = [];
  try {
    const payload = await buildActiveRosterPlayersForGuild(guildId, {
      reportLimit: 40,
      top: 250,
      maxRhPastEvents: 80,
    });
    players = payload.players || [];
  } catch {
    players = [];
  }

  const codes = [...new Set(rows.map((r) => String(r?.raidCode || "").trim()).filter(Boolean))];
  const bundleByCode = new Map();
  for (const code of codes) {
    try {
      const cacheKey = `hof-merged-rankings-v1-${code}`;
      const bundle = await getOrRefreshCachedPayload(cacheKey, {
        ttlMs: 7 * 24 * 60 * 60 * 1000,
        maxStaleMs: 14 * 24 * 60 * 60 * 1000,
        loader: () => loadMergedRankingsBundleForHallOfFameUncached(code),
      });
      bundleByCode.set(code, bundle);
    } catch {
      bundleByCode.set(code, null);
    }
  }

  return rows.map((row) => {
    const matched = matchHallOfFameRosterPlayer(players, row.winnerName);
    const bracket = hallOfFameBracketFromRosterPlayer(matched);
    const code = String(row?.raidCode || "").trim();
    const bundle = bundleByCode.get(code);
    let peakParse = null;
    let peakParseSource = null;
    let wclClassName = "";
    if (bundle?.mergedDps && bundle?.mergedHps) {
      const pick = pickHallOfFamePeakParse(bundle.mergedDps, bundle.mergedHps, code, row.winnerName, bracket);
      peakParse = pick.value;
      peakParseSource = pick.source;
    }
    if (bundle?.classByNameLower && row?.winnerName) {
      const k = String(row.winnerName).trim().toLowerCase();
      wclClassName = bundle.classByNameLower[k] || "";
    }
    return {
      ...row,
      player: matched || null,
      peakParse,
      peakParseSource,
      peakParseBracket: bracket,
      wclClassName,
    };
  });
}

async function getHallOfFameForGuild(guildId, limit = 10) {
  await ensureVotingStore();
  const voting = await getCurrentVotingRoundCached(guildId);
  const currentRoundKey = voting?.roundKey || "";
  const rows = votingHallOfFame(currentRoundKey, limit);
  try {
    return await enrichHallOfFameRows(guildId, rows);
  } catch {
    return rows.map((r) => ({
      ...r,
      player: null,
      peakParse: null,
      peakParseSource: null,
      peakParseBracket: null,
      wclClassName: "",
    }));
  }
}

async function upsertVote(voteInput) {
  await ensureVotingStore();
  const now = Date.now();
  const userId = String(voteInput.userId || "");
  const roundKey = String(voteInput.roundKey || "");
  const candidateName = String(voteInput.candidateName || "");
  if (!userId || !roundKey || !candidateName) throw new Error("Invalid vote payload");

  votingWriteChain = votingWriteChain.then(async () => {
    const idx = votingStoreState.votes.findIndex((vote) => vote.roundKey === roundKey && vote.userId === userId);
    if (idx === -1) {
      votingStoreState.votes.push({
        roundKey,
        raidCode: String(voteInput.raidCode || ""),
        raidStartTime: Number(voteInput.raidStartTime || 0),
        userId,
        candidateName,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const prev = votingStoreState.votes[idx];
      votingStoreState.votes[idx] = {
        ...prev,
        candidateName,
        updatedAt: now,
      };
    }
    await persistVotingStore();
  });
  await votingWriteChain;
}

function p2EditorIds() {
  return String(process.env.P2_EDITOR_DISCORD_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function p2EditorNames() {
  const raw = process.env.P2_EDITOR_DISCORD_NAMES;
  const source = raw && raw.trim() ? raw : "highbullet";
  return source
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function isP2Editor(session) {
  if (!session?.user) return false;
  const userId = String(session.user.id || "").trim();
  const ids = p2EditorIds();
  if (userId && ids.includes(userId)) return true;
  const nameCandidates = [session.user.globalName, session.user.username]
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);
  return nameCandidates.some((n) => p2EditorNames().includes(n));
}

function p2EditorDebug(session) {
  const configuredIds = p2EditorIds();
  const configuredNames = p2EditorNames();
  const userId = String(session?.user?.id || "").trim();
  const normalizedNames = [session?.user?.globalName, session?.user?.username]
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);
  const matchedById = Boolean(userId && configuredIds.includes(userId));
  const matchedByName = normalizedNames.some((name) => configuredNames.includes(name));
  return {
    isAdmin: matchedById || matchedByName,
    matchedById,
    matchedByName,
    userId,
    normalizedNames,
    configuredIdsCount: configuredIds.length,
    configuredNames,
  };
}

function requireAdminSession(req, res) {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) {
    res.status(401).json({ ok: false, error: "Login required" });
    return null;
  }
  if (!isP2Editor(session)) {
    res.status(403).json({ ok: false, error: "Admin access required" });
    return null;
  }
  return session;
}

async function persistP2Materials() {
  const tmpPath = `${p2MaterialsPath}.tmp`;
  const json = JSON.stringify(p2MaterialsState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, p2MaterialsPath);
}

async function ensureP2MaterialsStore() {
  if (p2MaterialsReady) return p2MaterialsReady;
  p2MaterialsReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(p2MaterialsPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.currentById === "object") {
        const nextCurrent = {};
        for (const m of P2_MATERIALS) {
          const n = Number(parsed.currentById[m.id]);
          nextCurrent[m.id] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : Number(m.defaultCurrent || 0);
        }
        p2MaterialsState = { currentById: nextCurrent };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      p2MaterialsState = {
        currentById: Object.fromEntries(P2_MATERIALS.map((m) => [m.id, Number(m.defaultCurrent || 0)])),
      };
      await persistP2Materials();
    }
  })();
  return p2MaterialsReady;
}

function getP2MaterialsRows() {
  return P2_MATERIALS.map((m) => ({
    id: m.id,
    name: m.name,
    required: m.required,
    current: Number(p2MaterialsState.currentById[m.id] || 0),
  }));
}

async function setP2MaterialCurrent(materialId, currentValue) {
  await ensureP2MaterialsStore();
  const exists = P2_MATERIALS.some((m) => m.id === materialId);
  if (!exists) throw new Error("Unknown material id");
  const safeValue = Math.max(0, Math.floor(Number(currentValue || 0)));

  p2MaterialsWriteChain = p2MaterialsWriteChain.then(async () => {
    p2MaterialsState.currentById[materialId] = safeValue;
    await persistP2Materials();
  });
  await p2MaterialsWriteChain;
}

function sanitizeJoinNeedsRows(rawRows) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const out = [];
  for (const row of rows.slice(0, 24)) {
    if (!row || typeof row !== "object") continue;
    const className = String(row.className || "")
      .trim()
      .slice(0, 64);
    const specFocus = String(row.specFocus || "")
      .trim()
      .slice(0, 96);
    if (!className || !specFocus) continue;
    const prRaw = String(row.priority || "open").trim().toLowerCase();
    const priority = prRaw === "high" || prRaw === "medium" || prRaw === "open" ? prRaw : "open";
    const colorRaw = String(row.color || "")
      .trim()
      .slice(0, 20);
    const color = /^#[0-9a-f]{6}$/i.test(colorRaw) ? colorRaw : "#ffffff";
    out.push({ className, specFocus, priority, color });
  }
  return out;
}

async function persistJoinNeedsStore() {
  const tmpPath = `${joinNeedsPath}.tmp`;
  const json = JSON.stringify(joinNeedsState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, joinNeedsPath);
}

async function ensureJoinNeedsStore() {
  if (joinNeedsReady) return joinNeedsReady;
  joinNeedsReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(joinNeedsPath, "utf8");
      const parsed = JSON.parse(raw);
      const rows = sanitizeJoinNeedsRows(parsed?.rows);
      joinNeedsState = { rows: rows.length ? rows : DEFAULT_JOIN_NEEDS.map((row) => ({ ...row })) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      joinNeedsState = { rows: DEFAULT_JOIN_NEEDS.map((row) => ({ ...row })) };
      await persistJoinNeedsStore();
    }
  })();
  return joinNeedsReady;
}

function sanitizeDiscordDmSubscribersState(raw) {
  const byUserIdIn = raw && typeof raw.subscribersByUserId === "object" ? raw.subscribersByUserId : {};
  const out = {};
  for (const [userIdRaw, rowRaw] of Object.entries(byUserIdIn)) {
    const userId = String(userIdRaw || "")
      .trim()
      .slice(0, 64);
    if (!userId) continue;
    const row = rowRaw && typeof rowRaw === "object" ? rowRaw : {};
    out[userId] = {
      userId,
      username: String(row.username || "").trim().slice(0, 128),
      globalName: String(row.globalName || "").trim().slice(0, 128),
      subscribed: row.subscribed !== false,
      updatedAt: Number.isFinite(Number(row.updatedAt)) ? Number(row.updatedAt) : Date.now(),
    };
  }
  const notifiedRaw = Array.isArray(raw?.notifiedEventIds) ? raw.notifiedEventIds : [];
  const notifiedEventIds = [...new Set(notifiedRaw.map((x) => String(x || "").trim()).filter(Boolean))].slice(-600);
  return { subscribersByUserId: out, notifiedEventIds };
}

async function persistDiscordDmSubscribersStore() {
  const tmpPath = `${discordDmSubscribersPath}.tmp`;
  const json = JSON.stringify(discordDmSubscribersState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, discordDmSubscribersPath);
}

async function ensureDiscordDmSubscribersStore() {
  if (discordDmSubscribersReady) return discordDmSubscribersReady;
  discordDmSubscribersReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(discordDmSubscribersPath, "utf8");
      const parsed = JSON.parse(raw);
      discordDmSubscribersState = sanitizeDiscordDmSubscribersState(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      discordDmSubscribersState = { subscribersByUserId: {}, notifiedEventIds: [] };
      await persistDiscordDmSubscribersStore();
    }
  })();
  return discordDmSubscribersReady;
}

async function setDiscordDmSubscriptionForSessionUser(session, subscribed) {
  await ensureDiscordDmSubscribersStore();
  const userId = String(session?.user?.id || "").trim();
  if (!userId) throw new Error("Login required");
  const nextSubscribed = Boolean(subscribed);
  const username = String(session?.user?.username || "").trim();
  const globalName = String(session?.user?.globalName || "").trim();
  discordDmSubscribersWriteChain = discordDmSubscribersWriteChain.catch(() => {}).then(async () => {
    const prev =
      discordDmSubscribersState.subscribersByUserId[userId] && typeof discordDmSubscribersState.subscribersByUserId[userId] === "object"
        ? discordDmSubscribersState.subscribersByUserId[userId]
        : {};
    discordDmSubscribersState.subscribersByUserId[userId] = {
      userId,
      username: username || String(prev.username || ""),
      globalName: globalName || String(prev.globalName || ""),
      subscribed: nextSubscribed,
      updatedAt: Date.now(),
    };
    await persistDiscordDmSubscribersStore();
  });
  await discordDmSubscribersWriteChain;
  return discordDmSubscribersState.subscribersByUserId[userId];
}

function raidHelperDmPollIntervalMs() {
  const raw = Number(process.env.RAID_HELPER_DM_POLL_MS);
  if (Number.isFinite(raw) && raw >= 60_000) return Math.min(60 * 60_000, Math.floor(raw));
  return 3 * 60_000;
}

function canRunRaidHelperDmNotifier() {
  return Boolean(process.env.DISCORD_BOT_TOKEN?.trim() && process.env.RAID_HELPER_API_KEY?.trim() && raidHelperDiscordGuildId());
}

async function discordBotApi(pathname, { method = "GET", body } = {}) {
  const botToken = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!botToken) throw new Error("Missing DISCORD_BOT_TOKEN");
  const res = await fetch(`${DISCORD_API_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(payload?.message || `Discord bot API failed (${res.status})`).slice(0, 180);
    throw new Error(msg);
  }
  return payload;
}

function formatRaidHelperEventStartForDm(startTimeSec) {
  const sec = Number(startTimeSec || 0);
  if (!Number.isFinite(sec) || sec <= 0) return "unknown time";
  const dt = new Date(sec * 1000);
  if (Number.isNaN(dt.getTime())) return "unknown time";
  return dt.toLocaleString();
}

async function sendDiscordDmForRaidHelperEvent(userId, eventRow) {
  const evId = String(eventRow?.id || "");
  const title = String(eventRow?.title || "New raid event").trim() || "New raid event";
  const when = formatRaidHelperEventStartForDm(eventRow?.startTime);
  const url = evId ? `https://raid-helper.dev/event/${encodeURIComponent(evId)}` : "";
  const dm = await discordBotApi("/users/@me/channels", {
    method: "POST",
    body: { recipient_id: String(userId || "") },
  });
  const channelId = String(dm?.id || "").trim();
  if (!channelId) throw new Error("Could not open DM channel");
  const lines = [`A new Raid-Helper event was posted: **${title}**`, `Start: ${when}`];
  if (url) lines.push(`Open event: ${url}`);
  lines.push("");
  lines.push("You receive this because you subscribed on wow-pug.com.");
  await discordBotApi(`/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: { content: lines.join("\n") },
  });
}

async function runRaidHelperDmPollOnce() {
  if (raidHelperDmPollRunning) return;
  raidHelperDmPollRunning = true;
  try {
    if (!canRunRaidHelperDmNotifier()) return;
    await ensureDiscordDmSubscribersStore();
    const serverId = raidHelperDiscordGuildId();
    if (!serverId) return;
    const events = await fetchRaidHelperServerEvents(serverId);
    const nowSec = Math.floor(Date.now() / 1000);
    const latestPosted = (Array.isArray(events) ? events : [])
      .map((event) => ({
        id: String(event.id || event.eventId || event.eventID || "").trim(),
        startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
        title: String(event.title || event.name || event.description || "Raid event").trim(),
      }))
      .filter((event) => event.id && Number.isFinite(event.startTime) && event.startTime >= nowSec - 6 * 3600)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, 4);
    const alreadyNotified = new Set(discordDmSubscribersState.notifiedEventIds || []);
    const newEvents = latestPosted.filter((event) => !alreadyNotified.has(event.id));
    if (!newEvents.length) return;
    const subscribers = Object.values(discordDmSubscribersState.subscribersByUserId || {}).filter(
      (row) => row && row.subscribed && String(row.userId || "").trim()
    );
    if (!subscribers.length) {
      discordDmSubscribersState.notifiedEventIds = [...alreadyNotified, ...newEvents.map((ev) => ev.id)].slice(-600);
      await persistDiscordDmSubscribersStore();
      return;
    }
    for (const event of newEvents) {
      for (const sub of subscribers) {
        try {
          await sendDiscordDmForRaidHelperEvent(sub.userId, event);
        } catch (error) {
          console.warn(`[dm] failed for user ${sub.userId}:`, error?.message || error);
        }
      }
      alreadyNotified.add(event.id);
    }
    discordDmSubscribersState.notifiedEventIds = [...alreadyNotified].slice(-600);
    await persistDiscordDmSubscribersStore();
  } catch (error) {
    console.warn("[dm] Raid Helper poll failed:", error?.message || error);
  } finally {
    raidHelperDmPollRunning = false;
  }
}

function startRaidHelperDmNotifier() {
  if (raidHelperDmPollTimer) return;
  if (!canRunRaidHelperDmNotifier()) {
    console.warn(
      "[dm] DM notifier disabled. Set DISCORD_BOT_TOKEN + RAID_HELPER_API_KEY + DISCORD_GUILD_ID (or RAID_HELPER_SERVER_ID)."
    );
    return;
  }
  const intervalMs = raidHelperDmPollIntervalMs();
  runRaidHelperDmPollOnce().catch(() => {});
  raidHelperDmPollTimer = setInterval(() => {
    runRaidHelperDmPollOnce().catch(() => {});
  }, intervalMs);
}

async function persistGargulLootHistory() {
  const tmpPath = `${gargulLootHistoryPath}.tmp`;
  const json = JSON.stringify(gargulLootState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, gargulLootHistoryPath);
}

async function ensureGargulLootHistoryStore() {
  if (gargulLootReady) return gargulLootReady;
  gargulLootReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(gargulLootHistoryPath, "utf8");
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.entries;
      const selected = Array.isArray(parsed?.selectedReportCodes)
        ? parsed.selectedReportCodes.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      gargulLootState = { entries: Array.isArray(list) ? list : [], selectedReportCodes: selected };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      gargulLootState = { entries: [], selectedReportCodes: [] };
      await persistGargulLootHistory();
    }
  })();
  return gargulLootReady;
}

async function persistNetherVortexStore() {
  const tmpPath = `${netherVortexNeedsPath}.tmp`;
  const json = JSON.stringify(netherVortexState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, netherVortexNeedsPath);
}

async function ensureNetherVortexStore() {
  if (netherVortexReady) return netherVortexReady;
  netherVortexReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(netherVortexNeedsPath, "utf8");
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.entries;
      netherVortexState = {
        entries: Array.isArray(list) ? list.filter((row) => row && typeof row === "object") : [],
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      netherVortexState = { entries: [] };
      await persistNetherVortexStore();
    }
  })();
  return netherVortexReady;
}

async function ensureRhWclLinksStore() {
  if (rhWclLinksReady) return rhWclLinksReady;
  rhWclLinksReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(rhWclCharacterLinksPath, "utf8");
      const parsed = JSON.parse(raw);
      rhWclLinksState = {
        links: Array.isArray(parsed?.links)
          ? parsed.links.filter((row) => row && typeof row === "object")
          : [],
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      rhWclLinksState = { links: [] };
      const tmpPath = `${rhWclCharacterLinksPath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(rhWclLinksState, null, 2), "utf8");
      await rename(tmpPath, rhWclCharacterLinksPath);
    }
  })();
  return rhWclLinksReady;
}

async function persistRhWclLinksStore() {
  const tmpPath = `${rhWclCharacterLinksPath}.tmp`;
  const json = JSON.stringify(rhWclLinksState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, rhWclCharacterLinksPath);
}

/** Canonical character roster rows (sorted: unassigned first). Single source with attendance + public `/api/wcl/guild/.../characters`. */
async function getGuildCharacterLinkRows() {
  await ensureRhWclLinksStore();
  return sortRhWclLinkRows(rhWclLinksState.links || []);
}

/** Caps and trims client-submitted Raid Helper ↔ WCL name rows (preserves guess provenance). */
function sanitizeRhWclLinksPayload(rawLinks) {
  const arr = Array.isArray(rawLinks) ? rawLinks : [];
  const links = [];
  for (const row of arr.slice(0, 400)) {
    if (!row || typeof row !== "object") continue;
    const raidHelperName = String(row?.raidHelperName || "").trim().slice(0, 96);
    if (!raidHelperName) continue;
    const rawNames = Array.isArray(row?.wclCharacterNames) ? row.wclCharacterNames : [];
    const rawSources = Array.isArray(row?.wclSources) ? row.wclSources : [];
    const rawConf = Array.isArray(row?.wclGuessConfidence) ? row.wclGuessConfidence : [];
    const names = [];
    const wclSources = [];
    const wclGuessConfidence = [];
    const seenLower = new Set();
    for (let i = 0; i < rawNames.length; i++) {
      const s = String(rawNames[i] || "").trim().slice(0, 64);
      if (!s) continue;
      const low = s.toLowerCase();
      if (seenLower.has(low)) continue;
      seenLower.add(low);
      names.push(s);
      wclSources.push(String(rawSources[i] || "manual").trim().slice(0, 40) || "manual");
      const c = rawConf[i];
      wclGuessConfidence.push(
        typeof c === "number" && Number.isFinite(c) ? Math.max(0, Math.min(100, Math.round(c))) : null
      );
      if (names.length >= 40) break;
    }
    const out = {
      raidHelperName,
      wclCharacterNames: names,
      guildRole: normalizeRhWclGuildRole(row?.guildRole),
    };
    if (wclSources.length) out.wclSources = wclSources;
    if (wclGuessConfidence.some((x) => typeof x === "number")) out.wclGuessConfidence = wclGuessConfidence;
    links.push(out);
  }
  return { links };
}

function chunkPositiveInts(ids, chunkSize) {
  const uniq = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  const size = Math.max(1, chunkSize);
  const out = [];
  for (let i = 0; i < uniq.length; i += size) {
    out.push(uniq.slice(i, i + size));
  }
  return out;
}

/**
 * Builds per-raid attendee sets and display-name map — shared by attendance API and admin helpers.
 * @returns {{
 *   raidSnapshots: Array<{ reportCode: string, startTime: number, attendeesLower: Set<string> }>,
 *   wclDisplayByLower: Map<string, string>,
 *   recentWclReports: Array<{ reportCode: string, startTime: number }>,
 *   raidRankingPayloads: Array<{ mergedDps: object, mergedHps: object }>,
 * }}
 */
async function gatherAttendanceRaidSnapshots(guildId, reportLimit, options = {}) {
  const forAttendancePercent = Boolean(options.attendancePercentMetrics);
  const reports = await getFilteredGuildReportsForGuild(guildId, reportLimit);
  const trackedReports = reports
    .map((report) => {
      const fightIds = (report.fights || [])
        .filter((fight) => {
          if (Number(fight?.encounterID || 0) <= 0) return false;
          const raidKey = resolvedTrackedRaidForFight(fight, report);
          if (!raidKey || !Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, raidKey)) return false;
          if (forAttendancePercent && WCL_ATTENDANCE_EXCLUDED_RAIDS.has(raidKey)) return false;
          return true;
        })
        .map((fight) => Number(fight.id))
        .filter((id) => Number.isInteger(id) && id > 0);
      return { report, fightIds };
    })
    .filter((entry) => entry.fightIds.length > 0);

  if (forAttendancePercent) {
    trackedReports.sort(
      (a, b) => reportStartTimeMs(b.report?.startTime) - reportStartTimeMs(a.report?.startTime)
    );
  }

  const detailCapOpt = options?.maxDetailedReports;
  const detailCap =
    Number.isFinite(Number(detailCapOpt)) && Number(detailCapOpt) > 0
      ? Math.min(100, Math.floor(Number(detailCapOpt)))
      : wclPerReportDetailCap();
  const attendanceRecentCap = forAttendancePercent ? wclAttendanceRecentRaidCount() : Number.POSITIVE_INFINITY;
  const effectiveCap = Math.min(detailCap, attendanceRecentCap);
  const cappedForAttendance = trackedReports.slice(0, effectiveCap);

  const raidSnapshots = [];
  const wclDisplayByLower = new Map();
  const raidRankingPayloads = [];

  const attendanceQuery = `
    query RaidAttendance($code: String!, $fightIds: [Int!]) {
      reportData {
        report(code: $code) {
          dpsRankings: rankings(fightIDs: $fightIds, playerMetric: dps)
          hpsRankings: rankings(fightIDs: $fightIds, playerMetric: hps)
        }
      }
    }
  `;

  for (const { report, fightIds } of cappedForAttendance) {
    const attendeeNamesLower = new Set();
    const dpsParts = [];
    const hpsParts = [];
    for (const chunk of chunkPositiveInts(fightIds, wclMaxFightIdsPerQuery())) {
      const data = await queryWcl(attendanceQuery, { code: report.code, fightIds: chunk });
      const reportFrag = data?.reportData?.report || {};
      dpsParts.push(reportFrag.dpsRankings);
      hpsParts.push(reportFrag.hpsRankings);
      const chunkNames = new Set([
        ...attendeeNamesFromRankings(reportFrag.dpsRankings),
        ...attendeeNamesFromRankings(reportFrag.hpsRankings),
      ]);
      for (const rawName of chunkNames) {
        const trimmed = String(rawName || "").trim();
        if (!trimmed) continue;
        const low = trimmed.toLowerCase();
        attendeeNamesLower.add(low);
        if (!wclDisplayByLower.has(low)) wclDisplayByLower.set(low, trimmed);
      }
    }
    if (!attendeeNamesLower.size) continue;

    raidSnapshots.push({
      reportCode: report.code,
      startTime: Number(report.startTime || 0),
      attendeesLower: attendeeNamesLower,
    });
    if (forAttendancePercent) {
      raidRankingPayloads.push({
        reportCode: String(report.code || ""),
        startTime: Number(report.startTime || 0),
        mergedDps: mergeWclRankingsPayloads(dpsParts),
        mergedHps: mergeWclRankingsPayloads(hpsParts),
      });
    }
  }

  const recentWclReports = raidSnapshots.map((raid) => ({
    reportCode: String(raid.reportCode || ""),
    startTime: Number(raid.startTime || 0),
  }));

  return { raidSnapshots, wclDisplayByLower, recentWclReports, raidRankingPayloads };
}

/** Sum vortex units from craft rows (each item defaults to at least 1). */
function netherVortexUnitsFromItems(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, it) => {
    const v = Number(it?.vortexNeeded ?? 1);
    const n = Number.isFinite(v) ? Math.max(1, Math.min(20, Math.floor(v))) : 1;
    return sum + n;
  }, 0);
}

/** Total Nether Vortex for one guild member: explicit pool + each craft line. */
function netherVortexEntryTotal(row) {
  const pool = Math.max(0, Number(row?.neededCount || 0));
  return pool + netherVortexUnitsFromItems(row?.items);
}

function sanitizeNetherVortexItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((row) => {
      if (typeof row === "string") {
        return { itemName: String(row || "").trim(), profession: "", vortexNeeded: 1 };
      }
      if (!row || typeof row !== "object") return null;
      return {
        itemID: Number(row.itemID || row.itemId || 0),
        itemName: String(row.itemName || row.name || "").trim(),
        profession: String(row.profession || "").trim(),
        vortexNeeded: Number(row.vortexNeeded || row.vortexCount || row.count || row.quantity || 1),
      };
    })
    .map((row) =>
      row
        ? {
            ...row,
            itemID: Number.isFinite(Number(row.itemID)) ? Math.max(0, Number(row.itemID)) : 0,
            vortexNeeded: Number.isFinite(Number(row.vortexNeeded))
              ? Math.max(1, Math.min(20, Math.floor(Number(row.vortexNeeded))))
              : 1,
          }
        : null
    )
    .filter((row) => row && row.itemName)
    .slice(0, 30);
}

/** Wowhead embeds `new Listview({ id: 'reagent-for', data: [...] })` with nested `reagents:[[30183,n],...]` — regex must balance brackets. */
function extractWowheadListviewDataArray(html, listId) {
  const text = String(html || "");
  const needles = [`id:'${listId}'`, `id:"${listId}"`, `id: '${listId}'`, `id: "${listId}"`];
  let pos = -1;
  for (const n of needles) {
    const i = text.indexOf(n);
    if (i >= 0) {
      pos = i;
      break;
    }
  }
  if (pos < 0) return null;
  const dataPos = text.indexOf("data:", pos);
  if (dataPos < 0) return null;
  const start = text.indexOf("[", dataPos);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function netherVortexCountFromWowheadReagents(reagents) {
  const pairs = Array.isArray(reagents) ? reagents : [];
  for (const p of pairs) {
    if (Array.isArray(p) && p.length >= 2 && Number(p[0]) === NETHER_VORTEX_WOW_ITEM_ID) {
      const n = Number(p[1]);
      if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(20, Math.floor(n)));
    }
  }
  return 1;
}

const WOWHEAD_SPELL_SKILL_TO_PROFESSION = {
  164: "Blacksmithing",
  165: "Leatherworking",
  171: "Alchemy",
  197: "Tailoring",
};

function professionFromWowheadSpellRow(row) {
  const sk = Array.isArray(row?.skill) ? row.skill : [];
  for (const sid of sk) {
    const id = Number(sid);
    if (WOWHEAD_SPELL_SKILL_TO_PROFESSION[id]) return WOWHEAD_SPELL_SKILL_TO_PROFESSION[id];
  }
  return String(row?.reqskill || "").trim();
}

function parseWowheadReagentForItems(html) {
  const text = String(html || "");
  const nameToId = new Map();
  const itemDictRx = /"(\d+)":\{"name_enus":"((?:\\.|[^"\\])+)"/g;
  let dictMatch;
  while ((dictMatch = itemDictRx.exec(text))) {
    const maybeId = Number(dictMatch[1] || 0);
    const rawName = String(dictMatch[2] || "");
    const itemName = rawName.replace(/\\"/g, '"').trim();
    if (maybeId > 0 && itemName && !nameToId.has(itemName)) {
      nameToId.set(itemName, maybeId);
    }
  }
  const linkRx = /<a[^>]+href="\/tbc\/item=(\d+)\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRx.exec(text))) {
    const maybeId = Number(linkMatch[1] || 0);
    const itemName = String(linkMatch[2] || "").replace(/&amp;/g, "&").trim();
    if (maybeId > 0 && itemName) {
      nameToId.set(itemName, maybeId);
    }
  }

  const spellRows = extractWowheadListviewDataArray(text, "reagent-for");
  if (Array.isArray(spellRows) && spellRows.length) {
    const fromSpells = spellRows
      .map((row) => {
        const itemName = String(row?.name || "").trim();
        const creates = row?.creates;
        const createdItemId = Array.isArray(creates) && creates.length ? Number(creates[0]) : 0;
        const mappedId = Number(nameToId.get(itemName) || 0);
        const itemID = mappedId > 0 ? mappedId : createdItemId > 0 ? createdItemId : 0;
        const vortexNeeded = netherVortexCountFromWowheadReagents(row?.reagents);
        const profession = professionFromWowheadSpellRow(row);
        return { itemID, itemName, profession, vortexNeeded };
      })
      .filter((row) => row.itemID > 0 && row.itemName)
      .sort((a, b) => a.itemName.localeCompare(b.itemName));
    if (fromSpells.length) return fromSpells;
  }

  const listviewBlocks = [...text.matchAll(/new Listview\(\{([\s\S]*?)\}\);/gi)].map((m) => m?.[1] || "");
  const candidate =
    listviewBlocks.find((block) => /id:\s*['"]reagent[-_]?for['"]/i.test(block)) ||
    listviewBlocks.find((block) => /name:\s*WH\.TERMS\.reagentfor/i.test(block)) ||
    "";
  if (!candidate) return [];
  const dataMatch = candidate.match(/data:\s*(\[[\s\S]*\])\s*$/i) || candidate.match(/data:\s*(\[[\s\S]*?\])\s*,/i);
  if (!dataMatch?.[1]) return [];
  let parsed = [];
  try {
    parsed = JSON.parse(dataMatch[1]);
  } catch {
    const fallback = [];
    const rx = /"id"\s*:\s*(\d+)[\s\S]*?"name"\s*:\s*"((?:\\.|[^"\\])+)"/gi;
    let m;
    while ((m = rx.exec(candidate))) {
      const itemID = Number(m[1] || 0);
      const itemName = String(m[2] || "").replace(/\\"/g, '"').trim();
      if (itemID > 0 && itemName) fallback.push({ itemID, itemName, profession: "", vortexNeeded: 1 });
    }
    return fallback
      .filter((row, idx, arr) => arr.findIndex((x) => x.itemID === row.itemID) === idx)
      .sort((a, b) => a.itemName.localeCompare(b.itemName));
  }
  return parsed
    .map((row) => {
      const itemName = String(row?.name || "").trim();
      const parsedId = Number(row?.id || 0);
      const mappedId = Number(nameToId.get(itemName) || 0);
      const creates = row?.creates;
      const createdItemId = Array.isArray(creates) && creates.length ? Number(creates[0]) : 0;
      const itemID = mappedId > 0 ? mappedId : createdItemId > 0 ? createdItemId : parsedId;
      return {
        itemID,
        itemName,
        profession: professionFromWowheadSpellRow(row) || String(row?.reqskill || "").trim(),
        vortexNeeded: netherVortexCountFromWowheadReagents(row?.reagents),
      };
    })
    .filter((row) => row.itemID > 0 && row.itemName)
    .sort((a, b) => a.itemName.localeCompare(b.itemName));
}

async function normalizeNetherVortexCraftableRows(parsedRows) {
  const normalized = [];
  for (const row of parsedRows || []) {
    let resolvedId = Number(row?.itemID || 0);
    try {
      const byName = await resolveClassicItemIdByName(row?.itemName);
      if (byName > 0) resolvedId = byName;
    } catch {
      // keep Wowhead id
    }
    normalized.push({
      itemID: resolvedId > 0 ? resolvedId : Number(row?.itemID || 0),
      itemName: String(row?.itemName || "").trim(),
      profession: String(row?.profession || "").trim(),
      vortexNeeded: Math.max(1, Math.min(20, Math.floor(Number(row?.vortexNeeded || 1)))),
    });
  }
  return normalized.filter((x) => x.itemID > 0 && x.itemName);
}

async function readNetherVortexCraftablesFallbackPayload() {
  try {
    const raw = await readFile(netherVortexCraftablesFallbackPath, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    const normalized = await normalizeNetherVortexCraftableRows(items);
    return {
      source: "data/nether-vortex-craftables-fallback.json",
      items: normalized,
    };
  } catch {
    return { source: "fallback-missing", items: [] };
  }
}

async function loadNetherVortexCraftablesPayloadFromWowhead() {
  const wowheadRes = await fetch(WOWHEAD_TBC_NETHER_VORTEX_URL, {
    headers: { "User-Agent": "fallen-tacticians-api/1.0 (+nether-vortex-tracker)" },
  });
  if (!wowheadRes.ok) {
    throw new Error(`Failed to fetch Wowhead craftables (${wowheadRes.status})`);
  }
  const html = await wowheadRes.text();
  const items = parseWowheadReagentForItems(html);
  if (!items.length) {
    throw new Error("Could not parse craftable items from Wowhead reagent-for list");
  }
  const normalized = await normalizeNetherVortexCraftableRows(items);
  if (!normalized.length) {
    throw new Error("Wowhead craftables normalized to empty");
  }
  return { source: WOWHEAD_TBC_NETHER_VORTEX_URL, items: normalized };
}

async function loadNetherVortexCraftablesPayload() {
  try {
    return await loadNetherVortexCraftablesPayloadFromWowhead();
  } catch (firstError) {
    const fb = await readNetherVortexCraftablesFallbackPayload();
    if (fb.items.length) return fb;
    throw firstError;
  }
}

function netherVortexCraftableCatalogMaps(catalogItems) {
  const byId = new Map();
  const byNameLower = new Map();
  for (const row of catalogItems || []) {
    const id = Number(row?.itemID || 0);
    if (id > 0) byId.set(id, row);
    const nm = String(row?.itemName || "").trim().toLowerCase();
    if (nm) byNameLower.set(nm, row);
  }
  return { byId, byNameLower };
}

/** Override per-line vortex counts from the TBC craft catalog (Wowhead reagent data). */
function enrichSanitizedNetherVortexItems(items, catalogMaps) {
  const { byId, byNameLower } = catalogMaps;
  return (Array.isArray(items) ? items : []).map((row) => {
    if (!row || typeof row !== "object") return row;
    let cat = null;
    const id = Number(row.itemID || 0);
    if (id > 0) cat = byId.get(id) || null;
    if (!cat) {
      const nm = String(row.itemName || "").trim().toLowerCase();
      if (nm) cat = byNameLower.get(nm) || null;
    }
    const vortexNeeded = cat
      ? Math.max(1, Math.min(20, Math.floor(Number(cat.vortexNeeded || 1))))
      : Math.max(1, Math.min(20, Math.floor(Number(row.vortexNeeded || 1))));
    return {
      ...row,
      itemID: Number.isFinite(id) && id > 0 ? id : Number(row.itemID || 0),
      vortexNeeded,
    };
  });
}

async function getNetherVortexCraftableCatalogMaps() {
  const payload = await getOrRefreshCachedPayload(NETHER_VORTEX_CRAFTABLES_CACHE_KEY, {
    ttlMs: 24 * 3600_000,
    maxStaleMs: 7 * 24 * 3600_000,
    loader: loadNetherVortexCraftablesPayload,
  });
  return netherVortexCraftableCatalogMaps(payload.items);
}

function normalizeGargulItemName(itemLink, fallback) {
  const link = String(itemLink || "").trim();
  const m = link.match(/\[(.+?)\]/);
  const picked = m?.[1] || fallback || "";
  return String(picked || "").trim() || "Unknown item";
}

function normalizeGargulPlayerName(name) {
  return String(name || "")
    .trim()
    .replace(/-.+$/, "");
}

/**
 * Map Gargul award time → WCL report row when the entry has no pinned report code.
 * Uses every report on that calendar day (not just one): pick the raid whose log **start**
 * is the latest still ≤ award time (same-day Kara then SSC → evening Kara loot stays Kara).
 */
function pickRaidRowForGargulTimestamp(timestampMs, reportRowsByDay, reportByCode, pinnedReportCode) {
  const code = String(pinnedReportCode || "").trim();
  const pinned = code ? reportByCode.get(code) || null : null;
  if (pinned) return pinned;

  const dayKey = raidCalendarDayKey(timestampMs);
  const list = dayKey ? reportRowsByDay.get(dayKey) : null;
  if (!list || !list.length) return null;
  if (list.length === 1) return list[0];

  const sorted = [...list].sort(
    (a, b) => reportStartTimeMs(a.reportStartTime) - reportStartTimeMs(b.reportStartTime)
  );
  const t = Number(timestampMs) || 0;

  let chosen = null;
  for (const row of sorted) {
    const start = reportStartTimeMs(row.reportStartTime);
    if (start > 0 && start <= t) chosen = row;
  }
  if (chosen) return chosen;

  return sorted.reduce((best, row) => {
    const da = Math.abs(reportStartTimeMs(row.reportStartTime) - t);
    const db = Math.abs(reportStartTimeMs(best.reportStartTime) - t);
    return da < db ? row : best;
  });
}

function gargulEntryToLootItem(entry, reportRowsByDay, reportByCode) {
  const timestampSec = Number(entry?.timestamp || 0);
  if (!Number.isFinite(timestampSec) || timestampSec <= 0) return null;
  const timestampMs = Math.floor(timestampSec * 1000);
  const dayKey = raidCalendarDayKey(timestampMs);
  const pinnedReportCode = String(entry?.reportCode || "").trim();
  const matchedRaid = pickRaidRowForGargulTimestamp(timestampMs, reportRowsByDay, reportByCode, pinnedReportCode);
  return {
    reportCode: matchedRaid?.reportCode || pinnedReportCode || `gargul-${dayKey || timestampSec}`,
    reportTitle: matchedRaid?.reportTitle || `Gargul Export ${dayKey || "unknown"}`,
    reportRaidName: matchedRaid?.reportRaidName || null,
    reportStartTime: Number(matchedRaid?.reportStartTime || timestampMs),
    itemId: Number(entry?.itemID || 0) > 0 ? Number(entry.itemID) : null,
    itemName: normalizeGargulItemName(entry?.itemLink, entry?.itemName),
    recipient: normalizeGargulPlayerName(entry?.awardedTo),
    rawType: "gargul",
    source: "gargul",
    rollType: String(entry?.winningRollType || ""),
    checksum: String(entry?.checksum || ""),
  };
}

function mergeLootItems(wclItems, gargulItems) {
  const merged = [];
  const seen = new Set();
  for (const row of [...(wclItems || []), ...(gargulItems || [])]) {
    const key = row?.checksum
      ? `checksum:${row.checksum}`
      : `${row?.reportCode || ""}|${row?.itemId || ""}|${row?.itemName || ""}|${row?.recipient || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

function dedupeGargulEntries(entries) {
  const out = [];
  const seen = new Set();
  for (const row of entries || []) {
    if (!row || typeof row !== "object") continue;
    const checksum = String(row?.checksum || "").trim();
    const key = checksum
      ? `checksum:${checksum}`
      : [
          String(row?.reportCode || "").trim(),
          String(row?.timestamp || "").trim(),
          String(row?.itemID || "").trim(),
          String(row?.itemLink || row?.itemName || "").trim().toLowerCase(),
          String(row?.awardedTo || "").trim().toLowerCase(),
        ].join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

// Explicit page routes keep frontend reachable in all environments.
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/home.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "home.html"));
});

app.get("/landing.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "landing.html"));
});

app.get("/events.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "events.html"));
});

app.get("/roster.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "roster.html"));
});

app.get(["/roster", "/roster/"], (_req, res) => {
  res.redirect(302, "/roster.html");
});

app.get("/voting.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "voting.html"));
});

app.get("/p2-preparation.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "p2-preparation.html"));
});

app.get("/loot-history.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "loot-history.html"));
});

app.get("/nether-vortex.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "nether-vortex.html"));
});

app.get("/privacy.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "privacy.html"));
});

app.get("/imprint.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "imprint.html"));
});

app.get("/auth/discord/login", (req, res) => {
  if (!discordClientId || !discordClientSecret) {
    return res
      .status(503)
      .type("html")
      .send(
        discordAuthHelpHtml("Discord login unavailable", [
          "<strong>Discord OAuth is not configured.</strong>",
          "Add <code>DISCORD_CLIENT_ID</code> and <code>DISCORD_CLIENT_SECRET</code> to your environment (see <code>.env.example</code>), restart the server, and try again.",
        ])
      );
  }
  pruneAuthMaps();
  const state = randomBytes(18).toString("hex");
  const next = String(req.query.next || "/voting.html");
  oauthStates.set(state, { expiresAt: Date.now() + oauthStateTtlMs, next });

  const qs = new URLSearchParams({
    client_id: discordClientId,
    redirect_uri: discordRedirectUri,
    response_type: "code",
    scope: "identify guilds",
    state,
    prompt: "consent",
  });
  return res.redirect(`https://discord.com/oauth2/authorize?${qs.toString()}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const state = String(req.query.state || "");
    const code = String(req.query.code || "");
    const stateRow = oauthStates.get(state);
    oauthStates.delete(state);
    if (!stateRow || stateRow.expiresAt <= Date.now()) {
      return res.status(400).send("Discord login state expired. Please try again.");
    }
    if (!code) {
      return res.status(400).send("Missing Discord authorization code.");
    }

    const tokenRes = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: discordClientId,
        client_secret: discordClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: discordRedirectUri,
      }),
    });
    const tokenPayload = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenPayload?.access_token) {
      const err = String(tokenPayload?.error || "");
      const desc = String(tokenPayload?.error_description || "").replace(/\+/g, " ");
      console.warn("[auth] Discord token exchange failed:", err || tokenRes.status, desc);
      const lines = [
        "<strong>Discord token exchange failed.</strong>",
        `Callback URL registered on this server: <code>${discordRedirectUri}</code>`,
        "In the Discord Developer Portal → OAuth2 → Redirects, add that URL <em>exactly</em> (same scheme, host, port, path). Register both <code>http://localhost:8787/auth/discord/callback</code> and <code>http://127.0.0.1:8787/auth/discord/callback</code> if you switch between them.",
        "Set <code>PUBLIC_BASE_URL</code> (or <code>DISCORD_REDIRECT_URI</code>) so it matches the URL you use in the Portal.",
      ];
      if (err === "invalid_grant" || desc.toLowerCase().includes("redirect")) {
        lines.push("Error from Discord often means <code>redirect_uri</code> mismatch.");
      }
      if (desc) {
        const safe = desc.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        lines.push(`Discord said: <code>${safe}</code>`);
      }
      return res.status(401).type("html").send(discordAuthHelpHtml("Discord login failed", lines));
    }

    const accessToken = tokenPayload.access_token;
    const me = await fetchDiscordJson("/users/@me", accessToken);
    const guilds = await fetchDiscordJson("/users/@me/guilds", accessToken);
    const inGuild =
      discordSkipGuildCheck ||
      !discordGuildId ||
      (Array.isArray(guilds) && guilds.some((g) => String(g?.id || "") === discordGuildId));
    if (discordSkipGuildCheck && discordGuildId) {
      console.warn("[auth] DISCORD_SKIP_GUILD_CHECK=1 — guild membership was not verified (development only).");
    }
    if (!inGuild) {
      const lines = [
        "<strong>This Discord account is not in the guild required by this app.</strong>",
        `Expected guild id: <code>${discordGuildId || "(not set)"}</code>`,
        "Join the server with this Discord account, or fix <code>DISCORD_GUILD_ID</code> / <code>RAID_HELPER_SERVER_ID</code> in your environment.",
      ];
      if (!isProd) {
        lines.push(
          "Local testing only: set <code>DISCORD_SKIP_GUILD_CHECK=1</code> in <code>.env</code> to bypass this check (never use in production)."
        );
      }
      return res.status(403).type("html").send(discordAuthHelpHtml("Discord — not in guild", lines));
    }

    const sessionId = randomBytes(24).toString("hex");
    authSessions.set(sessionId, {
      user: {
        id: String(me.id || ""),
        username: String(me.username || ""),
        discriminator: String(me.discriminator || ""),
        globalName: String(me.global_name || ""),
        avatar: String(me.avatar || ""),
      },
      guildId: discordGuildId,
      expiresAt: Date.now() + sessionTtlMs,
    });
    res.setHeader("Set-Cookie", serializeSessionCookie(sessionId, sessionTtlMs / 1000));
    return res.redirect(stateRow.next || "/voting.html");
  } catch (error) {
    return res.status(500).send(`Discord login failed: ${error.message || "unknown error"}`);
  }
});

app.post("/auth/logout", (req, res) => {
  const current = getSessionFromRequest(req);
  if (current?.sessionId) authSessions.delete(current.sessionId);
  res.setHeader("Set-Cookie", serializeSessionCookie("expired", 0));
  return res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.json({ authenticated: false, isAdmin: false });
  }
  return res.json({
    authenticated: true,
    isAdmin: isP2Editor(session),
    user: session.user,
    guildId: session.guildId || null,
  });
});

app.get("/api/join/dm-subscription", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session?.user?.id) {
      return res.json({ ok: true, authenticated: false, subscribed: false });
    }
    await ensureDiscordDmSubscribersStore();
    const userId = String(session.user.id || "").trim();
    const row = discordDmSubscribersState.subscribersByUserId[userId];
    return res.json({
      ok: true,
      authenticated: true,
      subscribed: Boolean(row?.subscribed),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load DM subscription state" });
  }
});

app.put("/api/join/dm-subscription", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session?.user?.id) {
      return res.status(401).json({ ok: false, error: "Login required" });
    }
    const subscribed = req.body?.subscribed !== false;
    const row = await setDiscordDmSubscriptionForSessionUser(session, subscribed);
    return res.json({ ok: true, subscribed: Boolean(row?.subscribed) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to save DM subscription" });
  }
});

app.get("/api/admin/health", (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) {
    return res.status(401).json({ ok: false, error: "Login required" });
  }
  return res.json({
    ok: true,
    authenticated: true,
    ...p2EditorDebug(session),
  });
});

app.get("/api/auth/config", (_req, res) => {
  if (isProd) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.json({
    discordClientIdConfigured: Boolean(discordClientId),
    discordClientSecretConfigured: Boolean(discordClientSecret),
    discordGuildIdConfigured: Boolean(discordGuildId),
    discordRedirectUri,
    publicBaseUrl,
  });
});

app.get("/api/p2-preparation/materials", async (req, res) => {
  try {
    await ensureP2MaterialsStore();
    const session = getSessionFromRequest(req);
    return res.json({
      ok: true,
      canEdit: isP2Editor(session),
      materials: getP2MaterialsRows(),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load materials" });
  }
});

app.get("/api/join/current-needs", async (_req, res) => {
  try {
    await ensureJoinNeedsStore();
    return res.json({ ok: true, rows: joinNeedsState.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load current needs" });
  }
});

app.get("/api/admin/join/current-needs", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    await ensureJoinNeedsStore();
    return res.json({ ok: true, rows: joinNeedsState.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load admin current needs" });
  }
});

app.put("/api/admin/join/current-needs", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const rows = sanitizeJoinNeedsRows(req.body?.rows);
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "At least one valid row is required" });
    }
    await ensureJoinNeedsStore();
    joinNeedsWriteChain = joinNeedsWriteChain.catch(() => {}).then(async () => {
      joinNeedsState.rows = rows;
      await persistJoinNeedsStore();
    });
    await joinNeedsWriteChain;
    return res.json({ ok: true, rows: joinNeedsState.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to save current needs" });
  }
});

app.get("/api/nether-vortex/needs", async (req, res) => {
  try {
    await ensureNetherVortexStore();
    const session = getSessionFromRequest(req);
    const userId = String(session?.user?.id || "").trim();
    let catalogMaps = { byId: new Map(), byNameLower: new Map() };
    try {
      catalogMaps = await getNetherVortexCraftableCatalogMaps();
    } catch {
      // Still return rows; per-line counts fall back to stored values.
    }
    const rows = [...(netherVortexState.entries || [])]
      .map((row) => ({
        userId: String(row.userId || ""),
        displayName: String(row.displayName || "Unknown"),
        neededCount: Math.max(0, Number(row.neededCount || 0)),
        items: enrichSanitizedNetherVortexItems(sanitizeNetherVortexItems(row.items), catalogMaps),
        updatedAt: Number(row.updatedAt || 0),
      }))
      .filter((row) => row.userId)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    const myEntry = userId ? rows.find((row) => row.userId === userId) || null : null;
    const totalNeeded = rows.reduce((sum, row) => sum + netherVortexEntryTotal(row), 0);
    return res.json({
      ok: true,
      authenticated: Boolean(userId),
      entries: rows,
      myEntry,
      totalNeeded,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load Nether Vortex tracker" });
  }
});

app.get("/api/nether-vortex/craftables", async (_req, res) => {
  try {
    const payload = await getOrRefreshCachedPayload(NETHER_VORTEX_CRAFTABLES_CACHE_KEY, {
      ttlMs: 24 * 3600_000,
      maxStaleMs: 7 * 24 * 3600_000,
      loader: loadNetherVortexCraftablesPayload,
    });
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load craftable items" });
  }
});

app.put("/api/nether-vortex/needs/my", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session?.user?.id) {
      return res.status(401).json({ ok: false, error: "Login required" });
    }
    const neededCountRaw = Number(req.body?.neededCount);
    const neededCount = Number.isFinite(neededCountRaw) ? Math.max(0, Math.floor(neededCountRaw)) : 0;
    let items = sanitizeNetherVortexItems(req.body?.items);
    try {
      const catalogMaps = await getNetherVortexCraftableCatalogMaps();
      items = enrichSanitizedNetherVortexItems(items, catalogMaps);
    } catch {
      // Catalog unavailable — persist sanitized rows only.
    }
    await ensureNetherVortexStore();
    // Recover from a prior rejected persist so the queue does not stay broken forever.
    netherVortexWriteChain = netherVortexWriteChain.catch(() => {}).then(async () => {
      const userId = String(session.user.id || "");
      const displayName = String(session.user.globalName || session.user.username || "Unknown");
      const nextEntry = { userId, displayName, neededCount, items, updatedAt: Date.now() };
      const prev = netherVortexState.entries || [];
      const idx = prev.findIndex((row) => String(row?.userId || "") === userId);
      if (idx >= 0) prev[idx] = nextEntry;
      else prev.push(nextEntry);
      netherVortexState.entries = prev;
      await persistNetherVortexStore();
    });
    await netherVortexWriteChain;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to save Nether Vortex need" });
  }
});

app.put("/api/p2-preparation/materials/current", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!isP2Editor(session)) {
      return res.status(403).json({ ok: false, error: "Only authorized editor can update current values" });
    }
    const materialId = String(req.body?.id || "").trim();
    const current = Number(req.body?.current);
    if (!materialId || !Number.isFinite(current) || current < 0) {
      return res.status(400).json({ ok: false, error: "id and non-negative current are required" });
    }
    await setP2MaterialCurrent(materialId, current);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to update material" });
  }
});

app.get("/api/loot-history/gargul", async (_req, res) => {
  try {
    const session = requireAdminSession(_req, res);
    if (!session) return;
    await ensureGargulLootHistoryStore();
    return res.json({
      ok: true,
      entries: gargulLootState.entries.length,
      rows: gargulLootState.entries,
      selectedReportCodes: gargulLootState.selectedReportCodes || [],
      lastTimestamp: gargulLootState.entries.reduce((max, row) => Math.max(max, Number(row?.timestamp || 0)), 0),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to read Gargul store" });
  }
});

app.post("/api/loot-history/gargul/import", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const payload = req.body;
    const entries = Array.isArray(payload) ? payload : payload?.entries;
    const reportCode = String(payload?.reportCode || "").trim();
    if (!Array.isArray(entries)) {
      return res.status(400).json({ ok: false, error: "Body must be a JSON array or { entries: [...] }" });
    }
    const sanitized = entries
      .filter((row) => row && typeof row === "object")
      .map((row) => ({ ...row, ...(reportCode ? { reportCode } : {}) }));
    await ensureGargulLootHistoryStore();
    gargulLootWriteChain = gargulLootWriteChain.then(async () => {
      gargulLootState.entries = dedupeGargulEntries([...(gargulLootState.entries || []), ...sanitized]);
      await persistGargulLootHistory();
      await invalidateLootHistoryCacheEntries();
    });
    await gargulLootWriteChain;
    return res.json({ ok: true, imported: sanitized.length, total: gargulLootState.entries.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to import Gargul loot history" });
  }
});

app.put("/api/loot-history/gargul/entries", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
    if (!entries) {
      return res.status(400).json({ ok: false, error: "Body must be { entries: [...] }" });
    }
    const sanitized = entries.filter((row) => row && typeof row === "object");
    await ensureGargulLootHistoryStore();
    gargulLootWriteChain = gargulLootWriteChain.then(async () => {
      gargulLootState.entries = sanitized;
      await persistGargulLootHistory();
      await invalidateLootHistoryCacheEntries();
    });
    await gargulLootWriteChain;
    return res.json({ ok: true, saved: sanitized.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to save Gargul entries" });
  }
});

app.put("/api/loot-history/events/selection", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const selected = Array.isArray(req.body?.reportCodes) ? req.body.reportCodes : null;
    if (!selected) {
      return res.status(400).json({ ok: false, error: "Body must be { reportCodes: [] }" });
    }
    const sanitized = selected.map((x) => String(x || "").trim()).filter(Boolean);
    await ensureGargulLootHistoryStore();
    gargulLootWriteChain = gargulLootWriteChain.then(async () => {
      gargulLootState.selectedReportCodes = [...new Set(sanitized)];
      await persistGargulLootHistory();
      await invalidateLootHistoryCacheEntries();
    });
    await gargulLootWriteChain;
    return res.json({ ok: true, selected: gargulLootState.selectedReportCodes.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to save event selection" });
  }
});

app.get("/api/admin/rh-wcl-links", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const links = await getGuildCharacterLinkRows();
    return res.json({ ok: true, links });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load Raid Helper ↔ WCL links" });
  }
});

app.put("/api/admin/rh-wcl-links", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const sanitized = sanitizeRhWclLinksPayload(req.body?.links);
    const sorted = { links: sortRhWclLinkRows(sanitized.links) };
    await ensureRhWclLinksStore();
    rhWclLinksWriteChain = rhWclLinksWriteChain.then(async () => {
      rhWclLinksState = sorted;
      await persistRhWclLinksStore();
    });
    await rhWclLinksWriteChain;
    return res.json({ ok: true, saved: sorted.links.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to save Raid Helper ↔ WCL links" });
  }
});

/** Clear the entire character roster on disk (admin only). */
app.delete("/api/admin/rh-wcl-links", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    await ensureRhWclLinksStore();
    rhWclLinksWriteChain = rhWclLinksWriteChain.then(async () => {
      rhWclLinksState = { links: [] };
      await persistRhWclLinksStore();
    });
    await rhWclLinksWriteChain;
    return res.json({ ok: true, links: [], deleted: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to delete Raid Helper ↔ WCL links" });
  }
});

/** Upsert one link row (merge into store by normalized Raid Helper key). Body matches one row + optional `previousRaidHelperName` when renaming the signup column. */
app.put("/api/admin/rh-wcl-links/row", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    await ensureRhWclLinksStore();

    const sanitized = sanitizeRhWclLinksPayload([req.body]);
    const row = sanitized.links[0];
    if (!row?.raidHelperName) {
      return res.status(400).json({ ok: false, error: "raidHelperName is required" });
    }

    const newKey = normalizeRaidHelperDisplayKey(row.raidHelperName);
    const prevRaw = String(req.body?.previousRaidHelperName ?? "").trim();
    const prevKey = prevRaw ? normalizeRaidHelperDisplayKey(prevRaw) : "";

    const keysToRemove = new Set([newKey]);
    if (prevKey && prevKey !== newKey) keysToRemove.add(prevKey);

    const prevLinks = rhWclLinksState.links || [];
    const filtered = prevLinks.filter((r) => !keysToRemove.has(normalizeRaidHelperDisplayKey(r.raidHelperName)));
    filtered.push(row);
    const sortedLinks = sortRhWclLinkRows(filtered);

    rhWclLinksWriteChain = rhWclLinksWriteChain.then(async () => {
      rhWclLinksState = { links: sortedLinks };
      await persistRhWclLinksStore();
    });
    await rhWclLinksWriteChain;

    return res.json({ ok: true, links: sortRhWclLinkRows(rhWclLinksState.links || []) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to save row" });
  }
});

/**
 * Heuristic merge: Raid Helper signup names × recent WCL log characters (admin-only).
 * Body JSON (optional): `{ raidHelperNames?: string[], guildId?: number, minScore?: number, apply?: boolean }`
 * — if `raidHelperNames` omitted, names are pulled from Raid Helper API (`RAID_HELPER_API_KEY` + `RAID_HELPER_SERVER_ID` or `DISCORD_GUILD_ID`).
 * Set `apply: true` to persist merged links immediately (otherwise preview only).
 */
app.post("/api/admin/rh-wcl-links/guess", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const guildId = Number(req.query.guildId || req.body?.guildId || votingGuildId);
    const wclReportsToDetail = rhWclLinkWclReportDetailCount();
    const reportLimit = Math.min(
      wclMaxGuildReportsLimit(),
      Math.max(wclReportsToDetail + 24, Number(req.query.limit || req.body?.limit || 40))
    );
    const minScoreRaw = Number(req.body?.minScore ?? req.query.minScore ?? 72);
    const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : 72;
    const serverId = raidHelperDiscordGuildId();
    const raidHelperApiKey = String(process.env.RAID_HELPER_API_KEY || "").trim();

    if (!Number.isInteger(guildId) || guildId <= 0) {
      return res.status(400).json({ ok: false, error: "guildId must be a positive integer" });
    }

    let wclCharacterNames = [];
    let recentWarcraftLogsReports = [];
    try {
      const { wclDisplayByLower, recentWclReports } = await gatherAttendanceRaidSnapshots(guildId, reportLimit, {
        maxDetailedReports: wclReportsToDetail,
      });
      wclCharacterNames = [...wclDisplayByLower.values()];
      recentWarcraftLogsReports = Array.isArray(recentWclReports) ? recentWclReports : [];
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: `Warcraft Logs attendance snapshot failed: ${String(error?.message || error).slice(0, 220)}`,
      });
    }

    let recentRaidHelperEvents = [];

    let raidHelperNames = Array.isArray(req.body?.raidHelperNames)
      ? req.body.raidHelperNames.map((x) => String(x || "").trim()).filter(Boolean)
      : null;

    let raidHelperSource = "none";
    let raidHelperFetchError = "";

    if (raidHelperNames?.length) {
      raidHelperSource = "request_body";
    } else if (serverId && raidHelperApiKey) {
      try {
        const collected = await collectRaidHelperSignupDisplayNames(serverId, rhWclLinkRaidHelperEventScanCount());
        raidHelperNames = collected.names;
        recentRaidHelperEvents = collected.scannedEvents || [];
        raidHelperSource = raidHelperNames?.length ? "raid_helper_api" : "raid_helper_api_empty";
      } catch (error) {
        raidHelperNames = [];
        raidHelperFetchError = String(error?.message || error).slice(0, 200);
        raidHelperSource = "raid_helper_api_error";
      }
    } else {
      raidHelperNames = raidHelperNames || [];
      raidHelperSource = !raidHelperApiKey ? "missing_raid_helper_api_key" : "missing_raid_helper_server_id";
    }

    if (!raidHelperNames?.length) {
      if (wclCharacterNames.length > 0) {
        return res.status(400).json({
          ok: false,
          error:
            "Raid Helper returned no signup names. Set RAID_HELPER_API_KEY and DISCORD_GUILD_ID (or RAID_HELPER_SERVER_ID), ensure recent posted events have signups, or POST { raidHelperNames: [...] }. Log characters are matched only onto Raid Helper names — they are not used as the left column.",
          raidHelperSource,
          raidHelperFetchError: raidHelperFetchError || undefined,
          wclNameCount: wclCharacterNames.length,
        });
      }
      return res.status(400).json({
        ok: false,
        error:
          "No Raid Helper signups and no Warcraft Logs names — check Raid Helper / WCL keys, guild reports, or POST { raidHelperNames: [...] }.",
        raidHelperSource,
        raidHelperFetchError: raidHelperFetchError || undefined,
      });
    }

    await ensureRhWclLinksStore();
    const existing = rhWclLinksState.links || [];
    const { links, stats } = mergeRhWclGuess(existing, raidHelperNames, wclCharacterNames, {
      minScore,
      orphanMinScore: rhWclOrphanGuessMinScore(),
      keepEmptyRaidHelperRows: true,
    });

    const apply = Boolean(req.body?.apply);
    if (apply) {
      rhWclLinksWriteChain = rhWclLinksWriteChain.then(async () => {
        rhWclLinksState = { links };
        await persistRhWclLinksStore();
      });
      await rhWclLinksWriteChain;
    }

    return res.json({
      ok: true,
      links,
      recentRaidHelperEvents,
      recentWarcraftLogsReports,
      stats: {
        ...stats,
        raidHelperSource,
        raidHelperFetchError: raidHelperFetchError || undefined,
        wclNameCount: wclCharacterNames.length,
        raidHelperSignupCount: raidHelperNames.length,
        raidHelperEventsScanLimit: rhWclLinkRaidHelperEventScanCount(),
        wclReportsDetailLimit: wclReportsToDetail,
      },
      applied: apply,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Guess merge failed" });
  }
});

/** Character names seen in recent tracked-raid reports (for mapping alts to Raid Helper signups). Admin only. */
app.get("/api/admin/wcl-attendee-names", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const guildId = Number(req.query.guildId || votingGuildId);
    const wclReportsToDetail = rhWclLinkWclReportDetailCount();
    const reportLimit = Math.min(
      wclMaxGuildReportsLimit(),
      Math.max(wclReportsToDetail + 24, Number(req.query.limit || 40))
    );
    if (!Number.isInteger(guildId) || guildId <= 0) {
      return res.status(400).json({ ok: false, error: "guildId must be a positive integer" });
    }
    const { wclDisplayByLower, recentWclReports } = await gatherAttendanceRaidSnapshots(guildId, reportLimit, {
      maxDetailedReports: wclReportsToDetail,
    });
    const characterNames = [...wclDisplayByLower.values()].sort((a, b) => a.localeCompare(b));
    return res.json({
      ok: true,
      guildId,
      characterNames,
      count: characterNames.length,
      wclReportsDetailLimit: wclReportsToDetail,
      recentWarcraftLogsReports: Array.isArray(recentWclReports) ? recentWclReports : [],
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load Warcraft Logs character names" });
  }
});

app.get("/api/voting/hall-of-fame", async (_req, res) => {
  try {
    const hallOfFame = await getHallOfFameForGuild(votingGuildId, 10);
    return res.json({ ok: true, hallOfFame });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load hall of fame" });
  }
});

app.get("/api/voting/current", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session?.user?.id) {
      return res.status(401).json({ ok: false, error: "Login required" });
    }

    const voting = await getCurrentVotingRoundCached(votingGuildId);
    if (!voting) {
      return res.status(404).json({ ok: false, error: "No recent tracked raid found" });
    }

    await ensureVotingStore();
    const votesByCandidate = getVotingTallies(voting.roundKey);
    const myVoteRow = getUserVote(voting.roundKey, String(session.user.id));

    const candidates = voting.candidates
      .map((c) => ({
        ...c,
        votes: Number(votesByCandidate.get(c.name) || 0),
      }))
      .sort((a, b) => b.votes - a.votes || b.dps - a.dps || a.name.localeCompare(b.name));

    return res.json({
      ok: true,
      raid: {
        roundKey: voting.roundKey,
        code: voting.raidCode,
        name: voting.raidName,
        title: voting.title,
        startTime: voting.startTime,
      },
      myVote: myVoteRow?.candidateName || null,
      candidates,
      hallOfFame: await getHallOfFameForGuild(votingGuildId, 10),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load voting round" });
  }
});

app.post("/api/voting/vote", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session?.user?.id) {
      return res.status(401).json({ ok: false, error: "Login required" });
    }

    const candidateName = String(req.body?.candidateName || "").trim();
    if (!candidateName) {
      return res.status(400).json({ ok: false, error: "candidateName is required" });
    }

    const voting = await getCurrentVotingRoundCached(votingGuildId);
    if (!voting) {
      return res.status(404).json({ ok: false, error: "No recent tracked raid found" });
    }

    const candidate = voting.candidates.find((c) => c.name.toLowerCase() === candidateName.toLowerCase());
    if (!candidate) {
      return res.status(400).json({ ok: false, error: "Candidate is not in the latest raid roster" });
    }

    await upsertVote({
      roundKey: voting.roundKey,
      raidCode: voting.raidCode,
      raidStartTime: voting.startTime,
      userId: String(session.user.id),
      candidateName: candidate.name,
    });

    return res.json({ ok: true, roundKey: voting.roundKey, candidateName: candidate.name });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to submit vote" });
  }
});

function parseWclTable(tableValue) {
  if (!tableValue) return null;
  try {
    const parsed = typeof tableValue === "string" ? JSON.parse(tableValue) : tableValue;
    // WCL may return table payload either as { entries: [...] } or { data: { entries: [...] } }.
    if (parsed?.data && !parsed?.entries) {
      return parsed.data;
    }
    return parsed;
  } catch {
    return null;
  }
}

function topFromTable(table, key = "total") {
  const entries = table?.entries || [];
  if (!entries.length) return null;
  return [...entries].sort((a, b) => (b?.[key] || 0) - (a?.[key] || 0))[0];
}

function normalizeFightEntry(entry) {
  if (!entry) return null;
  return {
    name: entry.name || "Unknown",
    type: entry.type || "N/A",
    total: Number(entry.total || 0),
    icon: entry.icon || null,
    id: entry.id || null,
  };
}

function deathCountFromEntry(entry) {
  const candidates = [entry?.deaths, entry?.total, entry?.count, entry?.value];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  // For Deaths tables, each entry can represent a single death event.
  if (entry && Object.prototype.hasOwnProperty.call(entry, "timestamp")) {
    return 1;
  }
  return 0;
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** WCL rankings JSON often exposes parse as `percentile` or `rank.percentile`, not `rankPercent`. */
function wclRankingEntryPercentile(entry) {
  if (!entry || typeof entry !== "object") return null;
  const a = Number(entry.rankPercent);
  if (Number.isFinite(a)) return a;
  const b = Number(entry.percentile);
  if (Number.isFinite(b)) return b;
  const rk = entry.rank;
  if (rk && typeof rk === "object") {
    const c = Number(rk.percentile ?? rk.rankPercent);
    if (Number.isFinite(c)) return c;
  }
  return null;
}

function wclRankingCharacterDisplayName(entry) {
  if (!entry || typeof entry !== "object") return "";
  const n = String(entry.name || "").trim();
  if (n) return n;
  const ch = entry.character;
  if (ch && typeof ch === "object") return String(ch.name || "").trim();
  return "";
}

function fightCharactersForRole(fight, roleKeyPlural) {
  const roles = fight?.roles;
  if (!roles || typeof roles !== "object") return [];
  let bucket = roles[roleKeyPlural];
  if (!bucket?.characters) {
    if (roleKeyPlural === "tanks") bucket = roles.tank;
    else if (roleKeyPlural === "healers") bucket = roles.healer;
  }
  const chars = bucket?.characters;
  return Array.isArray(chars) ? chars : [];
}

function collectRankPercents(node, targetName, bucket) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectRankPercents(item, targetName, bucket);
    return;
  }
  if (typeof node !== "object") return;

  const tl = String(targetName || "").toLowerCase();
  const nm = wclRankingCharacterDisplayName(node).toLowerCase();
  if (nm && nm === tl) {
    const pct = wclRankingEntryPercentile(node);
    if (pct != null) bucket.push(pct);
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      collectRankPercents(value, targetName, bucket);
    }
  }
}

function averageRankPercent(rankingsPayload, playerName) {
  const parsed = parseMaybeJson(rankingsPayload);
  if (!parsed || !playerName) return null;
  const values = [];
  collectRankPercents(parsed, playerName, values);
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/** Best fight for `playerName` by scanning each fight subtree (when role-based {@link bestRoleParse} misses). */
function bestFightParseDeepInPayload(rankingsPayload, playerName) {
  const parsed = parseMaybeJson(rankingsPayload);
  const fights = Array.isArray(parsed?.data) ? parsed.data : [];
  if (!playerName || !fights.length) return null;
  let best = null;
  for (const fight of fights) {
    const bucket = [];
    collectRankPercents(fight, playerName, bucket);
    if (!bucket.length) continue;
    const mx = Math.max(...bucket);
    if (!best || mx > best.rankPercent) {
      best = {
        rankPercent: mx,
        bossName: fight?.encounter?.name || fight?.name || "Unknown boss",
        fightId: fight?.fightID ?? fight?.id ?? null,
      };
    }
  }
  return best;
}

function averageRoleRankPercent(rankingsPayload, roleKey, playerName) {
  const parsed = parseMaybeJson(rankingsPayload);
  if (!parsed || !playerName) return null;
  const fights = Array.isArray(parsed?.data) ? parsed.data : [];
  const values = [];
  const pl = String(playerName).toLowerCase();
  for (const fight of fights) {
    const characters = fightCharactersForRole(fight, roleKey);
    const match = characters.find((entry) => wclRankingCharacterDisplayName(entry).toLowerCase() === pl);
    const pct = match ? wclRankingEntryPercentile(match) : null;
    if (pct != null) values.push(pct);
  }
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function bestRoleParse(rankingsPayload, roleKey, playerName) {
  const parsed = parseMaybeJson(rankingsPayload);
  if (!parsed || !playerName) return null;
  const fights = Array.isArray(parsed?.data) ? parsed.data : [];
  const pl = String(playerName).toLowerCase();

  let best = null;
  for (const fight of fights) {
    const characters = fightCharactersForRole(fight, roleKey);
    const match = characters.find((entry) => wclRankingCharacterDisplayName(entry).toLowerCase() === pl);
    const pct = match ? wclRankingEntryPercentile(match) : null;
    if (pct == null) continue;

    if (!best || pct > best.rankPercent) {
      best = {
        rankPercent: pct,
        bossName: fight?.encounter?.name || fight?.name || "Unknown boss",
        fightId: fight?.fightID ?? fight?.id ?? null,
      };
    }
  }
  return best;
}

function attendeeNamesFromRankings(rankingsPayload) {
  const parsed = parseMaybeJson(rankingsPayload);
  const fights = Array.isArray(parsed?.data) ? parsed.data : [];
  const names = new Set();
  for (const fight of fights) {
    for (const roleKey of ["tanks", "healers", "dps"]) {
      const chars = fightCharactersForRole(fight, roleKey);
      for (const char of chars) {
        const name = wclRankingCharacterDisplayName(char);
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/** Matches Events page `rosterNameKey` — Raid Helper display vs WCL character names. */
function normalizeRaidHelperDisplayKey(name) {
  let s = String(name || "")
    .trim()
    .replace(/\u00a0/g, " ");
  const slash = s.indexOf("/");
  if (slash > 0) s = s.slice(0, slash).trim();
  return s
    .replace(/\s*[-–—]\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-\s]*$/u, "")
    .toLowerCase();
}

function debugRankingsCharacterMatches(displayNameRaw, searchRaw) {
  const dn = String(displayNameRaw || "").trim().toLowerCase();
  const sn = String(searchRaw || "").trim().toLowerCase();
  if (dn && sn && dn === sn) return true;
  const kd = normalizeRaidHelperDisplayKey(displayNameRaw);
  const ks = normalizeRaidHelperDisplayKey(searchRaw);
  return Boolean(kd && ks && kd === ks);
}

/** Dev probe: pull merged rankings payload apart for one character name (strict + Raid-Helper-style key match). */
function debugRankingsProbe(mergedPayload, searchName) {
  const parsed = parseMaybeJson(mergedPayload);
  const fights = Array.isArray(parsed?.data) ? parsed.data : [];
  const samplesFirstFight = [];
  const hitsStrict = [];
  const hitsNormalized = [];

  if (fights[0]?.roles && typeof fights[0].roles === "object") {
    for (const roleKey of Object.keys(fights[0].roles)) {
      const chars = fights[0].roles[roleKey]?.characters;
      if (!Array.isArray(chars)) continue;
      for (let i = 0; i < Math.min(chars.length, 8); i++) {
        const entry = chars[i];
        samplesFirstFight.push({
          roleKey,
          displayName: wclRankingCharacterDisplayName(entry),
          percentileResolved: wclRankingEntryPercentile(entry),
          rankPercentRaw: entry?.rankPercent,
          percentileRaw: entry?.percentile,
          rankObjectKeys:
            entry?.rank && typeof entry.rank === "object" ? Object.keys(entry.rank).slice(0, 12) : [],
          entryKeys: entry && typeof entry === "object" ? Object.keys(entry).slice(0, 18) : [],
        });
      }
    }
  }

  for (let fi = 0; fi < fights.length; fi++) {
    const fight = fights[fi];
    const encounterName = fight?.encounter?.name || fight?.name || "";
    const roles = fight?.roles || {};
    for (const roleKey of Object.keys(roles)) {
      const chars = roles[roleKey]?.characters;
      if (!Array.isArray(chars)) continue;
      for (const entry of chars) {
        const disp = wclRankingCharacterDisplayName(entry);
        const pct = wclRankingEntryPercentile(entry);
        const payload = {
          fightIndex: fi,
          encounterName,
          roleKey,
          displayName: disp,
          percentileResolved: pct,
        };
        if (disp && disp.toLowerCase() === String(searchName || "").trim().toLowerCase()) {
          hitsStrict.push(payload);
        } else if (disp && debugRankingsCharacterMatches(disp, searchName)) {
          hitsNormalized.push(payload);
        }
      }
    }
  }

  return {
    fightCount: fights.length,
    samplesFirstFight,
    hitsStrictNameMatch: hitsStrict,
    hitsNormalizedKeyMatch: hitsNormalized,
    averageRoleTank: averageRoleRankPercent(mergedPayload, "tanks", searchName),
    averageRoleHealer: averageRoleRankPercent(mergedPayload, "healers", searchName),
    averageRoleDps: averageRoleRankPercent(mergedPayload, "dps", searchName),
    treeAveragePercentile: averageRankPercent(mergedPayload, searchName),
  };
}

/**
 * One raid log: best single-encounter percentile for role bracket among linked names.
 * Uses {@link bestRoleParse} per boss (true max encounter), then per-name fight-tree fallback — not an average.
 */
function bracketParseBestEncounterOneRaidDetailed(mergedDps, mergedHps, bracketKey, names) {
  let best = null;
  for (const name of names) {
    let cand = null;
    if (bracketKey === "heal") {
      const b = bestRoleParse(mergedHps, "healers", name);
      if (b?.rankPercent != null && Number.isFinite(b.rankPercent)) {
        cand = {
          percentile: b.rankPercent,
          encounterName: b.bossName,
          fightId: b.fightId,
          wclCharacterName: name,
          metric: "hps",
        };
      } else {
        const deep = bestFightParseDeepInPayload(mergedHps, name);
        if (deep?.rankPercent != null && Number.isFinite(deep.rankPercent)) {
          cand = {
            percentile: deep.rankPercent,
            encounterName: deep.bossName,
            fightId: deep.fightId,
            wclCharacterName: name,
            metric: "hps",
          };
        }
      }
    } else if (bracketKey === "tank") {
      const b = bestRoleParse(mergedDps, "tanks", name);
      if (b?.rankPercent != null && Number.isFinite(b.rankPercent)) {
        cand = {
          percentile: b.rankPercent,
          encounterName: b.bossName,
          fightId: b.fightId,
          wclCharacterName: name,
          metric: "dps",
        };
      } else {
        const deep = bestFightParseDeepInPayload(mergedDps, name);
        if (deep?.rankPercent != null && Number.isFinite(deep.rankPercent)) {
          cand = {
            percentile: deep.rankPercent,
            encounterName: deep.bossName,
            fightId: deep.fightId,
            wclCharacterName: name,
            metric: "dps",
          };
        }
      }
    } else {
      const b = bestRoleParse(mergedDps, "dps", name);
      if (b?.rankPercent != null && Number.isFinite(b.rankPercent)) {
        cand = {
          percentile: b.rankPercent,
          encounterName: b.bossName,
          fightId: b.fightId,
          wclCharacterName: name,
          metric: "dps",
        };
      } else {
        const deep = bestFightParseDeepInPayload(mergedDps, name);
        if (deep?.rankPercent != null && Number.isFinite(deep.rankPercent)) {
          cand = {
            percentile: deep.rankPercent,
            encounterName: deep.bossName,
            fightId: deep.fightId,
            wclCharacterName: name,
            metric: "dps",
          };
        }
      }
    }
    if (cand && (!best || cand.percentile > best.percentile)) best = cand;
  }
  return best;
}

function pickGlobalBestParseRun(runs) {
  let best = null;
  for (const run of runs) {
    if (!run || run.percentile == null || !Number.isFinite(run.percentile)) continue;
    if (!best || run.percentile > best.percentile) best = run;
  }
  if (!best) {
    return { value: null, source: null };
  }
  const {
    percentile,
    encounterName,
    fightId,
    reportCode,
    reportStartTime,
    wclCharacterName,
    metric,
  } = best;
  return {
    value: percentile,
    source: {
      encounterName: String(encounterName || "").trim() || "Unknown boss",
      fightId: fightId != null ? fightId : null,
      reportCode: String(reportCode || "").trim(),
      reportStartTime: Number(reportStartTime || 0),
      wclCharacterName: String(wclCharacterName || "").trim(),
      metric: String(metric || "").trim(),
    },
  };
}

/** Best encounter percentile per bracket across recent raids (max boss parse then max across logs). */
function summarizeParsesForLinkedGroup(group, raidRankingPayloads, wclDisplayByLower) {
  const empty = {
    bestTank: null,
    bestDps: null,
    bestHeal: null,
    bestTankSource: null,
    bestDpsSource: null,
    bestHealSource: null,
    raidsTank: 0,
    raidsDps: 0,
    raidsHeal: 0,
  };
  if (!Array.isArray(raidRankingPayloads) || raidRankingPayloads.length === 0) return empty;

  const names = [...group.wclLower]
    .sort()
    .map((low) => String(wclDisplayByLower.get(low) || low || "").trim())
    .filter(Boolean);

  const tankRuns = [];
  const dpsRuns = [];
  const healRuns = [];

  for (const entry of raidRankingPayloads) {
    const reportCode = String(entry?.reportCode || "");
    const reportStartTime = Number(entry?.startTime || 0);
    const mergedDps = entry?.mergedDps;
    const mergedHps = entry?.mergedHps;

    const td = bracketParseBestEncounterOneRaidDetailed(mergedDps, mergedHps, "tank", names);
    if (td) tankRuns.push({ ...td, reportCode, reportStartTime });

    const dd = bracketParseBestEncounterOneRaidDetailed(mergedDps, mergedHps, "dps", names);
    if (dd) dpsRuns.push({ ...dd, reportCode, reportStartTime });

    const hd = bracketParseBestEncounterOneRaidDetailed(mergedDps, mergedHps, "heal", names);
    if (hd) healRuns.push({ ...hd, reportCode, reportStartTime });
  }

  const tankPick = pickGlobalBestParseRun(tankRuns);
  const dpsPick = pickGlobalBestParseRun(dpsRuns);
  const healPick = pickGlobalBestParseRun(healRuns);

  return {
    bestTank: tankPick.value,
    bestDps: dpsPick.value,
    bestHeal: healPick.value,
    bestTankSource: tankPick.source,
    bestDpsSource: dpsPick.source,
    bestHealSource: healPick.source,
    raidsTank: tankRuns.length,
    raidsDps: dpsRuns.length,
    raidsHeal: healRuns.length,
  };
}

/** WCL sometimes yields numeric strings; normalize before Math.max / comparisons. */
function finiteParseNum(x) {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Global peak parse % per bracket — must match client `recomputeParseCeilingMaxes` (same inputs).
 * Exposed on `/attendance` so ops can verify badges without guessing.
 */
function computeParseCeilingMaxFromLeaderboard(leaderboard) {
  const max = { tank: null, heal: null, dps: null };
  const seen = new Set();
  for (const row of Array.isArray(leaderboard) ? leaderboard : []) {
    const id = String(row?.raidHelperName || row?.name || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ps = row?.parseSummaries;
    if (!ps || typeof ps !== "object") continue;
    const bt = finiteParseNum(ps.bestTank ?? ps.avgTank);
    const bh = finiteParseNum(ps.bestHeal ?? ps.avgHeal);
    const bd = finiteParseNum(ps.bestDps ?? ps.avgDps);
    if (bt != null && bt > 0) max.tank = max.tank == null ? bt : Math.max(max.tank, bt);
    if (bh != null && bh > 0) max.heal = max.heal == null ? bh : Math.max(max.heal, bh);
    if (bd != null && bd > 0) max.dps = max.dps == null ? bd : Math.max(max.dps, bd);
  }
  return max;
}

/**
 * Map a WCL rankings name onto one roster key (same family as `normalizeRaidHelperDisplayKey` + attendance).
 * WCL often returns short names; links may store `name-realm` only — strict Set membership missed most raiders.
 */
function resolveWclRankingsNameToRosterKey(groups, wclDisplayNameRaw, wclDisplayByLower) {
  const raw = String(wclDisplayNameRaw || "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  for (const g of groups.values()) {
    if (g.wclLower.has(low)) return normalizeRaidHelperDisplayKey(g.displayName);
  }
  const nTarget = normalizeRaidHelperDisplayKey(raw);
  for (const g of groups.values()) {
    const rk = normalizeRaidHelperDisplayKey(g.displayName);
    if (nTarget && (rk === nTarget || debugRankingsCharacterMatches(g.displayName, raw))) return rk;
    for (const altLow of g.wclLower) {
      const pretty = String(wclDisplayByLower?.get?.(altLow) ?? altLow ?? "").trim() || String(altLow);
      if (debugRankingsCharacterMatches(pretty, raw) || debugRankingsCharacterMatches(altLow, raw)) {
        return rk;
      }
      if (nTarget) {
        const nPretty = normalizeRaidHelperDisplayKey(pretty);
        const nAlt = normalizeRaidHelperDisplayKey(altLow);
        if (nPretty === nTarget || nAlt === nTarget) return rk;
      }
    }
  }
  return null;
}

/**
 * For one merged rankings payload and role bucket: on each boss fight, among linked guild characters
 * present in that bucket, everyone tied for max percentile is marked (same 0.02 tolerance as peak-parse UI).
 */
function addEncounterTopKeysFromMergedMetric(mergedPayload, rolePlural, groups, wclDisplayByLower, outRosterKeySet) {
  const parsed = parseMaybeJson(mergedPayload);
  const fights = Array.isArray(parsed?.data) ? parsed.data : [];
  for (const fight of fights) {
    const chars = fightCharactersForRole(fight, rolePlural);
    const scored = [];
    for (const entry of chars) {
      const nm = wclRankingCharacterDisplayName(entry);
      const rk = resolveWclRankingsNameToRosterKey(groups, nm, wclDisplayByLower);
      if (!rk) continue;
      const pct = wclRankingEntryPercentile(entry);
      if (pct == null || !Number.isFinite(Number(pct))) continue;
      scored.push({ rk, pct: Number(pct) });
    }
    if (scored.length === 0) continue;
    const maxPct = Math.max(...scored.map((x) => x.pct));
    for (const row of scored) {
      if (Math.abs(row.pct - maxPct) <= 0.02 + 1e-9) outRosterKeySet.add(row.rk);
    }
  }
}

/** Raid-helper roster keys that topped at least one encounter (tied allowed) in the attendance window, per bracket. */
function computeEncounterTopParserSets(groups, raidRankingPayloads, wclDisplayByLower) {
  const encounterTopTank = new Set();
  const encounterTopHeal = new Set();
  const encounterTopDps = new Set();
  if (!Array.isArray(raidRankingPayloads)) {
    return { encounterTopTank, encounterTopHeal, encounterTopDps };
  }
  for (const entry of raidRankingPayloads) {
    addEncounterTopKeysFromMergedMetric(entry?.mergedDps, "tanks", groups, wclDisplayByLower, encounterTopTank);
    addEncounterTopKeysFromMergedMetric(entry?.mergedDps, "dps", groups, wclDisplayByLower, encounterTopDps);
    addEncounterTopKeysFromMergedMetric(entry?.mergedHps, "healers", groups, wclDisplayByLower, encounterTopHeal);
  }
  return { encounterTopTank, encounterTopHeal, encounterTopDps };
}

/**
 * Aggregate per-raid attendance across all WCL characters linked to one Raid Helper identity.
 * Reads saved roster rows from {@link rhWclLinksState} / `rh-wcl-character-links.json`.
 * Leaderboard rows use `raidHelperName` for UI; `wclCharacters` lists merged log names.
 */
function buildRhWclLinkedAttendanceLeaderboard(raidSnapshots, linksState, top, wclDisplayByLower, raidRankingPayloads = []) {
  const consideredRaids = raidSnapshots.length;
  const links = Array.isArray(linksState?.links) ? linksState.links : [];
  /** @type {Map<string, string>} normalized Raid Helper key → guild role */
  const guildRoleByRhKey = new Map();
  for (const entry of links) {
    const k = normalizeRaidHelperDisplayKey(String(entry?.raidHelperName || ""));
    if (!k) continue;
    guildRoleByRhKey.set(k, normalizeRhWclGuildRole(entry?.guildRole));
  }
  /** @type {Map<string, { displayName: string, wclLower: Set<string> }>} */
  const groups = new Map();

  for (const entry of links) {
    const displayName = String(entry?.raidHelperName || "").trim();
    if (!displayName) continue;
    const logicalKey = normalizeRaidHelperDisplayKey(displayName);
    const wclLower = new Set();
    for (const cn of Array.isArray(entry?.wclCharacterNames) ? entry.wclCharacterNames : []) {
      const low = String(cn || "").trim().toLowerCase();
      if (low) wclLower.add(low);
    }
    wclLower.add(logicalKey);
    const prev = groups.get(logicalKey);
    if (prev) {
      for (const n of wclLower) prev.wclLower.add(n);
    } else {
      groups.set(logicalKey, { displayName, wclLower });
    }
  }

  const allWclLower = new Set();
  for (const raid of raidSnapshots) {
    for (const n of raid.attendeesLower) allWclLower.add(n);
  }

  const claimedLower = new Set();
  for (const g of groups.values()) {
    for (const n of g.wclLower) claimedLower.add(n);
  }

  for (const low of allWclLower) {
    if (claimedLower.has(low)) continue;
    const pretty = wclDisplayByLower.get(low) || low;
    groups.set(low, { displayName: pretty, wclLower: new Set([low]) });
  }

  const { encounterTopTank, encounterTopHeal, encounterTopDps } = computeEncounterTopParserSets(
    groups,
    raidRankingPayloads,
    wclDisplayByLower
  );

  const rows = [];
  for (const g of groups.values()) {
    let raidsAttended = 0;
    const attendanceHistory = [];
    for (const raid of raidSnapshots) {
      const attended = [...g.wclLower].some((n) => raid.attendeesLower.has(n));
      attendanceHistory.push(attended ? 1 : 0);
      if (attended) raidsAttended += 1;
    }
    const wclCharacters = [...g.wclLower].map((low) => wclDisplayByLower.get(low) || low).sort((a, b) =>
      a.localeCompare(b)
    );
    const parseSummaries = summarizeParsesForLinkedGroup(g, raidRankingPayloads, wclDisplayByLower);
    const rk = normalizeRaidHelperDisplayKey(g.displayName);
    parseSummaries.encounterTopTank = encounterTopTank.has(rk);
    parseSummaries.encounterTopHeal = encounterTopHeal.has(rk);
    parseSummaries.encounterTopDps = encounterTopDps.has(rk);
    rows.push({
      name: g.displayName,
      raidHelperName: g.displayName,
      wclCharacters,
      raidsAttended,
      attendanceRate: consideredRaids > 0 ? (raidsAttended / consideredRaids) * 100 : 0,
      attendanceHistory,
      parseSummaries,
      guildRole: guildRoleByRhKey.get(rk) ?? "Peon",
    });
  }

  rows.sort(
    (a, b) =>
      b.raidsAttended - a.raidsAttended ||
      b.attendanceRate - a.attendanceRate ||
      String(a.raidHelperName || "").localeCompare(String(b.raidHelperName || ""))
  );

  /** Saved roster rows must always appear on Events — never truncate them behind high-attendance unlinked players. */
  const linkedKeysFromStore = new Set(
    links
      .map((e) => normalizeRaidHelperDisplayKey(String(e?.raidHelperName || "")))
      .filter(Boolean)
  );
  const linkedRows = [];
  const unlinkedRows = [];
  for (const r of rows) {
    const k = normalizeRaidHelperDisplayKey(String(r?.raidHelperName || r?.name || ""));
    if (linkedKeysFromStore.has(k)) linkedRows.push(r);
    else unlinkedRows.push(r);
  }
  const spare = Math.max(0, top - linkedRows.length);
  const leaderboard = [...linkedRows, ...unlinkedRows.slice(0, spare)];

  return {
    consideredRaids,
    leaderboard,
  };
}

function extractReportCode(reportInput) {
  const value = String(reportInput || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/\/reports\/([A-Za-z0-9]+)/i);
    return match?.[1] || value;
  } catch {
    return value;
  }
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiresAt > now + 30_000) {
    return cachedToken;
  }

  const clientId = process.env.WCL_CLIENT_ID;
  const clientSecret = process.env.WCL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing WCL_CLIENT_ID or WCL_CLIENT_SECRET in .env");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(WCL_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  if (!response.ok) {
    throw new Error(`OAuth token request failed (${response.status})`);
  }

  const payload = await response.json();
  cachedToken = payload.access_token;
  cachedTokenExpiresAt = now + (Number(payload.expires_in || 3600) * 1000);
  return cachedToken;
}

async function getBlizzardAccessToken() {
  const now = Date.now();
  if (cachedBlizzardToken && cachedBlizzardTokenExpiresAt > now + 30_000) {
    return cachedBlizzardToken;
  }
  const clientId = process.env.BLIZZARD_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET?.trim() || "";
  if (!clientId || !clientSecret) {
    throw new Error("Blizzard API credentials are not configured (BLIZZARD_CLIENT_ID/BLIZZARD_CLIENT_SECRET)");
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(BLIZZARD_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.access_token) {
    throw new Error(`Blizzard OAuth failed (${res.status}): ${payload?.error_description || payload?.error || "unknown error"}`);
  }
  cachedBlizzardToken = payload.access_token;
  cachedBlizzardTokenExpiresAt = now + Number(payload.expires_in || 3600) * 1000;
  return cachedBlizzardToken;
}

function buildItemTooltipLines(itemData) {
  const out = [];
  const quality = String(itemData?.quality?.name || "").trim();
  const itemLevel = Number(itemData?.level || 0);
  const reqLevel = Number(itemData?.required_level || 0);
  const typeName = String(itemData?.item_subclass?.name || itemData?.item_class?.name || "").trim();
  const slotName = String(itemData?.inventory_type?.name || "").trim();
  if (quality) out.push(quality);
  if (itemLevel > 0) out.push(`Item Level ${itemLevel}`);
  if (reqLevel > 0) out.push(`Requires Level ${reqLevel}`);
  if (typeName || slotName) out.push([slotName, typeName].filter(Boolean).join(" · "));
  if (typeof itemData?.sell_price?.display_strings?.header === "string") {
    out.push(String(itemData.sell_price.display_strings.header));
  }
  return out.slice(0, 6);
}

/**
 * Blizzard `render.worldofwarcraft.com` icon URLs often fail as hotlinked `<img src>`
 * (referrer / CDN rules). Same artwork is served reliably from Wowhead's CDN.
 */
function normalizeWowItemIconUrl(iconUrl) {
  const s = String(iconUrl || "").trim();
  if (!s) return null;
  const m = s.match(/\/([a-z0-9_-]+)\.(jpg|png)(?:\?|$)/i);
  if (
    m &&
    (/render\.worldofwarcraft\.com/i.test(s) ||
      /blz-static/i.test(s) ||
      /blizzard\.com\/.*?\/icons\//i.test(s))
  ) {
    return `https://wow.zamimg.com/images/wow/icons/large/${m[1]}.jpg`;
  }
  return s;
}

async function fetchClassicItemMetadata(itemId) {
  const id = Number(itemId || 0);
  if (!Number.isInteger(id) || id <= 0) return { itemId: id || null };
  const token = await getBlizzardAccessToken();
  const namespace = wowClassicNamespace();
  const locale = wowClassicLocale();
  const base = blizzardApiBaseUrl();
  const authHeaders = { Authorization: `Bearer ${token}` };
  const itemUrl = `${base}/data/wow/item/${id}?namespace=${encodeURIComponent(namespace)}&locale=${encodeURIComponent(locale)}`;
  const mediaUrl = `${base}/data/wow/media/item/${id}?namespace=${encodeURIComponent(namespace)}&locale=${encodeURIComponent(locale)}`;
  const [itemRes, mediaRes] = await Promise.all([
    fetch(itemUrl, { headers: authHeaders }),
    fetch(mediaUrl, { headers: authHeaders }),
  ]);
  const itemData = await itemRes.json().catch(() => ({}));
  const mediaData = await mediaRes.json().catch(() => ({}));
  const mediaAssets = Array.isArray(mediaData?.assets) ? mediaData.assets : [];
  const rawIcon = mediaAssets.find((a) => String(a?.key || "").toLowerCase() === "icon")?.value || mediaAssets[0]?.value || null;
  const icon = normalizeWowItemIconUrl(rawIcon);
  const baseMeta = {
    itemId: id,
    name: String(itemData?.name || "").trim() || null,
    icon,
    quality: String(itemData?.quality?.name || "").trim() || null,
    itemLevel: Number(itemData?.level || 0) || null,
    requiredLevel: Number(itemData?.required_level || 0) || null,
    tooltip: buildItemTooltipLines(itemData),
  };
  if (!wowheadTooltipEnabled()) return baseMeta;
  const key = wowheadTooltipLocaleKey();
  const whUrl = `https://www.wowhead.com${wowheadFlavorPath()}/item=${id}?power`;
  const whRes = await fetch(whUrl, {
    headers: { "User-Agent": "fallen-tacticians-api/1.0 (+loot-history-tooltip)" },
  });
  const html = await whRes.text().catch(() => "");
  const tooltipHtml = extractWowheadTooltipHtml(html, id, key);
  if (!tooltipHtml) return baseMeta;
  const sanitizedTooltipHtml = String(tooltipHtml || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "");
  return {
    ...baseMeta,
    tooltipHtml: sanitizedTooltipHtml || null,
    tooltipSource: sanitizedTooltipHtml ? "wowhead" : "blizzard",
  };
}

async function resolveClassicItemIdByName(itemName) {
  const name = String(itemName || "").trim();
  if (!name) return 0;
  const token = await getBlizzardAccessToken();
  const namespace = wowClassicNamespace();
  const locale = wowClassicLocale();
  const base = blizzardApiBaseUrl();
  const authHeaders = { Authorization: `Bearer ${token}` };
  const searchFields = [...new Set([`name.${locale}`, "name.en_US"])];
  const lowerName = name.toLowerCase();
  for (const field of searchFields) {
    const url = `${base}/data/wow/search/item?namespace=${encodeURIComponent(namespace)}&locale=${encodeURIComponent(
      locale
    )}&${encodeURIComponent(field)}=${encodeURIComponent(name)}&_pageSize=8`;
    const res = await fetch(url, { headers: authHeaders });
    if (!res.ok) continue;
    const payload = await res.json().catch(() => ({}));
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const exact = results.find((row) => String(row?.data?.name || "").trim().toLowerCase() === lowerName);
    const picked = exact || results[0] || null;
    const resolved = Number(picked?.data?.id || 0);
    if (resolved > 0) return resolved;
  }
  return 0;
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wclMinIntervalMs() {
  const n = Number(process.env.WCL_MIN_INTERVAL_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(30_000, n);
  return 350;
}

function wclMaxRetries() {
  const n = Number(process.env.WCL_MAX_RETRIES);
  if (Number.isFinite(n) && n >= 1) return Math.min(25, n);
  return 8;
}

/** Max extra WCL calls (per report) for death/attendance/heatmap/loot loops; keeps free-tier keys under the limit. */
function wclPerReportDetailCap() {
  const n = Number(process.env.WCL_PER_REPORT_DETAIL_CAP);
  if (Number.isFinite(n) && n >= 1) return Math.min(100, n);
  return 18;
}

/** How many recent raid logs count toward `/attendance` % (25-player raids only in metrics mode). Default 6. */
function wclAttendanceRecentRaidCount() {
  const raw = process.env.WCL_ATTENDANCE_RECENT_RAIDS;
  const n = raw !== undefined && String(raw).trim() !== "" ? Number(raw) : 6;
  return Number.isFinite(n) ? Math.min(40, Math.max(1, Math.floor(n))) : 6;
}

/** When `1`, exposes `/api/wcl/guild/:guildId/debug-character-rankings` for probing rankings JSON by character name. */
function wclDebugRankingsRoutesEnabled() {
  return String(process.env.WCL_DEBUG_RANKINGS || "").trim() === "1";
}

/** Guild report list size for heavy `reports { data { fights { ... }}}` queries — large pulls exceed WCL max complexity (~50k). */
function wclMaxGuildReportsLimit() {
  const n = Number(process.env.WCL_MAX_GUILD_REPORTS_LIMIT);
  if (Number.isFinite(n) && n >= 5) return Math.min(100, n);
  return 40;
}

/** Split `fightIDs` across smaller GraphQL calls — table/rankings/events complexity scales with fight count. */
function wclMaxFightIdsPerQuery() {
  const n = Number(process.env.WCL_MAX_FIGHT_IDS_PER_QUERY);
  if (Number.isFinite(n) && n >= 5) return Math.min(80, n);
  return 24;
}

/** `events(limit: …)` contributes heavily to complexity; keep below WCL caps. */
function wclLootEventsLimit() {
  const n = Number(process.env.WCL_LOOT_EVENTS_LIMIT);
  if (Number.isFinite(n) && n >= 100) return Math.min(5000, n);
  return 1500;
}

/** Merge multiple `table()` payloads (damage/healing/tanking) by summing `total` per player. */
function mergeWclTableValuesFromApi(tableValues) {
  const byKey = new Map();
  for (const tv of tableValues) {
    const table = parseWclTable(tv);
    if (!table?.entries?.length) continue;
    for (const entry of table.entries) {
      const name = String(entry?.name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const add = Number(entry.total || 0);
      const cur = byKey.get(key);
      if (!cur) byKey.set(key, { ...entry, total: add });
      else cur.total = Number(cur.total || 0) + add;
    }
  }
  const entries = [...byKey.values()].sort((a, b) => (b.total || 0) - (a.total || 0));
  return { entries };
}

/** Concatenate ranking `data` arrays from chunked `rankings(...)` responses. */
function mergeWclRankingsPayloads(parts) {
  const data = [];
  for (const p of parts) {
    const parsed = parseMaybeJson(p);
    if (Array.isArray(parsed?.data)) data.push(...parsed.data);
  }
  return { data };
}

/** Serialize GraphQL calls and space them out to avoid WCL 429 (free keys are heavily limited). */
let wclGraphqlChain = Promise.resolve();

async function queryWcl(query, variables) {
  const run = async () => {
    const gap = wclMinIntervalMs();
    if (gap > 0) await sleepMs(gap);

    const token = await getAccessToken();
    const maxAttempts = wclMaxRetries();
    let lastStatus = 0;
    let lastMessage = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(WCL_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (response.ok) {
        const payload = await response.json();
        if (payload.errors?.length) {
          throw new Error(payload.errors[0]?.message || "WCL GraphQL error");
        }
        return payload?.data;
      }

      lastStatus = response.status;
      lastMessage = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        break;
      }

      const retryAfterRaw = response.headers.get("retry-after");
      const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
      let delayMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(120_000, Math.round(retryAfterSec * 1000))
          : Math.min(90_000, 2500 * 2 ** (attempt - 1));
      delayMs += Math.floor(Math.random() * 500);
      await sleepMs(delayMs);
    }

    throw new Error(
      `WCL API request failed (${lastStatus})${lastMessage ? `: ${lastMessage.slice(0, 180)}` : ""}`
    );
  };

  const job = wclGraphqlChain.then(run);
  wclGraphqlChain = job.catch(() => {});
  return job;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** WCL sometimes uses curly apostrophes; normalize before comparing to TRACKED_RAIDS keys. */
function normalizeWclLabel(value) {
  return normalizeText(String(value || "").replace(/\u2019/g, "'").replace(/\u2018/g, "'"));
}

/**
 * Report `startTime` from GraphQL is usually epoch ms, but some payloads use seconds.
 * Values below ~1e11 are treated as seconds (covers realistic Unix s through year 5000+).
 */
function reportStartTimeMs(raw) {
  const n = Number(raw || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 100_000_000_000) return Math.round(n * 1000);
  return n;
}

/** Map a WCL zone label to a TRACKED_RAIDS key, or null if not tracked. */
function resolveTrackedRaidZoneName(zoneRaw) {
  const z = normalizeWclLabel(zoneRaw).replace(/\s+/g, " ").trim();
  if (!z) return null;
  for (const key of Object.keys(TRACKED_RAIDS)) {
    if (normalizeWclLabel(key) === z) return key;
  }
  if (z.includes("karazhan") || /\bkara\b/.test(z)) return "Karazhan";
  if (z.includes("gruul") && z.includes("lair")) return "Gruul's Lair";
  if (z.includes("magtheridon")) return "Magtheridon's Lair";
  return null;
}

function resolvedTrackedRaidForFight(fight, report) {
  const fromFight = resolveTrackedRaidZoneName(fight?.gameZone?.name);
  if (fromFight) return fromFight;
  return resolveTrackedRaidZoneName(report?.zone?.name);
}

/** First encounter zone in the report that maps to a tracked raid (for UI headers). */
function primaryTrackedRaidNameFromReport(report) {
  for (const fight of report?.fights || []) {
    const key = resolvedTrackedRaidForFight(fight, report);
    if (key && Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, key)) return key;
  }
  return null;
}

function collectTrackedRaidZonesFromReport(report) {
  const zones = new Set();
  for (const fight of report?.fights || []) {
    if (Number(fight?.encounterID || 0) <= 0) continue;
    const key = resolvedTrackedRaidForFight(fight, report);
    if (key && Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, key)) zones.add(key);
  }
  return zones;
}

/**
 * Human-facing raid label for MVP voting / home POTR imagery.
 * Thursday Gruul/Mag nights often upload as a Gruul-only log; still brand as the combined night.
 */
function mvpUiRaidName(report, primaryRaidName) {
  const primary = String(primaryRaidName || "").trim();
  const zones = collectTrackedRaidZonesFromReport(report);
  const hasGruul = zones.has("Gruul's Lair");
  const hasMag = zones.has("Magtheridon's Lair");
  if (hasGruul && hasMag) return "Gruul's Lair + Magtheridon's Lair";
  const wd = reportWeekdayNormalizedInCalendarZone(report?.startTime);
  if (primary === "Gruul's Lair" && wd === "thursday") return "Gruul's Lair + Magtheridon's Lair";
  return primary;
}

function latestTrackedRaidReport(reports) {
  for (const report of reports || []) {
    const bossFights = (report?.fights || []).filter((f) => Number(f?.encounterID || 0) > 0);
    if (!bossFights.length) continue;
    const raidName = primaryTrackedRaidNameFromReport(report);
    if (!raidName) continue;
    return { report, bossFights, raidName };
  }
  return null;
}

function toMetricMap(entries) {
  const out = new Map();
  for (const e of entries || []) {
    const name = String(e?.name || "").trim();
    if (!name) continue;
    out.set(name.toLowerCase(), Number(e?.total || 0));
  }
  return out;
}

const VOTING_ROUND_QUERY = `
  query VotingRound($code: String!, $fightIds: [Int!]) {
    reportData {
      report(code: $code) {
        damageDone: table(dataType: DamageDone, fightIDs: $fightIds)
        healing: table(dataType: Healing, fightIDs: $fightIds)
        damageTaken: table(dataType: DamageTaken, fightIDs: $fightIds)
      }
    }
  }
`;

async function getLatestRaidVotingPayload(guildId) {
  const reports = await getFilteredGuildReportsForGuild(guildId, 20);
  const latest = latestTrackedRaidReport(reports);
  if (!latest) return null;

  const { report, bossFights, raidName: primaryRaidName } = latest;
  const raidName = mvpUiRaidName(report, primaryRaidName);
  const fightIds = bossFights.map((f) => Number(f.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!fightIds.length) return null;

  const chunks = chunkPositiveInts(fightIds, wclMaxFightIdsPerQuery());
  const damageParts = [];
  const healingParts = [];
  const tankParts = [];

  for (const ids of chunks) {
    const data = await queryWcl(VOTING_ROUND_QUERY, { code: report.code, fightIds: ids });
    damageParts.push(data?.reportData?.report?.damageDone);
    healingParts.push(data?.reportData?.report?.healing);
    tankParts.push(data?.reportData?.report?.damageTaken);
  }

  const dmg = mergeWclTableValuesFromApi(damageParts).entries || [];
  const heal = mergeWclTableValuesFromApi(healingParts).entries || [];
  const taken = mergeWclTableValuesFromApi(tankParts).entries || [];

  const dpsByName = toMetricMap(dmg);
  const hpsByName = toMetricMap(heal);
  const takenByName = toMetricMap(taken);

  const rosterNames = new Set();
  for (const c of report?.rankedCharacters || []) {
    const n = String(c?.name || "").trim();
    if (n) rosterNames.add(n);
  }

  const playerClassByName = new Map();
  for (const entry of [...dmg, ...heal, ...taken]) {
    const n = String(entry?.name || "").trim().toLowerCase();
    if (!n) continue;
    if (!playerClassByName.has(n) && entry?.type) playerClassByName.set(n, String(entry.type));
  }

  const candidates = [...rosterNames]
    .map((name) => {
      const k = name.toLowerCase();
      return {
        name,
        className: playerClassByName.get(k) || "",
        dps: Math.round(dpsByName.get(k) || 0),
        hps: Math.round(hpsByName.get(k) || 0),
        damageTaken: Math.round(takenByName.get(k) || 0),
      };
    })
    .sort((a, b) => b.dps - a.dps || a.name.localeCompare(b.name));

  const startTime = reportStartTimeMs(report?.startTime);
  return {
    roundKey: `${report.code}:${startTime}`,
    raidCode: report.code,
    raidName,
    title: report?.title || raidName,
    startTime,
    candidates,
  };
}

async function getCurrentVotingRoundCached(guildId) {
  const key = `voting-round-v1-${Number(guildId)}`;
  const ttlMs = votingRoundCacheTtlMs();
  return getOrRefreshCachedPayload(key, {
    ttlMs,
    maxStaleMs: Math.max(ttlMs * 10, 15 * 60_000),
    loader: async () => getLatestRaidVotingPayload(guildId),
  });
}

function eventsWclSpecIconsEnabled() {
  return String(process.env.EVENTS_WCL_SPEC_ICONS || "1").trim() !== "0";
}

function eventsWclSpecIconGuildId() {
  const override = Number(process.env.EVENTS_WCL_SPEC_ICON_GUILD_ID || 0);
  if (Number.isInteger(override) && override > 0) return override;
  return Number.isInteger(votingGuildId) && votingGuildId > 0 ? votingGuildId : 0;
}

function wclRosterIconCacheTtlMs() {
  const n = Number(process.env.WCL_ROSTER_ICON_CACHE_MS || 900_000);
  return Number.isFinite(n) && n > 0 ? n : 900_000;
}

/** Lowercase + diacritic-folded keys so WCL / Raid-Helper names can match. */
function wclIconMapKeysFromPlayerName(name) {
  const raw = String(name || "").trim();
  const keys = [];
  if (!raw) return keys;
  const lower = raw.toLowerCase();
  keys.push(lower);
  const folded = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (folded && folded !== lower) keys.push(folded);
  return keys;
}

function pickWclIconHit(iconMap, playerName) {
  if (!iconMap || typeof iconMap !== "object") return null;
  for (const k of wclIconMapKeysFromPlayerName(playerName)) {
    const hit = iconMap[k];
    if (hit && hit.icon) return hit;
  }
  return null;
}

/** Warcraft Logs names from the character roster for this Raid Helper signup (main + alts). */
function linkedWclCharacterNamesForRaidHelperName(linksState, rosterDisplayName) {
  const key = normalizeRaidHelperDisplayKey(String(rosterDisplayName || ""));
  if (!key) return [];
  for (const entry of linksState?.links || []) {
    const rh = normalizeRaidHelperDisplayKey(String(entry?.raidHelperName || ""));
    if (rh !== key) continue;
    const names = Array.isArray(entry?.wclCharacterNames) ? entry.wclCharacterNames : [];
    return names.map((x) => String(x || "").trim()).filter(Boolean);
  }
  return [];
}

/** First entry in `rh-wcl-character-links.json` for this signup — use as Raider.io profile name when RH display ≠ armory name. */
function primaryMappedWclCharacterNameForRioLookup(linksState, row) {
  const names = linkedWclCharacterNamesForRaidHelperName(linksState, row?.name);
  return names.length ? String(names[0] || "").trim() : "";
}

/**
 * Prefer icons for linked log names so we do not pick another player’s row when RH ≠ WCL display
 * (e.g. prot paladin showing warrior defensive stance from a name collision on Damage Done).
 */
function pickWclIconHitPreferringLinkedNames(iconMap, row, linksState) {
  const altNames = linkedWclCharacterNamesForRaidHelperName(linksState, row?.name);

  for (const alt of altNames) {
    const h = pickWclIconHit(iconMap, alt);
    if (!h?.icon) continue;
    if (wclDamageDoneIconAgreesWithRoster(h.icon, row, h.type || "")) return h;
  }
  const primary = pickWclIconHitForRosterDisplay(iconMap, row);
  if (primary?.icon && wclDamageDoneIconAgreesWithRoster(primary.icon, row, primary.type || "")) return primary;
  return null;
}

async function loadWclGuildRosterSpecIconMapUncached(guildId) {
  const gid = Number(guildId);
  if (!Number.isInteger(gid) || gid <= 0) return {};

  const reports = await getFilteredGuildReportsForGuild(gid, 20);
  const latest = latestTrackedRaidReport(reports);
  if (!latest) return {};

  const { report, bossFights } = latest;
  const fightIds = bossFights.map((f) => Number(f.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!fightIds.length) return {};

  const chunks = chunkPositiveInts(fightIds, wclMaxFightIdsPerQuery());
  const damageParts = [];
  for (const ids of chunks) {
    const data = await queryWcl(VOTING_ROUND_QUERY, { code: report.code, fightIds: ids });
    damageParts.push(data?.reportData?.report?.damageDone);
  }

  const merged = mergeWclTableValuesFromApi(damageParts);
  const out = Object.create(null);

  for (const entry of merged.entries || []) {
    const icon = String(entry?.icon || "").trim();
    if (!icon || !/^https?:\/\//i.test(icon)) continue;
    const type = String(entry?.type || "").trim();
    const payload = { icon, type };
    for (const k of wclIconMapKeysFromPlayerName(entry.name)) {
      if (!out[k]) out[k] = payload;
    }
  }
  return out;
}

async function getWclGuildRosterSpecIconMap(guildId) {
  const gid = Number(guildId);
  if (!Number.isInteger(gid) || gid <= 0) return {};
  const key = `wcl-guild-roster-spec-icons-v2-${gid}`;
  const ttlMs = wclRosterIconCacheTtlMs();
  return getOrRefreshCachedPayload(key, {
    ttlMs,
    maxStaleMs: Math.max(ttlMs * 10, 15 * 60_000),
    loader: async () => loadWclGuildRosterSpecIconMapUncached(gid),
  });
}

async function enrichConfirmedRosterWithWclSpecIcons(rows) {
  if (!eventsWclSpecIconsEnabled()) return rows;
  const gid = eventsWclSpecIconGuildId();
  if (!gid || !Array.isArray(rows) || !rows.length) return rows;

  await ensureRhWclLinksStore();
  const linksState = rhWclLinksState;

  let iconMap;
  try {
    iconMap = await getWclGuildRosterSpecIconMap(gid);
  } catch {
    return rows;
  }
  if (!iconMap || typeof iconMap !== "object") return rows;

  return rows.map((row) => {
    const hit = pickWclIconHitPreferringLinkedNames(iconMap, row, linksState);
    if (!hit?.icon) return row;
    if (!wclDamageDoneIconAgreesWithRoster(hit.icon, row, hit.type || "")) return row;
    return { ...row, wclSpecIconUrl: hit.icon, wclCombatSpecType: hit.type || "" };
  });
}

function bossListMatchesFightName(bossNames, fightName) {
  const fn = normalizeWclLabel(fightName);
  return bossNames.some((b) => normalizeWclLabel(b) === fn);
}

function resolveBossCanonicalName(bossNames, fightName) {
  const fn = normalizeWclLabel(fightName);
  const match = bossNames.find((b) => normalizeWclLabel(b) === fn);
  return match || fightName;
}

function toDmy(dateObj) {
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yyyy = dateObj.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function parseDmyToDate(dmy) {
  const m = String(dmy || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const dt = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function raidKeywordsFromWclTitle(title) {
  const text = normalizeText(title);
  const keywords = [];
  if (text.includes("kara") || text.includes("karazhan")) keywords.push("kara", "karazhan");
  if (text.includes("gruul")) keywords.push("gruul");
  if (text.includes("magtheridon") || text.includes("mag")) keywords.push("mag", "magtheridon");
  if (text.includes("ssc")) keywords.push("ssc", "serpentshrine");
  if (text.includes("tk") || text.includes("tempest")) keywords.push("tk", "tempest");
  return [...new Set(keywords)];
}

function raidImageFromTitle(title) {
  const text = normalizeText(title);
  if (
    text.includes("ssc") ||
    text.includes("serpentshrine") ||
    text.includes("serpentshrine cavern") ||
    text.includes("serpent shrine") ||
    text.includes("lady vashj")
  ) {
    return "/raid-images/ssc.png";
  }
  if (text.includes("tempest keep") || text.includes("the eye") || text.includes("tk")) {
    return "/raid-images/tk.png";
  }
  if (text.includes("kara") || text.includes("karazhan")) return "/raid-images/kara.png";
  // Distinct Blizzard encounter portraits (same boss icons WCL uses in rankings); assets.rpglogs.com hotlinks often 403 off-site.
  if (text.includes("magtheridon")) return "/raid-images/magtheridon.png";
  if (text.includes("gruul")) return "/raid-images/gruul.png";
  return "/raid-images/kara.png";
}

function raidImageFromRaidName(raidName) {
  const text = normalizeText(raidName || "");
  if (text.includes("serpentshrine") || text === "ssc") return "/raid-images/ssc.png";
  if (text.includes("tempest keep") || text.includes("the eye") || text === "tk") return "/raid-images/tk.png";
  if (text.includes("karazhan") || text === "kara") return "/raid-images/kara.png";
  if (text.includes("magtheridon")) return "/raid-images/magtheridon.png";
  if (text.includes("gruul")) return "/raid-images/gruul.png";
  return raidImageFromTitle(raidName || "");
}

function raidHelperHeaderImage(detail) {
  const candidates = [
    detail?.headerImage,
    detail?.header_image,
    detail?.image,
    detail?.imageUrl,
    detail?.imageURL,
    detail?.banner,
    detail?.bannerImage,
    detail?.template?.headerImage,
    detail?.template?.image,
    detail?.template?.banner,
  ];
  for (const value of candidates) {
    const url = String(value || "").trim();
    if (url) return url;
  }
  return null;
}

/** Calendar day for dedupe (same raid twice same evening). Align with guild locale via env. */
function wclCalendarTimeZone() {
  const tz = process.env.WCL_CALENDAR_TIMEZONE;
  return typeof tz === "string" && tz.trim() ? tz.trim() : "Europe/Berlin";
}

/** Report `startTime` weekday (normalized) in {@link wclCalendarTimeZone}, e.g. `"thursday"`. */
function reportWeekdayNormalizedInCalendarZone(startTimeRaw) {
  const ms = reportStartTimeMs(startTimeRaw);
  if (!ms) return "";
  const tz = wclCalendarTimeZone();
  let weekdayLong;
  try {
    weekdayLong = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(ms));
  } catch {
    weekdayLong = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(ms));
  }
  return normalizeText(weekdayLong);
}

/** Gruul/Mag → Thursday; Karazhan → Sunday (per report `startTime` in {@link wclCalendarTimeZone}). */
function trackedRaidAllowedOnCalendarWeekday(raidName, weekdayNorm) {
  if (!raidName || !Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, raidName)) return false;
  if (raidName === "Karazhan") return weekdayNorm === "sunday";
  if (raidName === "Gruul's Lair" || raidName === "Magtheridon's Lair") return weekdayNorm === "thursday";
  return false;
}

/** Drops fights from other instances or wrong raid night; empty reports are removed downstream. */
function filterReportFightsForRaidNightSchedule(report) {
  const wd = reportWeekdayNormalizedInCalendarZone(report?.startTime);
  if (!wd) return { ...report, fights: [] };
  const fights = (report.fights || []).filter((fight) => {
    if (Number(fight?.encounterID || 0) <= 0) return false;
    const raidName = resolvedTrackedRaidForFight(fight, report);
    if (!raidName || !TRACKED_RAIDS[raidName]) return false;
    return trackedRaidAllowedOnCalendarWeekday(raidName, wd);
  });
  return { ...report, fights };
}

function filterReportsForRaidNightSchedule(reports) {
  return (reports || [])
    .map((report) => filterReportFightsForRaidNightSchedule(report))
    .filter((report) => (report.fights || []).length > 0);
}

/** Comma-separated names that must appear in rankedCharacters (WCL characters that ranked on kills). */
function wclRequiredRaidPlayersNormalized() {
  const raw = process.env.WCL_REQUIRED_RAID_PLAYERS;
  if (raw !== undefined && String(raw).trim() === "") return [];
  return String(raw ?? "Gernig")
    .split(",")
    .map((s) => normalizeText(s))
    .filter(Boolean);
}

function normalizedPlayerNamesFromReport(report) {
  const names = new Set();
  for (const c of report.rankedCharacters || []) {
    const n = normalizeText(String(c?.name || ""));
    if (n) names.add(n);
  }
  return names;
}

function reportMatchesRequiredRaidPlayers(report) {
  const required = wclRequiredRaidPlayersNormalized();
  if (!required.length) return true;
  const names = normalizedPlayerNamesFromReport(report);
  return required.every((req) => names.has(req));
}

function filterReportsForRequiredRaidPlayers(reports) {
  return (reports || []).filter(reportMatchesRequiredRaidPlayers);
}

/** Gruul/Mag on Thu, Kara on Sun + required roster characters. */
function filterGuildRaidReports(reports) {
  const scheduled = filterReportsForRaidNightSchedule(reports || []);
  return filterReportsForRequiredRaidPlayers(scheduled);
}

const RH_SIGNUP_EXCLUDED_CLASSES = new Set(["Absence", "Bench", "Tentative", "Late"]);

/**
 * Raid-Helper payloads vary (`className` vs `class`, etc.).
 * If `class` holds only digits, treat it as a numeric id — not a display name (avoids "2" → wrong class).
 */
function raidHelperClassNameFromSignUpEntry(entry) {
  const s = String(
    entry?.className ??
      entry?.class ??
      entry?.wowClass ??
      entry?.playerClass ??
      entry?.characterClass ??
      entry?.character?.className ??
      entry?.character?.class ??
      ""
  ).trim();
  if (/^\d+$/.test(s)) return "";
  return s;
}

/**
 * Raid-Helper returns locale-specific class labels (e.g. DE "Krieger"); roster icons + prot detection need English slugs.
 * Keys = slugifyLocaleText(lower-case, diacritics stripped).
 */
const LOCALIZED_CLASS_SLUG_TO_ENGLISH_SLUG = {
  warrior: "warrior",
  paladin: "paladin",
  hunter: "hunter",
  rogue: "rogue",
  priest: "priest",
  shaman: "shaman",
  mage: "mage",
  warlock: "warlock",
  druid: "druid",
  deathknight: "deathknight",
  krieger: "warrior",
  jaeger: "hunter",
  jager: "hunter",
  schurke: "rogue",
  priester: "priest",
  schamane: "shaman",
  magier: "mage",
  hexenmeister: "warlock",
  druide: "druid",
  todesritter: "deathknight",
  guerrier: "warrior",
  chasseur: "hunter",
  voleur: "rogue",
  pretre: "priest",
  chaman: "shaman",
  demoniste: "warlock",
  chevalierdelamort: "deathknight",
  guerrero: "warrior",
  cazador: "hunter",
  picaro: "rogue",
  sacerdote: "priest",
  brujo: "warlock",
  druida: "druid",
};

const ENGLISH_CLASS_SLUG_TO_DISPLAY = {
  warrior: "Warrior",
  paladin: "Paladin",
  hunter: "Hunter",
  rogue: "Rogue",
  priest: "Priest",
  shaman: "Shaman",
  mage: "Mage",
  warlock: "Warlock",
  druid: "Druid",
  deathknight: "Death Knight",
};

/** Only real WoW classes — RH often puts spec names (e.g. Protection) in the class column; those must not become a “class” slug. */
const VALID_WOW_CLASS_SLUGS = new Set([
  "warrior",
  "paladin",
  "hunter",
  "rogue",
  "priest",
  "shaman",
  "mage",
  "warlock",
  "druid",
  "deathknight",
]);

function englishCanonicalClassSlugFromLocalizedDisplay(raw) {
  const slug = slugifyLocaleText(raw);
  if (!slug) return "";
  const mapped = LOCALIZED_CLASS_SLUG_TO_ENGLISH_SLUG[slug];
  const resolved = mapped || slug;
  if (!VALID_WOW_CLASS_SLUGS.has(resolved)) return "";
  return resolved;
}

/** Stable English UI label + consistent keys for guild tooling. */
function englishWowClassDisplayFromRaidHelper(raw) {
  const probe = slugifyLocaleText(raw);
  /** RH sometimes puts role bucket labels in the class column — never show those as a “class”. */
  if (
    probe &&
    /^(tank|tanks|schutz|healer|healers|melee|ranged|caster|casters|mdps|rdps)$/.test(probe)
  ) {
    return "";
  }
  const can = englishCanonicalClassSlugFromLocalizedDisplay(raw);
  if (!can) return "";
  return ENGLISH_CLASS_SLUG_TO_DISPLAY[can] || "";
}

/** Race display string when Raid-Helper provides it (field names vary by API version). */
function raidHelperRaceFromSignUpEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  const candidates = [
    entry.race,
    entry.raceName,
    entry.cRaceName,
    entry.characterRace,
    entry.wowRace,
    entry.raceDisplayName,
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return "";
}

/** `male` | `female` | "" — used with race for WoW race portrait icons when Raid-Helper sends it. */
function raidHelperGenderFromSignUpEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  const candidates = [
    entry.gender,
    entry.sex,
    entry.characterGender,
    entry.wowGender,
    entry.genderName,
    entry.cGender,
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (!s) continue;
    const low = s.toLowerCase();
    if (low === "female" || low === "f") return "female";
    if (low === "male" || low === "m") return "male";
    if (low.includes("female")) return "female";
    if (low.includes("male") && !low.includes("fe")) return "male";
  }
  return "";
}

/** Canonical labels for roster grouping + stats (RH sends Tank/Tanks, DE Schutz, etc.). */
function normalizeRaidHelperRoleLabel(roleName) {
  const raw = String(roleName || "").trim();
  const low = raw.toLowerCase();
  if (low === "tank" || low === "tanks" || low === "schutz") return "Tanks";
  if (low === "healer" || low === "healers") return "Healers";
  if (low === "melee" || low === "mdps") return "Melee";
  if (low === "ranged" || low === "rdps" || low === "caster" || low === "casters") return "Ranged";
  return raw;
}

/** Realm/server from Raid-Helper signup row (field names vary). Used with Raider.io / Blizzard profile. */
function raidHelperRealmFromSignUpEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  const candidates = [
    entry.realm,
    entry.realmName,
    entry.characterRealm,
    entry.server,
    entry.serverName,
    entry.world,
    entry.realmSlug,
    entry.homeRealm,
    entry.character?.realm,
    entry.character?.realmName,
    entry.wowRealm,
    entry.wowServer,
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s && !/^\d+$/.test(s)) return s;
  }
  return "";
}

/** Strip optional realm suffix after em dash (matches Events `rosterNameKey`). */
function stripRealmSuffixFromWowDisplayName(raw) {
  return String(raw || "")
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s*[-–—]\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-\s]*$/u, "")
    .trim();
}

/**
 * Which side of `Main/Alt` style signup names is the in-game character for Raider.io (assigned toon).
 * `last` = segment after `/` (typical: account or tag / character). Override if your guild lists character first.
 */
function raidHelperSignupSlashCharacterSegment() {
  const raw = String(process.env.RAID_HELPER_SIGNUP_SLASH_CHARACTER || "last").trim().toLowerCase();
  if (raw === "first" || raw === "left" || raw === "0") return "first";
  return "last";
}

/**
 * Raid Helper–parsed character name stored on each roster row (`rioLookupCharacterName`).
 * External APIs may also try {@link primaryMappedWclCharacterNameForRioLookup} first, then this, then stripped signup display — see {@link wowCharacterNameCandidatesForExternalApis}.
 *
 * Uses explicit Raid Helper character fields when present; otherwise parses `name` using {@link raidHelperSignupSlashCharacterSegment}.
 */
function raidHelperCharacterNameForRaiderIoLookup(entry) {
  if (!entry || typeof entry !== "object") return "";
  const candidates = [
    entry.characterName,
    entry.character?.name,
    entry.wowCharacterName,
    entry.playerCharacterName,
    entry.selectedCharacterName,
    entry.signUpCharacterName,
    entry.nameCharacter,
    entry.charName,
  ];
  for (const c of candidates) {
    const s = stripRealmSuffixFromWowDisplayName(String(c ?? ""));
    if (s && !/^\d+$/.test(s)) return s;
  }
  const display = stripRealmSuffixFromWowDisplayName(String(entry.name || ""));
  if (!display) return "";
  const slash = display.indexOf("/");
  if (slash <= 0) return display;
  const left = display.slice(0, slash).trim();
  const right = display.slice(slash + 1).trim();
  const seg = raidHelperSignupSlashCharacterSegment();
  const chosen = seg === "first" ? left || right : right || left;
  return stripRealmSuffixFromWowDisplayName(chosen);
}

function defaultWowRealmForRoster() {
  return String(process.env.WOW_GUILD_REALM || process.env.WOW_DEFAULT_REALM || "").trim();
}

function wowRosterRegion() {
  return String(process.env.WOW_PROFILE_REGION || process.env.BLIZZARD_REGION || "eu")
    .trim()
    .toLowerCase() || "eu";
}

function wowRealmSlugForLookup(realmRaw) {
  return String(realmRaw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function raiderIoClassicApiBase() {
  return String(process.env.RAIDER_IO_CLASSIC_API_BASE || "https://classic.raider.io/api/v1").replace(/\/$/, "");
}

function blizzardProfileClientConfigured() {
  return Boolean(process.env.BLIZZARD_CLIENT_ID?.trim() && process.env.BLIZZARD_CLIENT_SECRET?.trim());
}

function wowExternalSpecLookupEnabled() {
  const v = String(process.env.WOW_EXTERNAL_SPEC_LOOKUP || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}

async function loadRaiderIoClassicProfileRaw(region, realmSlug, characterName) {
  const base = raiderIoClassicApiBase();
  const url = new URL(`${base}/characters/profile`);
  url.searchParams.set("region", region);
  url.searchParams.set("realm", realmSlug);
  url.searchParams.set("name", characterName);
  url.searchParams.append("fields", "gear");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "fallen-tacticians-api/1.0 (+roster spec)" },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object" || Number(data.statusCode) >= 400) return null;
  return data;
}

function specNameFromRaiderIoClassicProfile(data) {
  if (!data || typeof data !== "object") return null;
  const direct =
    data.active_spec_name ||
    data.activeSpecName ||
    data.active_spec_name_classic ||
    data.spec_name ||
    data.activeSpecializationName;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const fromNested =
    data.spec?.name ||
    data.specialization?.name ||
    data.active_spec?.name ||
    data.character?.active_spec_name;
  if (typeof fromNested === "string" && fromNested.trim()) return fromNested.trim();
  return null;
}

function parseBlizzardActiveSpecializationName(data) {
  if (!data || typeof data !== "object") return null;
  const groups = data.specializations;
  if (!Array.isArray(groups)) return null;
  for (const g of groups) {
    const specs = g?.specializations;
    if (!Array.isArray(specs)) continue;
    const selected = specs.find((s) => s?.selected === true || s?.enabled === true);
    if (selected) {
      const n =
        selected.specialization?.name ||
        selected.playable_specialization?.name ||
        selected.specialization_name ||
        selected.name;
      if (typeof n === "string" && n.trim()) return n.trim();
    }
  }
  return null;
}

/**
 * Battle.net profile namespaces always use the `profile-*` prefix on the API.
 * Env may be set as `classicann-eu` or `profile-classicann-eu`.
 */
function normalizeBlizzardProfileNamespace(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.toLowerCase().startsWith("profile-") ? s : `profile-${s}`;
}

/**
 * TBC Anniversary realms (e.g. Thunderstrike EU) live under `profile-classicann-{region}`.
 * Progression / Cataclysm-era Classic uses `profile-classic-{region}`. Try env override first, then fallbacks.
 */
function blizzardCharacterProfileNamespaceCandidates(region) {
  const r = String(region || "eu").trim().toLowerCase() || "eu";
  const envNs = normalizeBlizzardProfileNamespace(process.env.BLIZZARD_PROFILE_NAMESPACE || "");
  const tierAnn = `profile-classicann-${r}`;
  const tierProg = `profile-classic-${r}`;
  const tierEra = `profile-classic1x-${r}`;
  const defaults = [tierAnn, tierProg, tierEra];
  const out = [];
  if (envNs) out.push(envNs);
  for (const d of defaults) {
    if (!out.some((x) => x.toLowerCase() === d.toLowerCase())) out.push(d);
  }
  return out;
}

async function fetchBlizzardClassicActiveSpecName(realmSlug, characterName) {
  if (!blizzardProfileClientConfigured()) return null;
  const token = await getBlizzardAccessToken();
  const region = wowClassicRegion();
  const locale = wowClassicLocale();
  const base = blizzardApiBaseUrl();
  const r = encodeURIComponent(String(realmSlug || "").toLowerCase());
  const c = encodeURIComponent(String(characterName || "").toLowerCase());
  for (const ns of blizzardCharacterProfileNamespaceCandidates(region)) {
    const url = `${base}/profile/wow/character/${r}/${c}/specializations?namespace=${encodeURIComponent(ns)}&locale=${encodeURIComponent(locale)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const data = await res.json().catch(() => null);
    const spec = parseBlizzardActiveSpecializationName(data);
    if (spec) return spec;
  }
  return null;
}

/** `GET .../profile/wow/character/{realm}/{name}` — English class label + optional active spec (same namespace as specializations). */
function parseBlizzardCharacterProfileSummary(data) {
  if (!data || typeof data !== "object") return { className: null, specName: null };
  let className = null;
  const cc = data.character_class;
  if (cc && typeof cc === "object" && typeof cc.name === "string" && cc.name.trim()) {
    className = cc.name.trim();
  }
  let specName = null;
  const sp = data.active_spec ?? data.active_specialization;
  if (sp && typeof sp === "object") {
    const n = sp.name;
    if (typeof n === "string" && n.trim()) specName = n.trim();
  }
  return { className, specName };
}

async function fetchBlizzardClassicCharacterSummaryFields(realmSlug, characterName) {
  if (!blizzardProfileClientConfigured()) return null;
  const token = await getBlizzardAccessToken();
  const region = wowClassicRegion();
  const locale = wowClassicLocale();
  const base = blizzardApiBaseUrl();
  const r = encodeURIComponent(String(realmSlug || "").toLowerCase());
  const c = encodeURIComponent(String(characterName || "").toLowerCase());
  for (const ns of blizzardCharacterProfileNamespaceCandidates(region)) {
    const url = `${base}/profile/wow/character/${r}/${c}?namespace=${encodeURIComponent(ns)}&locale=${encodeURIComponent(locale)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const data = await res.json().catch(() => null);
    const parsed = parseBlizzardCharacterProfileSummary(data);
    if (parsed?.className || parsed?.specName) return parsed;
  }
  return null;
}

/**
 * Builds ordered WoW character names to query Raider.io / Blizzard (same realm).
 * Preference: first linked Warcraft Logs name → Raid Helper parsed character field → signup display (realm stripped).
 * If the mapped log main 404s on Rio/Armory, the next candidate is tried so tank/spec icons still resolve.
 */
function wowCharacterNameCandidatesForExternalApis(row, linksState) {
  const display = stripRealmSuffixFromWowDisplayName(String(row?.name || ""));
  const mappedMain = primaryMappedWclCharacterNameForRioLookup(linksState, row);
  const rhChar = String(row?.rioLookupCharacterName || "").trim();
  const out = [];
  for (const cand of [mappedMain, rhChar, display]) {
    const c = String(cand || "").trim();
    if (!c) continue;
    if (!out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out;
}

/** Battle.net profile `{realm}/{name}` matches the in-game toon — prefer RH signup character before WCL↔Rio aliases. */
function wowBlizzardCharacterNameCandidates(row, linksState) {
  const display = stripRealmSuffixFromWowDisplayName(String(row?.name || ""));
  const mappedMain = primaryMappedWclCharacterNameForRioLookup(linksState, row);
  const rhChar = String(row?.rioLookupCharacterName || "").trim();
  const out = [];
  for (const cand of [rhChar, display, mappedMain]) {
    const c = String(cand || "").trim();
    if (!c) continue;
    if (!out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  return out;
}

async function enrichRosterRowExternalSpec(row, linksState) {
  const name = String(row.name || "").trim();
  if (!name) return row;
  const realmRaw = String(row.realm || "").trim() || defaultWowRealmForRoster();
  const nameCandidates = wowCharacterNameCandidatesForExternalApis(row, linksState);
  const preferredLookupName = nameCandidates[0] || stripRealmSuffixFromWowDisplayName(name);
  /** Rio / Battle.net need a realm slug; still expose which character name would be queried (localhost debugging). */
  if (!realmRaw) {
    return { ...row, rioProfileLookupName: preferredLookupName };
  }


  const needsClassRepair = raidHelperClassFieldLooksLikeRoleNotClass(row.className);
  const needsSpecLookup = wowExternalSpecLookupEnabled();
  /** Card label + lookup hint: mapping-first name (e.g. log main), not the first Rio URL candidate that 200s. */
  if (!needsClassRepair && !needsSpecLookup) {
    return { ...row, rioProfileLookupName: preferredLookupName };
  }

  const region = wowRosterRegion();
  const realmSlug = wowRealmSlugForLookup(realmRaw);

  let profile = null;
  let rioResolvedLookupName = "";
  const rioTryNames = nameCandidates.length ? nameCandidates : [preferredLookupName].filter(Boolean);
  for (const cand of rioTryNames) {
    const cacheSlug = slugifyLocaleText(cand);
    const rioKey = `raiderio-classic-profile-v1-${region}-${realmSlug}-${cacheSlug}`;
    try {
      profile = await getOrRefreshCachedPayload(rioKey, {
        ttlMs: Math.min(3600_000, Math.max(60_000, Number(process.env.WOW_RIO_CACHE_TTL_MS || 900_000))),
        maxStaleMs: Math.min(7 * 86400_000, Math.max(3600_000, Number(process.env.WOW_RIO_CACHE_STALE_MS || 86400_000))),
        loader: () => loadRaiderIoClassicProfileRaw(region, realmSlug, cand),
      });
    } catch {
      profile = null;
    }
    if (profile) {
      rioResolvedLookupName = cand;
      break;
    }
  }

  let out = { ...row, rioProfileLookupName: preferredLookupName };

  const rioClassRaw = profile ? classNameFromRaiderIoClassicProfile(profile) : "";
  const rioClassDisplay = rioClassRaw ? englishWowClassDisplayFromRaidHelper(rioClassRaw) : "";
  const rioSpecDirect = profile ? specNameFromRaiderIoClassicProfile(profile) : null;

  if (profile && rioClassDisplay) {
    out.raiderIoClassName = rioClassDisplay;
  }
  if (rioSpecDirect) {
    out.raiderIoSpecName = rioSpecDirect;
  }

  let blizzardSummary = { className: null, specName: null };
  if (blizzardProfileClientConfigured() && (needsClassRepair || needsSpecLookup)) {
    const blizzardCandidates = wowBlizzardCharacterNameCandidates(row, linksState);
    const bnetTry = blizzardCandidates.length ? blizzardCandidates : [preferredLookupName].filter(Boolean);
    for (const cand of bnetTry) {
      const cacheSlug = slugifyLocaleText(cand);
      const bSumKey = `bnet-classic-character-summary-v3-${region}-${realmSlug}-${cacheSlug}`;
      try {
        blizzardSummary = await getOrRefreshCachedPayload(bSumKey, {
          ttlMs: 3600_000,
          maxStaleMs: 86400_000,
          loader: async () => {
            const fields = await fetchBlizzardClassicCharacterSummaryFields(realmSlug, cand);
            return fields || { className: null, specName: null };
          },
        });
      } catch {
        blizzardSummary = { className: null, specName: null };
      }
      if (blizzardSummary?.className || blizzardSummary?.specName) break;
    }
  }

  const blizzardClassDisplay = blizzardSummary?.className
    ? englishWowClassDisplayFromRaidHelper(blizzardSummary.className)
    : "";
  if (blizzardClassDisplay) {
    out.blizzardClassName = blizzardClassDisplay;
  }

  // Class: keep Raid Helper when trustworthy; Rio fills bogus RH column unless filtered as junk tank prot.
  if (!raidHelperClassIsTrustworthy(row.className)) {
    if (rioClassDisplay && !rioMergedClassLooksWrongForTankProtProtection(row, rioClassRaw)) {
      out.className = rioClassDisplay;
    }
  }
  /** Blizzard armory when class column still empty (skipped Rio armory mismatch — plate tanks, missing RH class). */
  if (!String(out.className || "").trim() && blizzardClassDisplay) {
    out.className = blizzardClassDisplay;
  }

  if (!needsSpecLookup) return out;

  let specName = rioSpecDirect || blizzardSummary?.specName || null;

  const specFallbackCand = rioResolvedLookupName || preferredLookupName;
  if (!specName && blizzardProfileClientConfigured() && specFallbackCand) {
    const bKey = `bnet-classic-active-spec-v3-${region}-${realmSlug}-${slugifyLocaleText(specFallbackCand)}`;
    try {
      specName = await getOrRefreshCachedPayload(bKey, {
        ttlMs: 3600_000,
        maxStaleMs: 86400_000,
        loader: () => fetchBlizzardClassicActiveSpecName(realmSlug, specFallbackCand),
      });
    } catch {
      specName = null;
    }
  }

  if (specName && !String(out.specName || "").trim()) {
    out = { ...out, specName };
  }
  if (specName && !out.raiderIoSpecName) {
    out = { ...out, raiderIoSpecName: specName };
  }
  return out;
}

async function enrichConfirmedRosterExternalSpecs(rows) {
  await ensureRhWclLinksStore();
  const linksState = rhWclLinksState;
  const conc = Math.min(
    16,
    Math.max(1, Number(process.env.WOW_EXTERNAL_SPEC_CONCURRENCY || 6) || 6)
  );
  const out = [];
  for (let i = 0; i < rows.length; i += conc) {
    const slice = rows.slice(i, i + conc);
    out.push(...(await Promise.all(slice.map((row) => enrichRosterRowExternalSpec(row, linksState)))));
  }
  return out;
}

function stripInternalRosterFields(row) {
  const { realm: _r, rioLookupCharacterName: _lu, ...rest } = row;
  /** Express `res.json` drops keys whose value is `undefined` — always expose the lookup label for debugging. */
  const display = stripRealmSuffixFromWowDisplayName(String(rest.name || ""));
  const rhParsedChar = String(_lu || "").trim();
  const rawLu = rest.rioProfileLookupName;
  /** One WoW character identity for Rio/Blizzard + UI (e.g. Mightyboom); signup label stays on `name`. */
  const lookup =
    rawLu != null && String(rawLu).trim()
      ? String(rawLu).trim()
      : rhParsedChar || display;
  return { ...rest, characterName: lookup, rioProfileLookupName: lookup };
}

/** Absolute icon URL when Raid-Helper embeds one on the signup row. */
function raidHelperSpecIconUrlFromSignUpEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  const candidates = [
    entry.specIcon,
    entry.specIconUrl,
    entry.specIconURL,
    entry.iconUrl,
    entry.iconURL,
    entry.classIconUrl,
    entry.specImage,
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return "";
}

/** Spec / class / role text: EU diacritics (e.g. Protéction) + Raid-Helper spacing. */
function slugifyLocaleText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^a-z0-9]+/g, "");
}

/** RH uses Protection1 / Protection2 when two players pick the same spec name — normalize for display and slug logic. */
function normalizeProtectionSpecLabel(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  const slug = slugifyLocaleText(t);
  if (/^protection\d+$/.test(slug)) return "Protection";
  return t;
}

/** Raid Helper sometimes stores the role bucket ("Tank", "Healer") in the class field — breaks zamimg class icons. */
const RAID_HELPER_FALSE_CLASS_SLUGS = new Set([
  "tank",
  "tanks",
  "schutz",
  "healer",
  "healers",
  "melee",
  "ranged",
  "caster",
  "casters",
  "mdps",
  "rdps",
]);

function raidHelperClassFieldLooksLikeRoleNotClass(classRaw) {
  const s = slugifyLocaleText(classRaw);
  if (!s) return true; // missing class — repair from Raider.io when Tank/healer filled the column wrong
  return RAID_HELPER_FALSE_CLASS_SLUGS.has(s);
}

/** Raid Helper sent a real class name (not empty, not role-as-class). */
function raidHelperClassIsTrustworthy(classRaw) {
  const s = slugifyLocaleText(classRaw);
  if (!s) return false;
  return !RAID_HELPER_FALSE_CLASS_SLUGS.has(s);
}

/** Tank + Protection-like spec with no RH class snapshot: Rio often mismatches the armory (wrong player/realm). */
function rioMergedClassLooksWrongForTankProtProtection(row, rioClassRaw) {
  const rhClassSnap = englishCanonicalClassSlugFromLocalizedDisplay(row?.raidHelperClassName);
  if (rhClassSnap) return false;
  const role = slugifyLocaleText(row?.roleName);
  const isTankRole = role === "tank" || role === "tanks" || role === "schutz";
  const spec = slugifyLocaleText(row?.specName);
  const protLike =
    /^protection\d+$/.test(spec) ||
    spec.includes("protection") ||
    spec === "prot" ||
    spec === "schutz" ||
    spec === "tank" ||
    spec === "tanks";
  if (!isTankRole || !protLike) return false;
  const slug = englishCanonicalClassSlugFromLocalizedDisplay(rioClassRaw);
  if (!slug) return false;
  return !["warrior", "paladin", "druid", "deathknight"].includes(slug);
}

/**
 * Class slug for Events roster + WCL icons: merges Raid Helper + Raider.io.
 * If RH says Warrior but Rio says Paladin (or vice versa), prefer Rio — matches armory for mis-clicked RH class.
 */
function englishCanonicalClassSlugForEventsIcons(row) {
  const rh = englishCanonicalClassSlugFromLocalizedDisplay(row?.className);
  const rio = englishCanonicalClassSlugFromLocalizedDisplay(row?.raiderIoClassName);
  const bnet = englishCanonicalClassSlugFromLocalizedDisplay(row?.blizzardClassName);
  const plate = new Set(["paladin", "warrior"]);
  if (plate.has(rh) && plate.has(rio) && rh !== rio) return rio;
  if (rh) return rh;
  if (rio) return rio;
  return bnet || "";
}

function pickWclIconHitForRosterDisplay(iconMap, row) {
  const hitName = pickWclIconHit(iconMap, row?.name);
  if (hitName?.icon) return hitName;
  const lu = String(row?.rioLookupCharacterName || "").trim();
  if (lu) {
    const hitLu = pickWclIconHit(iconMap, lu);
    if (hitLu?.icon) return hitLu;
  }
  return null;
}

function classNameFromRaiderIoClassicProfile(data) {
  if (!data || typeof data !== "object") return "";
  const c = data.class;
  if (typeof c === "string" && c.trim()) return c.trim();
  if (c && typeof c === "object" && typeof c.name === "string" && c.name.trim()) return c.name.trim();
  const ch = data.character;
  if (ch && typeof ch === "object") {
    const cc = ch.class;
    if (typeof cc === "string" && cc.trim()) return cc.trim();
    if (cc && typeof cc === "object" && typeof cc.name === "string" && cc.name.trim()) return cc.name.trim();
  }
  return "";
}

/**
 * Canonical prot spec badges — same URLs as `public/tbc-spec-icons.json` (see `scripts/fetch-tbc-spec-icons.mjs`).
 * Blizzard spell media can differ by patch; we always send one zamimg texture per spec.
 */
const ZAMIMG_PROT_SPEC_ICON_URL = {
  paladin: "https://wow.zamimg.com/images/wow/icons/large/spell_holy_sealofprotection.jpg",
  warrior: "https://wow.zamimg.com/images/wow/icons/large/ability_warrior_defensivestance.jpg",
};

/** Feral spec spell on Wowhead is cat-form; tanking druids use bear (matches events UI `specIconZamimgUrlForKey`). */
const ZAMIMG_DRUID_BEAR_TANK_ICON_URL =
  "https://wow.zamimg.com/images/wow/icons/large/ability_racial_bearform.jpg";

function protIconTextureLooksWarrior(iconUrl) {
  const u = String(iconUrl || "").toLowerCase();
  return (
    u.includes("ability_warrior_defensivestance") ||
    u.includes("ability_warrior_shieldwall") ||
    u.includes("inv_shield_06") ||
    u.includes("inv_shield_05")
  );
}

function protIconTextureLooksPaladin(iconUrl) {
  const u = String(iconUrl || "").toLowerCase();
  return (
    u.includes("spell_holy_sealofprotection") ||
    u.includes("spell_holy_devotionaura") ||
    u.includes("spell_holy_sealofvengeance") ||
    u.includes("spell_holy_righteousfury")
  );
}

/**
 * WCL Damage Done uses one "Protection" type for both classes; the icon can disagree with Raid-Helper class.
 * Skip WCL badge when the texture clearly belongs to the other tank class so canonical specIconUrl wins client-side.
 */
function wclProtIconAgreesWithRosterClass(iconUrl, row) {
  const cls = englishCanonicalClassSlugForEventsIcons(row);
  const war = protIconTextureLooksWarrior(iconUrl);
  const pal = protIconTextureLooksPaladin(iconUrl);
  // Missing or non-plate tank class: do not attach a one-sided prot texture from WCL (plate tanks share "Protection" type).
  if (cls !== "paladin" && cls !== "warrior") {
    if ((war && !pal) || (pal && !war)) return false;
    return true;
  }
  if (cls === "paladin" && war && !pal) return false;
  if (cls === "warrior" && pal && !war) return false;
  return true;
}

/** Damage-done icon filenames often spell out another class (e.g. Shaman lightning on a Warrior row after name collision). */
function wclIconTextureLooksShaman(iconUrl) {
  const u = String(iconUrl || "").toLowerCase();
  return (
    u.includes("spell_nature_lightning") ||
    u.includes("spell_nature_magicimmunity") ||
    u.includes("spell_shaman") ||
    u.includes("ability_shaman") ||
    u.includes("spell_fire_totem") ||
    u.includes("spell_nature_earthbind") ||
    u.includes("spell_nature_nullwolf") ||
    u.includes("spell_nature_healingwave") ||
    u.includes("spell_fire_elementaldevastation")
  );
}

function wclIconTextureLooksWarriorFuryOrArms(iconUrl) {
  const u = String(iconUrl || "").toLowerCase();
  return (
    u.includes("ability_warrior_savageblow") ||
    u.includes("ability_warrior_innerrage") ||
    u.includes("spell_nature_bloodlust") ||
    u.includes("ability_dualwield") ||
    u.includes("ability_whirlwind")
  );
}

/** Best-effort class slug from WCL Damage Done `type` (English labels). Empty = skip type check. */
function classSlugFromWclDamageDoneType(typeRaw) {
  const t = slugifyLocaleText(typeRaw);
  if (!t) return "";
  if (t === "arms" || t === "fury") return "warrior";
  if (t === "elemental" || t === "enhancement") return "shaman";
  if (t === "balance" || t === "feral" || t === "guardian") return "druid";
  if (t === "arcane" || t === "fire" || t === "frost") return "mage";
  if (t === "affliction" || t === "demonology" || t === "destruction") return "warlock";
  if (t === "assassination" || t === "combat" || t === "subtlety") return "rogue";
  if (t === "beastmastery" || t === "marksmanship" || t === "survival") return "hunter";
  if (t === "shadow" || t === "discipline") return "priest";
  /** Restoration / Protection appear on two classes — rely on texture checks instead. */
  return "";
}

function wclCombatSpecTypeAgreesWithRoster(row, wclTypeRaw) {
  const rosterCls = englishCanonicalClassSlugForEventsIcons(row);
  const implied = classSlugFromWclDamageDoneType(wclTypeRaw);
  if (!implied || !rosterCls) return true;
  return implied === rosterCls;
}

function wclDamageDoneIconAgreesWithRoster(iconUrl, row, wclTypeRaw = "") {
  const cls = englishCanonicalClassSlugForEventsIcons(row);
  if (!cls) {
    return wclProtIconAgreesWithRosterClass(iconUrl, row);
  }
  if (!wclProtIconAgreesWithRosterClass(iconUrl, row)) return false;
  if (!wclCombatSpecTypeAgreesWithRoster(row, wclTypeRaw)) return false;
  if (cls === "warrior" && wclIconTextureLooksShaman(iconUrl)) return false;
  if (cls === "shaman" && wclIconTextureLooksWarriorFuryOrArms(iconUrl)) return false;
  return true;
}

/** Always set Raid-Helper rows to the canonical texture so API matches events UI (overwrites wrong RH icons). */
function attachClassicSpecSpellIconIfNeeded(row) {
  const cls = englishCanonicalClassSlugForEventsIcons(row);
  const role = slugifyLocaleText(row?.roleName);
  const spec = slugifyLocaleText(row?.specName);
  const isTankRole = role === "tank" || role === "tanks" || role === "schutz";
  const protLike =
    spec.includes("protection") ||
    spec === "prot" ||
    spec === "schutz" ||
    spec === "tank" ||
    spec === "tanks";
  if (cls === "druid" && isTankRole) {
    return { ...row, specIconUrl: ZAMIMG_DRUID_BEAR_TANK_ICON_URL };
  }
  if (cls === "paladin" && (isTankRole || protLike)) {
    return { ...row, specIconUrl: ZAMIMG_PROT_SPEC_ICON_URL.paladin };
  }
  if (cls === "warrior" && (isTankRole || protLike)) {
    return { ...row, specIconUrl: ZAMIMG_PROT_SPEC_ICON_URL.warrior };
  }
  return row;
}

/**
 * Active roster has no Raid Helper signup context; we default `roleName` to Ranged. After Rio/Blizzard spec
 * enrichment, infer Healers / Tanks so parse bracket + “parsing ceiling” badge match the toon’s real role.
 */
function inferActiveRosterRoleNameFromSpec(row) {
  const specRaw = normalizeProtectionSpecLabel(String(row?.specName || row?.raiderIoSpecName || row?.blizzardSpecName || ""));
  const spec = slugifyLocaleText(specRaw);
  const cls = englishCanonicalClassSlugForEventsIcons(row);
  if (!spec) return null;

  if (
    spec.includes("protection") ||
    /^protection\d*$/.test(spec) ||
    spec.includes("guardian") ||
    spec.includes("brewmaster") ||
    (cls === "deathknight" && spec.includes("blood"))
  ) {
    return "Tanks";
  }

  if (
    (cls === "priest" && (spec.includes("holy") || spec.includes("discipline") || spec === "disc")) ||
    (cls === "paladin" && spec.includes("holy")) ||
    (cls === "shaman" && spec.includes("restoration")) ||
    (cls === "druid" && (spec.includes("restoration") || spec === "resto")) ||
    (cls === "monk" && spec.includes("mistweaver")) ||
    (cls === "evoker" && spec.includes("preservation"))
  ) {
    return "Healers";
  }

  if (cls === "hunter" || cls === "mage" || cls === "warlock") return "Ranged";
  if (cls === "priest" && spec.includes("shadow")) return "Ranged";
  if (cls === "druid" && spec.includes("balance")) return "Ranged";
  if (cls === "shaman" && spec.includes("elemental")) return "Ranged";
  if (cls === "rogue") return "Melee";
  if (cls === "warrior" && (spec.includes("arms") || spec.includes("fury"))) return "Melee";
  if (cls === "paladin" && spec.includes("retribution")) return "Melee";
  if (cls === "deathknight" && (spec.includes("frost") || spec.includes("unholy"))) return "Melee";
  if (cls === "shaman" && spec.includes("enhancement")) return "Melee";
  if (cls === "druid" && spec.includes("feral")) return "Melee";

  return null;
}

/** Reuse filtered guild reports across endpoints so the dashboard does not queue 6 identical WCL pulls (GraphQL calls are serialized). */
function wclGuildReportsCacheTtlMs() {
  const n = Number(process.env.WCL_GUILD_REPORTS_CACHE_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(600_000, n);
  return 180_000;
}

const GUILD_REPORTS_QUERY_DASHBOARD = `
  query GuildReports($guildId: Int!, $limit: Int!) {
    reportData {
      reports(guildID: $guildId, limit: $limit) {
        data {
          code
          title
          startTime
          endTime
          rankedCharacters {
            name
          }
          owner {
            name
          }
          zone {
            name
          }
          fights {
            id
            encounterID
            name
            kill
            startTime
            endTime
            gameZone {
              name
            }
          }
        }
      }
    }
  }
`;

const filteredGuildReportsCache = new Map();
/** When the dashboard fires many endpoints at once, reuse the same in-flight WCL pull. */
const filteredGuildReportsInflight = new Map();

async function getFilteredGuildReportsForGuild(guildId, sliceLimit) {
  const maxL = wclMaxGuildReportsLimit();
  const want = Math.min(maxL, Math.max(1, Number(sliceLimit) || maxL));
  const key = `${guildId}:${maxL}`;
  const ttl = wclGuildReportsCacheTtlMs();
  const now = Date.now();

  const hit = filteredGuildReportsCache.get(key);
  if (hit && now - hit.at <= ttl) {
    return hit.reports.slice(0, want);
  }

  let inflight = filteredGuildReportsInflight.get(key);
  if (!inflight) {
    inflight = (async () => {
      try {
        const data = await queryWcl(GUILD_REPORTS_QUERY_DASHBOARD, { guildId, limit: maxL });
        return filterGuildRaidReports(data?.reportData?.reports?.data || []);
      } finally {
        filteredGuildReportsInflight.delete(key);
      }
    })();
    filteredGuildReportsInflight.set(key, inflight);
  }

  const reports = await inflight;
  filteredGuildReportsCache.set(key, { at: Date.now(), reports });
  return reports.slice(0, want);
}

/** Comma-separated WCL site usernames; earlier = higher priority when deduping same-day raids. */
function wclPriorityUploaders() {
  const raw = process.env.WCL_PRIORITY_LOG_UPLOADERS || "tibtoth";
  return raw
    .split(",")
    .map((s) => normalizeText(s))
    .filter(Boolean);
}

function raidCalendarDayKey(startTimeMs) {
  const ms = Number(startTimeMs || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  try {
    return new Date(ms).toLocaleDateString("en-CA", { timeZone: wclCalendarTimeZone() });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function choosePreferredRaidCalendarEntry(a, b, priorityList) {
  const score = (entry) => {
    const n = normalizeText(entry.uploadedBy || "");
    const idx = priorityList.findIndex((p) => p === n);
    return idx === -1 ? priorityList.length : idx;
  };
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa < sb ? a : b;
  return (Number(b.startTime) || 0) >= (Number(a.startTime) || 0) ? b : a;
}

function dedupeRaidCalendarEntries(entries) {
  const priorityList = wclPriorityUploaders();
  const groups = new Map();
  for (const entry of entries) {
    const dayKey = raidCalendarDayKey(entry.startTime);
    if (!dayKey) continue;
    const k = `${dayKey}::${entry.raidName}`;
    const prev = groups.get(k);
    if (!prev) {
      groups.set(k, entry);
      continue;
    }
    groups.set(k, choosePreferredRaidCalendarEntry(prev, entry, priorityList));
  }
  return [...groups.values()].sort((a, b) => b.startTime - a.startTime);
}

function buildRecentRaidCalendarEntries(reports) {
  const entries = [];
  for (const report of reports) {
    const zoneBuckets = new Map();
    for (const fight of report.fights || []) {
      if (Number(fight?.encounterID || 0) <= 0) continue;
      const raidName = resolvedTrackedRaidForFight(fight, report);
      if (!raidName || !TRACKED_RAIDS[raidName]) continue;
      if (!zoneBuckets.has(raidName)) zoneBuckets.set(raidName, []);
      zoneBuckets.get(raidName).push(fight);
    }

    for (const [raidName, zoneFights] of zoneBuckets) {
      const bosses = TRACKED_RAIDS[raidName];
      const kills = zoneFights.filter((fight) => fight?.kill && bossListMatchesFightName(bosses, fight.name));
      const uniqueKilled = new Set(kills.map((fight) => resolveBossCanonicalName(bosses, fight.name)));
      const bossesKilled = uniqueKilled.size;
      const bossesTotal = bosses.length;

      let clearDurationMs = null;
      let isFullClear = false;
      if (bossesKilled === bossesTotal && kills.length) {
        const clearStart = Math.min(...kills.map((fight) => Number(fight.startTime || 0)));
        const clearEnd = Math.max(...kills.map((fight) => Number(fight.endTime || 0)));
        const clearMs = clearEnd - clearStart;
        if (Number.isFinite(clearMs) && clearMs > 0) {
          clearDurationMs = clearMs;
          isFullClear = true;
        }
      }

      entries.push({
        reportCode: report.code,
        title: report.title || report.code,
        startTime: reportStartTimeMs(report.startTime),
        uploadedBy: report.owner?.name || null,
        raidName,
        clearDurationMs,
        isFullClear,
        bossesKilled,
        bossesTotal,
        wclUrl: `https://fresh.warcraftlogs.com/reports/${report.code}`,
        image: raidImageFromRaidName(raidName),
      });
    }
  }

  const dedupedEntries = dedupeRaidCalendarEntries(entries);

  for (const entry of dedupedEntries) {
    entry.calendarDay = raidCalendarDayKey(entry.startTime);
  }

  const durationsByRaid = new Map();
  for (const entry of dedupedEntries) {
    if (!entry.isFullClear || !entry.clearDurationMs) continue;
    if (!durationsByRaid.has(entry.raidName)) durationsByRaid.set(entry.raidName, []);
    durationsByRaid.get(entry.raidName).push(entry.clearDurationMs);
  }

  const boundsByRaid = new Map();
  for (const [raidName, durs] of durationsByRaid) {
    boundsByRaid.set(raidName, { min: Math.min(...durs), max: Math.max(...durs) });
  }

  for (const entry of dedupedEntries) {
    if (!entry.isFullClear || !entry.clearDurationMs) {
      entry.clearHeat = null;
      continue;
    }
    const { min, max } = boundsByRaid.get(entry.raidName) || { min: 0, max: 0 };
    if (max <= min) entry.clearHeat = 1;
    else entry.clearHeat = 1 - (entry.clearDurationMs - min) / (max - min);
  }

  const fastestClearMsByRaid = new Map();
  for (const entry of dedupedEntries) {
    if (!entry.isFullClear || !entry.clearDurationMs) continue;
    const prev = fastestClearMsByRaid.get(entry.raidName);
    if (prev === undefined || entry.clearDurationMs < prev) {
      fastestClearMsByRaid.set(entry.raidName, entry.clearDurationMs);
    }
  }
  for (const entry of dedupedEntries) {
    entry.isBestClearInCalendar = false;
    entry.deltaBehindBestMs = null;
    if (!entry.isFullClear || !entry.clearDurationMs) continue;
    const best = fastestClearMsByRaid.get(entry.raidName);
    if (best === undefined) continue;
    entry.deltaBehindBestMs = entry.clearDurationMs - best;
    entry.isBestClearInCalendar = entry.clearDurationMs === best;
  }

  dedupedEntries.sort((a, b) => b.startTime - a.startTime);
  return dedupedEntries;
}

async function fetchRaidHelperServerEvents(serverId) {
  const apiKey = process.env.RAID_HELPER_API_KEY;
  if (!apiKey) throw new Error("Missing RAID_HELPER_API_KEY in .env");
  if (!serverId) throw new Error("Missing Raid-Helper server id");

  const firstUrl = `${RAID_HELPER_API_URL}/servers/${serverId}/events?page=1`;
  const firstRes = await fetch(firstUrl, {
    headers: { Accept: "application/json", Authorization: apiKey },
  });
  if (!firstRes.ok) {
    const message = await firstRes.text();
    throw new Error(`Raid-Helper server events failed (${firstRes.status}): ${message.slice(0, 180)}`);
  }
  const firstPayload = await firstRes.json();
  const totalPages = Math.max(1, Number(firstPayload?.pages || 1));
  const events = [...(firstPayload?.postedEvents || [])];

  for (let page = 2; page <= totalPages; page += 1) {
    const url = `${RAID_HELPER_API_URL}/servers/${serverId}/events?page=${page}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: apiKey },
    });
    if (!res.ok) continue;
    const payload = await res.json();
    events.push(...(payload?.postedEvents || []));
  }

  return events;
}

async function fetchRaidHelperEventDetail(eventId) {
  const apiKey = process.env.RAID_HELPER_API_KEY;
  const url = `${RAID_HELPER_API_URL}/events/${eventId}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: apiKey },
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Count primary Raid Helper signups per normalized RH key across **past** posted events (same filters as events KPI).
 * @returns {Promise<{ counts: Map<string, number>, pastEventsScanned: number }>}
 */
async function countRaidHelperPrimarySignupsPerRhKey(maxPastEvents) {
  const serverId = raidHelperDiscordGuildId() || "711838953430319115";
  const excludedClasses = new Set(["Absence", "Bench", "Tentative", "Late"]);
  const nowSec = Math.floor(Date.now() / 1000);
  const cap = Math.min(150, Math.max(1, Math.floor(Number(maxPastEvents || 80))));

  const allEvents = await fetchRaidHelperServerEvents(serverId);
  const pastEvents = allEvents
    .map((event) => ({
      id: String(event.id || event.eventId || event.eventID || ""),
      startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
    }))
    .filter((e) => e.id && e.startTime > 0 && e.startTime <= nowSec)
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, cap);

  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const ev of pastEvents) {
    const detail = await fetchRaidHelperEventDetail(ev.id);
    if (!detail) continue;
    const signUps = Array.isArray(detail.signUps) ? detail.signUps : [];
    for (const entry of signUps) {
      if (String(entry?.status || "").toLowerCase() !== "primary") continue;
      if (excludedClasses.has(raidHelperClassNameFromSignUpEntry(entry))) continue;
      const name = String(entry?.name || "").trim();
      const key = normalizeRaidHelperDisplayKey(name);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return { counts, pastEventsScanned: pastEvents.length };
}

/**
 * Unique signup display names from the most recent Raid Helper posted events (for RH ↔ WCL guessing).
 * @returns {{ names: string[], scannedEvents: Array<{ id: string, startTime: number }> }}
 */
async function collectRaidHelperSignupDisplayNames(serverId, maxEvents = 6) {
  const apiKey = process.env.RAID_HELPER_API_KEY;
  if (!apiKey) throw new Error("Missing RAID_HELPER_API_KEY");

  const events = await fetchRaidHelperServerEvents(serverId);
  const limit = Math.max(1, Math.min(40, maxEvents));
  const withTime = events
    .map((event) => ({
      id: String(event.id || event.eventId || event.eventID || ""),
      startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
    }))
    .filter((event) => event.id)
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, limit);

  const scannedEvents = withTime.map((e) => ({ id: e.id, startTime: e.startTime }));

  const byNorm = new Map();
  for (const event of withTime) {
    const detail = await fetchRaidHelperEventDetail(event.id);
    const signUps = Array.isArray(detail?.signUps) ? detail.signUps : [];
    for (const entry of signUps) {
      const name = String(entry?.name || "").trim();
      if (!name) continue;
      const key = normalizeRaidHelperDisplayKey(name);
      if (!key) continue;
      if (!byNorm.has(key)) byNorm.set(key, name);
    }
  }
  return {
    names: [...byNorm.values()].sort((a, b) => a.localeCompare(b)),
    scannedEvents,
  };
}

async function raidHelperRequest(pathname, { method = "GET", body } = {}) {
  const apiKey = process.env.RAID_HELPER_API_KEY;
  if (!apiKey) throw new Error("Missing RAID_HELPER_API_KEY in .env");
  const res = await fetch(`${RAID_HELPER_API_URL}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: apiKey,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const rawText = await res.text();
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const detail = parsed?.error || parsed?.message || rawText || "Raid-Helper API error";
    const err = new Error(`Raid-Helper request failed (${res.status}): ${String(detail).slice(0, 200)}`);
    err.statusCode = res.status;
    throw err;
  }
  return parsed;
}

function raidHelperSignupProfileFromEntry(entry, fallbackName = "") {
  if (!entry) return null;
  const className = raidHelperClassNameFromSignUpEntry(entry);
  const roleName = normalizeRaidHelperRoleLabel(
    String(entry?.roleName || entry?.role || entry?.cRoleName || entry?.cRole || "").trim()
  );
  const specName = normalizeProtectionSpecLabel(String(entry?.specName || entry?.cSpecName || "").trim());
  if (!className || !roleName) return null;
  return {
    userId: String(entry?.userId || "").trim(),
    name: String(entry?.name || fallbackName || "").trim(),
    className: englishWowClassDisplayFromRaidHelper(className),
    roleName,
    specName,
  };
}

async function resolveRaidHelperSignupProfileForUser(serverId, userId, fallbackName = "") {
  const events = await fetchRaidHelperServerEvents(serverId);
  const withTime = events
    .map((event) => ({
      id: String(event.id || event.eventId || event.eventID || ""),
      startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
    }))
    .filter((event) => event.id)
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, 20);

  for (const event of withTime) {
    const detail = await fetchRaidHelperEventDetail(event.id);
    const signUps = Array.isArray(detail?.signUps) ? detail.signUps : [];
    const row = signUps.find((entry) => String(entry?.userId || "") === String(userId || ""));
    const profile = raidHelperSignupProfileFromEntry(row, fallbackName);
    if (profile) return profile;
  }
  return null;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "fallen-tacticians-api" });
});

app.get("/api/wcl/guild/:guildId/reports", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const limit = Math.min(20, Math.max(1, Number(req.query.limit || 10)));
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  const query = `
    query GuildReports($guildId: Int!, $limit: Int!) {
      reportData {
        reports(guildID: $guildId, limit: $limit) {
          data {
            code
            title
            startTime
            endTime
            rankedCharacters {
              name
            }
            endTime
            zone { name }
            fights {
              id
              name
              gameZone { name }
            }
          }
        }
      }
    }
  `;

  try {
    const data = await queryWcl(query, { guildId, limit });
    const reports = filterGuildRaidReports(data?.reportData?.reports?.data || []);

    const normalizedReports = reports.map((report) => {
      const allowedFights = (report.fights || []).filter((fight) =>
        allowedTbcZones.has(fight?.gameZone?.name || "")
      );
      return {
        code: report.code,
        title: report.title,
        zoneName: report?.zone?.name || null,
        startTime: report.startTime,
        endTime: report.endTime,
        fights: allowedFights.map((fight) => ({
          id: fight.id,
          name: fight.name,
          zoneName: fight?.gameZone?.name || null,
        })),
      };
    });

    return res.json({
      guildId,
      reports: normalizedReports.filter((report) => report.fights.length > 0),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/sync/wcl-raid-helper/:guildId/relevant-ids", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const reportLimit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(5, Number(req.query.limit || 20))
  );
  const serverId = raidHelperDiscordGuildId() || "711838953430319115";
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  const reportsQuery = `
    query GuildReports($guildId: Int!, $limit: Int!) {
      reportData {
        reports(guildID: $guildId, limit: $limit) {
          data {
            code
            title
            startTime
            owner {
              name
            }
            rankedCharacters {
              name
            }
            fights {
              id
              encounterID
              startTime
              endTime
              gameZone { name }
            }
          }
        }
      }
    }
  `;

  try {
    const wclData = await queryWcl(reportsQuery, { guildId, limit: reportLimit });
    const reports = filterGuildRaidReports(wclData?.reportData?.reports?.data || []);
    const wclRaids = reports
      .filter((report) =>
        (report.fights || []).some((fight) => {
          const zone = fight?.gameZone?.name || "";
          return Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zone) && Number(fight?.encounterID || 0) > 0;
        })
      )
      .map((report) => ({
        reportCode: report.code,
        title: report.title || report.code,
        startTime: Number(report.startTime || 0),
        startDateDmy: report.startTime ? toDmy(new Date(Number(report.startTime))) : null,
        keywords: raidKeywordsFromWclTitle(report.title || ""),
      }));

    const rhEvents = await fetchRaidHelperServerEvents(serverId);
    const normalizedRhEvents = rhEvents.map((event) => ({
      eventId: String(event.id || event.eventId || event.eventID || ""),
      title: String(event.title || ""),
      titleNorm: normalizeText(event.title || ""),
      timestampSec: Number(event.timestamp || event.time || event.start || event.startTime || 0),
      date: String(event.date || ""),
      dateObj:
        parseDmyToDate(event.date || "") ||
        (Number(event.timestamp || event.time || event.start || event.startTime || 0) > 0
          ? new Date(Number(event.timestamp || event.time || event.start || event.startTime || 0) * 1000)
          : null),
    }));

    // Enrich missing dates from event detail endpoint so date matching remains primary.
    for (const event of normalizedRhEvents) {
      if (!event.eventId || event.dateObj) continue;
      const detail = await fetchRaidHelperEventDetail(event.eventId);
      const detailDate = String(detail?.date || "");
      const detailTs = Number(detail?.timestamp || detail?.time || detail?.start || detail?.startTime || 0);
      if (detailDate) {
        event.date = detailDate;
        event.dateObj = parseDmyToDate(detailDate);
      }
      if (!event.dateObj && detailTs > 0) {
        event.timestampSec = detailTs;
        event.dateObj = new Date(detailTs * 1000);
      }
    }

    const relevant = [];
    const usedEventIds = new Set();
    for (const raid of wclRaids) {
      const raidDateObj = raid.startDateDmy ? parseDmyToDate(raid.startDateDmy) : null;
      let best = null;

      for (const event of normalizedRhEvents) {
        if (!event.eventId) continue;
        if (usedEventIds.has(event.eventId)) continue;
        let score = 0;

        // Primary: date matching.
        if (raidDateObj && event.dateObj) {
          const dayDiff = Math.abs(Math.round((raidDateObj - event.dateObj) / 86_400_000));
          if (dayDiff === 0) score += 120;
          else if (dayDiff === 1) score += 80;
          else if (dayDiff <= 3) score += 40;
        }

        // Secondary: title keyword matching.
        for (const kw of raid.keywords) {
          if (event.titleNorm.includes(kw)) score += 20;
        }

        // Tertiary: timestamp proximity as weak tie-breaker.
        if (raid.startTime > 0 && event.timestampSec > 0) {
          const diffHours = Math.abs(Math.floor(raid.startTime / 1000) - event.timestampSec) / 3600;
          if (diffHours <= 24) score += 10;
          else if (diffHours <= 72) score += 5;
        }

        if (!best || score > best.score) {
          best = { ...event, score };
        }
      }

      if (best && best.score >= 60) {
        usedEventIds.add(best.eventId);
        relevant.push({
          wclReportCode: raid.reportCode,
          wclTitle: raid.title,
          wclStartTime: raid.startTime,
          wclDate: raid.startDateDmy,
          raidHelperEventId: best.eventId,
          raidHelperTitle: best.title,
          raidHelperDate:
            best.date ||
            (best.dateObj instanceof Date && !Number.isNaN(best.dateObj.getTime())
              ? toDmy(best.dateObj)
              : ""),
          confidence: best.score >= 120 ? "high" : "medium",
          score: best.score,
        });
      }
    }

    // Unique event IDs, filtered by WCL source-of-truth mapping.
    const relevantEventIds = [...new Set(relevant.map((row) => row.raidHelperEventId))];

    return res.json({
      guildId,
      sourceOfTruth: "warcraftlogs",
      raidHelperServerId: serverId,
      relevantEventIds,
      mappings: relevant,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

/**
 * Run async work on `items` with at most `limit` concurrent iterators. Results stay index-aligned with `items`.
 */
async function mapWithConcurrency(items, limit, fn) {
  const n = items.length;
  if (!n) return [];
  const cap = Math.max(1, Math.min(limit, n));
  const out = new Array(n);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= n) break;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: cap }, () => worker()));
  return out;
}

app.get("/api/raid-helper/future-events", async (_req, res) => {
  const serverId = raidHelperDiscordGuildId() || "711838953430319115";
  const nowSec = Math.floor(Date.now() / 1000);
  const excludedClasses = new Set(["Absence", "Bench", "Tentative", "Late"]);
  const session = getSessionFromRequest(_req);
  const viewerUserId = String(session?.user?.id || "");

  try {
    const events = await fetchRaidHelperServerEvents(serverId);
    const future = events
      .map((event) => ({
        id: String(event.id || event.eventId || event.eventID || ""),
        title: String(event.title || "Unnamed Event"),
        description: String(event.description || ""),
        startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
        endTime: Number(event.endTime || 0),
        date: String(event.date || ""),
        signUpCount: Number(event.signUpCount || 0),
        leaderName: String(event.leaderName || ""),
        softresId: String(event.softresId || ""),
        channelName: String(event.channelName || ""),
      }))
      .filter((event) => event.id && event.startTime > nowSec)
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, 20);

    await ensureRhWclLinksStore();
    /** Raid Helper display key → guild rank from Account Assignment (`rh-wcl-character-links.json`). */
    const guildRoleByRhKey = new Map();
    for (const link of rhWclLinksState.links || []) {
      const k = normalizeRaidHelperDisplayKey(String(link?.raidHelperName || ""));
      if (k) guildRoleByRhKey.set(k, normalizeRhWclGuildRole(link?.guildRole));
    }

    const rhFutureConc = Math.min(
      16,
      Math.max(1, Number(process.env.RAID_HELPER_FUTURE_EVENTS_CONCURRENCY || 6) || 6)
    );

    const detailed = await mapWithConcurrency(future, rhFutureConc, async (event) => {
      const detail = await fetchRaidHelperEventDetail(event.id);
      const signUps = Array.isArray(detail?.signUps) ? detail.signUps : [];

      const rosterBase = signUps
        .filter(
          (entry) =>
            String(entry?.status || "").toLowerCase() === "primary" &&
            !excludedClasses.has(raidHelperClassNameFromSignUpEntry(entry))
        )
        .map((entry) => {
          const rhClass = englishWowClassDisplayFromRaidHelper(raidHelperClassNameFromSignUpEntry(entry));
          const rhSpec = normalizeProtectionSpecLabel(String(entry?.specName || entry?.cSpecName || "").trim());
          const rhKey = normalizeRaidHelperDisplayKey(String(entry?.name || ""));
          return {
            name: String(entry?.name || ""),
            /** In-game character for Raider.io / Blizzard — explicit RH fields or slash segment (see RAID_HELPER_SIGNUP_SLASH_CHARACTER). */
            rioLookupCharacterName: raidHelperCharacterNameForRaiderIoLookup(entry),
            className: rhClass,
            specName: rhSpec,
            /** Snapshot before Raider.io merge — spec vs class stay inspectable per signup. */
            raidHelperClassName: rhClass,
            raidHelperSpecName: rhSpec,
            roleName: normalizeRaidHelperRoleLabel(
              String(entry?.roleName || entry?.role || entry?.cRoleName || entry?.cRole || "").trim()
            ),
            race: raidHelperRaceFromSignUpEntry(entry),
            gender: raidHelperGenderFromSignUpEntry(entry),
            specIconUrl: raidHelperSpecIconUrlFromSignUpEntry(entry),
            realm: raidHelperRealmFromSignUpEntry(entry) || defaultWowRealmForRoster(),
            guildRole: guildRoleByRhKey.get(rhKey) ?? "Peon",
          };
        })
        .filter((entry) => entry.name)
        .sort((a, b) => a.name.localeCompare(b.name));

      let confirmedRoster = await enrichConfirmedRosterExternalSpecs(rosterBase);
      confirmedRoster = await Promise.all(confirmedRoster.map((row) => attachClassicSpecSpellIconIfNeeded(row)));
      confirmedRoster = await enrichConfirmedRosterWithWclSpecIcons(confirmedRoster);
      confirmedRoster = confirmedRoster.map(stripInternalRosterFields);

      const rosterByRole = {
        Tanks: confirmedRoster.filter((x) => x.roleName === "Tanks").length,
        Healers: confirmedRoster.filter((x) => x.roleName === "Healers").length,
        Melee: confirmedRoster.filter((x) => x.roleName === "Melee").length,
        Ranged: confirmedRoster.filter((x) => x.roleName === "Ranged").length,
      };

      return {
        ...event,
        raidImage: raidImageFromTitle(`${event.title} ${event.description}`),
        headerImage: raidHelperHeaderImage(detail),
        discord: {
          channelId: String(detail?.channelId || event?.channelId || ""),
          url:
            detail?.channelId || event?.channelId
              ? `https://discord.com/channels/${serverId}/${detail?.channelId || event?.channelId}`
              : null,
        },
        raidHelper: {
          url: `https://raid-helper.xyz/events/${event.id}`,
        },
        softres: {
          enabled: Boolean(event.softresId),
          id: event.softresId || null,
          url: event.softresId ? `https://softres.it/raid/${event.softresId}` : null,
        },
        signups: {
          total: signUps.length,
          confirmed: confirmedRoster.length,
        },
        currentUserSignup:
          viewerUserId &&
          signUps.find((entry) => String(entry?.userId || "") === viewerUserId && String(entry?.status || ""))
            ? (() => {
                const match = signUps.find((entry) => String(entry?.userId || "") === viewerUserId);
                return {
                  signupId: Number(match?.id || 0),
                  status: String(match?.status || ""),
                  className: englishWowClassDisplayFromRaidHelper(raidHelperClassNameFromSignUpEntry(match)),
                  specName: normalizeProtectionSpecLabel(String(match?.specName || match?.cSpecName || "").trim()),
                  roleName: normalizeRaidHelperRoleLabel(
                    String(match?.roleName || match?.role || match?.cRoleName || match?.cRole || "").trim()
                  ),
                };
              })()
            : null,
        rosterByRole,
        confirmedRoster,
      };
    });

    return res.json({
      serverId,
      count: detailed.length,
      events: detailed,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

/**
 * KPIs: unique primary raiders across scanned Raid Helper history; mean WCL attendance % for
 * Account Assignment **Core** guild role; total Gargul loot rows (guild loot history).
 */
app.get("/api/raid-helper/events-kpi", async (req, res) => {
  const guildId = Number(req.query.guildId || process.env.VOTING_GUILD_ID || 817080);
  const maxPastEvents = Math.min(150, Math.max(1, Math.floor(Number(req.query.maxPastEvents || 80))));
  const wclLimit = Math.min(wclMaxGuildReportsLimit(), Math.max(10, Number(req.query.wclLimit || 40)));
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  const serverId = raidHelperDiscordGuildId() || "711838953430319115";
  const excludedClasses = new Set(["Absence", "Bench", "Tentative", "Late"]);
  const nowSec = Math.floor(Date.now() / 1000);

  const cacheKey = eventsKpiCacheKey({ guildId, maxPastEvents, wclLimit });
  try {
    const payload = await getEventsKpiCached(cacheKey, async () => {
    const allEvents = await fetchRaidHelperServerEvents(serverId);
    const pastEvents = allEvents
      .map((event) => ({
        id: String(event.id || event.eventId || event.eventID || ""),
        startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
      }))
      .filter((e) => e.id && e.startTime > 0 && e.startTime <= nowSec)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, maxPastEvents);

    const rhKpiConc = Math.min(
      16,
      Math.max(1, Number(process.env.RAID_HELPER_FUTURE_EVENTS_CONCURRENCY || 6) || 6)
    );

    const [keyLists] = await Promise.all([
      mapWithConcurrency(pastEvents, rhKpiConc, async (ev) => {
        const detail = await fetchRaidHelperEventDetail(ev.id);
        if (!detail) return [];
        const signUps = Array.isArray(detail.signUps) ? detail.signUps : [];
        const keys = [];
        for (const entry of signUps) {
          if (String(entry?.status || "").toLowerCase() !== "primary") continue;
          if (excludedClasses.has(raidHelperClassNameFromSignUpEntry(entry))) continue;
          const name = String(entry?.name || "").trim();
          const key = normalizeRaidHelperDisplayKey(name);
          if (!key) continue;
          keys.push(key);
        }
        return keys;
      }),
      Promise.all([ensureRhWclLinksStore(), ensureGargulLootHistoryStore()]),
    ]);

    const uniqueKeys = new Set(keyLists.flat());

    const reportLimit = wclLimit;
    const { raidSnapshots, wclDisplayByLower, raidRankingPayloads } = await gatherAttendanceRaidSnapshots(
      guildId,
      reportLimit,
      { attendancePercentMetrics: true }
    );
    const linkedPayload = buildRhWclLinkedAttendanceLeaderboard(
      raidSnapshots,
      rhWclLinksState,
      300,
      wclDisplayByLower,
      raidRankingPayloads
    );

    let coreAttendanceSum = 0;
    let coreAttendanceCount = 0;
    let linkedAttendanceSum = 0;
    let linkedAttendanceCount = 0;
    for (const row of linkedPayload.leaderboard) {
      const r = Number(row.attendanceRate ?? 0);
      if (Number.isFinite(r)) {
        linkedAttendanceSum += r;
        linkedAttendanceCount += 1;
      }
      if (normalizeRhWclGuildRole(row?.guildRole) !== "Core") continue;
      if (!Number.isFinite(r)) continue;
      coreAttendanceSum += r;
      coreAttendanceCount += 1;
    }
    const linkedAttendanceAverage = linkedAttendanceCount > 0 ? linkedAttendanceSum / linkedAttendanceCount : null;
    const coreAttendanceAverage = coreAttendanceCount > 0 ? coreAttendanceSum / coreAttendanceCount : linkedAttendanceAverage;
    const coreAttendanceSource = coreAttendanceCount > 0 ? "core" : linkedAttendanceCount > 0 ? "linked" : "none";

    const gargulRows = Array.isArray(gargulLootState.entries) ? gargulLootState.entries : [];
    const totalItemsDistributed = gargulRows.filter(
      (row) => row && (row.itemID || row.itemLink) && row.received !== false
    ).length;

    const rateByRhKey = new Map();
    for (const row of linkedPayload.leaderboard) {
      const k = normalizeRaidHelperDisplayKey(String(row?.raidHelperName || row?.name || ""));
      if (k) rateByRhKey.set(k, Number(row.attendanceRate ?? 0));
    }
    const withWclAttendanceMatch = [...uniqueKeys].filter((k) => rateByRhKey.has(k)).length;

    return {
      guildId,
      uniqueRaiderCount: uniqueKeys.size,
      pastEventsScanned: pastEvents.length,
      maxPastEvents,
      consideredRaids: linkedPayload.consideredRaids,
      coreAttendanceAverage,
      coreAttendanceSource,
      coreRaiderCount: coreAttendanceCount,
      linkedRaiderCount: linkedAttendanceCount,
      totalItemsDistributed,
    };
    });
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.post("/api/raid-helper/events/:eventId/signup", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) return res.status(401).json({ ok: false, error: "Login required" });

  const eventId = String(req.params.eventId || "").trim();
  const serverId = raidHelperDiscordGuildId() || "711838953430319115";
  if (!eventId) return res.status(400).json({ ok: false, error: "Missing eventId" });

  try {
    const detail = await fetchRaidHelperEventDetail(eventId);
    if (!detail) return res.status(404).json({ ok: false, error: "Event not found" });
    const userId = String(session.user.id || "");
    const displayName = String(session.user.globalName || session.user.username || "").trim();
    const signUps = Array.isArray(detail?.signUps) ? detail.signUps : [];

    const existingPrimary = signUps.find(
      (entry) => String(entry?.userId || "") === userId && String(entry?.status || "").toLowerCase() === "primary"
    );
    if (existingPrimary) {
      return res.json({ ok: true, alreadySignedUp: true, signupId: Number(existingPrimary.id || 0) });
    }

    const fromEvent = raidHelperSignupProfileFromEntry(
      signUps.find((entry) => String(entry?.userId || "") === userId),
      displayName
    );
    const profile = fromEvent || (await resolveRaidHelperSignupProfileForUser(serverId, userId, displayName));
    if (!profile) {
      return res.status(400).json({
        ok: false,
        error:
          "No class/spec profile found for your user yet. Please sign up once in Raid-Helper manually, then retry.",
      });
    }

    const payload = {
      userId,
      name: profile.name || displayName || userId,
      className: profile.className,
      specName: profile.specName || "",
      roleName: profile.roleName,
      status: "primary",
    };
    const created = await raidHelperRequest(`/events/${eventId}/signups`, { method: "POST", body: payload });
    const nextSignUps = Array.isArray(created?.event?.signUps) ? created.event.signUps : [];
    const myRow = nextSignUps.find((entry) => String(entry?.userId || "") === userId);
    return res.json({
      ok: true,
      signupId: Number(myRow?.id || 0),
      status: String(myRow?.status || "primary"),
    });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return res.status(status).json({ ok: false, error: error?.message || "Signup failed" });
  }
});

app.delete("/api/raid-helper/events/:eventId/signup", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) return res.status(401).json({ ok: false, error: "Login required" });

  const eventId = String(req.params.eventId || "").trim();
  if (!eventId) return res.status(400).json({ ok: false, error: "Missing eventId" });

  try {
    const detail = await fetchRaidHelperEventDetail(eventId);
    if (!detail) return res.status(404).json({ ok: false, error: "Event not found" });
    const userId = String(session.user.id || "");
    const signUps = Array.isArray(detail?.signUps) ? detail.signUps : [];
    const myPrimary = signUps.find(
      (entry) => String(entry?.userId || "") === userId && String(entry?.status || "").toLowerCase() === "primary"
    );
    const myAny = myPrimary || signUps.find((entry) => String(entry?.userId || "") === userId);
    const signupId = Number(myAny?.id || 0);
    if (!signupId) return res.json({ ok: true, alreadySignedOff: true });

    await raidHelperRequest(`/events/${eventId}/signups/${signupId}`, { method: "DELETE" });
    return res.json({ ok: true });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return res.status(status).json({ ok: false, error: error?.message || "Signoff failed" });
  }
});

app.get("/api/wcl/guild/:guildId/boss-times", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const limit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(10, Number(req.query.limit || 50))
  );
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  try {
    const reports = await getFilteredGuildReportsForGuild(guildId, limit);

    const raidSummary = Object.entries(TRACKED_RAIDS).map(([raidName, bosses]) => {
      const bestByBoss = new Map();
      let bestClear = null;
      for (const report of reports) {
        const raidBossKills = (report.fights || []).filter(
          (fight) =>
            resolvedTrackedRaidForFight(fight, report) === raidName &&
            fight?.kill &&
            Number(fight?.encounterID || 0) > 0 &&
            bossListMatchesFightName(bosses, fight.name)
        );

        const uniqueBossKills = new Set(
          raidBossKills.map((fight) => resolveBossCanonicalName(bosses, fight.name))
        );
        if (uniqueBossKills.size === bosses.length && raidBossKills.length) {
          const clearStart = Math.min(...raidBossKills.map((fight) => Number(fight.startTime || 0)));
          const clearEnd = Math.max(...raidBossKills.map((fight) => Number(fight.endTime || 0)));
          const clearDurationMs = clearEnd - clearStart;

          if (Number.isFinite(clearDurationMs) && clearDurationMs > 0) {
            if (!bestClear || clearDurationMs < bestClear.durationMs) {
              bestClear = {
                durationMs: clearDurationMs,
                reportCode: report.code,
                reportTitle: report.title,
                reportStartTime: reportStartTimeMs(report.startTime),
              };
            }
          }
        }

        for (const fight of report.fights || []) {
          if (resolvedTrackedRaidForFight(fight, report) !== raidName) continue;
          if (!fight?.kill || Number(fight?.encounterID || 0) <= 0) continue;
          if (!bossListMatchesFightName(bosses, fight.name)) continue;

          const durationMs = Number(fight.endTime || 0) - Number(fight.startTime || 0);
          if (!Number.isFinite(durationMs) || durationMs <= 0) continue;

          const canonical = resolveBossCanonicalName(bosses, fight.name);
          const existing = bestByBoss.get(canonical);
          if (!existing || durationMs < existing.durationMs) {
            bestByBoss.set(canonical, {
              bossName: canonical,
              durationMs,
              fightId: fight.id,
              reportCode: report.code,
              reportTitle: report.title,
              reportStartTime: reportStartTimeMs(report.startTime),
            });
          }
        }
      }

      const bossRows = bosses.map((bossName) => ({
        bossName,
        bestKill: bestByBoss.get(bossName) || null,
      }));

      return {
        raidName,
        bestClear,
        bosses: bossRows,
      };
    });

    const rawRequired = process.env.WCL_REQUIRED_RAID_PLAYERS;
    const requiredRaidPlayersList =
      rawRequired !== undefined && String(rawRequired).trim() === ""
        ? []
        : String(rawRequired ?? "Gernig")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

    /** Only reports that achieved the fastest tracked full clear per raid (tiles above). */
    const reportByCode = new Map((reports || []).map((r) => [r.code, r]));
    const pbClearReportCodes = [];
    const pbClearCodesSet = new Set();
    for (const raid of raidSummary) {
      const code = raid.bestClear?.reportCode;
      if (code && !pbClearCodesSet.has(code)) {
        pbClearCodesSet.add(code);
        pbClearReportCodes.push(code);
      }
    }

    const rankedNameSet = new Set();
    for (const code of pbClearCodesSet) {
      const report = reportByCode.get(code);
      if (!report) continue;
      for (const c of report.rankedCharacters || []) {
        const n = String(c?.name || "").trim();
        if (n) rankedNameSet.add(n);
      }
    }

    const recentRankedRoster = [...rankedNameSet].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { sensitivity: "base" })
    );

    return res.json({
      guildId,
      limit,
      raidSummary,
      rosterInfo: {
        requiredRaidPlayers: requiredRaidPlayersList,
        recentRankedRoster,
        rankedRosterCount: rankedNameSet.size,
        pbClearReportCodes,
        reportsScanned: reports.length,
        calendarTimeZone: wclCalendarTimeZone(),
        raidNightPolicy: "Gruul's Lair & Magtheridon's Lair: Thursday · Karazhan: Sunday",
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/wcl/guild/:guildId/recent-raids-calendar", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const limit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(10, Number(req.query.limit || 60))
  );
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  try {
    const reports = await getFilteredGuildReportsForGuild(guildId, limit);
    const entries = buildRecentRaidCalendarEntries(reports);
    return res.json({
      guildId,
      limit,
      count: entries.length,
      calendarTimeZone: wclCalendarTimeZone(),
      raidNightPolicy: "Gruul's Lair & Magtheridon's Lair: Thursday · Karazhan: Sunday",
      requiredRaidPlayers: process.env.WCL_REQUIRED_RAID_PLAYERS ?? "Gernig",
      entries,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/wcl/guild/:guildId/latest-raid-mvp", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const limit = Math.min(50, Math.max(10, Number(req.query.limit || 20)));
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  try {
    const reports = await getFilteredGuildReportsForGuild(guildId, limit);

    const recentRaidReport = reports.find((report) =>
      (report.fights || []).some((fight) => {
        const key = resolvedTrackedRaidForFight(fight, report);
        return Boolean(key && TRACKED_RAIDS[key] && Number(fight?.encounterID || 0) > 0);
      })
    );

    if (!recentRaidReport) {
      return res.status(404).json({
        error:
          "No tracked raid report found on the right night (Gruul/Mag Thu, Kara Sun) with your required roster for this guild yet.",
      });
    }

    const bossFightIds = (recentRaidReport.fights || [])
      .filter((fight) => {
        const key = resolvedTrackedRaidForFight(fight, recentRaidReport);
        return Boolean(key && TRACKED_RAIDS[key] && Number(fight?.encounterID || 0) > 0);
      })
      .map((fight) => Number(fight.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!bossFightIds.length) {
      return res.status(404).json({ error: "Most recent tracked raid has no boss fights." });
    }

    const mvpQuery = `
      query LatestRaidMvp($code: String!, $fightIds: [Int!]) {
        reportData {
          report(code: $code) {
            damage: table(dataType: DamageDone, fightIDs: $fightIds)
            healing: table(dataType: Healing, fightIDs: $fightIds)
            tanking: table(dataType: DamageTaken, fightIDs: $fightIds)
          }
        }
      }
    `;

    const fightChunks = chunkPositiveInts(bossFightIds, wclMaxFightIdsPerQuery());
    const damageParts = [];
    const healingParts = [];
    const tankingParts = [];
    for (const chunk of fightChunks) {
      const mvpData = await queryWcl(mvpQuery, { code: recentRaidReport.code, fightIds: chunk });
      const report = mvpData?.reportData?.report;
      damageParts.push(report?.damage);
      healingParts.push(report?.healing);
      tankingParts.push(report?.tanking);
    }
    const damageTable = mergeWclTableValuesFromApi(damageParts);
    const healingTable = mergeWclTableValuesFromApi(healingParts);
    const tankingTable = mergeWclTableValuesFromApi(tankingParts);
    const dps = normalizeFightEntry(topFromTable(damageTable, "total"));
    const heal = normalizeFightEntry(topFromTable(healingTable, "total"));
    const tank = normalizeFightEntry(topFromTable(tankingTable, "total"));

    let bestParses = { dps: null, heal: null, tank: null };
    try {
      const parseQuery = `
        query LatestRaidParse($code: String!, $fightIds: [Int!]) {
          reportData {
            report(code: $code) {
              dpsRankings: rankings(fightIDs: $fightIds, playerMetric: dps)
              hpsRankings: rankings(fightIDs: $fightIds, playerMetric: hps)
            }
          }
        }
      `;
      const dpsRankParts = [];
      const hpsRankParts = [];
      for (const chunk of fightChunks) {
        const parseData = await queryWcl(parseQuery, { code: recentRaidReport.code, fightIds: chunk });
        const rankings = parseData?.reportData?.report || {};
        dpsRankParts.push(rankings.dpsRankings);
        hpsRankParts.push(rankings.hpsRankings);
      }
      const mergedDpsRankings = mergeWclRankingsPayloads(dpsRankParts);
      const mergedHpsRankings = mergeWclRankingsPayloads(hpsRankParts);
      bestParses = {
        dps: bestRoleParse(mergedDpsRankings, "dps", dps?.name),
        heal: bestRoleParse(mergedHpsRankings, "healers", heal?.name),
        tank: bestRoleParse(mergedDpsRankings, "tanks", tank?.name),
      };
    } catch {
      // Parse rankings are non-critical; keep MVP payload functional if ranking metric/schema varies.
    }

    return res.json({
      raid: {
        code: recentRaidReport.code,
        title: recentRaidReport.title,
        raidName: mvpUiRaidName(
          recentRaidReport,
          primaryTrackedRaidNameFromReport(recentRaidReport)
        ),
        startTime: reportStartTimeMs(recentRaidReport.startTime),
        endTime: reportStartTimeMs(recentRaidReport.endTime),
        fightCount: bossFightIds.length,
      },
      dps: { ...dps, bestParse: bestParses.dps },
      heal: { ...heal, bestParse: bestParses.heal },
      tank: { ...tank, bestParse: bestParses.tank },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/wcl/guild/:guildId/death-leaderboard", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const limit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(10, Number(req.query.limit || 50))
  );
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  try {
    const reports = await getFilteredGuildReportsForGuild(guildId, limit);
    const totals = new Map();
    let scannedReports = 0;
    const detailCap = wclPerReportDetailCap();
    let detailFetches = 0;

    for (const report of reports) {
      const fightIds = (report.fights || [])
        .filter((fight) => {
          const zoneName = fight?.gameZone?.name || "";
          return (
            Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zoneName) &&
            Number(fight?.encounterID || 0) > 0
          );
        })
        .map((fight) => Number(fight.id))
        .filter((id) => Number.isInteger(id) && id > 0);

      if (!fightIds.length) continue;
      if (detailFetches >= detailCap) break;
      detailFetches += 1;
      scannedReports += 1;

      const deathQuery = `
        query ReportDeaths($code: String!, $fightIds: [Int!]) {
          reportData {
            report(code: $code) {
              deaths: table(dataType: Deaths, fightIDs: $fightIds)
            }
          }
        }
      `;

      for (const chunk of chunkPositiveInts(fightIds, wclMaxFightIdsPerQuery())) {
        const deathsData = await queryWcl(deathQuery, { code: report.code, fightIds: chunk });
        const deathsTable = parseWclTable(deathsData?.reportData?.report?.deaths);
        const entries = deathsTable?.entries || [];
        for (const entry of entries) {
          const playerName = String(entry?.name || "").trim();
          if (!playerName) continue;
          const deaths = deathCountFromEntry(entry);
          if (deaths <= 0) continue;
          totals.set(playerName, (totals.get(playerName) || 0) + deaths);
        }
      }
    }

    const topParam = req.query.top;
    const top =
      topParam === undefined || topParam === ""
        ? 5
        : Math.min(500, Math.max(1, Math.floor(Number(topParam) || 5)));

    const leaderboard = [...totals.entries()]
      .map(([name, deaths]) => ({ name, deaths }))
      .sort((a, b) => b.deaths - a.deaths)
      .slice(0, top);

    return res.json({
      guildId,
      scannedReports,
      leaderboard,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

/** Guild character roster from the primary `rh-wcl-character-links.json` store (Raid Helper ↔ WCL names). Read-only; edits via admin. */
app.get("/api/wcl/guild/:guildId/characters", async (req, res) => {
  const guildId = Number(req.params.guildId);
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }
  try {
    const characters = await getGuildCharacterLinkRows();
    return res.json({
      ok: true,
      guildId,
      rosterSource: "rh-wcl-character-links",
      count: characters.length,
      characters,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/wcl/guild/:guildId/attendance", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const reportLimit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(10, Number(req.query.limit || 40))
  );
  /* Events roster matches many names; keep upper bound high enough that bench/alts aren’t all missing. */
  const top = Math.min(200, Math.max(5, Number(req.query.top || 25)));
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  try {
    await ensureRhWclLinksStore();
    const { raidSnapshots, wclDisplayByLower, raidRankingPayloads } = await gatherAttendanceRaidSnapshots(
      guildId,
      reportLimit,
      {
        attendancePercentMetrics: true,
      }
    );

    const linkedPayload = buildRhWclLinkedAttendanceLeaderboard(
      raidSnapshots,
      rhWclLinksState,
      top,
      wclDisplayByLower,
      raidRankingPayloads
    );

    const parseCeilingMax = computeParseCeilingMaxFromLeaderboard(linkedPayload.leaderboard);

    return res.json({
      guildId,
      consideredRaids: linkedPayload.consideredRaids,
      raids: raidSnapshots.map((raid) => ({ reportCode: raid.reportCode, startTime: raid.startTime })),
      leaderboard: linkedPayload.leaderboard,
      parseCeilingMax,
      parseRankingReports: raidRankingPayloads.length,
      attendanceLinking: true,
      rhWclLinkCount: rhWclLinksState.links?.length || 0,
      attendanceScope: {
        only25PlayerRaids: true,
        excludedRaids: [...WCL_ATTENDANCE_EXCLUDED_RAIDS],
        recentRaidCap: wclAttendanceRecentRaidCount(),
      },
      parseScope: {
        sameRaidsAsAttendance: true,
        metricNote:
          "Peak parse columns: best single-boss percentile per raid log, then max across recent capped raids (tooltip = encounter + report + fight). Parsing badge: tied for best percentile among linked raiders on that boss for your bracket (tank / healer / DPS) in any raid in the window.",
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

/**
 * Active roster: players with ≥1 attendance hit in the same capped recent 25-player raids as `/attendance`,
 * enriched with Raider.io / WCL spec art like Events cards. Includes `guildRole` from Account Assignment store.
 */
app.get("/api/wcl/guild/:guildId/active-roster", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const reportLimit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(10, Number(req.query.limit || 40))
  );
  const top = Math.min(300, Math.max(80, Number(req.query.top || 220)));
  const maxRhPastEvents = Math.min(150, Math.max(1, Math.floor(Number(req.query.maxRhPastEvents || 80))));
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  try {
    const payload = await buildActiveRosterPlayersForGuild(guildId, { reportLimit, top, maxRhPastEvents });
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

/**
 * Debug: fetch rankings for latest (or chosen) guild report and show whether WCL returns parse data for `name`.
 * Enable with WCL_DEBUG_RANKINGS=1. Example: `/api/wcl/guild/817080/debug-character-rankings?name=Mooman`
 */
app.get("/api/wcl/guild/:guildId/debug-character-rankings", async (req, res) => {
  if (!wclDebugRankingsRoutesEnabled()) {
    return res.status(404).json({
      error: "Route disabled. Set WCL_DEBUG_RANKINGS=1 in .env and restart the server.",
    });
  }

  const guildId = Number(req.params.guildId);
  const characterName = String(req.query.name || "").trim();
  const explicitCode = String(req.query.reportCode || "").trim();
  const limit = Math.min(wclMaxGuildReportsLimit(), Math.max(10, Number(req.query.limit || 30)));

  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }
  if (!characterName) {
    return res.status(400).json({ error: "Missing query param: name (exact Warcraft Logs character name as in rankings)" });
  }

  const parseQuery = `
    query DebugRaidRankings($code: String!, $fightIds: [Int!]) {
      reportData {
        report(code: $code) {
          dpsRankings: rankings(fightIDs: $fightIds, playerMetric: dps)
          hpsRankings: rankings(fightIDs: $fightIds, playerMetric: hps)
        }
      }
    }
  `;

  try {
    const reports = await getFilteredGuildReportsForGuild(guildId, limit);
    let report = null;
    if (explicitCode) {
      const low = explicitCode.toLowerCase();
      report = reports.find((r) => String(r.code || "").toLowerCase() === low) || null;
    } else {
      report =
        reports.find((r) =>
          (r.fights || []).some((fight) => {
            const zoneName = fight?.gameZone?.name || "";
            return (
              Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zoneName) &&
              Number(fight?.encounterID || 0) > 0
            );
          })
        ) || null;
    }

    if (!report?.code) {
      return res.json({
        ok: false,
        guildId,
        characterName,
        message: explicitCode
          ? `No report with code ${explicitCode} in filtered guild list (raise limit=).`
          : "No tracked-zone raid report with boss fights found.",
      });
    }

    const bossFightIds = (report.fights || [])
      .filter((fight) => {
        const zoneName = fight?.gameZone?.name || "";
        return (
          Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zoneName) &&
          Number(fight?.encounterID || 0) > 0
        );
      })
      .map((fight) => Number(fight.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!bossFightIds.length) {
      return res.json({
        ok: false,
        guildId,
        characterName,
        reportCode: report.code,
        message: "Report has no boss fights in tracked zones.",
      });
    }

    const dpsParts = [];
    const hpsParts = [];
    for (const chunk of chunkPositiveInts(bossFightIds, wclMaxFightIdsPerQuery())) {
      const parseData = await queryWcl(parseQuery, { code: report.code, fightIds: chunk });
      const frag = parseData?.reportData?.report || {};
      dpsParts.push(frag.dpsRankings);
      hpsParts.push(frag.hpsRankings);
    }

    const mergedDps = mergeWclRankingsPayloads(dpsParts);
    const mergedHps = mergeWclRankingsPayloads(hpsParts);

    const dpsProbe = debugRankingsProbe(mergedDps, characterName);
    const hpsProbe = debugRankingsProbe(mergedHps, characterName);

    const rankedHint = Array.isArray(report.rankedCharacters)
      ? report.rankedCharacters
          .map((c) => String(c?.name || "").trim())
          .filter(Boolean)
          .slice(0, 40)
      : [];

    return res.json({
      ok: true,
      guildId,
      characterName,
      reportCode: report.code,
      reportTitle: report.title || "",
      rankedCharactersSample: rankedHint,
      bossFightCount: bossFightIds.length,
      interpretation: {
        anyStrictHits: dpsProbe.hitsStrictNameMatch.length > 0 || hpsProbe.hitsStrictNameMatch.length > 0,
        anyNormalizedHits:
          dpsProbe.hitsNormalizedKeyMatch.length > 0 || hpsProbe.hitsNormalizedKeyMatch.length > 0,
        useDPSMetricForTankAndDps: true,
        useHPSMetricForHealers: true,
      },
      dpsMetric: dpsProbe,
      hpsMetric: hpsProbe,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/wcl/guild/:guildId/mvp-trend", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const trendSize = Math.min(8, Math.max(1, Number(req.query.trendSize || 4)));
  const reportLimit = Math.min(50, Math.max(10, Number(req.query.limit || 20)));
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  const reportsQuery = `
    query GuildReports($guildId: Int!, $limit: Int!) {
      reportData {
        reports(guildID: $guildId, limit: $limit) {
          data {
            code
            title
            startTime
            rankedCharacters {
              name
            }
            endTime
            fights {
              id
              encounterID
              name
              kill
              gameZone { name }
            }
          }
        }
      }
    }
  `;

  try {
    const reportData = await queryWcl(reportsQuery, { guildId, limit: reportLimit });
    const reports = filterGuildRaidReports(reportData?.reportData?.reports?.data || []);
    const trackedReports = reports
      .filter((report) =>
        (report.fights || []).some((fight) => {
          const zoneName = fight?.gameZone?.name || "";
          return (
            Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zoneName) &&
            Number(fight?.encounterID || 0) > 0
          );
        })
      )
      .slice(0, trendSize);

    const trend = [];
    for (const report of trackedReports) {
      const fightIds = (report.fights || [])
        .filter((fight) => {
          const zoneName = fight?.gameZone?.name || "";
          return (
            Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zoneName) &&
            Number(fight?.encounterID || 0) > 0
          );
        })
        .map((fight) => Number(fight.id))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (!fightIds.length) continue;

      const mvpQuery = `
        query RaidMvp($code: String!, $fightIds: [Int!]) {
          reportData {
            report(code: $code) {
              damage: table(dataType: DamageDone, fightIDs: $fightIds)
              healing: table(dataType: Healing, fightIDs: $fightIds)
              tanking: table(dataType: DamageTaken, fightIDs: $fightIds)
            }
          }
        }
      `;
      const fightChunks = chunkPositiveInts(fightIds, wclMaxFightIdsPerQuery());
      const damageParts = [];
      const healingParts = [];
      const tankingParts = [];
      for (const chunk of fightChunks) {
        const mvpData = await queryWcl(mvpQuery, { code: report.code, fightIds: chunk });
        const r = mvpData?.reportData?.report;
        damageParts.push(r?.damage);
        healingParts.push(r?.healing);
        tankingParts.push(r?.tanking);
      }
      const dps = normalizeFightEntry(topFromTable(mergeWclTableValuesFromApi(damageParts), "total"));
      const heal = normalizeFightEntry(topFromTable(mergeWclTableValuesFromApi(healingParts), "total"));
      const tank = normalizeFightEntry(topFromTable(mergeWclTableValuesFromApi(tankingParts), "total"));

      trend.push({
        reportCode: report.code,
        reportTitle: report.title,
        startTime: report.startTime,
        dps: dps ? { name: dps.name, total: dps.total, type: dps.type } : null,
        heal: heal ? { name: heal.name, total: heal.total, type: heal.type } : null,
        tank: tank ? { name: tank.name, total: tank.total, type: tank.type } : null,
      });
    }

    return res.json({ guildId, trend });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/wcl/guild/:guildId/wipe-heatmap", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const reportLimit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(10, Number(req.query.limit || 50))
  );
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  const reportsQuery = `
    query GuildReports($guildId: Int!, $limit: Int!) {
      reportData {
        reports(guildID: $guildId, limit: $limit) {
          data {
            code
            startTime
            rankedCharacters {
              name
            }
            fights {
              encounterID
              name
              kill
              startTime
              endTime
              gameZone { name }
            }
          }
        }
      }
    }
  `;

  try {
    const reportData = await queryWcl(reportsQuery, { guildId, limit: reportLimit });
    const reports = filterGuildRaidReports(reportData?.reportData?.reports?.data || []);
    const byBoss = new Map();

    for (const report of reports) {
      for (const fight of report.fights || []) {
        const zoneName = fight?.gameZone?.name || "";
        if (!Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zoneName)) continue;
        if (Number(fight?.encounterID || 0) <= 0) continue;

        const key = `${zoneName}::${fight.name}`;
        const durationMs = Number(fight.endTime || 0) - Number(fight.startTime || 0);
        const row = byBoss.get(key) || {
          raidName: zoneName,
          bossName: fight.name,
          attempts: 0,
          kills: 0,
          wipes: 0,
          totalWipeMs: 0,
          wipeCountForAvg: 0,
        };

        row.attempts += 1;
        if (fight.kill) {
          row.kills += 1;
        } else {
          row.wipes += 1;
          if (Number.isFinite(durationMs) && durationMs > 0) {
            row.totalWipeMs += durationMs;
            row.wipeCountForAvg += 1;
          }
        }
        byBoss.set(key, row);
      }
    }

    const heatmap = [...byBoss.values()]
      .map((row) => ({
        raidName: row.raidName,
        bossName: row.bossName,
        attempts: row.attempts,
        kills: row.kills,
        wipes: row.wipes,
        wipeRate: row.attempts > 0 ? (row.wipes / row.attempts) * 100 : 0,
        avgWipeMs: row.wipeCountForAvg > 0 ? row.totalWipeMs / row.wipeCountForAvg : null,
      }))
      .sort((a, b) => b.wipes - a.wipes || b.wipeRate - a.wipeRate || a.bossName.localeCompare(b.bossName));

    return res.json({ guildId, heatmap });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/wcl/guild/:guildId/death-encounter-heatmap", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const reportLimit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(10, Number(req.query.limit || 50))
  );
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  try {
    const reports = await getFilteredGuildReportsForGuild(guildId, reportLimit);
    const byBoss = new Map();
    const detailCap = wclPerReportDetailCap();
    let detailFetches = 0;

    for (const report of reports) {
      const trackedFights = (report.fights || []).filter((fight) => {
        const zoneName = fight?.gameZone?.name || "";
        return Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zoneName) && Number(fight?.encounterID || 0) > 0;
      });
      if (!trackedFights.length) continue;

      const fightIds = trackedFights
        .map((fight) => Number(fight?.id))
        .filter((id) => Number.isInteger(id) && id > 0);
      const fightDeaths = new Map();
      if (fightIds.length && detailFetches < detailCap) {
        detailFetches += 1;
        const deathsQuery = `
          query ReportDeaths($code: String!, $fightIds: [Int!]) {
            reportData {
              report(code: $code) {
                deaths: table(dataType: Deaths, fightIDs: $fightIds)
              }
            }
          }
        `;
        for (const chunk of chunkPositiveInts(fightIds, wclMaxFightIdsPerQuery())) {
          const deathsData = await queryWcl(deathsQuery, { code: report.code, fightIds: chunk });
          const deathsTable = parseWclTable(deathsData?.reportData?.report?.deaths);
          const entries = deathsTable?.entries || [];
          for (const entry of entries) {
            const fallbackDeaths = deathCountFromEntry(entry);
            const perFight = Array.isArray(entry?.fights) ? entry.fights : [];
            if (perFight.length) {
              for (const fightRow of perFight) {
                const fightId = Number(fightRow?.id || fightRow?.fightID || fightRow?.fightId || 0);
                if (!Number.isInteger(fightId) || fightId <= 0) continue;
                const deaths = Number(fightRow?.deaths || fightRow?.total || fallbackDeaths || 0);
                if (!Number.isFinite(deaths) || deaths <= 0) continue;
                fightDeaths.set(fightId, (fightDeaths.get(fightId) || 0) + deaths);
              }
              continue;
            }

            const singleFightId = Number(entry?.fightID || entry?.fightId || entry?.fight || 0);
            if (Number.isInteger(singleFightId) && singleFightId > 0 && fallbackDeaths > 0) {
              fightDeaths.set(singleFightId, (fightDeaths.get(singleFightId) || 0) + fallbackDeaths);
            }
          }
        }
      }

      for (const fight of trackedFights) {
        const zoneName = fight?.gameZone?.name || "";
        const fightId = Number(fight?.id || 0);

        const key = `${zoneName}::${fight.name}`;
        const row = byBoss.get(key) || {
          raidName: zoneName,
          bossName: fight.name,
          attempts: 0,
          kills: 0,
          wipes: 0,
          totalDeaths: 0,
        };

        const deathsForFight = fightDeaths.get(fightId) || 0;
        row.attempts += 1;
        row.totalDeaths += deathsForFight;
        if (fight.kill) row.kills += 1;
        else row.wipes += 1;

        byBoss.set(key, row);
      }
    }

    const heatmap = [...byBoss.values()]
      .map((row) => ({
        raidName: row.raidName,
        bossName: row.bossName,
        attempts: row.attempts,
        kills: row.kills,
        wipes: row.wipes,
        totalDeaths: row.totalDeaths,
        deathsPerAttempt: row.attempts > 0 ? row.totalDeaths / row.attempts : 0,
        wipeRate: row.attempts > 0 ? (row.wipes / row.attempts) * 100 : 0,
      }))
      .sort(
        (a, b) =>
          b.deathsPerAttempt - a.deathsPerAttempt ||
          b.totalDeaths - a.totalDeaths ||
          b.wipeRate - a.wipeRate ||
          a.bossName.localeCompare(b.bossName)
      );

    return res.json({ guildId, heatmap });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

async function fetchGuildLootReceived(guildId, reportLimit) {
  await ensureGargulLootHistoryStore();
  const reportsQuery = `
    query GuildReports($guildId: Int!, $limit: Int!) {
      reportData {
        reports(guildID: $guildId, limit: $limit) {
          data {
            code
            title
            startTime
            rankedCharacters {
              name
            }
            fights {
              id
              encounterID
              gameZone { name }
            }
          }
        }
      }
    }
  `;

  const reportData = await queryWcl(reportsQuery, { guildId, limit: reportLimit });
  const reports = filterGuildRaidReports(reportData?.reportData?.reports?.data || []);
  const trackedReports = reports
    .map((report) => {
      const raidName = primaryTrackedRaidNameFromReport(report);
      const fightIds = (report.fights || [])
        .filter((fight) => {
          const zoneName = fight?.gameZone?.name || "";
          return Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zoneName) && Number(fight?.encounterID || 0) > 0;
        })
        .map((fight) => Number(fight.id))
        .filter((id) => Number.isInteger(id) && id > 0);
      const queryFightIds = [0, ...fightIds];
      return { report, fightIds, queryFightIds, raidName };
    })
    .filter((entry) => entry.fightIds.length > 0);

  const receivedItems = [];
  const lootEventsCap = wclLootEventsLimit();
  for (const { report, queryFightIds, raidName } of trackedReports.slice(0, wclPerReportDetailCap())) {
    const lootQuery = `
      query LootEvents($code: String!, $fightIds: [Int!], $lootLimit: Int!, $startTime: Float) {
        reportData {
          report(code: $code) {
            events(
              dataType: All
              fightIDs: $fightIds
              limit: $lootLimit
              startTime: $startTime
              filterExpression: "type='loot'"
            ) {
              data
              nextPageTimestamp
            }
          }
        }
      }
    `;
    const events = [];
    let nextStart = null;
    const seenPageStarts = new Set();
    for (let page = 0; page < 8; page += 1) {
      const lootData = await queryWcl(lootQuery, {
        code: report.code,
        fightIds: queryFightIds,
        lootLimit: lootEventsCap,
        startTime: nextStart,
      });
      const pageData = lootData?.reportData?.report?.events?.data || [];
      events.push(...pageData);
      const nextPage = lootData?.reportData?.report?.events?.nextPageTimestamp;
      if (!Number.isFinite(Number(nextPage))) break;
      const nextTs = Number(nextPage);
      if (seenPageStarts.has(nextTs)) break;
      seenPageStarts.add(nextTs);
      nextStart = nextTs;
    }

    for (const event of events) {
      const itemId = Number(event?.itemID || event?.itemId || 0);
      const recipient = String(event?.target?.name || event?.targetName || event?.name || "").trim();
      if (!itemId && !event?.itemName) continue;
      receivedItems.push({
        reportCode: report.code,
        reportTitle: report.title,
        reportRaidName: raidName || null,
        reportStartTime: report.startTime,
        itemId: itemId > 0 ? itemId : null,
        itemName: event?.itemName || null,
        recipient: recipient || null,
        rawType: event?.type || null,
      });
    }
  }

  /** Calendar day → all WCL reports that day (fixes Kara + 25s same day mis-attribution). */
  const reportRowsByDay = new Map();
  const reportByCode = new Map();
  for (const { report, raidName } of trackedReports) {
    const dayKey = raidCalendarDayKey(Number(report?.startTime || 0));
    const row = {
      reportCode: report.code,
      reportTitle: report.title,
      reportRaidName: raidName || null,
      reportStartTime: Number(report.startTime || 0),
      reportUploader: report?.owner?.name ? String(report.owner.name) : null,
    };
    reportByCode.set(String(report.code), row);
    if (!dayKey) continue;
    const arr = reportRowsByDay.get(dayKey) || [];
    arr.push(row);
    reportRowsByDay.set(dayKey, arr);
  }
  const gargulItems = gargulLootState.entries
    .filter((entry) => entry && typeof entry === "object" && entry.received !== false)
    .map((entry) => gargulEntryToLootItem(entry, reportRowsByDay, reportByCode))
    .filter(Boolean);
  const mergedItems = mergeLootItems(receivedItems, gargulItems).filter((row) => !isTenPlayerTbcLootRow(row));

  const syntheticRaids = new Map();
  for (const row of gargulItems) {
    if (!row?.reportCode) continue;
    if (syntheticRaids.has(row.reportCode)) continue;
    syntheticRaids.set(row.reportCode, {
      reportCode: row.reportCode,
      reportTitle: row.reportTitle,
      reportStartTime: Number(row.reportStartTime || 0),
    });
  }

  const allRaids = [
    ...trackedReports.map(({ report, raidName }) => ({
      reportCode: report.code,
      reportTitle: report.title,
      reportRaidName: raidName || null,
      reportStartTime: Number(report.startTime || 0),
      reportUploader: report?.owner?.name ? String(report.owner.name) : null,
    })),
    ...[...syntheticRaids.values()].filter(
      (row) => !trackedReports.some(({ report }) => String(report.code) === String(row.reportCode))
    ),
  ].filter((raid) => !isTenPlayerTbcLootRow(raid));
  const selectedSet = new Set((gargulLootState.selectedReportCodes || []).map((x) => String(x)));
  const visibleRaids = selectedSet.size
    ? allRaids.filter((raid) => selectedSet.has(String(raid.reportCode)))
    : allRaids;
  const visibleItems = selectedSet.size
    ? mergedItems.filter((item) => selectedSet.has(String(item?.reportCode || "")))
    : mergedItems;

  return {
    guildId,
    reportsChecked: trackedReports.length,
    selectedReportCodes: [...selectedSet],
    raids: visibleRaids,
    allRaids,
    items: visibleItems,
    note:
      visibleItems.length === 0
        ? "No loot receipt events were returned by Warcraft Logs, and no Gargul import data is stored yet."
        : null,
  };
}

app.get("/api/wcl/guild/:guildId/loot-received", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const reportLimit = Math.min(40, Math.max(5, Number(req.query.limit || 15)));
  const forceRefresh = String(req.query.refresh || "") === "1";
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }
  try {
    const key = lootHistoryCacheKey(guildId, reportLimit);
    const loader = () => fetchGuildLootReceived(guildId, reportLimit);
    const payload = forceRefresh
      ? await forceRefreshCachedPayload(key, loader)
      : await getOrRefreshCachedPayload(key, {
          ttlMs: lootHistoryCacheTtlMs(),
          maxStaleMs: lootHistoryMaxStaleMs(),
          loader,
        });
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/loot-history", async (req, res) => {
  const reportLimit = Math.min(40, Math.max(5, Number(req.query.limit || 15)));
  const forceRefresh = String(req.query.refresh || "") === "1";
  try {
    const key = lootHistoryCacheKey(votingGuildId, reportLimit);
    const loader = () => fetchGuildLootReceived(votingGuildId, reportLimit);
    const payload = forceRefresh
      ? await forceRefreshCachedPayload(key, loader)
      : await getOrRefreshCachedPayload(key, {
          ttlMs: lootHistoryCacheTtlMs(),
          maxStaleMs: lootHistoryMaxStaleMs(),
          loader,
        });
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.get("/api/wow-classic/items", async (req, res) => {
  try {
    const idsRaw = String(req.query.ids || "")
      .split(",")
      .map((x) => Number(String(x || "").trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    const uniqueIds = [...new Set(idsRaw)].slice(0, 80);
    if (!uniqueIds.length) return res.json({ ok: true, items: [] });
    const items = [];
    for (const itemId of uniqueIds) {
      const key = `item-meta-v2-${wowClassicRegion()}-${wowClassicNamespace()}-${wowClassicLocale()}-${itemId}`;
      const payload = await getOrRefreshCachedPayload(key, {
        ttlMs: itemMetadataCacheTtlMs(),
        maxStaleMs: 30 * 24 * 3600_000,
        loader: () => fetchClassicItemMetadata(itemId),
      });
      items.push(payload);
    }
    return res.json({ ok: true, items });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load item metadata" });
  }
});

app.post("/api/wcl/mvp", async (req, res) => {
  const reportCode = extractReportCode(req.body?.reportCode);
  const fightId = Number(req.body?.fightId);

  if (!reportCode || !Number.isInteger(fightId) || fightId <= 0) {
    return res.status(400).json({ error: "reportCode and positive integer fightId are required" });
  }

  const query = `
    query ReportRoleMvp($code: String!, $fightId: Int!) {
      reportData {
        report(code: $code) {
          fights(fightIDs: [$fightId]) {
            id
            gameZone {
              name
            }
          }
          damage: table(dataType: DamageDone, fightIDs: [$fightId])
          healing: table(dataType: Healing, fightIDs: [$fightId])
          tanking: table(dataType: DamageTaken, fightIDs: [$fightId])
        }
      }
    }
  `;

  try {
    const data = await queryWcl(query, { code: reportCode, fightId });
    const report = data?.reportData?.report;
    const fight = report?.fights?.find((entry) => Number(entry?.id) === fightId);
    const zoneName = fight?.gameZone?.name;
    if (!zoneName || !allowedTbcZones.has(zoneName)) {
      return res.status(400).json({
        error: `Fight is not in allowed TBC Classic zones (got: ${zoneName || "unknown zone"})`,
      });
    }

    const damageTable = parseWclTable(report?.damage);
    const healingTable = parseWclTable(report?.healing);
    const tankingTable = parseWclTable(report?.tanking);

    return res.json({
      dps: topFromTable(damageTable, "total"),
      heal: topFromTable(healingTable, "total"),
      tank: topFromTable(tankingTable, "total"),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

app.listen(port, () => {
  console.log(`Fallen Tacticians API running on http://localhost:${port}`);
  console.log(`Persistent data directory: ${dataDir}`);
  if (discordClientId && discordClientSecret) {
    console.log(
      `[auth] Discord OAuth redirect (must match Developer Portal → Redirects): ${discordRedirectUri}`
    );
    if (discordSkipGuildCheck) {
      console.warn("[auth] DISCORD_SKIP_GUILD_CHECK is on — guild membership checks are bypassed.");
    }
  } else {
    console.warn("[auth] Discord OAuth disabled — set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to enable login.");
  }
  ensureVotingStore().catch((error) => {
    console.error("Failed to initialize voting store:", error?.message || error);
  });
  ensureP2MaterialsStore().catch((error) => {
    console.error("Failed to initialize P2 materials store:", error?.message || error);
  });
  ensureJoinNeedsStore().catch((error) => {
    console.error("Failed to initialize Join needs store:", error?.message || error);
  });
  ensureDiscordDmSubscribersStore().catch((error) => {
    console.error("Failed to initialize Discord DM subscribers store:", error?.message || error);
  });
  startRaidHelperDmNotifier();
  ensureGargulLootHistoryStore().catch((error) => {
    console.error("Failed to initialize Gargul loot history store:", error?.message || error);
  });
  ensureNetherVortexStore().catch((error) => {
    console.error("Failed to initialize Nether Vortex store:", error?.message || error);
  });
});
