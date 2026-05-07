import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { mergeRhWclGuess, normalizeRhWclGuildRole, sortRhWclLinkRows } from "./lib/rh-wcl-guess.mjs";
import { syncBadgePngsToSvgs, watchBadgePngsToSvgs } from "./lib/badge-png-svg-sync.mjs";
import {
  registerSyncTask,
  startSyncRunner,
  runSyncTaskNow,
  isSyncTaskRunning,
  listSyncTasks,
  syncRunnerSnapshot,
} from "./lib/sync/runner.mjs";
import { firstClearParticipantsByRaidFromReports as computeFirstClearParticipantsByRaid } from "./lib/compute/first-clears.mjs";
import {
  openItemNeedsDb,
  nvUpsertCurrent,
  nvGetAllCurrent,
  nvGetHistory,
  profileGetByUserId,
  profileGetByUserIds,
  profileGetAllWithPicture,
  profileSetPicture,
  profileSetMainCharacter,
  profileGetHistory,
  p2UpsertMaterial,
  p2GetAllCurrent,
  p2GetHistory,
  getItemNeedsDbPath,
  rhNameKey as identityRhNameKey,
  userUpsert as identityUserUpsert,
  characterUpsert as identityCharacterUpsert,
  charactersGetByUserId as identityCharactersGetByUserId,
  userListAll as identityUserListAll,
  userGetByDiscordId as identityUserGetByDiscordId,
  userGetById as identityUserGetById,
  userGetByRaidHelperKey as identityUserGetByRaidHelperKey,
  identityListLinkedCharacterNames,
  identityResolveProfilesByCharacterNames,
  identityResolveDiscordIdsByRhKey,
  identityResolveCharacterByDiscordId,
  identityResolveRaidHelperNameByDiscordId,
  mvpVotesReplaceFromState,
  mvpVotesGetAll,
  dmSubscribersReplaceFromState,
  dmSubscribersGetAll,
  dmNotifiedEventIdsGetAll,
  roleAlertLogReplaceFromState,
  roleAlertLogGetAll,
  hofNotesReplaceFromState,
  hofNotesGetAll,
  backupItemNeedsDb,
  badgeStateReplaceForUser,
  badgeStateGetByUserId,
  resolveOwnerForCharacterName as identityResolveOwnerForCharacterName,
  firstClearParticipantsReplace,
  firstClearParticipantsGet,
  deathTotalsReplaceForWindow,
  deathTotalsGetByWindow,
  bestTimeRosterReplace,
  bestTimeRosterGet,
  raidAttendanceReplaceForWindow,
  raidAttendanceGetByWindow,
  raidAttendanceGetFreshestWindow,
  raidAppearancesReplaceForReports,
  raidAppearancesCountsByUser,
  raidAppearancesDistinctReportCount,
  raidAppearancesRecent,
  parseSummaryReplaceAll,
  parseSummaryGetByUserId,
  parseSummaryGetByMainCharacterIds,
  lootAwardsReplaceAll,
  lootAwardsGetAll,
  lootAwardsListRaids,
  lootAwardsGetByUserId,
  lootAwardsGetByCharacterIds,
  cutoverReadinessCounts,
} from "./lib/item-needs-db.mjs";

/**
 * Phase 4 cutover flag. When set, `/api/profile/me/badges` reads from the
 * `badge_state` table instead of recomputing from live WCL/voting stores
 * on every request. Default ON — flip to `0` to fall back to the legacy
 * resolver if drift is found post-cutover.
 */
function materializeBadgesEnabled() {
  const v = String(process.env.MATERIALIZE_BADGES ?? "1").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

/**
 * Phase 5 cutover flag. Default ON — once `syncAttendance` has written
 * the four materialised tables at least once, the leaderboard / death-
 * leaderboard / first-clear / boss-times endpoints serve from them
 * instead of re-running the WCL scan on every hit.
 */
function materializeAttendanceEnabled() {
  const v = String(process.env.MATERIALIZE_ATTENDANCE ?? "1").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

/**
 * Phase 9 cutover flag. Default ON — once `syncAttendance` has written
 * the new `raid_appearances` table at least once, the leaderboard
 * "Events" KPI and the 5/10/25/50/100 raid milestone badges read the
 * count of distinct **admin-curated** WCL guild raid reports a user
 * appeared in (Event Management → `gargulLootState.selectedReportCodes`)
 * straight from SQLite. Set `MATERIALIZE_RAID_APPEARANCES=0` to fall
 * back to the legacy Raid Helper signup count if WCL drift is found
 * post-cutover.
 */
function materializeRaidAppearancesEnabled() {
  const v = String(process.env.MATERIALIZE_RAID_APPEARANCES ?? "1").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

/**
 * Phase 7 cutover flag. Default ON — once `syncLoot` has written the
 * `loot_awards` table at least once, `/api/loot-history` and the per-
 * player loot lookups serve from SQLite instead of refetching the WCL
 * loot-events graph on every hit. Set `MATERIALIZE_LOOT=0` to fall
 * back to the live `fetchGuildLootReceived` pipeline.
 */
function materializeLootEnabled() {
  const v = String(process.env.MATERIALIZE_LOOT ?? "1").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

/**
 * Phase 3 cutover flag. Default ON — once Phase 3 dual-write has been
 * deployed, the four small stores (mvp_votes, dm_subscribers,
 * role_alert_log, hof_notes) are hydrated from SQLite at boot. Set
 * `MATERIALIZE_PHASE3=0` to fall back to JSON-only hydration.
 */
function materializePhase3Enabled() {
  const v = String(process.env.MATERIALIZE_PHASE3 ?? "1").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

/**
 * Phase 2 cutover flag. Default ON — once Phase 1 dual-write has been
 * deployed, the canonical `users` / `user_characters` tables hold the
 * same data as the legacy JSON files. Set `MATERIALIZE_IDENTITY=0` to
 * fall back to JSON-based reads for one deploy if SQL drift surfaces
 * post-cutover.
 */
function materializeIdentityEnabled() {
  const v = String(process.env.MATERIALIZE_IDENTITY ?? "1").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

dotenv.config({ override: true });

const app = express();
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 8787);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const achievementBadgeDir = path.join(publicDir, "images", "achievements");

// Badge workflow helper: any PNG dropped into `public/images/achievements` gets a same-name SVG generated.
// This keeps badge assets "auto-converted to svg" for frontend usage without requiring manual export steps.
syncBadgePngsToSvgs(achievementBadgeDir).catch(() => {});
watchBadgePngsToSvgs(achievementBadgeDir);

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

/** Browsers may still send `If-None-Match` after a prior ETag; Express then returns 304 with an empty body and the
 * client reuses whatever document it had — which breaks HTML when inline `<style>` changes but the URL does not.
 * Strip conditional headers for `.html` so static always sends a full 200 + body (Cache-Control is still no-store). */
app.use((req, res, next) => {
  if (req.method === "GET" && /\.html$/i.test(String(req.path || ""))) {
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];
  }
  next();
});

app.use(
  express.static(publicDir, {
    etag: true,
    lastModified: true,
    index: false,
    maxAge: isProd ? "1d" : 0,
    immutable: false,
    setHeaders: (res, filePath) => {
      // HTML pages must never get heuristic freshness in any browser/proxy — otherwise inline
      // <style> + cache-busted script URLs go stale together when iterating on Phase 2 / NV.
      if (/\.html$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  })
);

app.use("/api", async (req, res, next) => {
  if (!shouldUsePublicSnapshot(req)) return next();
  try {
    await ensurePublicDataSnapshotStore();
    const key = publicSnapshotKeyFromRequest(req);
    const hit = publicDataSnapshotState.byKey?.[key];
    if (hit && Object.prototype.hasOwnProperty.call(hit, "payload")) {
      res.setHeader("x-plb-public-snapshot", "hit");
      return res.json(hit.payload);
    }
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        upsertPublicSnapshotForKey(key, body).catch((error) =>
          console.error("[public-snapshot] write-through failed:", error?.message || error)
        );
      }
      return originalJson(body);
    };
    return next();
  } catch (error) {
    console.error("[public-snapshot] middleware failed:", error?.message || error);
    return next();
  }
});

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

/** Only allow relative redirect targets after Discord OAuth (open-redirect hardening). */
function safeDiscordOAuthNext(raw) {
  const s = String(raw || "").trim() || "/voting.html";
  if (!s.startsWith("/") || s.startsWith("//")) return "/voting.html";
  if (s.includes("\\") || /[\0\r\n]/.test(s)) return "/voting.html";
  return s;
}

/**
 * Stateless OAuth `state` (HMAC-signed) so login survives server restarts and single-process dev.
 * Previously used an in-memory Map, which produced HTTP 400 after `node --watch` / redeploy.
 */
function encodeDiscordOAuthState(nextPath, ttlMs) {
  const exp = Date.now() + ttlMs;
  const next = safeDiscordOAuthNext(nextPath);
  const payload = JSON.stringify({ exp, next });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = createHmac("sha256", authSessionSecret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function decodeDiscordOAuthState(stateParam) {
  const raw = String(stateParam || "").trim();
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = createHmac("sha256", authSessionSecret).update(payloadB64).digest("base64url");
  try {
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const exp = Number(parsed?.exp);
  const next = safeDiscordOAuthNext(parsed?.next);
  if (!Number.isFinite(exp)) return null;
  return { expiresAt: exp, next };
}

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

/**
 * Open the SQLite-backed Item Need Submissions database. The DB is the source
 * of truth for Nether Vortex needs and P2 raid material counts; the legacy
 * JSON files (`nether-vortex-needs.json`, `p2-materials.json`) are migrated on
 * first run and then kept as a write-through human-readable backup.
 */
try {
  openItemNeedsDb(dataDir);
  console.log(`[item-needs-db] ready at ${getItemNeedsDbPath()}`);
} catch (error) {
  console.warn("[item-needs-db] failed to open database:", error?.message || error);
}

const votingStorePath = path.join(dataDir, "mvp-votes.json");
let votingStoreReady = null;
let votingWriteChain = Promise.resolve();
let votingStoreState = { votes: [] };
const p2MaterialsPath = path.join(dataDir, "p2-materials.json");
const joinNeedsPath = path.join(dataDir, "join-current-needs.json");
const discordDmSubscribersPath = path.join(dataDir, "discord-dm-subscribers.json");
const roleAlertDmLogPath = path.join(dataDir, "role-alert-dm-log.json");
const hofNotesPath = path.join(dataDir, "hof-notes.json");
/** Persisted enriched Hall of Fame payload (roster match + peak parses + raid names). Refreshed when winners list changes or TTL expires. */
const hofEnrichedCachePath = path.join(dataDir, "hof-enriched-cache.json");
let hofEnrichedWriteChain = Promise.resolve();
/** @type {{ guildId: number, limit: number, fingerprint: string, generatedAt: number, hallOfFame: any[] } | null} */
let hofEnrichedMemoryCache = null;
const gargulLootHistoryPath = path.join(dataDir, "gargul-loot-history.json");
const netherVortexNeedsPath = path.join(dataDir, "nether-vortex-needs.json");
const publicDataSnapshotPath = path.join(dataDir, "public-data-snapshots.json");
const analyticsStorePath = path.join(dataDir, "site-analytics.json");
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
let roleAlertDmLogReady = null;
let roleAlertDmLogWriteChain = Promise.resolve();
let hofNotesReady = null;
let hofNotesWriteChain = Promise.resolve();
let gargulLootReady = null;
let gargulLootWriteChain = Promise.resolve();
let netherVortexReady = null;
let netherVortexWriteChain = Promise.resolve();
let publicDataSnapshotReady = null;
let publicDataSnapshotWriteChain = Promise.resolve();
let analyticsStoreReady = null;
let analyticsWriteChain = Promise.resolve();
let gargulLootState = { entries: [], selectedReportCodes: [] };
let netherVortexState = { entries: [] };
let publicDataSnapshotState = { updatedAt: 0, byKey: {} };
let analyticsStoreState = { events: [] };
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
const JOIN_NEED_COLOR_BY_CLASS_SLUG = {
  warrior: "#c79c6e",
  paladin: "#f58cba",
  hunter: "#abd473",
  rogue: "#fff569",
  priest: "#ffffff",
  shaman: "#0070dd",
  mage: "#69ccf0",
  warlock: "#9482c9",
  druid: "#ff7d0a",
  deathknight: "#c41f3b",
};
let p2MaterialsState = {
  currentById: Object.fromEntries(P2_MATERIALS.map((m) => [m.id, Number(m.defaultCurrent || 0)])),
};
let joinNeedsState = { rows: DEFAULT_JOIN_NEEDS.map((row) => ({ ...row })) };
let discordDmSubscribersState = { subscribersByUserId: {}, notifiedEventIds: [] };
let roleAlertDmLogState = { byEventId: {} };
let hofNotesState = { byWinnerRaidKey: {} };
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
  if (Number.isFinite(n) && n >= 0) return Math.min(60 * 60_000, n);
  return 5 * 60_000;
}

function eventsKpiCacheMaxStaleMs() {
  const n = Number(process.env.EVENTS_KPI_CACHE_MAX_STALE_MS);
  if (Number.isFinite(n) && n >= 60_000) return Math.min(7 * 24 * 3600_000, n);
  return 24 * 3600_000;
}

function eventsKpiCacheKey({ guildId, maxPastEvents, wclLimit }) {
  return `events-kpi-v1:${Number(guildId)}:${Number(maxPastEvents)}:${Number(wclLimit)}`;
}

const eventsKpiDiskCachePath = path.join(dataDir, "events-kpi-cache.json");
let eventsKpiDiskCacheReady = null;
let eventsKpiDiskWriteChain = Promise.resolve();
/** Mirror of the persisted disk file — keeps writes O(1) without re-reading. */
const eventsKpiDiskMirror = new Map();

/**
 * Hydrate {@link eventsKpiMicroCache} from `data/events-kpi-cache.json`. Runs once
 * (lazy, idempotent) so the very first call after a Render cold start can answer
 * from disk instead of hammering Raid Helper + WCL.
 */
async function ensureEventsKpiDiskCache() {
  if (eventsKpiDiskCacheReady) return eventsKpiDiskCacheReady;
  eventsKpiDiskCacheReady = (async () => {
    try {
      const raw = await readFile(eventsKpiDiskCachePath, "utf8");
      const parsed = JSON.parse(raw);
      const byKey = parsed && typeof parsed === "object" && parsed.byKey ? parsed.byKey : {};
      for (const [key, entry] of Object.entries(byKey)) {
        if (!entry || typeof entry !== "object") continue;
        const at = Number(entry.at);
        if (!Number.isFinite(at)) continue;
        eventsKpiDiskMirror.set(key, { at, data: entry.data });
        eventsKpiMicroCache.set(key, { at, data: entry.data });
      }
    } catch (err) {
      if (err?.code !== "ENOENT") {
        console.warn("[events-kpi] disk cache load failed:", err?.message || err);
      }
    }
  })();
  return eventsKpiDiskCacheReady;
}

function persistEventsKpiDiskCache() {
  eventsKpiDiskWriteChain = eventsKpiDiskWriteChain.catch(() => {}).then(async () => {
    const byKey = {};
    for (const [k, v] of eventsKpiDiskMirror.entries()) byKey[k] = v;
    const tmp = `${eventsKpiDiskCachePath}.tmp`;
    await writeFile(tmp, JSON.stringify({ byKey }, null, 2), "utf8");
    await rename(tmp, eventsKpiDiskCachePath);
  });
  return eventsKpiDiskWriteChain;
}

/**
 * Stale-while-revalidate KPI cache.
 *
 * - Fresh hit  (`age < ttl`)            → return cached, no work.
 * - Stale-OK   (`ttl ≤ age < maxStale`) → return cached AND kick off background
 *                                        refresh (the user sees instant data,
 *                                        the next request gets fresh numbers).
 * - Cold miss                           → compute synchronously, dedupe inflight.
 */
async function getEventsKpiCached(cacheKey, loader) {
  await ensureEventsKpiDiskCache();
  const ttlMs = eventsKpiCacheTtlMs();
  const maxStaleMs = eventsKpiCacheMaxStaleMs();
  const now = Date.now();
  const cached = eventsKpiMicroCache.get(cacheKey);
  const age = cached ? now - Number(cached.at || 0) : Number.POSITIVE_INFINITY;

  if (cached && age < ttlMs) return cached.data;

  if (cached && age < maxStaleMs) {
    if (!eventsKpiInflight.get(cacheKey)) {
      const refresh = (async () => {
        try {
          const data = await loader();
          const at = Date.now();
          eventsKpiMicroCache.set(cacheKey, { at, data });
          eventsKpiDiskMirror.set(cacheKey, { at, data });
          persistEventsKpiDiskCache().catch(() => {});
        } catch (err) {
          console.warn("[events-kpi] background refresh failed:", err?.message || err);
        } finally {
          eventsKpiInflight.delete(cacheKey);
        }
      })();
      eventsKpiInflight.set(cacheKey, refresh);
    }
    return cached.data;
  }

  const running = eventsKpiInflight.get(cacheKey);
  if (running) return running;
  const task = (async () => {
    const data = await loader();
    const at = Date.now();
    eventsKpiMicroCache.set(cacheKey, { at, data });
    eventsKpiDiskMirror.set(cacheKey, { at, data });
    persistEventsKpiDiskCache().catch(() => {});
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
  try {
    mvpVotesReplaceFromState(votingStoreState);
  } catch (error) {
    console.warn("[mvp-votes] dual-write failed:", error?.message || error);
  }
}

async function ensureVotingStore() {
  if (votingStoreReady) return votingStoreReady;
  votingStoreReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    /* Phase 3 cutover: when SQLite has rows, hydrate from there.
       JSON write-through still keeps the legacy file in sync as a rollback. */
    if (materializePhase3Enabled()) {
      try {
        const sqlVotes = mvpVotesGetAll();
        if (Array.isArray(sqlVotes) && sqlVotes.length > 0) {
          votingStoreState = {
            votes: sqlVotes
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
          return;
        }
      } catch (error) {
        console.warn("[mvp-votes] SQLite hydrate failed, falling back to JSON:", error?.message || error);
      }
    }
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

async function persistAnalyticsStore() {
  const tmpPath = `${analyticsStorePath}.tmp`;
  const json = JSON.stringify(analyticsStoreState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, analyticsStorePath);
}

async function ensureAnalyticsStore() {
  if (analyticsStoreReady) return analyticsStoreReady;
  analyticsStoreReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(analyticsStorePath, "utf8");
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed?.events) ? parsed.events : [];
      analyticsStoreState = {
        events: rows
          .map((row) => ({
            at: Number(row?.at || 0),
            type: String(row?.type || "pageview"),
            path: String(row?.path || "/"),
            title: String(row?.title || "").slice(0, 160),
            referrer: String(row?.referrer || "").slice(0, 220),
            sessionId: String(row?.sessionId || "").slice(0, 120),
          }))
          .filter((row) => row.at > 0 && row.path),
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      analyticsStoreState = { events: [] };
      await persistAnalyticsStore();
    }
  })();
  return analyticsStoreReady;
}

async function appendAnalyticsEvent(event) {
  await ensureAnalyticsStore();
  analyticsWriteChain = analyticsWriteChain.then(async () => {
    analyticsStoreState.events.push(event);
    const maxEvents = 20_000;
    if (analyticsStoreState.events.length > maxEvents) {
      analyticsStoreState.events = analyticsStoreState.events.slice(-maxEvents);
    }
    await persistAnalyticsStore();
  });
  await analyticsWriteChain;
}

function analyticsSummary({ days = 30 } = {}) {
  const safeDays = Math.max(1, Math.min(365, Math.floor(Number(days) || 30)));
  const since = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const rows = (analyticsStoreState.events || []).filter((row) => Number(row?.at || 0) >= since);
  const pageviews = rows.filter((row) => row.type === "pageview");

  const byPath = new Map();
  const byDay = new Map();
  const uniqueSessions = new Set();
  for (const row of pageviews) {
    const pathKey = String(row.path || "/");
    byPath.set(pathKey, (byPath.get(pathKey) || 0) + 1);
    if (row.sessionId) uniqueSessions.add(String(row.sessionId));
    const d = new Date(Number(row.at || 0));
    const day = Number.isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }

  const topPages = [...byPath.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 25);
  const daily = [...byDay.entries()]
    .map(([day, views]) => ({ day, views }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    ok: true,
    days: safeDays,
    totalEvents: rows.length,
    pageviews: pageviews.length,
    uniqueSessions: uniqueSessions.size,
    topPages,
    daily,
  };
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

function buildMockHallOfFameRows(limit = 8) {
  const now = Date.now();
  const rows = [
    {
      roundKey: "mock-hof-highbullet",
      raidCode: "MOCK-SWP-HIGHBULLET",
      raidName: "Sunwell Plateau",
      raidStartTime: now - 7 * 24 * 60 * 60 * 1000,
      winnerName: "Highbullet",
      winnerVotes: 41,
    },
    {
      roundKey: "mock-hof-glutelf",
      raidCode: "MOCK-BT-GLUTELF",
      raidName: "Black Temple",
      raidStartTime: now - 14 * 24 * 60 * 60 * 1000,
      winnerName: "Glutelf",
      winnerVotes: 36,
    },
  ];
  return rows.slice(0, Math.max(1, Math.floor(Number(limit) || 8)));
}

const HOF_REPORT_FIGHTS_QUERY = `
  query HofReportFights($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
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

function looksLikeWclReportCode(value) {
  const v = String(value || "").trim();
  return /^[A-Za-z0-9]{8,20}$/.test(v);
}

async function hallOfFameReportMetaForCode(raidCode) {
  const code = String(raidCode || "").trim();
  if (!code || !looksLikeWclReportCode(code)) return null;
  return getOrRefreshCachedPayload(`hof-report-meta-v1-${code}`, {
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    maxStaleMs: 14 * 24 * 60 * 60 * 1000,
    loader: async () => {
      const data = await queryWcl(HOF_REPORT_FIGHTS_QUERY, { code });
      const report = data?.reportData?.report;
      if (!report) return null;
      const inferredPrimary = primaryTrackedRaidNameFromReport(report);
      const raidName = mvpUiRaidName(report, inferredPrimary || String(report?.zone?.name || ""));
      return {
        raidName: String(raidName || "").trim(),
        raidStartTime: reportStartTimeMs(report?.startTime),
      };
    },
  });
}

async function hydrateHallOfFameRaidMetadata(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  return Promise.all(
    rows.map(async (row) => {
      const currentRaidName = String(row?.raidName || "").trim();
      const raidCode = String(row?.raidCode || "").trim();
      const shouldResolve = !currentRaidName || currentRaidName === raidCode || looksLikeWclReportCode(currentRaidName);
      if (!shouldResolve) return row;
      let meta = null;
      try {
        meta = await hallOfFameReportMetaForCode(raidCode);
      } catch {
        meta = null;
      }
      return {
        ...row,
        raidName: String(meta?.raidName || currentRaidName || raidCode || "Raid").trim(),
        raidStartTime: Number(row?.raidStartTime || meta?.raidStartTime || 0),
      };
    })
  );
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
function rhPrimarySignupTotalForRosterRow(rhSignupResult, attRow, stripped) {
  const map = rhSignupResult?.counts instanceof Map ? rhSignupResult.counts : null;
  if (!map || !map.size) return 0;
  const wclChars = Array.isArray(attRow?.wclCharacters) ? attRow.wclCharacters : [];
  const raw = [
    stripped?.name,
    attRow?.raidHelperName,
    attRow?.name,
    stripped?.characterName,
    ...wclChars,
  ];
  const keys = new Set();
  for (const x of raw) {
    const k = normalizeRaidHelperDisplayKey(String(x || ""));
    if (k) keys.add(k);
  }
  let max = 0;
  for (const k of keys) {
    const c = Number(map.get(k) || 0);
    if (c > max) max = c;
  }
  return max;
}

async function buildActiveRosterPlayersForGuild(guildId, { reportLimit = 40, top = 250, maxRhPastEvents = 0 } = {}) {
  const rhSignupCounts = await countRaidHelperPrimarySignupsPerRhKey(maxRhPastEvents);
  await ensureRhWclLinksStore();

  // Phase 9 cutover — read distinct admin-curated WCL guild raid reports
  // each canonical user appeared in straight from `raid_appearances`.
  // The set of report codes that "counts" is the admin Event Management
  // selection (`gargulLootState.selectedReportCodes`); when no selection
  // has been saved we use every code we have in `raid_appearances`,
  // matching the existing loot-history fallback semantics. Falls back to
  // an empty Map if the table is empty (first deploy before any sync) so
  // the legacy Raid Helper signup count keeps serving in the meantime.
  const useMaterialisedAppearances = materializeRaidAppearancesEnabled();
  const selectedReportCodesList = Array.from(
    new Set(
      (gargulLootState?.selectedReportCodes || [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );
  /** @type {Map<number, number>} */
  let wclAppearanceCountsByUserId = new Map();
  let wclAppearanceReportCount = 0;
  if (useMaterialisedAppearances) {
    try {
      const totalRows = raidAppearancesDistinctReportCount();
      if (totalRows > 0) {
        wclAppearanceCountsByUserId = raidAppearancesCountsByUser(
          selectedReportCodesList.length ? { reportCodes: selectedReportCodesList } : {}
        );
        wclAppearanceReportCount = selectedReportCodesList.length || totalRows;
      }
    } catch (error) {
      console.warn("[roster] raid_appearances lookup failed, falling back to RH signups:", error?.message || error);
      wclAppearanceCountsByUserId = new Map();
      wclAppearanceReportCount = 0;
    }
  }
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

  // Build a `name-key → discordUserId` index once so each player row can
  // declare its canonical Discord id. Indexed by *both* the Raid Helper
  // signup name and every WCL character name on the link, so a roster row
  // whose `name` is the WoW character (e.g. "Highbullet") still resolves to
  // a Discord ID even when the link's RH-name is the Discord nick instead.
  let discordIdByRhKey;
  if (materializeIdentityEnabled()) {
    try {
      discordIdByRhKey = identityResolveDiscordIdsByRhKey();
    } catch (error) {
      console.warn("[identity-cutover] discordIdByRhKey fallback to JSON:", error?.message || error);
      discordIdByRhKey = null;
    }
  }
  if (!discordIdByRhKey) {
    discordIdByRhKey = new Map();
    for (const link of rhWclLinksState?.links || []) {
      const id = sanitizeDiscordUserId(link?.discordUserId);
      if (!id) continue;
      const rhKey = normalizeRaidHelperDisplayKey(String(link?.raidHelperName || ""));
      if (rhKey && !discordIdByRhKey.has(rhKey)) discordIdByRhKey.set(rhKey, id);
      for (const cn of Array.isArray(link?.wclCharacterNames) ? link.wclCharacterNames : []) {
        const cnKey = normalizeRaidHelperDisplayKey(String(cn || ""));
        if (cnKey && !discordIdByRhKey.has(cnKey)) discordIdByRhKey.set(cnKey, id);
      }
    }
  }
  // Augment with the live RH-signup scan cache so newly observed users still
  // resolve before the next manual save on /admin.html.
  for (const [userId, entry] of Object.entries(discordIdToRhNameState?.byUserId || {})) {
    const key = normalizeRaidHelperDisplayKey(String(entry?.rhName || ""));
    const id = sanitizeDiscordUserId(userId);
    if (id && key && !discordIdByRhKey.has(key)) discordIdByRhKey.set(key, id);
  }

  // Phase 6: enrich each player row with the canonical user id / main
  // character drawn from the SQL identity tables. Live attendance + parses
  // still come from the gather pipeline; the canonical fields enable
  // downstream consumers (profile picture by users.id, badge_state lookups)
  // without needing a Discord OAuth login.
  const players = enriched.map((row, i) => {
    const att = pairs[i].attRow;
    const stripped = stripInternalRosterFields(row);
    const rhPastEventCount = rhPrimarySignupTotalForRosterRow(rhSignupCounts, att, stripped);
    const rhLookupKeys = [...new Set(
      [
        stripped?.name,
        att?.raidHelperName,
        att?.name,
        stripped?.characterName,
        ...(Array.isArray(att?.wclCharacters) ? att.wclCharacters : []),
      ]
        .map((x) => normalizeRaidHelperDisplayKey(String(x || "")))
        .filter(Boolean)
    )];
    let discordUserId = null;
    for (const k of rhLookupKeys) {
      const id = discordIdByRhKey.get(k);
      if (id) {
        discordUserId = id;
        break;
      }
    }
    let dbUserId = null;
    let mainCharacterName = null;
    if (materializeIdentityEnabled()) {
      try {
        let canonical = discordUserId ? identityUserGetByDiscordId(discordUserId) : null;
        if (!canonical) {
          for (const k of rhLookupKeys) {
            const hit = identityUserGetByRaidHelperKey(k);
            if (hit) {
              canonical = hit;
              break;
            }
          }
        }
        if (canonical?.id) {
          dbUserId = canonical.id;
          if (canonical.mainCharacterId) {
            const characters = identityCharactersGetByUserId(canonical.id);
            const main = characters.find((c) => c.id === canonical.mainCharacterId);
            if (main) mainCharacterName = main.characterName;
          }
        }
      } catch {
        /* canonical lookup is non-essential; live data still serves */
      }
    }
    // WCL-confirmed appearances across the admin-curated Event Management
    // set. `wclEventCount` is the new authoritative "Events" KPI — driven
    // by `raid_appearances`, scoped to `gargulLootState.selectedReportCodes`.
    // We keep `rhPastEventCount` populated for backward compat: when the
    // materialised cutover is producing data, we set it equal to
    // `wclEventCount` so older clients (still reading the RH field) get
    // the same number as the new ones.
    const wclEventCount =
      dbUserId && wclAppearanceCountsByUserId.size
        ? Number(wclAppearanceCountsByUserId.get(dbUserId) || 0)
        : 0;
    const cutoverActive = useMaterialisedAppearances && wclAppearanceCountsByUserId.size > 0;
    return {
      ...stripped,
      guildRole: normalizeRhWclGuildRole(att.guildRole),
      raidsAttended: att.raidsAttended,
      attendanceRate: att.attendanceRate,
      wclCharacters: att.wclCharacters,
      parseSummaries: att.parseSummaries,
      attendanceHistory: att.attendanceHistory,
      wclEventCount,
      rhPastEventCount: cutoverActive ? wclEventCount : rhPastEventCount,
      legacyRhSignupCount: rhPastEventCount,
      discordUserId,
      dbUserId,
      mainCharacterName,
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
      maxPastEvents: maxRhPastEvents <= 0 ? null : maxRhPastEvents,
      scanAllPastPostedEvents: maxRhPastEvents <= 0,
      pastEventsScanned: rhSignupCounts.pastEventsScanned,
      note:
        "Legacy Raid Helper signup scan. Surfaced as `legacyRhSignupCount` on each player; the leaderboard \"Events\" KPI now uses `wclEventCount` (Warcraft Logs appearances scoped to the admin Event Management selection).",
    },
    wclEventScope: {
      source: useMaterialisedAppearances && wclAppearanceCountsByUserId.size > 0 ? "raid_appearances" : "rh_signups_fallback",
      selectedReportCodes: selectedReportCodesList,
      reportCodesCounted: wclAppearanceReportCount,
      note:
        "wclEventCount: distinct WCL guild raid reports each canonical user appeared in, scoped to `gargulLootState.selectedReportCodes` (admin Event Management). Falls back to the Raid Helper signup count for one release if `raid_appearances` is empty.",
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
      maxRhPastEvents: 0,
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
    const fallbackPeakFromRoster =
      bracket === "heal"
        ? Number(matched?.parseSummaries?.bestHeal)
        : bracket === "tank"
          ? Number(matched?.parseSummaries?.bestTank)
          : Number(matched?.parseSummaries?.bestDps);
    const fallbackPeak = Number.isFinite(fallbackPeakFromRoster) ? fallbackPeakFromRoster : null;
    if (peakParse == null) peakParse = fallbackPeak;
    if (!wclClassName && matched?.className) wclClassName = String(matched.className || "");
    const syntheticPlayer =
      matched ||
      (row?.winnerName
        ? {
            name: String(row.winnerName || ""),
            characterName: String(row.winnerName || ""),
            className: wclClassName || "",
            specName: "",
            roleName: bracket === "heal" ? "Healer" : bracket === "tank" ? "Tank" : "Ranged",
            wclCharacters: [],
          }
        : null);
    return {
      ...row,
      player: syntheticPlayer,
      peakParse,
      peakParseSource,
      peakParseBracket: bracket,
      wclClassName,
    };
  });
}

function sortHallOfFameRowsByRaidStartDesc(list) {
  return [...list].sort((a, b) => Number(b?.raidStartTime || 0) - Number(a?.raidStartTime || 0));
}

async function getHallOfFameForGuild(guildId, limit = 10) {
  await ensureVotingStore();
  await ensureHofNotesStore();
  const voting = await getCurrentVotingRoundCached(guildId);
  const currentRoundKey = voting?.roundKey || "";
  let identityRows = votingHallOfFame(currentRoundKey, limit);
  if (!identityRows.length) identityRows = buildMockHallOfFameRows(limit);
  identityRows = sortHallOfFameRowsByRaidStartDesc(identityRows);
  const fingerprint = computeHallOfFameWinnerFingerprint(identityRows);

  const cached = await tryReadHallOfFameEnrichedCache(guildId, limit, fingerprint);
  if (cached) {
    return applyHofNotesToHallOfFameRows(cached);
  }

  try {
    const enriched = await enrichHallOfFameRows(guildId, identityRows);
    const withRaidNames = await hydrateHallOfFameRaidMetadata(enriched);
    const sorted = sortHallOfFameRowsByRaidStartDesc(withRaidNames);
    await persistHallOfFameEnrichedCache(guildId, limit, fingerprint, stripHallOfFameRowsForDiskCache(sorted));
    return applyHofNotesToHallOfFameRows(sorted);
  } catch {
    const hydrated = await hydrateHallOfFameRaidMetadata(identityRows).catch(() => identityRows);
    return sortHallOfFameRowsByRaidStartDesc(applyHofNotesToHallOfFameRows(hydrated)).map((r) => ({
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
  const raw = String(process.env.P2_EDITOR_DISCORD_IDS || "").trim();
  const source = raw || "308667806633951243";
  return source
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function p2EditorNames() {
  const raw = process.env.P2_EDITOR_DISCORD_NAMES;
  const source = raw && raw.trim() ? raw : "highbullet,maxwi,max";
  return source
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeAdminNameValue(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isP2Editor(session) {
  if (!session?.user) return false;
  const userId = String(session.user.id || "").trim();
  const ids = p2EditorIds();
  if (userId && ids.includes(userId)) return true;
  const configuredNames = p2EditorNames();
  const configuredNamesNormalized = configuredNames.map((n) => normalizeAdminNameValue(n)).filter(Boolean);
  const nameCandidates = [session.user.globalName, session.user.username]
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);
  const nameCandidatesNormalized = nameCandidates.map((n) => normalizeAdminNameValue(n)).filter(Boolean);
  const looseNameMatch = nameCandidatesNormalized.some((cand) =>
    configuredNamesNormalized.some((cfg) => cand.includes(cfg) || cfg.includes(cand))
  );
  return (
    nameCandidates.some((n) => configuredNames.includes(n)) ||
    nameCandidatesNormalized.some((n) => configuredNamesNormalized.includes(n)) ||
    looseNameMatch
  );
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
    // Seed in-memory state from the legacy JSON file first (so the DB migration
    // and any pre-DB deployments still work). The SQLite database overrides
    // these values below when present.
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
    // SQLite is authoritative once the DB is populated (post-migration). Pull
    // the latest counts so reloads after a server restart see DB-backed values.
    try {
      const { currentById } = p2GetAllCurrent();
      const merged = { ...p2MaterialsState.currentById };
      let touched = false;
      for (const [id, value] of Object.entries(currentById)) {
        const v = Number(value);
        if (!Number.isFinite(v) || v < 0) continue;
        if (merged[id] !== v) {
          merged[id] = v;
          touched = true;
        }
      }
      if (touched) p2MaterialsState = { currentById: merged };
    } catch (error) {
      console.warn("[item-needs-db] p2 hydrate failed:", error?.message || error);
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

async function setP2MaterialCurrent(materialId, currentValue, editor = null) {
  await ensureP2MaterialsStore();
  const exists = P2_MATERIALS.some((m) => m.id === materialId);
  if (!exists) throw new Error("Unknown material id");
  const safeValue = Math.max(0, Math.floor(Number(currentValue || 0)));

  // SQLite write is synchronous and append-only (history row on every change).
  try {
    p2UpsertMaterial({
      materialId,
      currentValue: safeValue,
      updatedAt: Date.now(),
      userId: editor?.userId || null,
      displayName: editor?.displayName || null,
    });
  } catch (error) {
    console.warn("[item-needs-db] p2UpsertMaterial failed:", error?.message || error);
  }

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
    const classSlug = englishCanonicalClassSlugFromLocalizedDisplay(className);
    const color = JOIN_NEED_COLOR_BY_CLASS_SLUG[classSlug] || "#ffffff";
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
  try {
    dmSubscribersReplaceFromState(discordDmSubscribersState);
  } catch (error) {
    console.warn("[dm-subs] dual-write failed:", error?.message || error);
  }
}

async function ensureDiscordDmSubscribersStore() {
  if (discordDmSubscribersReady) return discordDmSubscribersReady;
  discordDmSubscribersReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    if (materializePhase3Enabled()) {
      try {
        const subRows = dmSubscribersGetAll();
        const notifRows = dmNotifiedEventIdsGetAll();
        if ((Array.isArray(subRows) && subRows.length > 0) || (Array.isArray(notifRows) && notifRows.length > 0)) {
          const subscribersByUserId = {};
          for (const r of subRows) {
            const userId = String(r?.userId || "").trim();
            if (!userId) continue;
            subscribersByUserId[userId] = {
              userId,
              username: String(r?.username || ""),
              globalName: String(r?.globalName || ""),
              subscribed: !!r?.subscribed,
              updatedAt: Number(r?.updatedAt || 0),
            };
          }
          discordDmSubscribersState = sanitizeDiscordDmSubscribersState({
            subscribersByUserId,
            notifiedEventIds: notifRows.map((r) => String(r?.eventId || "")).filter(Boolean),
          });
          return;
        }
      } catch (error) {
        console.warn(
          "[dm-subscribers] SQLite hydrate failed, falling back to JSON:",
          error?.message || error
        );
      }
    }
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

function sanitizeRoleAlertDmLogState(raw) {
  const byEventIdIn = raw && typeof raw.byEventId === "object" ? raw.byEventId : {};
  const byEventId = {};
  for (const [eventIdRaw, eventRowRaw] of Object.entries(byEventIdIn)) {
    const eventId = String(eventIdRaw || "").trim().slice(0, 80);
    if (!eventId) continue;
    const eventRow = eventRowRaw && typeof eventRowRaw === "object" ? eventRowRaw : {};
    const byUserIdIn = eventRow && typeof eventRow.byUserId === "object" ? eventRow.byUserId : {};
    const byUserId = {};
    for (const [userIdRaw, tsRaw] of Object.entries(byUserIdIn)) {
      const userId = String(userIdRaw || "").trim().slice(0, 64);
      if (!userId) continue;
      const sentAt = Number(tsRaw);
      if (!Number.isFinite(sentAt) || sentAt <= 0) continue;
      byUserId[userId] = sentAt;
    }
    byEventId[eventId] = { byUserId };
  }
  return { byEventId };
}

function normalizeHofWinnerRaidKey(raidCode, winnerName) {
  const code = String(raidCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
  const winner = String(winnerName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 _-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  if (!code || !winner) return "";
  return `${code}::${winner}`;
}

function applyHofNotesToHallOfFameRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    const winnerRaidKey = normalizeHofWinnerRaidKey(row?.raidCode, row?.winnerName);
    const note =
      winnerRaidKey && hofNotesState.byWinnerRaidKey && typeof hofNotesState.byWinnerRaidKey === "object"
        ? hofNotesState.byWinnerRaidKey[winnerRaidKey]
        : null;
    return {
      ...row,
      winnerRaidKey,
      customQuote: String(note?.quote || ""),
    };
  });
}

function hallOfFameEnrichedCacheTtlMs() {
  const n = Number(process.env.HOF_ENRICHED_DISK_CACHE_MS);
  if (Number.isFinite(n) && n >= 60_000) return Math.min(168 * 3600_000, n);
  return 6 * 3600_000;
}

function computeHallOfFameWinnerFingerprint(rows) {
  if (!Array.isArray(rows) || !rows.length) return "empty";
  const parts = rows.map((r) =>
    [
      String(r?.roundKey || ""),
      String(r?.raidCode || ""),
      String(r?.winnerName || ""),
      String(Number(r?.raidStartTime || 0)),
    ].join("|")
  );
  parts.sort();
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function stripHallOfFameRowsForDiskCache(rows) {
  return rows.map((row) => {
    const copy = { ...(row || {}) };
    delete copy.winnerRaidKey;
    delete copy.customQuote;
    return copy;
  });
}

async function tryReadHallOfFameEnrichedCache(guildId, limit, fingerprint) {
  const ttl = hallOfFameEnrichedCacheTtlMs();
  const now = Date.now();
  const mem = hofEnrichedMemoryCache;
  if (
    mem &&
    Number(mem.guildId) === Number(guildId) &&
    Number(mem.limit) === Number(limit) &&
    mem.fingerprint === fingerprint &&
    now - Number(mem.generatedAt || 0) < ttl &&
    Array.isArray(mem.hallOfFame)
  ) {
    return mem.hallOfFame;
  }
  try {
    const raw = await readFile(hofEnrichedCachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed?.v === 1 &&
      Number(parsed.guildId) === Number(guildId) &&
      Number(parsed.limit) === Number(limit) &&
      parsed.fingerprint === fingerprint &&
      Array.isArray(parsed.hallOfFame) &&
      now - Number(parsed.generatedAt || 0) < ttl
    ) {
      hofEnrichedMemoryCache = {
        guildId: Number(guildId),
        limit: Number(limit),
        fingerprint,
        generatedAt: Number(parsed.generatedAt || 0),
        hallOfFame: parsed.hallOfFame,
      };
      return parsed.hallOfFame;
    }
  } catch {
    /* cache miss */
  }
  return null;
}

async function persistHallOfFameEnrichedCache(guildId, limit, fingerprint, hallOfFame) {
  const generatedAt = Date.now();
  const payload = {
    v: 1,
    guildId: Number(guildId),
    limit: Number(limit),
    fingerprint,
    generatedAt,
    hallOfFame,
  };
  hofEnrichedMemoryCache = {
    guildId: Number(guildId),
    limit: Number(limit),
    fingerprint,
    generatedAt,
    hallOfFame,
  };
  hofEnrichedWriteChain = hofEnrichedWriteChain.then(async () => {
    try {
      await mkdir(dataDir, { recursive: true });
      const tmpPath = `${hofEnrichedCachePath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");
      await rename(tmpPath, hofEnrichedCachePath);
    } catch {
      /* disk optional */
    }
  });
  await hofEnrichedWriteChain;
}

function sanitizeHofNotesState(raw) {
  const byWinnerRaidKeyIn = raw && typeof raw.byWinnerRaidKey === "object" ? raw.byWinnerRaidKey : {};
  const byWinnerRaidKey = {};
  for (const [keyRaw, noteRaw] of Object.entries(byWinnerRaidKeyIn)) {
    const key = String(keyRaw || "").trim().slice(0, 220);
    if (!key) continue;
    const note = noteRaw && typeof noteRaw === "object" ? noteRaw : {};
    const quote = String(note.quote || "")
      .trim()
      .slice(0, 320);
    byWinnerRaidKey[key] = {
      quote,
      updatedAt: Number.isFinite(Number(note.updatedAt)) ? Number(note.updatedAt) : Date.now(),
      updatedBy: String(note.updatedBy || "")
        .trim()
        .slice(0, 128),
    };
  }
  return { byWinnerRaidKey };
}

async function persistHofNotesStore() {
  const tmpPath = `${hofNotesPath}.tmp`;
  const json = JSON.stringify(hofNotesState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, hofNotesPath);
  try {
    hofNotesReplaceFromState(hofNotesState);
  } catch (error) {
    console.warn("[hof-notes] dual-write failed:", error?.message || error);
  }
}

async function ensureHofNotesStore() {
  if (hofNotesReady) return hofNotesReady;
  hofNotesReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    if (materializePhase3Enabled()) {
      try {
        const rows = hofNotesGetAll();
        if (Array.isArray(rows) && rows.length > 0) {
          const byWinnerRaidKey = {};
          for (const r of rows) {
            const key = String(r?.winnerRaidKey || "").trim();
            if (!key) continue;
            byWinnerRaidKey[key] = {
              quote: String(r?.quote || ""),
              updatedAt: Number(r?.updatedAt || 0),
              updatedBy: String(r?.updatedBy || ""),
            };
          }
          hofNotesState = sanitizeHofNotesState({ byWinnerRaidKey });
          return;
        }
      } catch (error) {
        console.warn(
          "[hof-notes] SQLite hydrate failed, falling back to JSON:",
          error?.message || error
        );
      }
    }
    try {
      const raw = await readFile(hofNotesPath, "utf8");
      const parsed = JSON.parse(raw);
      hofNotesState = sanitizeHofNotesState(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      hofNotesState = { byWinnerRaidKey: {} };
      await persistHofNotesStore();
    }
  })();
  return hofNotesReady;
}

async function persistRoleAlertDmLogStore() {
  const tmpPath = `${roleAlertDmLogPath}.tmp`;
  const json = JSON.stringify(roleAlertDmLogState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, roleAlertDmLogPath);
  try {
    roleAlertLogReplaceFromState(roleAlertDmLogState);
  } catch (error) {
    console.warn("[role-alert-log] dual-write failed:", error?.message || error);
  }
}

async function ensureRoleAlertDmLogStore() {
  if (roleAlertDmLogReady) return roleAlertDmLogReady;
  roleAlertDmLogReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    if (materializePhase3Enabled()) {
      try {
        const rows = roleAlertLogGetAll();
        if (Array.isArray(rows) && rows.length > 0) {
          const byEventId = {};
          for (const r of rows) {
            const eventId = String(r?.eventId || "").trim();
            const userId = String(r?.userId || "").trim();
            const sentAt = Number(r?.sentAt || 0);
            if (!eventId || !userId || !Number.isFinite(sentAt) || sentAt <= 0) continue;
            if (!byEventId[eventId]) byEventId[eventId] = { byUserId: {} };
            byEventId[eventId].byUserId[userId] = sentAt;
          }
          roleAlertDmLogState = sanitizeRoleAlertDmLogState({ byEventId });
          return;
        }
      } catch (error) {
        console.warn(
          "[role-alert-log] SQLite hydrate failed, falling back to JSON:",
          error?.message || error
        );
      }
    }
    try {
      const raw = await readFile(roleAlertDmLogPath, "utf8");
      const parsed = JSON.parse(raw);
      roleAlertDmLogState = sanitizeRoleAlertDmLogState(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      roleAlertDmLogState = { byEventId: {} };
      await persistRoleAlertDmLogStore();
    }
  })();
  return roleAlertDmLogReady;
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
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

function raidHelperDiscordEventPostUrl(eventDetail, fallbackEventId = "") {
  const guildId = raidHelperDiscordGuildId();
  const channelId = String(eventDetail?.channelId || "").trim();
  const messageId = String(
    eventDetail?.messageId ||
      eventDetail?.postId ||
      eventDetail?.signupMessageId ||
      eventDetail?.discordMessageId ||
      ""
  ).trim();
  if (guildId && channelId && messageId) {
    return `https://discord.com/channels/${encodeURIComponent(String(guildId))}/${encodeURIComponent(channelId)}/${encodeURIComponent(messageId)}`;
  }
  if (guildId && channelId) {
    return `https://discord.com/channels/${encodeURIComponent(String(guildId))}/${encodeURIComponent(channelId)}`;
  }
  const evId = String(eventDetail?.id || fallbackEventId || "").trim();
  return evId ? `https://raid-helper.xyz/events/${encodeURIComponent(evId)}` : "";
}

async function sendDiscordDmForRaidHelperEvent(userId, eventRow) {
  const evId = String(eventRow?.id || "");
  const title = String(eventRow?.title || "New raid event").trim() || "New raid event";
  const when = formatRaidHelperEventStartForDm(eventRow?.startTime);
  const raidStats = await raidStatsForEventTitle(title);
  const eventDetail = evId ? await fetchRaidHelperEventDetail(evId) : null;
  const discordPostUrl = raidHelperDiscordEventPostUrl(eventDetail, evId);
  const headerImageUrl = joinUsDmHeaderImageUrl() || eventDmHeaderImageUrl(eventDetail, title);
  const dm = await discordBotApi("/users/@me/channels", {
    method: "POST",
    body: { recipient_id: String(userId || "") },
  });
  const channelId = String(dm?.id || "").trim();
  if (!channelId) throw new Error("Could not open DM channel");
  const lines = [`A new Raid-Helper event was posted: **${title}**`, `Start: ${when}`];
  lines.length = 0;
  lines.push(`Hello Friend, we need you for our Adventures in **${title}**`);
  lines.push("");
  lines.push(`**${title}**`);
  lines.push(when);
  if (raidStats?.bestClearText) lines.push(`Best clear so far: ${raidStats.bestClearText}`);
  if (raidStats?.progressText) lines.push(`Progress: ${raidStats.progressText}`);
  lines.push("");
  lines.push(` Join the Raid -> ${discordPostUrl ? `[Discord Signup Channel](${discordPostUrl})` : "Discord Signup Channel"}`);
  lines.push(` Join the Community -> [Join Us Website](${joinUsPageUrl()})`);
  if (headerImageUrl) {
    await sendJoinUsHeaderImageMessage(channelId, headerImageUrl);
  }
  await discordBotApi(`/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: { content: lines.join("\n"), flags: 4 },
  });
}

async function runRaidHelperDmPollOnce() {
  if (raidHelperDmPollRunning) return;
  raidHelperDmPollRunning = true;
  try {
    if (!canRunRaidHelperDmNotifier()) return;
    await ensureDiscordDmSubscribersStore();
    await ensureRoleAlertDmLogStore();
    const serverId = raidHelperDiscordGuildId();
    if (!serverId) return;
    const events = await fetchRaidHelperServerEvents(serverId);
    const nowSec = Math.floor(Date.now() / 1000);
    const latestPostedRaw = (Array.isArray(events) ? events : [])
      .map((event) => ({
        id: String(event.id || event.eventId || event.eventID || "").trim(),
        startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
        title: String(event.title || event.name || event.description || "Raid event").trim(),
      }))
      .filter((event) => event.id && Number.isFinite(event.startTime) && event.startTime >= nowSec - 6 * 3600)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, 8);
    const seenEventIds = new Set();
    const latestPosted = [];
    for (const event of latestPostedRaw) {
      if (seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);
      latestPosted.push(event);
      if (latestPosted.length >= 4) break;
    }
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

const RAID_HELPER_BLOCKER_NAME_KEYWORDS = new Set([
  // Generic role placeholders
  "tank",
  "tanks",
  "healer",
  "healers",
  "melee",
  "ranged",
  "caster",
  "casters",
  "mdps",
  "rdps",
  "support",
  // Warrior
  "arms",
  "fury",
  "protection",
  "prot",
  // Druid
  "balance",
  "boomkin",
  "dreamstate",
  "feral",
  "guardian",
  "restoration",
  "resto",
  // Paladin
  "holy",
  "retribution",
  "ret",
  "retri",
  // Rogue
  "assassination",
  "combat",
  "subtlety",
  // Hunter
  "beastmastery",
  "bm",
  "marksmanship",
  "mm",
  "survival",
  // Priest
  "discipline",
  "disc",
  "shadow",
  "smite",
  // Mage
  "arcane",
  "fire",
  "frost",
  // Warlock
  "affliction",
  "demonology",
  "demo",
  "destruction",
  "destro",
  // Shaman
  "elemental",
  "ele",
  "enhancement",
  "enh",
  // Neutral placeholders sometimes used in plans
  "open",
  "free",
]);

function blockerNameContainsKnownKeyword(nameRaw) {
  const normalized = String(nameRaw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (RAID_HELPER_BLOCKER_NAME_KEYWORDS.has(token)) return true;
  }
  // Also allow direct compact forms like "beastmastery" / "marksmanship" already as one token.
  if (RAID_HELPER_BLOCKER_NAME_KEYWORDS.has(normalized.replace(/\s+/g, ""))) return true;
  return false;
}

function signupLooksLikeBlocker(entry) {
  const name = String(entry?.name || "").trim();
  const roleName = normalizeRaidHelperRoleLabel(
    String(entry?.roleName || entry?.role || entry?.cRoleName || entry?.cRole || "").trim()
  );
  const className = englishWowClassDisplayFromRaidHelper(raidHelperClassNameFromSignUpEntry(entry));
  const specName = normalizeProtectionSpecLabel(String(entry?.specName || entry?.cSpecName || "").trim());
  if (!name) return false;
  const low = name.toLowerCase();
  if (/^group\s*\d+/i.test(name)) return true;
  if (blockerNameContainsKnownKeyword(name)) return true;
  if (specName && low === String(specName).trim().toLowerCase()) return true;
  if (roleName && low === String(roleName).trim().toLowerCase()) return true;
  if (className && low === String(className).trim().toLowerCase()) return true;
  return false;
}

function normalizeNeedRoleKey(roleRaw) {
  const role = normalizeRaidHelperRoleLabel(String(roleRaw || "").trim());
  if (role === "Tanks" || role === "Healers" || role === "Melee" || role === "Ranged") return role;
  return "";
}

function normalizeNeedClassKey(classRaw) {
  return englishWowClassDisplayFromRaidHelper(String(classRaw || "").trim());
}

function inferRoleFromClassSpecName(classNameRaw, specNameRaw, nameRaw) {
  const className = String(classNameRaw || "").trim().toLowerCase();
  const specName = String(specNameRaw || "").trim().toLowerCase();
  const name = String(nameRaw || "").trim().toLowerCase();
  const raw = `${className} ${specName} ${name}`;
  if (/\b(tank|protection|guardian)\b/.test(raw)) return "Tanks";
  if (/\b(healer|holy|resto|restoration|discipline|disc|smite)\b/.test(raw)) return "Healers";
  if (/\b(arms|fury|combat|assassination|subtlety|retribution|ret|enhancement|enh|feral)\b/.test(raw)) return "Melee";
  if (
    /\b(arcane|fire|frost|shadow|elemental|ele|destruction|destro|demonology|demo|affliction|balance|boomkin|dreamstate|beastmastery|marksmanship|survival|hunter|mage|warlock)\b/.test(
      raw
    )
  )
    return "Ranged";
  return "";
}

function compBlockerRowsFromPayload(compPayload, existingNamesLower = new Set()) {
  const slots = Array.isArray(compPayload?.slots) ? compPayload.slots : [];
  const out = [];
  for (const slot of slots) {
    const name = String(slot?.name || "").trim();
    if (!name) continue;
    const low = name.toLowerCase();
    if (existingNamesLower.has(low)) continue;
    const probe = {
      name,
      roleName: inferRoleFromClassSpecName(slot?.className, slot?.specName, name),
      className: String(slot?.className || "").trim(),
      specName: String(slot?.specName || "").trim(),
    };
    if (!signupLooksLikeBlocker(probe)) continue;
    out.push({
      signupId: Number(slot?.id || 0) || 0,
      userId: "",
      name,
      roleName: probe.roleName,
      className: englishWowClassDisplayFromRaidHelper(probe.className),
      specName: normalizeProtectionSpecLabel(probe.specName),
      isBlocker: true,
    });
  }
  return out;
}

function buildCompBoardFromPayload(compPayload, existingNamesLower = new Set()) {
  const slots = Array.isArray(compPayload?.slots) ? compPayload.slots : [];
  const groupCount = Math.max(1, Math.floor(Number(compPayload?.groupCount || 5)));
  const slotCount = Math.max(1, Math.floor(Number(compPayload?.slotCount || 5)));
  const roleCounts = { Tanks: 0, Healers: 0, Melee: 0, Ranged: 0 };
  const groups = Array.from({ length: groupCount }, (_, i) => ({ groupNumber: i + 1, slots: [] }));
  for (const slot of slots) {
    const name = String(slot?.name || "").trim();
    const className = String(slot?.className || "").trim();
    const specName = String(slot?.specName || "").trim();
    const roleName = inferRoleFromClassSpecName(className, specName, name);
    if (roleName) roleCounts[roleName] = Number(roleCounts[roleName] || 0) + 1;
    const groupNumber = Math.max(1, Math.floor(Number(slot?.groupNumber || 1)));
    const idx = Math.min(groups.length - 1, Math.max(0, groupNumber - 1));
    const entryProbe = {
      name,
      roleName,
      className: englishWowClassDisplayFromRaidHelper(className),
      specName: normalizeProtectionSpecLabel(specName),
    };
    const isBlocker = signupLooksLikeBlocker(entryProbe);
    const isKnownSignup = existingNamesLower.has(String(name || "").toLowerCase());
    groups[idx].slots.push({
      id: String(slot?.id || ""),
      slotNumber: Number(slot?.slotNumber || 0),
      name,
      roleName,
      className: englishWowClassDisplayFromRaidHelper(className),
      specName: normalizeProtectionSpecLabel(specName),
      isBlocker,
      isKnownSignup,
      color: String(slot?.color || ""),
      isConfirmed: String(slot?.isConfirmed || ""),
      classEmoteId: String(slot?.classEmoteId || ""),
      specEmoteId: String(slot?.specEmoteId || ""),
    });
  }
  for (const group of groups) {
    group.slots.sort((a, b) => Number(a.slotNumber || 0) - Number(b.slotNumber || 0));
  }
  return {
    id: String(compPayload?.id || ""),
    title: String(compPayload?.title || ""),
    groupCount,
    slotCount,
    showRoles: Boolean(compPayload?.showRoles),
    showClasses: Boolean(compPayload?.showClasses),
    roleCounts,
    groups,
  };
}

function summarizeEventNeedsFromDetail(detail, overridesMap = {}, extraRows = []) {
  const signUps = Array.isArray(detail?.signUps) ? detail.signUps : [];
  const primary = signUps.filter((entry) => String(entry?.status || "").toLowerCase() === "primary");
  const rosterRows = primary.map((entry) => {
    const signupId = Number(entry?.id || 0);
    const ov = overridesMap && typeof overridesMap === "object" ? String(overridesMap[String(signupId)] || "") : "";
    const forced = ov === "real" ? false : ov === "blocker" ? true : null;
    const isBlocker = forced == null ? signupLooksLikeBlocker(entry) : forced;
    const roleName = normalizeRaidHelperRoleLabel(
      String(entry?.roleName || entry?.role || entry?.cRoleName || entry?.cRole || "").trim()
    );
    const className = englishWowClassDisplayFromRaidHelper(raidHelperClassNameFromSignUpEntry(entry));
    const specName = normalizeProtectionSpecLabel(String(entry?.specName || entry?.cSpecName || "").trim());
    return {
      signupId,
      userId: String(entry?.userId || "").trim(),
      name: String(entry?.name || "").trim(),
      roleName,
      className,
      specName,
      isBlocker,
    };
  });
  for (const row of Array.isArray(extraRows) ? extraRows : []) {
    if (!row || typeof row !== "object") continue;
    rosterRows.push({
      signupId: Number(row.signupId || 0) || 0,
      userId: String(row.userId || "").trim(),
      name: String(row.name || "").trim(),
      roleName: normalizeRaidHelperRoleLabel(String(row.roleName || "").trim()),
      className: englishWowClassDisplayFromRaidHelper(String(row.className || "").trim()),
      specName: normalizeProtectionSpecLabel(String(row.specName || "").trim()),
      isBlocker: row.isBlocker !== false,
    });
  }
  const realRows = rosterRows.filter((row) => !row.isBlocker);
  const blockerRows = rosterRows.filter((row) => row.isBlocker);
  const currentByRole = { Tanks: 0, Healers: 0, Melee: 0, Ranged: 0 };
  const currentByClass = {};
  const blockerSpecNeedsByRole = { Tanks: {}, Healers: {}, Melee: {}, Ranged: {} };
  for (const row of realRows) {
    const role = normalizeNeedRoleKey(row.roleName);
    if (role) currentByRole[role] = Number(currentByRole[role] || 0) + 1;
    const cls = normalizeNeedClassKey(row.className);
    if (cls) currentByClass[cls] = Number(currentByClass[cls] || 0) + 1;
  }
  for (const row of blockerRows) {
    const role = normalizeNeedRoleKey(row.roleName);
    if (!role) continue;
    let specLabel = String(row.specName || "").trim();
    const cls = normalizeNeedClassKey(row.className);
    if (!specLabel) {
      const rawName = String(row.name || "").trim().toLowerCase();
      if (rawName.includes("enh")) specLabel = "Enhancement";
      else if (rawName.includes("combat")) specLabel = "Combat";
      else if (rawName.includes("balance") || rawName.includes("boomkin") || rawName.includes("dreamstate")) specLabel = "Balance";
      else if (rawName.includes("retri") || rawName.includes("ret")) specLabel = "Retribution";
    }
    if (!specLabel) continue;
    if (specLabel.toLowerCase() === "balance" && cls === "Druid") specLabel = "Balance Druid";
    blockerSpecNeedsByRole[role][specLabel] = Number(blockerSpecNeedsByRole[role][specLabel] || 0) + 1;
  }
  return {
    signupsTotal: signUps.length,
    primaryTotal: primary.length,
    realRows,
    blockerRows,
    currentByRole,
    currentByClass,
    blockerSpecNeedsByRole,
  };
}

function sanitizeRoleSpecNeedsInput(raw) {
  const out = { Tanks: [], Healers: [], Melee: [], Ranged: [] };
  const src = raw && typeof raw === "object" ? raw : {};
  for (const role of ["Tanks", "Healers", "Melee", "Ranged"]) {
    const rows = Array.isArray(src[role]) ? src[role] : [];
    out[role] = rows
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const spec = String(row.spec || row.name || "").trim().slice(0, 80);
        const count = Math.max(0, Math.floor(Number(row.count || 0)));
        if (!spec || count <= 0) return null;
        return { spec, count };
      })
      .filter(Boolean)
      .slice(0, 24);
  }
  return out;
}

function roleSpecNeedsMap(roleSpecNeeds) {
  const maps = { Tanks: {}, Healers: {}, Melee: {}, Ranged: {} };
  const src = roleSpecNeeds && typeof roleSpecNeeds === "object" ? roleSpecNeeds : {};
  for (const role of ["Tanks", "Healers", "Melee", "Ranged"]) {
    for (const row of Array.isArray(src[role]) ? src[role] : []) {
      const spec = String(row?.spec || "").trim();
      const count = Math.max(0, Math.floor(Number(row?.count || 0)));
      if (!spec || count <= 0) continue;
      maps[role][spec] = (maps[role][spec] || 0) + count;
    }
  }
  return maps;
}

function normalizeSpecKey(specRaw) {
  return String(specRaw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

async function collectSubscriberRoleSignals(subscribedUserIds, maxPastEvents = 40) {
  const userSet = new Set((Array.isArray(subscribedUserIds) ? subscribedUserIds : []).map((x) => String(x || "").trim()).filter(Boolean));
  const out = new Map();
  if (!userSet.size) return out;
  const serverId = raidHelperDiscordGuildId();
  if (!serverId) return out;
  const nowSec = Math.floor(Date.now() / 1000);
  const allEvents = await fetchRaidHelperServerEvents(serverId);
  const pastEvents = allEvents
    .map((event) => ({
      id: String(event.id || event.eventId || event.eventID || ""),
      startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
    }))
    .filter((event) => event.id && Number.isFinite(event.startTime) && event.startTime > 0 && event.startTime <= nowSec)
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, Math.max(1, Math.min(80, Math.floor(Number(maxPastEvents || 40)))));
  for (const ev of pastEvents) {
    const detail = await fetchRaidHelperEventDetail(ev.id);
    const signUps = Array.isArray(detail?.signUps) ? detail.signUps : [];
    for (const entry of signUps) {
      if (String(entry?.status || "").toLowerCase() !== "primary") continue;
      if (signupLooksLikeBlocker(entry)) continue;
      const userId = String(entry?.userId || "").trim();
      if (!userSet.has(userId)) continue;
      const roleName = normalizeNeedRoleKey(
        normalizeRaidHelperRoleLabel(String(entry?.roleName || entry?.role || entry?.cRoleName || entry?.cRole || "").trim())
      );
      const className = normalizeNeedClassKey(englishWowClassDisplayFromRaidHelper(raidHelperClassNameFromSignUpEntry(entry)));
      if (!roleName && !className) continue;
      if (!out.has(userId)) out.set(userId, { roles: new Set(), classes: new Set(), specs: new Set(), samples: [] });
      const row = out.get(userId);
      if (roleName) row.roles.add(roleName);
      if (className) row.classes.add(className);
      const specName = normalizeProtectionSpecLabel(String(entry?.specName || entry?.cSpecName || "").trim());
      if (specName) row.specs.add(specName);
      if (row.samples.length < 6) {
        row.samples.push({
          eventId: ev.id,
          roleName: roleName || "",
          className: className || "",
          specName: specName || "",
          name: String(entry?.name || "").trim(),
        });
      }
    }
  }
  return out;
}

async function collectPastParticipantSignals(maxPastEvents = 60) {
  const out = new Map();
  const serverId = raidHelperDiscordGuildId();
  if (!serverId) return out;
  const nowSec = Math.floor(Date.now() / 1000);
  const minStartSec = Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000);
  const allEvents = await fetchRaidHelperServerEvents(serverId);
  const pastEvents = allEvents
    .map((event) => ({
      id: String(event.id || event.eventId || event.eventID || ""),
      startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
    }))
    .filter(
      (event) =>
        event.id &&
        Number.isFinite(event.startTime) &&
        event.startTime >= minStartSec &&
        event.startTime <= nowSec
    )
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, Math.max(1, Math.min(120, Math.floor(Number(maxPastEvents || 60)))));
  for (const ev of pastEvents) {
    const detail = await fetchRaidHelperEventDetail(ev.id);
    const signUps = Array.isArray(detail?.signUps) ? detail.signUps : [];
    for (const entry of signUps) {
      if (String(entry?.status || "").toLowerCase() !== "primary") continue;
      if (signupLooksLikeBlocker(entry)) continue;
      const userId = String(entry?.userId || "").trim();
      if (!userId) continue;
      const classDisplay = englishWowClassDisplayFromRaidHelper(raidHelperClassNameFromSignUpEntry(entry));
      const specName = normalizeProtectionSpecLabel(String(entry?.specName || entry?.cSpecName || "").trim());
      const roleRaw = normalizeRaidHelperRoleLabel(
        String(entry?.roleName || entry?.role || entry?.cRoleName || entry?.cRole || "").trim()
      );
      const inferredRole = inferRoleFromClassSpecName(classDisplay, specName, String(entry?.name || "").trim());
      const roleName = normalizeNeedRoleKey(roleRaw || inferredRole);
      const className = normalizeNeedClassKey(classDisplay);
      if (!out.has(userId)) {
        out.set(userId, {
          userId,
          displayName: String(entry?.name || "").trim(),
          roles: new Set(),
          classes: new Set(),
          specs: new Set(),
          samples: [],
          raidsSeen: 0,
          lastSeenStartTime: 0,
        });
      }
      const row = out.get(userId);
      if (!row.displayName) row.displayName = String(entry?.name || "").trim();
      if (roleName) row.roles.add(roleName);
      if (className) row.classes.add(className);
      if (specName) row.specs.add(specName);
      if (row.samples.length < 8) {
        row.samples.push({
          eventId: ev.id,
          roleName: roleName || "",
          className: className || "",
          specName: specName || "",
          name: String(entry?.name || "").trim(),
        });
      }
      row.raidsSeen += 1;
      row.lastSeenStartTime = Math.max(Number(row.lastSeenStartTime || 0), Number(ev.startTime || 0));
    }
  }
  return out;
}

async function buildCustomDmCandidates(maxPastEvents = 120) {
  await ensureDiscordDmSubscribersStore();
  try {
    await ensureRhWclLinksStore();
  } catch {
    rhWclLinksState = { links: [] };
  }
  const subscribedById = new Set(
    Object.values(discordDmSubscribersState.subscribersByUserId || {})
      .filter((row) => row && row.subscribed && String(row.userId || "").trim())
      .map((row) => String(row.userId || "").trim())
  );
  const guildRoleByRhKey = new Map();
  for (const link of rhWclLinksState.links || []) {
    const k = normalizeRaidHelperDisplayKey(String(link?.raidHelperName || ""));
    if (k) guildRoleByRhKey.set(k, normalizeRhWclGuildRole(link?.guildRole));
  }
  let signals = new Map();
  try {
    signals = await collectPastParticipantSignals(maxPastEvents);
  } catch {
    signals = new Map();
  }
  for (const sub of Object.values(discordDmSubscribersState.subscribersByUserId || {})) {
    const uid = String(sub?.userId || "").trim();
    if (!uid || signals.has(uid)) continue;
    signals.set(uid, {
      userId: uid,
      displayName: String(sub?.globalName || sub?.username || uid),
      roles: new Set(),
      classes: new Set(),
      specs: new Set(),
      samples: [],
      raidsSeen: 0,
      lastSeenStartTime: 0,
    });
  }
  const rows = [...signals.values()];
  const guildId = raidHelperDiscordGuildId();
  const checks = await mapWithConcurrency(rows, 8, async (sig) => {
    const inGuild = await isDiscordGuildMemberViaBot(sig.userId, guildId);
    return { sig, inGuild };
  });
  const candidates = [];
  for (const row of checks) {
    const sig = row?.sig;
    if (!sig?.userId) continue;
    if (row.inGuild === false) continue;
    const uid = String(sig.userId || "").trim();
    if (!uid) continue;
    const recent = Array.isArray(sig.samples) && sig.samples.length ? sig.samples[0] : null;
    const rhKey = normalizeRaidHelperDisplayKey(String(sig.displayName || ""));
    candidates.push({
      userId: uid,
      displayName: String(sig.displayName || uid),
      roles: [...(sig.roles || [])].filter(Boolean),
      recentClass: String(recent?.className || ""),
      recentSpec: String(recent?.specName || ""),
      guildRole: String(guildRoleByRhKey.get(rhKey) || "Peon"),
      subscribed: subscribedById.has(uid),
      raidsSeen: Number(sig.raidsSeen || 0),
      inGuildConfirmed: row.inGuild === true,
    });
  }
  candidates.sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || "")));
  return { candidates, subscribedById };
}

async function isDiscordGuildMemberViaBot(userId, guildId) {
  const botToken = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!botToken || !guildId || !userId) return null;
  try {
    const res = await fetch(
      `${DISCORD_API_BASE}/guilds/${encodeURIComponent(String(guildId))}/members/${encodeURIComponent(String(userId))}`,
      {
        headers: { Authorization: `Bot ${botToken}` },
      }
    );
    if (res.status === 404) return false;
    if (res.ok) return true;
    return null;
  } catch {
    return null;
  }
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
    // Load legacy JSON first (used as the migration source the very first time
    // the SQLite DB is opened, and as a fallback if the DB is unavailable).
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
    // Override from SQLite once it has rows. The DB is the source of truth.
    try {
      const dbRows = nvGetAllCurrent();
      if (dbRows.length) {
        netherVortexState = {
          entries: dbRows.map((r) => ({
            userId: r.userId,
            displayName: r.displayName,
            neededCount: Number(r.neededCount) || 0,
            items: Array.isArray(r.items) ? r.items : [],
            updatedAt: Number(r.updatedAt) || 0,
          })),
        };
      }
    } catch (error) {
      console.warn("[item-needs-db] nv hydrate failed:", error?.message || error);
    }
  })();
  return netherVortexReady;
}

async function persistPublicDataSnapshotStore() {
  const tmpPath = `${publicDataSnapshotPath}.tmp`;
  const json = JSON.stringify(publicDataSnapshotState, null, 2);
  await writeFile(tmpPath, json, "utf8");
  await rename(tmpPath, publicDataSnapshotPath);
}

async function ensurePublicDataSnapshotStore() {
  if (publicDataSnapshotReady) return publicDataSnapshotReady;
  publicDataSnapshotReady = (async () => {
    await mkdir(dataDir, { recursive: true });
    try {
      const raw = await readFile(publicDataSnapshotPath, "utf8");
      const parsed = JSON.parse(raw);
      publicDataSnapshotState = {
        updatedAt: Number(parsed?.updatedAt || 0),
        byKey:
          parsed?.byKey && typeof parsed.byKey === "object" && !Array.isArray(parsed.byKey)
            ? parsed.byKey
            : {},
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      publicDataSnapshotState = { updatedAt: 0, byKey: {} };
      await persistPublicDataSnapshotStore();
    }
  })();
  return publicDataSnapshotReady;
}

function publicSnapshotKeyFromRequest(req) {
  const params = new URLSearchParams(req.query || {});
  params.delete("live");
  params.delete("snapshot_refresh");
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(entries).toString();
  return query ? `${req.path}?${query}` : req.path;
}

function shouldUsePublicSnapshot(req) {
  if (req.method !== "GET") return false;
  if (String(req.query?.live || "") === "1") return false;
  if (String(req.query?.snapshot_refresh || "") === "1") return false;
  if (req.path.startsWith("/api/admin/")) return false;
  if (req.path.startsWith("/api/auth/")) return false;
  if (req.path === "/api/health") return false;
  if (req.path === "/api/raid-helper/future-events") return true;
  if (req.path === "/api/raid-helper/events-kpi") return true;
  if (req.path === "/api/voting/hall-of-fame") return true;
  return /^\/api\/wcl\/guild\/\d+\/(boss-times|recent-raids-calendar|latest-raid-mvp|death-leaderboard|attendance|death-encounter-heatmap|active-roster|loot-received|first-clear-participants)$/.test(
    req.path
  );
}

async function upsertPublicSnapshotForKey(key, payload) {
  await ensurePublicDataSnapshotStore();
  publicDataSnapshotState.byKey[key] = { syncedAt: Date.now(), payload };
  publicDataSnapshotState.updatedAt = Date.now();
  publicDataSnapshotWriteChain = publicDataSnapshotWriteChain
    .then(() => persistPublicDataSnapshotStore())
    .catch((error) => console.error("[public-snapshot] persist failed:", error?.message || error));
  await publicDataSnapshotWriteChain;
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
  // Dual-write to the canonical identity layer (Phase 1). Best-effort —
  // never block or fail the JSON persist path on a SQLite hiccup. Reads
  // still come from rhWclLinksState until Phase 2 cuts the reads over.
  try {
    dualWriteRhWclLinksToIdentityDb(rhWclLinksState?.links || []);
  } catch (error) {
    console.warn("[identity-dualwrite] rh-wcl-links mirror failed:", error?.message || error);
  }
}

/**
 * Mirror the in-memory rh-wcl-character-links rows into the canonical
 * `users` + `user_characters` tables. One transaction per call. Safe to
 * invoke after every successful JSON persist; the upsert helpers are
 * idempotent.
 */
function dualWriteRhWclLinksToIdentityDb(links) {
  if (!Array.isArray(links) || links.length === 0) return;
  const now = Date.now();
  for (const link of links) {
    const raidHelperName = String(link?.raidHelperName || "").trim();
    if (!raidHelperName) continue;
    const discordUserId = sanitizeDiscordUserId(link?.discordUserId);
    const guildRole = link?.guildRole ? String(link.guildRole).trim() : null;
    const wclCharacterNames = Array.isArray(link?.wclCharacterNames)
      ? link.wclCharacterNames.map((n) => String(n || "").trim()).filter(Boolean)
      : [];
    const user = identityUserUpsert({
      discordUserId: discordUserId || null,
      raidHelperName,
      displayName: raidHelperName,
      guildRole,
      source: "dualwrite:rh-wcl-links",
      updatedAt: now,
    });
    for (const characterName of wclCharacterNames) {
      identityCharacterUpsert({
        userId: user.id,
        characterName,
        discoveredVia: "wcl-roster",
        source: "dualwrite:rh-wcl-links",
        updatedAt: now,
      });
    }
  }
}

/** Canonical character roster rows (sorted: unassigned first). Single source with attendance + public `/api/wcl/guild/.../characters`. */
async function getGuildCharacterLinkRows() {
  await ensureRhWclLinksStore();
  return sortRhWclLinkRows(rhWclLinksState.links || []);
}

/**
 * Validates a Discord user id snowflake — Discord ids are 17-20 digit numeric
 * strings. We only accept the bare digits to avoid storing arbitrary garbage
 * the operator may have pasted by accident.
 */
function sanitizeDiscordUserId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (!/^\d{17,20}$/.test(s)) return "";
  return s;
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
    const discordUserId = sanitizeDiscordUserId(row?.discordUserId);
    if (discordUserId) out.discordUserId = discordUserId;
    // Provenance for the Discord id field — `manual` when the operator typed
    // it, `rh-scan` when our auto-resolver backfilled it from a Raid Helper
    // signup. Never required, but lets the admin UI show an "auto" chip.
    const discordIdSource = String(row?.discordUserIdSource || "").trim().slice(0, 24);
    if (discordUserId && discordIdSource) out.discordUserIdSource = discordIdSource;
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

/** Total Nether Vortex for one guild member: sum of craft lines only (pool field retired). */
function netherVortexEntryTotal(row) {
  return netherVortexUnitsFromItems(row?.items);
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
    .filter((row) => {
      if (!row) return false;
      const name = String(row.itemName || "").trim();
      const id = Number(row.itemID || 0);
      return Boolean(name) || (Number.isFinite(id) && id > 0);
    })
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
    const itemName = String(row.itemName || "").trim() || (cat ? String(cat.itemName || "").trim() : "");
    const profession = String(row.profession || "").trim() || (cat ? String(cat.profession || "").trim() : "");
    return {
      ...row,
      itemID: Number.isFinite(id) && id > 0 ? id : Number(row.itemID || 0),
      itemName,
      profession,
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
  res.sendFile(path.join(publicDir, "join.html"));
});

app.get(["/leaderboard", "/leaderboard/", "/leaderboard.html"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/home.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "home.html"));
});

app.get("/landing.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "landing.html"));
});

app.get("/events.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "join.html"));
});

app.get("/roster.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get(["/roster", "/roster/"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/voting.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "voting.html"));
});

app.get("/p2-preparation.html", (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) {
    return res.redirect(`/auth/discord/login?next=${encodeURIComponent("/p2-preparation.html")}`);
  }
  res.sendFile(path.join(publicDir, "p2-preparation.html"));
});

app.get("/loot-history.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "loot-history.html"));
});

app.get("/nether-vortex.html", (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) {
    return res.redirect(`/auth/discord/login?next=${encodeURIComponent("/nether-vortex.html")}`);
  }
  res.sendFile(path.join(publicDir, "p2-preparation.html"));
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
  const next = String(req.query.next || "/voting.html");
  const state = encodeDiscordOAuthState(next, oauthStateTtlMs);

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
    const stateRow = decodeDiscordOAuthState(state);
    if (!stateRow || stateRow.expiresAt <= Date.now()) {
      return res
        .status(400)
        .type("html")
        .send(
          discordAuthHelpHtml("Discord login — invalid or expired session", [
            "<strong>This login attempt could not be verified.</strong>",
            "Common causes: the link sat open too long (state expires after about 10 minutes), or <code>AUTH_SESSION_SECRET</code> changed between starting login and returning from Discord.",
            "Go back to the site and click <strong>Log in with Discord</strong> again.",
          ])
        );
    }
    if (!code) {
      return res
        .status(400)
        .type("html")
        .send(
          discordAuthHelpHtml("Discord login — missing code", [
            "<strong>Discord did not return an authorization code.</strong>",
            "Try logging in again from the site. If you denied access on Discord’s screen, approve the prompt or use the correct Discord account.",
          ])
        );
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

app.get("/api/admin/role-alerts/events", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const serverId = raidHelperDiscordGuildId();
    if (!serverId) {
      return res.status(400).json({ ok: false, error: "Missing DISCORD_GUILD_ID or RAID_HELPER_SERVER_ID" });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const events = await fetchRaidHelperServerEvents(serverId);
    const future = (Array.isArray(events) ? events : [])
      .map((event) => ({
        id: String(event.id || event.eventId || event.eventID || "").trim(),
        title: String(event.title || event.name || "Unnamed Event").trim(),
        startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
      }))
      .filter((event) => event.id && Number.isFinite(event.startTime) && event.startTime >= nowSec)
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, 30);
    return res.json({ ok: true, events: future });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load role-alert events" });
  }
});

app.post("/api/admin/role-alerts/analyze", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const eventId = String(req.body?.eventId || "").trim();
    if (!eventId) return res.status(400).json({ ok: false, error: "eventId is required" });
    const overrides = req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {};
    const detail = await fetchRaidHelperEventDetail(eventId);
    if (!detail) return res.status(404).json({ ok: false, error: "Raid event not found" });
    const existingPrimaryNames = new Set(
      (Array.isArray(detail?.signUps) ? detail.signUps : [])
        .filter((entry) => String(entry?.status || "").toLowerCase() === "primary")
        .map((entry) => String(entry?.name || "").trim().toLowerCase())
        .filter(Boolean)
    );
    let compBlockers = [];
    let compBoard = null;
    let compUsed = false;
    try {
      const comp = await raidHelperRequest(`/comps/${encodeURIComponent(eventId)}`);
      compBlockers = compBlockerRowsFromPayload(comp, existingPrimaryNames);
      compBoard = buildCompBoardFromPayload(comp, existingPrimaryNames);
      compUsed = true;
    } catch {
      compBlockers = [];
      compBoard = null;
      compUsed = false;
    }
    const summary = summarizeEventNeedsFromDetail(detail, overrides, compBlockers);
    const manualRoleSpecNeeds = sanitizeRoleSpecNeedsInput(req.body?.manualRoleSpecNeeds);
    const manualRoleSpecNeedMap = roleSpecNeedsMap(manualRoleSpecNeeds);
    const desiredByRoleIn = req.body?.desiredByRole && typeof req.body.desiredByRole === "object" ? req.body.desiredByRole : {};
    const desiredByRole = {
      Tanks: Math.max(0, Math.floor(Number(desiredByRoleIn.Tanks ?? 3) || 0)),
      Healers: Math.max(0, Math.floor(Number(desiredByRoleIn.Healers ?? 5) || 0)),
      Melee: Math.max(0, Math.floor(Number(desiredByRoleIn.Melee ?? 8) || 0)),
      Ranged: Math.max(0, Math.floor(Number(desiredByRoleIn.Ranged ?? 9) || 0)),
    };
    const missingByRole = {};
    for (const role of ["Tanks", "Healers", "Melee", "Ranged"]) {
      const cur = Number(summary.currentByRole[role] || 0);
      const need = Number(desiredByRole[role] || 0);
      missingByRole[role] = Math.max(0, need - cur);
    }
    const analysisWarnings = [];
    await ensureDiscordDmSubscribersStore();
    await ensureRoleAlertDmLogStore();
    try {
      await ensureRhWclLinksStore();
    } catch (error) {
      analysisWarnings.push("Could not load Account Assignment mappings; defaulting guild role to Peon.");
      rhWclLinksState = { links: [] };
    }
    const subscribedById = new Set(
      Object.values(discordDmSubscribersState.subscribersByUserId || {})
        .filter((row) => row && row.subscribed && String(row.userId || "").trim())
        .map((row) => String(row.userId || "").trim())
    );
    const alreadyDmSentByUserId =
      roleAlertDmLogState?.byEventId &&
      roleAlertDmLogState.byEventId[eventId] &&
      typeof roleAlertDmLogState.byEventId[eventId].byUserId === "object"
        ? roleAlertDmLogState.byEventId[eventId].byUserId
        : {};
    const guildRoleByRhKey = new Map();
    for (const link of rhWclLinksState.links || []) {
      const k = normalizeRaidHelperDisplayKey(String(link?.raidHelperName || ""));
      if (k) guildRoleByRhKey.set(k, normalizeRhWclGuildRole(link?.guildRole));
    }
    let participantSignals = new Map();
    try {
      participantSignals = await collectPastParticipantSignals(80);
    } catch (error) {
      analysisWarnings.push("Past participant scan failed; showing comp/need analysis without DM candidates.");
      participantSignals = new Map();
    }
    const defaultTargetRoles = ["Tanks", "Healers", "Melee", "Ranged"].filter((role) => {
      const missingCount = Number(missingByRole[role] || 0);
      const blockerSpecCount = Object.keys(summary.blockerSpecNeedsByRole?.[role] || {}).length;
      const manualSpecCount = Object.keys(manualRoleSpecNeedMap?.[role] || {}).length;
      return missingCount > 0 || blockerSpecCount > 0 || manualSpecCount > 0;
    });
    const neededSpecSetByRole = {};
    for (const role of ["Tanks", "Healers", "Melee", "Ranged"]) {
      const merged = {
        ...(summary.blockerSpecNeedsByRole?.[role] || {}),
        ...(manualRoleSpecNeedMap?.[role] || {}),
      };
      neededSpecSetByRole[role] = new Set(
        Object.keys(merged)
          .map((spec) => normalizeSpecKey(spec))
          .filter(Boolean)
      );
    }
    const candidateTargets = [];
    const participantRows = [...participantSignals.values()];
    const guildId = raidHelperDiscordGuildId();
    let membershipChecks = [];
    try {
      membershipChecks = await mapWithConcurrency(participantRows, 8, async (sig) => {
        const inGuild = await isDiscordGuildMemberViaBot(sig.userId, guildId);
        return { sig, inGuild };
      });
    } catch (error) {
      analysisWarnings.push("Discord guild membership checks failed; candidates could not be verified and were excluded.");
      membershipChecks = participantRows.map((sig) => ({ sig, inGuild: null }));
    }
    for (const row of membershipChecks) {
      const sig = row?.sig;
      if (!sig?.userId) continue;
      if (row.inGuild !== true) continue;
      const userId = String(sig.userId || "").trim();
      if (!userId) continue;
      const matchedRoles = defaultTargetRoles.filter((role) => sig.roles.has(role));
      if (!matchedRoles.length) continue;
      const signalSpecKeys = new Set([...(sig.specs || [])].map((spec) => normalizeSpecKey(spec)).filter(Boolean));
      const matchedSpecs = [];
      let specQualified = false;
      for (const role of matchedRoles) {
        const neededSpecs = neededSpecSetByRole[role];
        if (!neededSpecs || neededSpecs.size === 0) {
          specQualified = true;
          continue;
        }
        for (const sk of signalSpecKeys) {
          if (neededSpecs.has(sk)) {
            specQualified = true;
            const sampleSpec = [...(sig.specs || [])].find((s) => normalizeSpecKey(s) === sk) || sk;
            if (!matchedSpecs.includes(sampleSpec)) matchedSpecs.push(sampleSpec);
          }
        }
      }
      if (!specQualified) continue;
      const recent = Array.isArray(sig.samples) && sig.samples.length ? sig.samples[0] : null;
      const rhKey = normalizeRaidHelperDisplayKey(String(sig.displayName || ""));
      candidateTargets.push({
        userId,
        displayName: String(sig.displayName || userId),
        matchedRoles,
        matchedSpecs,
        guildRole: String(guildRoleByRhKey.get(rhKey) || "Peon"),
        recentClass: String(recent?.className || ""),
        recentSpec: String(recent?.specName || ""),
        subscribed: subscribedById.has(userId),
        dmSentForEvent: Boolean(alreadyDmSentByUserId[userId]),
        dmSentAt: Number(alreadyDmSentByUserId[userId] || 0),
        raidsSeen: Number(sig.raidsSeen || 0),
        inGuild: row.inGuild === true,
      });
    }
    const reachableByRole = { Tanks: 0, Healers: 0, Melee: 0, Ranged: 0 };
    for (const role of ["Tanks", "Healers", "Melee", "Ranged"]) {
      reachableByRole[role] = candidateTargets.filter((row) => Array.isArray(row.matchedRoles) && row.matchedRoles.includes(role)).length;
    }
    return res.json({
      ok: true,
      event: {
        id: String(detail?.id || eventId),
        title: String(detail?.title || detail?.name || "Unnamed Event"),
        startTime: Number(detail?.startTime || detail?.time || 0),
      },
      compUsed,
      compBlockerRowsAdded: compBlockers.length,
      compBoard,
      signups: {
        total: summary.signupsTotal,
        primary: summary.primaryTotal,
        real: summary.realRows.length,
        blockers: summary.blockerRows.length,
      },
      desiredByRole,
      currentByRole: summary.currentByRole,
      missingByRole,
      reachableByRole,
      subscribedTotal: subscribedById.size,
      warnings: analysisWarnings,
      defaultTargetRoles,
      blockerSpecNeedsByRole: summary.blockerSpecNeedsByRole,
      manualRoleSpecNeeds,
      manualRoleSpecNeedMap,
      candidateTargets,
      currentByClass: summary.currentByClass,
      realRows: summary.realRows,
      blockerRows: summary.blockerRows,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to analyze role alerts" });
  }
});

app.post("/api/admin/role-alerts/send", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    if (!String(process.env.DISCORD_BOT_TOKEN || "").trim()) {
      return res.status(400).json({ ok: false, error: "DISCORD_BOT_TOKEN is required for DM send" });
    }
    const eventId = String(req.body?.eventId || "").trim();
    if (!eventId) return res.status(400).json({ ok: false, error: "eventId is required" });
    const overrides = req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {};
    const desiredByRoleIn = req.body?.desiredByRole && typeof req.body.desiredByRole === "object" ? req.body.desiredByRole : {};
    const detail = await fetchRaidHelperEventDetail(eventId);
    if (!detail) return res.status(404).json({ ok: false, error: "Raid event not found" });
    const existingPrimaryNames = new Set(
      (Array.isArray(detail?.signUps) ? detail.signUps : [])
        .filter((entry) => String(entry?.status || "").toLowerCase() === "primary")
        .map((entry) => String(entry?.name || "").trim().toLowerCase())
        .filter(Boolean)
    );
    let compBlockers = [];
    try {
      const comp = await raidHelperRequest(`/comps/${encodeURIComponent(eventId)}`);
      compBlockers = compBlockerRowsFromPayload(comp, existingPrimaryNames);
    } catch {
      compBlockers = [];
    }
    const summary = summarizeEventNeedsFromDetail(detail, overrides, compBlockers);
    const manualRoleSpecNeeds = sanitizeRoleSpecNeedsInput(req.body?.manualRoleSpecNeeds);
    const manualRoleSpecNeedMap = roleSpecNeedsMap(manualRoleSpecNeeds);
    const desiredByRole = {
      Tanks: Math.max(0, Math.floor(Number(desiredByRoleIn.Tanks ?? 3) || 0)),
      Healers: Math.max(0, Math.floor(Number(desiredByRoleIn.Healers ?? 5) || 0)),
      Melee: Math.max(0, Math.floor(Number(desiredByRoleIn.Melee ?? 8) || 0)),
      Ranged: Math.max(0, Math.floor(Number(desiredByRoleIn.Ranged ?? 9) || 0)),
    };
    const neededRoles = [];
    for (const role of ["Tanks", "Healers", "Melee", "Ranged"]) {
      const cur = Number(summary.currentByRole[role] || 0);
      const need = Number(desiredByRole[role] || 0);
      const blockerSpecCount = Object.keys(summary.blockerSpecNeedsByRole?.[role] || {}).length;
      const manualSpecCount = Object.keys(manualRoleSpecNeedMap?.[role] || {}).length;
      if (need > cur || blockerSpecCount > 0 || manualSpecCount > 0) neededRoles.push(role);
    }
    const selectedRolesRaw = Array.isArray(req.body?.targetRoles) ? req.body.targetRoles : [];
    const selectedRoles = [...new Set(selectedRolesRaw.map((x) => normalizeNeedRoleKey(x)).filter(Boolean))];
    const targetRoles = selectedRoles.length ? selectedRoles : neededRoles;
    if (!targetRoles.length) {
      return res.status(400).json({ ok: false, error: "No missing roles based on desired composition." });
    }
    await ensureDiscordDmSubscribersStore();
    const subscribedById = new Set(
      Object.values(discordDmSubscribersState.subscribersByUserId || {})
        .filter((row) => row && row.subscribed && String(row.userId || "").trim())
        .map((row) => String(row.userId || "").trim())
    );
    const signals = await collectPastParticipantSignals(80);
    const guildId = raidHelperDiscordGuildId();
    const eventName = String(detail?.title || detail?.name || "Raid Event").trim();
    const raidStats = await raidStatsForEventTitle(eventName);
    const discordPostUrl = raidHelperDiscordEventPostUrl(detail, eventId);
    const headerImageUrl = joinUsDmHeaderImageUrl() || eventDmHeaderImageUrl(detail, eventName);
    const when = formatRaidHelperEventStartForDm(Number(detail?.startTime || detail?.time || 0));
    const delivered = [];
    const skipped = [];
    const selectedUserIds = new Set(
      (Array.isArray(req.body?.targetUserIds) ? req.body.targetUserIds : [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    );
    const userIdsToProcess = selectedUserIds.size ? [...selectedUserIds] : [];
    if (!userIdsToProcess.length) {
      return res.status(400).json({ ok: false, error: "No target users selected." });
    }
    for (const uidRaw of userIdsToProcess) {
      const uid = String(uidRaw || "").trim();
      if (!uid) continue;
      const guildMember = await isDiscordGuildMemberViaBot(uid, guildId);
      if (guildMember !== true) {
        skipped.push({ userId: uid, reason: "User is not confirmed as a Discord server member" });
        continue;
      }
      const signal = signals.get(uid);
      if (!signal) {
        skipped.push({ userId: uid, reason: "No historical role/class signal" });
        continue;
      }
      const roleHit = targetRoles.some((role) => signal.roles.has(role));
      if (!roleHit) {
        skipped.push({ userId: uid, reason: "No selected role match" });
        continue;
      }
      const dm = await discordBotApi("/users/@me/channels", { method: "POST", body: { recipient_id: uid } });
      const channelId = String(dm?.id || "").trim();
      if (!channelId) {
        skipped.push({ userId: uid, reason: "Failed to open DM channel" });
        continue;
      }
      const msg = [
        `Hello Friend, we need you for our Adventures in **${eventName}**`,
        "",
        `**${eventName}**`,
        when,
        ...(raidStats?.bestClearText ? [`Best clear so far: ${raidStats.bestClearText}`] : []),
        ...(raidStats?.progressText ? [`Progress: ${raidStats.progressText}`] : []),
        "",
        ` Join the Raid -> ${discordPostUrl ? `[Discord Signup Channel](${discordPostUrl})` : "Discord Signup Channel"}`,
        ` Join the Community -> [Join Us Website](${joinUsPageUrl()})`,
      ].join("\n");
      try {
        if (headerImageUrl) {
          await sendJoinUsHeaderImageMessage(channelId, headerImageUrl);
        }
        await discordBotApi(`/channels/${encodeURIComponent(channelId)}/messages`, {
          method: "POST",
          body: { content: msg, flags: 4 },
        });
        delivered.push({ userId: uid, matchedRoles: [...signal.roles].filter((role) => neededRoles.includes(role)) });
      } catch (error) {
        skipped.push({ userId: uid, reason: String(error?.message || "DM send failed") });
      }
    }
    if (delivered.length) {
      const nowMs = Date.now();
      roleAlertDmLogWriteChain = roleAlertDmLogWriteChain.catch(() => {}).then(async () => {
        if (!roleAlertDmLogState.byEventId || typeof roleAlertDmLogState.byEventId !== "object") {
          roleAlertDmLogState.byEventId = {};
        }
        if (!roleAlertDmLogState.byEventId[eventId] || typeof roleAlertDmLogState.byEventId[eventId] !== "object") {
          roleAlertDmLogState.byEventId[eventId] = { byUserId: {} };
        }
        if (
          !roleAlertDmLogState.byEventId[eventId].byUserId ||
          typeof roleAlertDmLogState.byEventId[eventId].byUserId !== "object"
        ) {
          roleAlertDmLogState.byEventId[eventId].byUserId = {};
        }
        for (const row of delivered) {
          const uid = String(row?.userId || "").trim();
          if (!uid) continue;
          roleAlertDmLogState.byEventId[eventId].byUserId[uid] = nowMs;
        }
        await persistRoleAlertDmLogStore();
      });
      await roleAlertDmLogWriteChain;
    }
    return res.json({
      ok: true,
      eventId,
      targetRoles,
      neededRoles,
      selectedUsersCount: userIdsToProcess.length,
      deliveredCount: delivered.length,
      skippedCount: skipped.length,
      delivered,
      skipped,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to send role alerts" });
  }
});

app.get("/api/admin/custom-dm/candidates", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const { candidates, subscribedById } = await buildCustomDmCandidates(120);
    return res.json({
      ok: true,
      subscribedTotal: subscribedById.size,
      candidates,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load DM candidates" });
  }
});

app.post("/api/admin/custom-dm/send", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    if (!String(process.env.DISCORD_BOT_TOKEN || "").trim()) {
      return res.status(400).json({ ok: false, error: "DISCORD_BOT_TOKEN is required for DM send" });
    }
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ ok: false, error: "message is required" });
    if (message.length > 1800) return res.status(400).json({ ok: false, error: "message is too long (max 1800 chars)" });

    const selectedRolesRaw = Array.isArray(req.body?.targetRoles) ? req.body.targetRoles : [];
    const targetRoles = [...new Set(selectedRolesRaw.map((x) => normalizeNeedRoleKey(x)).filter(Boolean))];
    const selectedUserIds = new Set(
      (Array.isArray(req.body?.targetUserIds) ? req.body.targetUserIds : [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    );
    const subscribedOnly = Boolean(req.body?.subscribedOnly);

    const candidatesById = new Map();
    if (targetRoles.length || !selectedUserIds.size) {
      try {
        const { candidates } = await buildCustomDmCandidates(120);
        for (const row of candidates) {
          const uid = String(row?.userId || "").trim();
          if (uid) candidatesById.set(uid, row);
        }
      } catch (error) {
        if (!selectedUserIds.size) {
          return res.status(500).json({ ok: false, error: error?.message || "Failed to build DM target candidates" });
        }
      }
    }
    const targetUserSet = new Set();
    for (const uid of selectedUserIds) {
      targetUserSet.add(uid);
    }
    if (targetRoles.length) {
      for (const row of candidatesById.values()) {
        const roles = Array.isArray(row?.roles) ? row.roles : [];
        if (roles.some((r) => targetRoles.includes(normalizeNeedRoleKey(r)))) {
          targetUserSet.add(String(row.userId || ""));
        }
      }
    }
    if (subscribedOnly) {
      await ensureDiscordDmSubscribersStore();
      const subscribedById = new Set(
        Object.values(discordDmSubscribersState.subscribersByUserId || {})
          .filter((row) => row && row.subscribed && String(row.userId || "").trim())
          .map((row) => String(row.userId || "").trim())
      );
      for (const uid of [...targetUserSet]) {
        if (!subscribedById.has(uid)) targetUserSet.delete(uid);
      }
    }
    if (!targetUserSet.size) {
      return res.status(400).json({ ok: false, error: "No matching target users." });
    }

    const delivered = [];
    const skipped = [];
    for (const uid of targetUserSet) {
      try {
        const guildMember = await isDiscordGuildMemberViaBot(uid, raidHelperDiscordGuildId());
        if (guildMember !== true) {
          skipped.push({ userId: uid, reason: "User is not confirmed as a Discord server member" });
          continue;
        }
        const dm = await discordBotApi("/users/@me/channels", { method: "POST", body: { recipient_id: uid } });
        const channelId = String(dm?.id || "").trim();
        if (!channelId) {
          skipped.push({ userId: uid, reason: "Failed to open DM channel" });
          continue;
        }
        await discordBotApi(`/channels/${encodeURIComponent(channelId)}/messages`, {
          method: "POST",
          body: { content: message, flags: 4 },
        });
        delivered.push({ userId: uid });
      } catch (error) {
        skipped.push({ userId: uid, reason: String(error?.message || "DM send failed") });
      }
    }

    return res.json({
      ok: true,
      targetUsersCount: targetUserSet.size,
      deliveredCount: delivered.length,
      skippedCount: skipped.length,
      delivered,
      skipped,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to send custom DM" });
  }
});

app.get("/api/admin/public-snapshot/status", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  try {
    await ensurePublicDataSnapshotStore();
    const keys = Object.keys(publicDataSnapshotState.byKey || {});
    return res.json({
      ok: true,
      updatedAt: Number(publicDataSnapshotState.updatedAt || 0),
      entries: keys.length,
      keys: keys.slice(0, 120),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to read snapshot status" });
  }
});

app.post("/api/admin/public-snapshot/sync", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  try {
    await ensurePublicDataSnapshotStore();
    const guildId = Number(req.body?.guildId || 817080);
    const origin = `${req.protocol}://${req.get("host")}`;
    const syncPaths = [
      "/api/raid-helper/future-events",
      `/api/raid-helper/events-kpi?guildId=${guildId}&maxPastEvents=80&wclLimit=40`,
      `/api/wcl/guild/${guildId}/recent-raids-calendar?limit=60`,
      `/api/wcl/guild/${guildId}/boss-times?limit=50`,
      `/api/wcl/guild/${guildId}/latest-raid-mvp?limit=15`,
      `/api/wcl/guild/${guildId}/death-leaderboard?limit=40&top=400`,
      `/api/wcl/guild/${guildId}/attendance?limit=40&top=250`,
      `/api/wcl/guild/${guildId}/death-encounter-heatmap?limit=25`,
      `/api/wcl/guild/${guildId}/active-roster?limit=40&top=250&maxRhPastEvents=0`,
      `/api/wcl/guild/${guildId}/loot-received?limit=40`,
      `/api/wcl/guild/${guildId}/first-clear-participants?limit=150`,
      "/api/voting/hall-of-fame",
    ];
    const results = [];
    for (const rel of syncPaths) {
      const joiner = rel.includes("?") ? "&" : "?";
      const url = `${origin}${rel}${joiner}snapshot_refresh=1`;
      try {
        const response = await fetch(url, { method: "GET" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || (body && typeof body === "object" && body.ok === false)) {
          throw new Error(body?.error || `Request failed (${response.status})`);
        }
        const key = publicSnapshotKeyFromRequest({
          path: rel.split("?")[0],
          query: Object.fromEntries(new URL(url).searchParams.entries()),
        });
        await upsertPublicSnapshotForKey(key, body);
        results.push({ path: rel, ok: true });
      } catch (error) {
        results.push({ path: rel, ok: false, error: error?.message || "Sync failed" });
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    return res.json({
      ok: okCount > 0,
      syncedAt: Date.now(),
      okCount,
      failCount: results.length - okCount,
      results,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to sync public snapshot" });
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

app.post("/api/analytics/track", async (req, res) => {
  try {
    await ensureAnalyticsStore();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const type = String(body.type || "pageview").trim().toLowerCase();
    const pathVal = String(body.path || "/").trim();
    const title = String(body.title || "").trim().slice(0, 160);
    const referrer = String(body.referrer || "").trim().slice(0, 220);
    const sessionId = String(body.sessionId || "").trim().slice(0, 120);
    if (!pathVal.startsWith("/")) {
      return res.status(400).json({ ok: false, error: "Invalid path" });
    }
    if (!["pageview", "event"].includes(type)) {
      return res.status(400).json({ ok: false, error: "Invalid analytics type" });
    }
    await appendAnalyticsEvent({
      at: Date.now(),
      type,
      path: pathVal,
      title,
      referrer,
      sessionId,
    });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to track analytics" });
  }
});

app.get("/api/admin/analytics/summary", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    await ensureAnalyticsStore();
    const days = Number(req.query.days || 30);
    return res.json(analyticsSummary({ days }));
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load analytics summary" });
  }
});

app.get("/api/admin/subscribers", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    await ensureDiscordDmSubscribersStore();
    const rows = Object.values(discordDmSubscribersState.subscribersByUserId || {})
      .map((row) => ({
        userId: String(row?.userId || ""),
        username: String(row?.username || ""),
        globalName: String(row?.globalName || ""),
        subscribed: Boolean(row?.subscribed),
        subscribedAt: Number(row?.subscribedAt || 0),
        updatedAt: Number(row?.updatedAt || 0),
      }))
      .filter((row) => row.userId)
      .sort((a, b) => Number(b.subscribedAt || b.updatedAt || 0) - Number(a.subscribedAt || a.updatedAt || 0));

    return res.json({
      ok: true,
      total: rows.length,
      subscribed: rows.filter((r) => r.subscribed).length,
      rows,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load subscribers" });
  }
});

app.get("/api/admin/hof-notes", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    await ensureHofNotesStore();
    const hallOfFame = await getHallOfFameForGuild(votingGuildId, 24);
    let rows = hallOfFame.map((row) => {
      const winnerName = String(row?.winnerName || "").trim();
      const raidCode = String(row?.raidCode || "").trim();
      const winnerRaidKey = normalizeHofWinnerRaidKey(raidCode, winnerName);
      const note = winnerRaidKey ? hofNotesState.byWinnerRaidKey[winnerRaidKey] : null;
      return {
        winnerRaidKey,
        winnerName,
        raidCode,
        raidName: String(row?.raidName || row?.raidCode || "").trim(),
        raidStartTime: Number(row?.raidStartTime || 0),
        quote: String(note?.quote || row?.customQuote || ""),
        updatedAt: Number(note?.updatedAt || 0),
        updatedBy: String(note?.updatedBy || ""),
      };
    });
    if (!rows.length) {
      const now = Date.now();
      const mockRows = [
        {
          winnerName: "Highbullet",
          raidCode: "MOCK-SWP-HIGHBULLET",
          raidName: "Sunwell Plateau",
          raidStartTime: now - 7 * 24 * 60 * 60 * 1000,
        },
        {
          winnerName: "Glutelf",
          raidCode: "MOCK-BT-GLUTELF",
          raidName: "Black Temple",
          raidStartTime: now - 14 * 24 * 60 * 60 * 1000,
        },
      ];
      rows = mockRows.map((row) => {
        const winnerRaidKey = normalizeHofWinnerRaidKey(row.raidCode, row.winnerName);
        const note = winnerRaidKey ? hofNotesState.byWinnerRaidKey[winnerRaidKey] : null;
        return {
          winnerRaidKey,
          winnerName: row.winnerName,
          raidCode: row.raidCode,
          raidName: row.raidName,
          raidStartTime: Number(row.raidStartTime || 0),
          quote: String(note?.quote || ""),
          updatedAt: Number(note?.updatedAt || 0),
          updatedBy: String(note?.updatedBy || ""),
        };
      });
    }
    return res.json({ ok: true, rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load hall of fame notes" });
  }
});

app.put("/api/admin/hof-notes", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const winnerRaidKey = String(req.body?.winnerRaidKey || "").trim().slice(0, 220);
    const quote = String(req.body?.quote || "")
      .trim()
      .slice(0, 320);
    if (!winnerRaidKey) {
      return res.status(400).json({ ok: false, error: "winnerRaidKey is required" });
    }
    await ensureHofNotesStore();
    const actor =
      String(session?.user?.globalName || "").trim() || String(session?.user?.username || "").trim() || "admin";
    hofNotesWriteChain = hofNotesWriteChain.catch(() => {}).then(async () => {
      hofNotesState.byWinnerRaidKey[winnerRaidKey] = {
        quote,
        updatedAt: Date.now(),
        updatedBy: actor,
      };
      await persistHofNotesStore();
    });
    await hofNotesWriteChain;
    return res.json({ ok: true, winnerRaidKey, quote });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to save hall of fame note" });
  }
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
    await ensureRhWclLinksStore();
    const session = getSessionFromRequest(req);
    const userId = String(session?.user?.id || "").trim();
    let catalogMaps = { byId: new Map(), byNameLower: new Map() };
    try {
      catalogMaps = await getNetherVortexCraftableCatalogMaps();
    } catch {
      // Still return rows; per-line counts fall back to stored values.
    }
    const rawEntries = [...(netherVortexState.entries || [])];
    // Resolve every row's Discord-ID → RH-signup-name in parallel before the
    // sync map step so a slow disk-cache load on the very first request does
    // not serialize across rows.
    const rhNamesByUserId = new Map(
      await Promise.all(
        rawEntries.map(async (row) => {
          const id = String(row?.userId || "");
          if (!id) return [id, ""];
          const rhName = await resolveRaidHelperNameByDiscordUserId(id);
          return [id, rhName];
        })
      )
    );
    const rows = rawEntries
      .map((row) => {
        const discordName = String(row.displayName || "Unknown");
        const userId = String(row.userId || "");
        const rhSignupName = rhNamesByUserId.get(userId) || "";
        // Lookup chain (most stable first):
        //   1. Direct Discord-ID match against rh-wcl-character-links.json
        //   2. RH-signup-name match (canonical, Discord-ID-keyed via cache)
        //   3. Discord display-name match (legacy fallback)
        const linked =
          resolveLinkedWowCharacterByDiscordUserId(userId) ||
          (rhSignupName && resolveLinkedWowCharacterFromRhWcl(rhSignupName)) ||
          resolveLinkedWowCharacterFromRhWcl(discordName);
        const characterName = String(linked || rhSignupName || discordName).trim() || discordName;
        const characterProfileUrl = linked ? raiderIoCharacterProfileWebUrl(linked) : "";
        return {
          userId,
          displayName: discordName,
          raidHelperName: rhSignupName || null,
          characterName,
          characterProfileUrl,
          neededCount: 0,
          items: enrichSanitizedNetherVortexItems(sanitizeNetherVortexItems(row.items), catalogMaps),
          updatedAt: Number(row.updatedAt || 0),
        };
      })
      .filter((row) => row.userId)
      .filter((row) => netherVortexEntryTotal(row) > 0)
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
    const neededCount = 0;
    let items = sanitizeNetherVortexItems(req.body?.items);
    try {
      const catalogMaps = await getNetherVortexCraftableCatalogMaps();
      items = enrichSanitizedNetherVortexItems(items, catalogMaps);
    } catch {
      // Catalog unavailable — persist sanitized rows only.
    }
    await ensureNetherVortexStore();
    const userId = String(session.user.id || "");
    const displayName = String(session.user.globalName || session.user.username || "Unknown");
    const updatedAt = Date.now();

    // Source of truth: SQLite. Writes through to the legacy JSON for backup +
    // any code still reading `netherVortexState`.
    try {
      nvUpsertCurrent({ userId, displayName, items, neededCount, updatedAt });
    } catch (error) {
      console.warn("[item-needs-db] nvUpsertCurrent failed:", error?.message || error);
    }

    // Recover from a prior rejected persist so the queue does not stay broken forever.
    netherVortexWriteChain = netherVortexWriteChain.catch(() => {}).then(async () => {
      const prev = netherVortexState.entries || [];
      const idx = prev.findIndex((row) => String(row?.userId || "") === userId);
      if (!items.length) {
        if (idx >= 0) prev.splice(idx, 1);
        netherVortexState.entries = prev;
        await persistNetherVortexStore();
        return;
      }
      const nextEntry = { userId, displayName, neededCount, items, updatedAt };
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
    const editor = {
      userId: String(session.user?.id || "") || null,
      displayName:
        String(session.user?.globalName || session.user?.username || "").trim() || null,
    };
    await setP2MaterialCurrent(materialId, current, editor);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to update material" });
  }
});

/**
 * Admin-only audit feed for Item Need Submissions.
 *
 * `?kind=nv|p2` selects which feed to read; `nv` returns Nether Vortex
 * submissions (latest 200 PUTs across all users with their items), `p2`
 * returns every change to a P2 raid material count.
 */
app.get("/api/admin/item-needs/history", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  const kind = String(req.query?.kind || "nv").toLowerCase();
  const limit = Math.max(1, Math.min(2000, Number(req.query?.limit) || 200));
  try {
    if (kind === "p2") {
      const materialId = req.query?.materialId ? String(req.query.materialId) : undefined;
      return res.json({ ok: true, kind: "p2", rows: p2GetHistory({ limit, materialId }) });
    }
    const userId = req.query?.userId ? String(req.query.userId) : undefined;
    return res.json({ ok: true, kind: "nv", rows: nvGetHistory({ limit, userId }) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to read history" });
  }
});

/**
 * Force-refresh of the Discord-ID → RH-signup-name cache. Useful after a fresh
 * Raid Helper signup that added a new Discord user we haven't seen before;
 * otherwise the cache picks them up automatically on the next 1h TTL refresh.
 *
 * GET  → return current cache snapshot (size + sample entries) for diagnosis.
 * POST → trigger a refresh and return the resulting snapshot.
 */
app.get("/api/admin/discord-rh-name-cache", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  try {
    await ensureDiscordIdToRhNameCacheLoaded();
    const byUserId = discordIdToRhNameState?.byUserId || {};
    const entries = Object.entries(byUserId)
      .map(([userId, v]) => ({ userId, rhName: v?.rhName || "", lastSeenAt: Number(v?.lastSeenAt || 0) }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return res.json({
      ok: true,
      updatedAt: Number(discordIdToRhNameState?.updatedAt || 0),
      total: entries.length,
      sample: entries.slice(0, 50),
      refreshing: Boolean(discordIdToRhNameRefreshInflight),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to read cache" });
  }
});

app.post("/api/admin/discord-rh-name-cache/refresh", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  try {
    await refreshDiscordIdToRhNameCache();
    const total = Object.keys(discordIdToRhNameState?.byUserId || {}).length;
    return res.json({
      ok: true,
      total,
      updatedAt: Number(discordIdToRhNameState?.updatedAt || 0),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to refresh cache" });
  }
});

/* =============================================================================
 * Identity diff — admin spot-check that the new canonical `users` /
 * `user_characters` tables are in sync with the legacy JSON sources during
 * Phase 1 of the canonical-user database migration. Reports rows missing
 * from each side, plus per-row drift on Discord id, RH name, and guild role.
 *
 * Read-only; never mutates either side. Designed for low call frequency
 * (admin clicks "diff", not polled).
 * ============================================================================= */
app.get("/api/admin/identity-diff", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  try {
    await ensureRhWclLinksStore();
    await ensureDiscordIdToRhNameCacheLoaded();

    const links = Array.isArray(rhWclLinksState?.links) ? rhWclLinksState.links : [];
    const byUserId = discordIdToRhNameState?.byUserId || {};

    /** Map JSON link rows into a compact, comparable shape keyed by RH key. */
    const jsonLinksByKey = new Map();
    for (const link of links) {
      const rhName = String(link?.raidHelperName || "").trim();
      if (!rhName) continue;
      const key = identityRhNameKey(rhName);
      if (!key) continue;
      jsonLinksByKey.set(key, {
        raidHelperName: rhName,
        raidHelperNameKey: key,
        discordUserId: sanitizeDiscordUserId(link?.discordUserId) || null,
        guildRole: link?.guildRole ? String(link.guildRole).trim() : null,
        wclCharacterNames: Array.isArray(link?.wclCharacterNames)
          ? link.wclCharacterNames.map((n) => String(n || "").trim()).filter(Boolean)
          : [],
      });
    }

    /** Map cache rows into a compact, comparable shape keyed by Discord id. */
    const cacheByDiscordId = new Map();
    for (const [discordUserId, entry] of Object.entries(byUserId)) {
      const id = sanitizeDiscordUserId(discordUserId);
      if (!id) continue;
      cacheByDiscordId.set(id, {
        discordUserId: id,
        rhName: entry?.rhName ? String(entry.rhName).trim() : "",
        rhNameKey: entry?.rhName ? identityRhNameKey(entry.rhName) : "",
      });
    }

    const dbUsers = identityUserListAll();
    const dbUsersByDiscordId = new Map();
    const dbUsersByRhKey = new Map();
    for (const u of dbUsers) {
      if (u.discordUserId) dbUsersByDiscordId.set(u.discordUserId, u);
      if (u.raidHelperNameKey) dbUsersByRhKey.set(u.raidHelperNameKey, u);
    }

    const missingFromDb = []; // JSON has it, SQLite doesn't
    const missingFromJson = []; // SQLite has it, JSON doesn't
    const drift = []; // both sides have it but fields disagree

    for (const [rhKey, jl] of jsonLinksByKey) {
      let dbUser = jl.discordUserId ? dbUsersByDiscordId.get(jl.discordUserId) : null;
      if (!dbUser) dbUser = dbUsersByRhKey.get(rhKey) || null;
      if (!dbUser) {
        missingFromDb.push({ source: "rh-wcl-links", ...jl });
        continue;
      }
      const dbCharacterNames = identityCharactersGetByUserId(dbUser.id).map((c) => c.characterName);
      const driftFields = {};
      if ((jl.discordUserId || null) !== (dbUser.discordUserId || null)) {
        driftFields.discordUserId = { json: jl.discordUserId, db: dbUser.discordUserId };
      }
      if ((jl.raidHelperName || null) !== (dbUser.raidHelperName || null)) {
        driftFields.raidHelperName = { json: jl.raidHelperName, db: dbUser.raidHelperName };
      }
      if ((jl.guildRole || null) !== (dbUser.guildRole || null)) {
        driftFields.guildRole = { json: jl.guildRole, db: dbUser.guildRole };
      }
      const missingChars = jl.wclCharacterNames.filter((n) => {
        const k = identityRhNameKey(n);
        return k && !dbCharacterNames.some((c) => identityRhNameKey(c) === k);
      });
      if (missingChars.length) driftFields.missingCharacters = missingChars;
      if (Object.keys(driftFields).length) {
        drift.push({
          source: "rh-wcl-links",
          rhKey,
          dbUserId: dbUser.id,
          json: jl,
          db: { ...dbUser, characterNames: dbCharacterNames },
          fields: driftFields,
        });
      }
    }

    for (const [discordId, cacheRow] of cacheByDiscordId) {
      const dbUser = dbUsersByDiscordId.get(discordId);
      if (!dbUser) {
        missingFromDb.push({ source: "discord-id-cache", ...cacheRow });
        continue;
      }
      const driftFields = {};
      if ((cacheRow.rhName || null) !== (dbUser.raidHelperName || null)) {
        driftFields.raidHelperName = { json: cacheRow.rhName, db: dbUser.raidHelperName };
      }
      if (Object.keys(driftFields).length) {
        drift.push({
          source: "discord-id-cache",
          discordUserId: discordId,
          dbUserId: dbUser.id,
          json: cacheRow,
          db: dbUser,
          fields: driftFields,
        });
      }
    }

    for (const u of dbUsers) {
      const matchedByLink = u.raidHelperNameKey && jsonLinksByKey.has(u.raidHelperNameKey);
      const matchedByCache = u.discordUserId && cacheByDiscordId.has(u.discordUserId);
      if (!matchedByLink && !matchedByCache) {
        missingFromJson.push({
          dbUserId: u.id,
          discordUserId: u.discordUserId,
          raidHelperName: u.raidHelperName,
          displayName: u.displayName,
        });
      }
    }

    return res.json({
      ok: true,
      counts: {
        jsonRhLinks: jsonLinksByKey.size,
        jsonDiscordCache: cacheByDiscordId.size,
        dbUsers: dbUsers.length,
        missingFromDb: missingFromDb.length,
        missingFromJson: missingFromJson.length,
        drift: drift.length,
      },
      // Cap each list to keep the response sane for the admin UI even if
      // something has gone catastrophically wrong with the sync.
      missingFromDb: missingFromDb.slice(0, 200),
      missingFromJson: missingFromJson.slice(0, 200),
      drift: drift.slice(0, 200),
    });
  } catch (error) {
    console.error("[identity-diff] failed:", error?.stack || error);
    return res.status(500).json({ ok: false, error: error?.message || "identity-diff failed" });
  }
});

/* =============================================================================
 * POST /api/admin/db/backup
 *
 * Take a point-in-time copy of `data/item-needs.sqlite` to
 * `data/backups/item-needs-<timestamp>.sqlite` using SQLite's `VACUUM INTO`.
 * Atomic, low-overhead — the DB is fully usable while the copy runs.
 * Run before each Phase cuts over so we always have a known-good fallback.
 * ============================================================================= */
app.post("/api/admin/db/backup", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  try {
    const backupsDir = path.join(dataDir, "backups");
    await mkdir(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetPath = path.join(backupsDir, `item-needs-${stamp}.sqlite`);
    const result = backupItemNeedsDb(targetPath);
    return res.json({
      ok: true,
      targetPath: result.targetPath,
      sizeBytes: result.sizeBytes,
      filename: path.basename(result.targetPath),
      createdAt: Date.now(),
    });
  } catch (error) {
    console.error("[db-backup] failed:", error?.stack || error);
    return res.status(500).json({ ok: false, error: error?.message || "backup failed" });
  }
});

/* =============================================================================
 * GET /api/admin/cutover-readiness
 *
 * Phase 8 safety gate. Reports a row count per materialised table. A `0`
 * for any table backing a cutover read path means the corresponding sync
 * worker has not produced rows yet, so legacy fallback is still serving
 * production traffic — it is NOT safe to remove dual-write JSON writers
 * for that store. The admin UI surfaces this so the cleanup phase only
 * runs once every count is non-zero.
 * ============================================================================= */
app.get("/api/admin/cutover-readiness", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  try {
    const counts = cutoverReadinessCounts();
    const flags = {
      MATERIALIZE_IDENTITY: materializeIdentityEnabled(),
      MATERIALIZE_BADGES: materializeBadgesEnabled(),
      MATERIALIZE_ATTENDANCE: materializeAttendanceEnabled(),
      MATERIALIZE_LOOT: materializeLootEnabled(),
      MATERIALIZE_PHASE3: materializePhase3Enabled(),
      MATERIALIZE_RAID_APPEARANCES: materializeRaidAppearancesEnabled(),
    };
    const ready = Object.values(counts).every(
      (v) => typeof v === "number" && v > 0
    );
    let raidAppearancesContext = null;
    try {
      const distinctReports = raidAppearancesDistinctReportCount();
      const selectedReportCodes = Array.from(
        new Set(
          (gargulLootState?.selectedReportCodes || [])
            .map((x) => String(x || "").trim())
            .filter(Boolean)
        )
      );
      const counts = raidAppearancesCountsByUser(
        selectedReportCodes.length ? { reportCodes: selectedReportCodes } : {}
      );
      raidAppearancesContext = {
        distinctReports,
        selectedReportCodes: selectedReportCodes.length,
        usersWithCount: counts.size,
        cutoverActive: materializeRaidAppearancesEnabled() && counts.size > 0,
        countsScope: selectedReportCodes.length ? "admin-event-management" : "all-known-reports",
      };
    } catch (error) {
      raidAppearancesContext = { error: error?.message || "raid_appearances inspect failed" };
    }
    return res.json({
      ok: true,
      ready,
      counts,
      flags,
      raidAppearances: raidAppearancesContext,
      checkedAt: Date.now(),
      note: ready
        ? "Every materialised table is non-empty. Safe to proceed with Phase 8 cleanup once a snapshot of legacy JSON has been taken."
        : "At least one materialised table is empty. Trigger the matching sync task before removing dual-write writers.",
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "readiness check failed" });
  }
});

/* =============================================================================
 * GET /api/admin/database/users
 * GET /api/admin/database/users/:userId
 *
 * Browseable view of the canonical user database. Backs the "Database"
 * sub-nav tab on the admin page. Returns each canonical `users` row
 * with its linked `user_characters`, plus per-user materialised counts
 * (parses, badges, loot, attendance) so an admin can spot-check that
 * the sync workers populated the right rows for the right user.
 * ============================================================================= */
app.get("/api/admin/database/users", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  try {
    const search = String(req.query.q || "").trim().toLowerCase();
    const users = identityUserListAll();
    const filtered = !search
      ? users
      : users.filter((u) => {
          const haystack = [
            u.discordUserId,
            u.raidHelperName,
            u.displayName,
            u.guildRole,
          ]
            .map((x) => String(x || "").toLowerCase())
            .join(" ");
          return haystack.includes(search);
        });
    const enriched = filtered.map((u) => {
      const characters = identityCharactersGetByUserId(u.id);
      const mainCharacter = characters.find((c) => c.id === u.mainCharacterId) || null;
      return {
        id: u.id,
        discordUserId: u.discordUserId || null,
        raidHelperName: u.raidHelperName || null,
        displayName: u.displayName || null,
        guildRole: u.guildRole || null,
        mainCharacterId: u.mainCharacterId || null,
        mainCharacterName: mainCharacter?.characterName || null,
        pictureFilename: u.pictureFilename || null,
        pictureUpdatedAt: u.pictureUpdatedAt || null,
        firstSeenAt: u.firstSeenAt || null,
        lastSeenAt: u.lastSeenAt || null,
        isAuthenticated: !!u.isAuthenticated,
        characterCount: characters.length,
        characters: characters.map((c) => ({
          id: c.id,
          characterName: c.characterName,
          wowClass: c.wowClass || null,
          wowSpec: c.wowSpec || null,
          realm: c.realm || null,
          isMain: !!c.isMain,
          discoveredVia: c.discoveredVia || null,
          firstSeenAt: c.firstSeenAt || null,
          lastSeenAt: c.lastSeenAt || null,
        })),
      };
    });
    return res.json({
      ok: true,
      total: users.length,
      shown: enriched.length,
      users: enriched,
      checkedAt: Date.now(),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "database load failed" });
  }
});

app.get("/api/admin/database/users/:userId", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ ok: false, error: "userId must be a positive integer" });
  }
  try {
    const user = identityUserGetById(userId);
    if (!user) return res.status(404).json({ ok: false, error: "user not found" });
    const characters = identityCharactersGetByUserId(user.id);
    const characterIds = characters.map((c) => c.id);
    let parses = [];
    let loot = [];
    let badges = [];
    try {
      parses = parseSummaryGetByUserId(user.id);
    } catch {
      parses = [];
    }
    try {
      loot = lootAwardsGetByUserId(user.id);
    } catch {
      loot = [];
    }
    try {
      badges = badgeStateGetByUserId(user.id);
    } catch {
      badges = [];
    }
    return res.json({
      ok: true,
      user,
      characters,
      characterIds,
      materialised: {
        parses,
        loot,
        badges,
      },
      checkedAt: Date.now(),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "database load failed" });
  }
});

/* =============================================================================
 * GET  /api/admin/sync                — observability: every task's status
 * POST /api/admin/sync/:taskId        — trigger one task now (single-flight)
 *
 * The sync framework lives in `lib/sync/runner.mjs`. Tasks are registered
 * once at startup and re-run on a fixed cadence; this endpoint is for the
 * admin UI to surface lag, errors, and manual reruns. Response shape is
 * stable across phase rollouts.
 * ============================================================================= */
app.get("/api/admin/sync", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  try {
    return res.json({ ok: true, tasks: syncRunnerSnapshot() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "sync snapshot failed" });
  }
});

app.post("/api/admin/sync/:taskId", async (req, res) => {
  const session = requireAdminSession(req, res);
  if (!session) return;
  const taskId = String(req.params?.taskId || "").trim();
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId required" });
  const known = listSyncTasks().some((t) => t.id === taskId);
  if (!known) return res.status(404).json({ ok: false, error: `unknown task '${taskId}'` });
  try {
    const force = String(req.query?.force || "").trim() === "1";
    if (!force && isSyncTaskRunning(taskId)) {
      return res.json({ ok: true, skipped: true, reason: "already running" });
    }
    const result = await runSyncTaskNow(taskId, { force });
    return res.json({ ok: true, taskId, ...result });
  } catch (error) {
    console.error(`[admin-sync] '${taskId}' failed:`, error?.stack || error);
    return res.status(500).json({ ok: false, error: error?.message || "sync run failed" });
  }
});

/* =============================================================================
 * Profiles — per-Discord-user profile picture, main-character pick, badge view.
 * Storage:
 *   - Metadata: SQLite `user_profiles` / `user_profile_history` tables.
 *   - Picture bytes: `<dataDir>/profile-pictures/<userId>.<ext>` on disk.
 * ============================================================================= */

const profilePicturesDir = path.join(dataDir, "profile-pictures");
mkdirSync(profilePicturesDir, { recursive: true });

const PROFILE_PICTURE_MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const PROFILE_PICTURE_ALLOWED_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/** Magic-byte sniff so we don't trust the client-declared mime when persisting. */
function detectImageMimeFromBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  return null;
}

function profilePictureFilenameFor(userId, ext) {
  const safe = String(userId).replace(/[^0-9]/g, "");
  return `${safe || "user"}.${ext}`;
}

async function safeUnlinkProfilePicture(filename) {
  if (!filename) return;
  try {
    await unlink(path.join(profilePicturesDir, filename));
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn("[profile] failed to unlink old picture:", err?.message || err);
    }
  }
}

/**
 * WoW characters this Discord user can pick as their "main". Pulls from the
 * Account Assignment table (`rh-wcl-character-links.json`) — we search by
 * Discord ID first (canonical) then fall back to the legacy display-name
 * match for rows that haven't been backfilled yet.
 */
function listLinkedWowCharactersForDiscordUserId(userId, displayName) {
  const id = sanitizeDiscordUserId(userId);
  if (materializeIdentityEnabled()) {
    try {
      const fromDb = identityListLinkedCharacterNames({ discordUserId: id, displayName });
      if (Array.isArray(fromDb)) return fromDb;
    } catch (error) {
      console.warn("[identity-cutover] listLinkedWowCharactersForDiscordUserId fallback:", error?.message || error);
    }
  }
  const links = Array.isArray(rhWclLinksState?.links) ? rhWclLinksState.links : [];
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const name = String(raw || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  // Profile main character is the user's explicit declaration of "this is me on
  // the website". Treat it as the most authoritative name for badge matching:
  // works even when their Account Assignment row uses a Discord nick as
  // `raidHelperName` and has an empty `wclCharacterNames` (the common case).
  if (id) {
    try {
      const profile = profileGetByUserId(id);
      const main = String(profile?.mainCharacterName || "").trim();
      if (main) push(main);
    } catch {
      /* profile DB optional */
    }
  }

  for (const link of links) {
    if (id && sanitizeDiscordUserId(link?.discordUserId) === id) {
      for (const cn of Array.isArray(link?.wclCharacterNames) ? link.wclCharacterNames : []) push(cn);
      const rh = String(link?.raidHelperName || "").trim();
      if (rh) push(rh);
    }
  }
  if (!out.length) {
    const dnKey = normalizeRaidHelperDisplayKey(String(displayName || ""));
    for (const link of links) {
      const rhKey = normalizeRaidHelperDisplayKey(String(link?.raidHelperName || ""));
      if (rhKey && rhKey === dnKey) {
        for (const cn of Array.isArray(link?.wclCharacterNames) ? link.wclCharacterNames : []) push(cn);
        push(link?.raidHelperName);
      }
    }
  }
  return out;
}

/** Raid-count milestones: distinct WCL guild raid reports (admin Event Management scope); see highestRaidMilestoneThresholdMet. */
const RAID_MILESTONE_THRESHOLDS = [5, 10, 25, 50, 100];

/** Largest milestone in {@link RAID_MILESTONE_THRESHOLDS} that `count` satisfies, or 0. */
function highestRaidMilestoneThresholdMet(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0) return 0;
  for (const t of [...RAID_MILESTONE_THRESHOLDS].sort((a, b) => b - a)) {
    if (n >= t) return t;
  }
  return 0;
}

/**
 * Catalog of every badge surfaced anywhere on the site, grouped by category so
 * the profile page can render an "all badges" overview. Mirrors the artwork
 * already shipped under `/public/images/`.
 */
const BADGE_CATALOG = [
  {
    id: "guild-rank",
    label: "Guild rank",
    description: "Manual officer ranks and attendance-based tiers.",
    badges: [
      { id: "guildlead", name: "PUG Lead", icon: "/images/guild-roles/guildlead.png", tier: "officer" },
      { id: "raidlead", name: "Raid Lead", icon: "/images/guild-roles/raidlead.png", tier: "officer" },
      { id: "core", name: "Core", icon: "/images/guild-roles/core.png", tier: "officer" },
      { id: "veteran", name: "Veteran", icon: "/images/guild-roles/veteran.png", tier: "attendance" },
      { id: "grunt", name: "Grunt", icon: "/images/guild-roles/grunt.png", tier: "attendance" },
      { id: "peon", name: "Peon", icon: "/images/guild-roles/peon.png", tier: "attendance" },
    ],
  },
  {
    id: "achievements",
    label: "Achievements",
    description: "Earned by appearing in WCL rosters / MVP votes.",
    badges: [
      { id: "best-time-participant", name: "Best time participant", icon: "/images/achievements/best-time-participant.png" },
      { id: "hall-of-fame", name: "MVP hall of fame", icon: "/images/achievements/hall-of-fame.png" },
      { id: "iron-attendance", name: "Iron attendance", icon: "/images/achievements/iron-attendance.png" },
      { id: "parsing-ceiling", name: "Parsing ceiling", icon: "/images/achievements/parsing-ceiling.png" },
      { id: "most-deaths-last-6-raids", name: "Most deaths (last 6)", icon: "/images/achievements/most-deaths-last-6-raids.png" },
    ],
  },
  {
    id: "first-clears",
    label: "First clears",
    description: "Listed in the ranked roster of the guild's first full clear of each raid.",
    badges: [
      { id: "kara-first-time-clear", name: "Karazhan first clear", icon: "/images/achievements/kara-first-time-clear.png" },
      { id: "gruul-first-time-clear", name: "Gruul first clear", icon: "/images/achievements/gruul-first-time-clear.png" },
      { id: "magtheridon-first-time-clear", name: "Magtheridon first clear", icon: "/images/achievements/magtheridon-first-time-clear.png" },
    ],
  },
  {
    id: "raid-milestones",
    label: "Raid milestones",
    description:
      "Distinct guild raid reports a player appeared in on Warcraft Logs, scoped to the admin Event Management selection (only WCL events explicitly marked as guild raids count). Attendance % still uses only the recent WCL window (WCL_ATTENDANCE_RECENT_RAIDS, default 6). Only the **highest** milestone tier reached is awarded and shown (e.g. at 12 events you earn the 10-raid badge, not 5 and 10 together).",
    badges: [
      { id: "raids-with-guild-5", name: "5 raids with the guild", icon: "/images/achievements/raids-with-guild-5.png" },
      { id: "raids-with-guild-10", name: "10 raids with the guild", icon: "/images/achievements/raids-with-guild-10.png" },
      { id: "raids-with-guild-25", name: "25 raids with the guild", icon: "/images/achievements/raids-with-guild-25.png" },
      { id: "raids-with-guild-50", name: "50 raids with the guild", icon: "/images/achievements/raids-with-guild-50.png" },
      { id: "raids-with-guild-100", name: "100 raids with the guild", icon: "/images/achievements/raids-with-guild-100.png" },
    ],
  },
];

/** Public profile getter — same payload shape we hand back from /me, minus the ability to upload. */
function publicProfileFromDb(userId) {
  const row = profileGetByUserId(userId);
  if (!row) return null;
  return {
    userId: row.userId,
    displayName: row.displayName,
    mainCharacterName: row.mainCharacterName,
    pictureUrl: row.pictureFilename ? `/api/profile/picture/${encodeURIComponent(row.userId)}?v=${row.pictureEtag || row.pictureUpdatedAt || 0}` : null,
    pictureUpdatedAt: row.pictureUpdatedAt,
    updatedAt: row.updatedAt,
  };
}

/** GET /api/profile/me — caller's own profile (auth required). */
app.get("/api/profile/me", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) return res.status(401).json({ ok: false, error: "Login required" });
  try {
    const userId = String(session.user.id);
    const displayName = String(session.user.globalName || session.user.username || "");
    let row = profileGetByUserId(userId);
    if (!row) {
      // Lazy-create an empty profile so the UI has something to bind to.
      row = profileSetMainCharacter({ userId, displayName, mainCharacterName: null });
    }
    const characters = listLinkedWowCharactersForDiscordUserId(userId, displayName);
    return res.json({
      ok: true,
      profile: publicProfileFromDb(userId),
      linkedCharacters: characters,
      pictureLimits: {
        maxBytes: PROFILE_PICTURE_MAX_BYTES,
        allowedMime: [...PROFILE_PICTURE_ALLOWED_MIME.keys()],
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load profile" });
  }
});

/** PUT /api/profile/me/main-character — pick which linked WCL character is "main". */
app.put("/api/profile/me/main-character", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) return res.status(401).json({ ok: false, error: "Login required" });
  try {
    const userId = String(session.user.id);
    const displayName = String(session.user.globalName || session.user.username || "");
    const requested = String(req.body?.mainCharacterName || "").trim();
    let chosen = null;
    if (requested) {
      const candidates = listLinkedWowCharactersForDiscordUserId(userId, displayName);
      const lower = requested.toLowerCase();
      chosen = candidates.find((c) => c.toLowerCase() === lower) || null;
      if (!chosen) {
        return res.status(400).json({
          ok: false,
          error: "Choose one of your linked Warcraft Logs characters. Add a mapping on /admin.html if it's missing.",
          linkedCharacters: candidates,
        });
      }
    }
    profileSetMainCharacter({ userId, displayName, mainCharacterName: chosen });
    return res.json({ ok: true, profile: publicProfileFromDb(userId) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to update main character" });
  }
});

/**
 * PUT /api/profile/me/picture — upload (raw body, `Content-Type` declares mime).
 * The page sends `fetch(..., { method: 'PUT', body: blob, headers: { 'Content-Type': type } })`
 * instead of multipart so we don't have to add a parser dependency.
 */
app.put(
  "/api/profile/me/picture",
  express.raw({ type: () => true, limit: PROFILE_PICTURE_MAX_BYTES }),
  async (req, res) => {
    const session = getSessionFromRequest(req);
    if (!session?.user?.id) return res.status(401).json({ ok: false, error: "Login required" });
    try {
      const declaredMime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ ok: false, error: "Empty upload" });
      }
      if (req.body.length > PROFILE_PICTURE_MAX_BYTES) {
        return res.status(413).json({ ok: false, error: "File too large (max 4 MB)" });
      }
      const sniffedMime = detectImageMimeFromBytes(req.body);
      const finalMime = sniffedMime || (PROFILE_PICTURE_ALLOWED_MIME.has(declaredMime) ? declaredMime : null);
      if (!finalMime || !PROFILE_PICTURE_ALLOWED_MIME.has(finalMime)) {
        return res.status(415).json({ ok: false, error: "Only JPEG, PNG, WebP, or GIF images are allowed." });
      }
      const ext = PROFILE_PICTURE_ALLOWED_MIME.get(finalMime);
      const userId = String(session.user.id);
      const displayName = String(session.user.globalName || session.user.username || "");
      const filename = profilePictureFilenameFor(userId, ext);

      // If switching extension, remove the old file (`.png` after `.jpg` etc.)
      const existing = profileGetByUserId(userId);
      if (existing?.pictureFilename && existing.pictureFilename !== filename) {
        await safeUnlinkProfilePicture(existing.pictureFilename);
      }
      await writeFile(path.join(profilePicturesDir, filename), req.body);
      const etag = createHash("sha256").update(req.body).digest("hex").slice(0, 16);
      profileSetPicture({
        userId,
        displayName,
        pictureFilename: filename,
        pictureMime: finalMime,
        pictureSizeBytes: req.body.length,
        pictureEtag: etag,
      });
      return res.json({ ok: true, profile: publicProfileFromDb(userId) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error?.message || "Failed to save picture" });
    }
  }
);

/** DELETE /api/profile/me/picture — clear the uploaded picture. */
app.delete("/api/profile/me/picture", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) return res.status(401).json({ ok: false, error: "Login required" });
  try {
    const userId = String(session.user.id);
    const displayName = String(session.user.globalName || session.user.username || "");
    const existing = profileGetByUserId(userId);
    if (existing?.pictureFilename) {
      await safeUnlinkProfilePicture(existing.pictureFilename);
    }
    profileSetPicture({ userId, displayName, pictureFilename: null });
    return res.json({ ok: true, profile: publicProfileFromDb(userId) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to remove picture" });
  }
});

/**
 * Send the picture bytes for one resolved profile metadata row. Shared
 * helper for both the Discord-id-keyed and canonical-id-keyed endpoints.
 */
function sendProfilePictureFromMeta(res, meta) {
  if (!meta?.pictureFilename) return res.status(404).end();
  const filePath = path.join(profilePicturesDir, meta.pictureFilename);
  // Aggressive caching keyed on the etag (URLs include `?v=<etag>`), so a new
  // upload changes the URL and side-steps any cached response.
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.setHeader("Content-Type", meta.pictureMime || "application/octet-stream");
  if (meta.pictureEtag) res.setHeader("ETag", `"${meta.pictureEtag}"`);
  return res.sendFile(filePath, (err) => {
    if (err) {
      if (!res.headersSent) res.status(404).end();
    }
  });
}

/**
 * GET /api/profile/picture/:userId — serve the stored picture bytes.
 * Public (no auth) so leaderboard / Hall of Fame can render avatars without
 * requiring viewers to be logged in. ETag-based for efficient revalidation.
 *
 * Resolution order:
 *   1. Canonical `users.picture_filename` keyed by `discord_user_id`
 *      (canonical post-Phase-2 source).
 *   2. Legacy `user_profiles.picture_filename` keyed by Discord id (kept
 *      while dual-write is still in effect).
 */
app.get("/api/profile/picture/:userId", async (req, res) => {
  const userId = sanitizeDiscordUserId(req.params.userId);
  if (!userId) return res.status(400).end();
  if (materializeIdentityEnabled()) {
    try {
      const canonical = identityUserGetByDiscordId(userId);
      if (canonical?.pictureFilename) return sendProfilePictureFromMeta(res, canonical);
    } catch (error) {
      console.warn("[identity-cutover] picture-by-discord-id canonical lookup failed:", error?.message || error);
    }
  }
  const profile = profileGetByUserId(userId);
  return sendProfilePictureFromMeta(res, profile);
});

/**
 * GET /api/profile/picture/by-user/:dbUserId — canonical-id keyed picture
 * lookup. Used by `/api/profiles/by-character-names` when a raider has an
 * uploaded picture but no Discord login yet (so we can't use the legacy
 * `/api/profile/picture/<discord-id>` route). Public, ETag-cached.
 */
app.get("/api/profile/picture/by-user/:dbUserId", async (req, res) => {
  const dbUserId = Number(req.params.dbUserId);
  if (!Number.isInteger(dbUserId) || dbUserId <= 0) return res.status(400).end();
  try {
    const canonical = identityUserGetById(dbUserId);
    if (!canonical?.pictureFilename) return res.status(404).end();
    return sendProfilePictureFromMeta(res, canonical);
  } catch (error) {
    console.warn("[identity-cutover] picture-by-user lookup failed:", error?.message || error);
    return res.status(500).end();
  }
});

/**
 * GET /api/profiles/by-character-names?names=A,B,C — fallback lookup for the
 * leaderboard / Hall of Fame when a player row has no `discordUserId` yet
 * (e.g. the Account Assignment table hasn't been backfilled with the user's
 * Discord ID). Resolves a profile picture for a WoW character name via:
 *   1. Direct match on `user_profiles.main_character_name`.
 *   2. Reverse-lookup through `rhWclLinksState`: any link that lists the
 *      requested name in `wclCharacterNames` → take its `discordUserId`
 *      → fetch the matching `user_profiles` row.
 * Public, capped at 200 names.
 */
app.get("/api/profiles/by-character-names", async (req, res) => {
  try {
    const raw = String(req.query?.names || "");
    const namesIn = raw
      .split(",")
      .map((n) => String(n || "").trim())
      .filter(Boolean)
      .slice(0, 200);
    if (!namesIn.length) return res.json({ ok: true, profiles: {} });

    if (materializeIdentityEnabled()) {
      try {
        const profiles = identityResolveProfilesByCharacterNames(namesIn);
        return res.json({ ok: true, profiles });
      } catch (error) {
        console.warn("[identity-cutover] /api/profiles/by-character-names fallback:", error?.message || error);
      }
    }

    const wantedKeys = new Map();
    for (const name of namesIn) {
      const key = normalizeRaidHelperDisplayKey(name);
      if (!key || wantedKeys.has(key)) continue;
      wantedKeys.set(key, name);
    }
    if (!wantedKeys.size) return res.json({ ok: true, profiles: {} });

    // Pull every profile that has an uploaded picture (small set, opt-in).
    // We walk it once, matching against (a) its main character name and
    // (b) every WCL character name on the Account Assignment row that
    // shares the user's Discord id. First match per requested name wins.
    const profilesWithPicture = profileGetAllWithPicture();
    if (!profilesWithPicture.length) return res.json({ ok: true, profiles: {} });

    const links = Array.isArray(rhWclLinksState?.links) ? rhWclLinksState.links : [];
    const linksByDiscordId = new Map();
    for (const link of links) {
      const id = sanitizeDiscordUserId(link?.discordUserId);
      if (!id) continue;
      if (!linksByDiscordId.has(id)) linksByDiscordId.set(id, []);
      linksByDiscordId.get(id).push(link);
    }

    const profileByMatchKey = new Map();
    const remember = (key, row) => {
      if (!key || profileByMatchKey.has(key)) return;
      profileByMatchKey.set(key, row);
    };
    for (const row of profilesWithPicture) {
      const mainKey = normalizeRaidHelperDisplayKey(String(row.mainCharacterName || ""));
      if (mainKey) remember(mainKey, row);
      const myLinks = linksByDiscordId.get(row.userId) || [];
      for (const link of myLinks) {
        remember(normalizeRaidHelperDisplayKey(String(link?.raidHelperName || "")), row);
        for (const cn of Array.isArray(link?.wclCharacterNames) ? link.wclCharacterNames : []) {
          remember(normalizeRaidHelperDisplayKey(String(cn || "")), row);
        }
      }
    }

    const out = {};
    for (const [key, originalName] of wantedKeys.entries()) {
      const row = profileByMatchKey.get(key);
      if (row?.pictureFilename) {
        out[originalName] = {
          userId: row.userId,
          mainCharacterName: row.mainCharacterName,
          pictureUrl: `/api/profile/picture/${encodeURIComponent(row.userId)}?v=${row.pictureEtag || row.pictureUpdatedAt || 0}`,
        };
      }
    }
    return res.json({ ok: true, profiles: out });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load profiles" });
  }
});

/**
 * GET /api/profiles/by-user-ids?ids=A,B,C — batch metadata lookup for the
 * leaderboard / Hall of Fame portrait override. Public, capped at 200 ids.
 */
app.get("/api/profiles/by-user-ids", async (req, res) => {
  try {
    const raw = String(req.query?.ids || "");
    const ids = raw
      .split(",")
      .map((x) => sanitizeDiscordUserId(x))
      .filter(Boolean)
      .slice(0, 200);
    if (!ids.length) return res.json({ ok: true, profiles: {} });
    const rows = profileGetByUserIds(ids);
    const out = {};
    for (const row of rows) {
      out[row.userId] = {
        userId: row.userId,
        mainCharacterName: row.mainCharacterName,
        pictureUrl: row.pictureFilename
          ? `/api/profile/picture/${encodeURIComponent(row.userId)}?v=${row.pictureEtag || row.pictureUpdatedAt || 0}`
          : null,
      };
    }
    return res.json({ ok: true, profiles: out });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load profiles" });
  }
});

/** GET /api/profile/me/badges — full catalog with obtained / not obtained per badge. */
app.get("/api/profile/me/badges", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.user?.id) return res.status(401).json({ ok: false, error: "Login required" });
  try {
    const userId = String(session.user.id);
    const displayName = String(session.user.globalName || session.user.username || "");
    // Account Assignment store is loaded lazily; ensure it's hydrated so this
    // endpoint behaves the same on a cold boot as on a warm one.
    try {
      await ensureRhWclLinksStore();
    } catch {
      /* fall through with whatever's in memory */
    }
    const linkedCharacters = listLinkedWowCharactersForDiscordUserId(userId, displayName);

    // Phase 4 cutover: prefer materialised badge_state. Falls back to live
    // computation when the SQLite row is missing (cold boot before first
    // syncBadges run) or the env flag is off.
    if (materializeBadgesEnabled()) {
      try {
        const canonical = identityUserGetByDiscordId(userId);
        if (canonical?.id) {
          const states = badgeStateGetByUserId(canonical.id);
          if (states.length) {
            const stateById = new Map(states.map((s) => [s.badgeId, s]));
            let highestRaidMilestoneFromDb = 0;
            for (const t of [...RAID_MILESTONE_THRESHOLDS].sort((a, b) => b - a)) {
              const bid = `raids-with-guild-${t}`;
              if (stateById.get(bid)?.earned) {
                highestRaidMilestoneFromDb = t;
                break;
              }
            }
            const categories = BADGE_CATALOG.map((cat) => ({
              ...cat,
              badges: cat.badges.map((b) => {
                const st = stateById.get(b.id);
                let earned = !!st?.earned;
                if (String(b.id || "").startsWith("raids-with-guild-")) {
                  const tier = Number(String(b.id).replace("raids-with-guild-", ""));
                  earned =
                    highestRaidMilestoneFromDb > 0 &&
                    Number.isFinite(tier) &&
                    tier === highestRaidMilestoneFromDb;
                }
                return {
                  ...b,
                  earned,
                  firstEarnedAt: st?.firstEarnedAt || null,
                };
              }),
            }));
            return res.json({
              ok: true,
              source: "materialized",
              categories,
              linkedCharacters,
              lazyBadges: [
                "iron-attendance",
                "parsing-ceiling",
                "most-deaths-last-6-raids",
                "best-time-participant",
              ],
            });
          }
        }
      } catch (error) {
        console.warn("[badges] materialised read failed, falling back:", error?.message || error);
      }
    }

    const linkedKeys = new Set(linkedCharacters.map((c) => normalizeRaidHelperDisplayKey(c)).filter(Boolean));
    const links = Array.isArray(rhWclLinksState?.links) ? rhWclLinksState.links : [];
    const myRow = links.find((l) => sanitizeDiscordUserId(l?.discordUserId) === userId) || null;
    if (myRow?.raidHelperName) {
      const rk = normalizeRaidHelperDisplayKey(String(myRow.raidHelperName));
      if (rk) linkedKeys.add(rk);
    }
    for (const cn of Array.isArray(myRow?.wclCharacterNames) ? myRow.wclCharacterNames : []) {
      const ck = normalizeRaidHelperDisplayKey(String(cn || ""));
      if (ck) linkedKeys.add(ck);
    }
    // reproduce the *first-clear* and *MVP hall of fame* facts cheaply server-
    // side from existing stores. Other achievements (iron attendance, peak
    // ceiling, most deaths, best-time) require the rolling roster + WCL
    // computation we already cache for the leaderboard — return them as
    // "earned via leaderboard" so the client can lazily resolve from the
    // active-roster API on render. Keeping this simple ships the page today
    // without forcing a roster fetch on every profile load.
    const earned = new Set();

    // MVP hall of fame: any past round where this user's linked character
    // won the vote. `votingHallOfFame` aggregates rounds and surfaces the
    // single winner per round - same source the public Hall of Fame uses.
    try {
      await ensureVotingStore();
      const rounds = votingHallOfFame("", 200);
      for (const round of rounds) {
        const win = String(round?.winnerName || "").trim();
        if (!win) continue;
        if (linkedKeys.has(normalizeRaidHelperDisplayKey(win))) {
          earned.add("hall-of-fame");
          break;
        }
      }
    } catch {}

    // First clears: scan recent guild reports for the canonical first-clear
    // raids and check whether a linked character appeared in the ranked roster.
    try {
      const guildId = Number(eventsWclSpecIconGuildId() || votingGuildId);
      if (Number.isInteger(guildId) && guildId > 0 && linkedKeys.size) {
        const limit = Math.max(80, Number(wclAttendanceRecentRaidCount?.() || 80));
        const reports = await getFilteredGuildReportsForGuild(guildId, Math.min(wclMaxGuildReportsLimit(), limit));
        const firstClears = firstClearParticipantsByRaidFromReports(reports, [
          "Karazhan",
          "Gruul's Lair",
          "Magtheridon's Lair",
        ]);
        const matchAny = (group) => {
          const names = Array.isArray(group?.participants) ? group.participants : [];
          return names.some((n) => {
            const key = normalizeRaidHelperDisplayKey(String(n || ""));
            return key && linkedKeys.has(key);
          });
        };
        if (matchAny(firstClears?.["Karazhan"])) earned.add("kara-first-time-clear");
        if (matchAny(firstClears?.["Gruul's Lair"])) earned.add("gruul-first-time-clear");
        if (matchAny(firstClears?.["Magtheridon's Lair"])) earned.add("magtheridon-first-time-clear");
      }
    } catch {}

    // Guild rank: derive from Account Assignment (`myRow` loaded above for linkedKeys).
    const guildRoleSlug = String(myRow?.guildRole || "Peon").toLowerCase().replace(/\s+/g, "-");
    if (guildRoleSlug === "guildlead" || guildRoleSlug === "puglead") earned.add("guildlead");
    else if (guildRoleSlug === "raidlead") earned.add("raidlead");
    else if (guildRoleSlug === "core") earned.add("core");
    else if (guildRoleSlug === "veteran") earned.add("veteran");
    else if (guildRoleSlug === "grunt") earned.add("grunt");
    else earned.add("peon");

    // Phase 9 cutover: raid milestone badges (5/10/25/50/100) are gated on
    // distinct WCL guild raid reports the user appeared in, scoped to the
    // admin Event Management selection. Falls back to the legacy Raid
    // Helper signup count if `raid_appearances` is empty (first deploy
    // before any sync) so the badges keep working during transition.
    try {
      let milestoneCount = 0;
      let milestoneSource = "rh-signups";
      const cutoverOn = materializeRaidAppearancesEnabled();
      if (cutoverOn) {
        try {
          const totalRows = raidAppearancesDistinctReportCount();
          if (totalRows > 0) {
            const canonical = identityUserGetByDiscordId(userId);
            if (canonical?.id) {
              const codes = Array.from(
                new Set(
                  (gargulLootState?.selectedReportCodes || [])
                    .map((x) => String(x || "").trim())
                    .filter(Boolean)
                )
              );
              const counts = raidAppearancesCountsByUser(codes.length ? { reportCodes: codes } : {});
              milestoneCount = Number(counts.get(canonical.id) || 0);
              milestoneSource = "raid_appearances";
            }
          }
        } catch {
          milestoneSource = "rh-signups";
        }
      }
      if (milestoneSource !== "raid_appearances") {
        try {
          const result = await countRaidHelperPrimarySignupsPerRhKey(0);
          const counts = result?.counts instanceof Map ? result.counts : null;
          if (counts) {
            for (const k of linkedKeys) {
              const c = Number(counts.get(k) || 0);
              if (c > milestoneCount) milestoneCount = c;
            }
          }
        } catch {
          /* RH count is best-effort here; badge sync will catch up next cycle */
        }
      }
      const highestT = highestRaidMilestoneThresholdMet(milestoneCount);
      if (highestT > 0) earned.add(`raids-with-guild-${highestT}`);
    } catch {}

    const categories = BADGE_CATALOG.map((cat) => ({
      ...cat,
      badges: cat.badges.map((b) => ({ ...b, earned: earned.has(b.id) })),
    }));
    return res.json({
      ok: true,
      categories,
      // Names the badge UI should match against when running the leaderboard's
      // client-side badge resolvers (iron attendance, parsing ceiling, most
      // deaths last 6, best-time participant). Includes the profile's explicit
      // main character + every linked WCL/Account-Assignment name.
      linkedCharacters,
      // Badge ids the client should resolve on top of the static catalog by
      // re-running `playerEarnedXxxBadge` against the active-roster + WCL
      // payloads the leaderboard already loads. Server cannot resolve these
      // cheaply because the source data is large + stale-while-revalidate.
      lazyBadges: [
        "iron-attendance",
        "parsing-ceiling",
        "most-deaths-last-6-raids",
        "best-time-participant",
      ],
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load badges" });
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
    const userId = session?.user?.id ? String(session.user.id) : "";
    const authenticated = Boolean(userId);

    const voting = await getCurrentVotingRoundCached(votingGuildId);
    if (!voting) {
      return res.status(404).json({ ok: false, error: "No recent tracked raid found" });
    }

    await ensureVotingStore();
    const votesByCandidate = getVotingTallies(voting.roundKey);
    const myVoteRow = authenticated ? getUserVote(voting.roundKey, userId) : null;

    const candidates = voting.candidates
      .map((c) => ({
        ...c,
        votes: Number(votesByCandidate.get(c.name) || 0),
      }))
      .sort((a, b) => b.votes - a.votes || b.dps - a.dps || a.name.localeCompare(b.name));

    return res.json({
      ok: true,
      authenticated,
      raid: {
        roundKey: voting.roundKey,
        code: voting.raidCode,
        name: voting.raidName,
        title: voting.title,
        startTime: voting.startTime,
      },
      myVote: myVoteRow?.candidateName || null,
      candidates,
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
      const rawCombatType = playerClassByName.get(k) || "";
      const className = englishClassDisplayFromWclCombatType(rawCombatType) || rawCombatType;
      return {
        name,
        className,
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

function absoluteUrlFromPublicBase(maybeUrl) {
  const raw = String(maybeUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith("/")) return "";
  let base = String(publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (!base || /localhost|127\.0\.0\.1/i.test(base)) {
    base = String(process.env.PUBLIC_SITE_URL || "https://wow-pug.com").trim().replace(/\/+$/, "");
  }
  return base ? `${base}${raw}` : "";
}

function eventDmHeaderImageUrl(eventDetail, eventTitle = "") {
  const direct = absoluteUrlFromPublicBase(raidHelperHeaderImage(eventDetail));
  if (direct) return direct;
  const raidName = trackedRaidNameFromEventTitle(eventTitle);
  let headerPath = "";
  if (raidName === "Karazhan") headerPath = "/raid-images/event-header-kara.png";
  else if (raidName === "Gruul's Lair") headerPath = "/raid-images/event-header-gruul.png";
  else if (raidName === "Magtheridon's Lair") headerPath = "/raid-images/event-header-magtheridon.png";
  else if (raidName === "Serpentshrine Cavern") headerPath = "/raid-images/event-header-ssc.png";
  else if (raidName === "The Eye") headerPath = "/raid-images/event-header-tk.png";
  const fallback = absoluteUrlFromPublicBase(headerPath || raidImageFromTitle(String(eventTitle || "")));
  return fallback || "";
}

function joinUsDmHeaderImageUrl() {
  return absoluteUrlFromPublicBase("/raid-images/dm-join-us.png");
}

function joinUsPageUrl() {
  return "https://wow-pug.com/join.html";
}

async function sendJoinUsHeaderImageMessage(channelId, fallbackImageUrl = "") {
  const botToken = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!botToken || !channelId) return;
  try {
    const imagePath = path.join(publicDir, "raid-images", "dm-join-us.png");
    const imageBuf = await readFile(imagePath);
    const payload = {
      embeds: [{ image: { url: "attachment://dm-join-us.png" } }],
    };
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", new Blob([imageBuf], { type: "image/png" }), "dm-join-us.png");
    const res = await fetch(`${DISCORD_API_BASE}/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}` },
      body: form,
    });
    if (res.ok) return;
  } catch {
    // fall through to URL embed fallback
  }
  if (fallbackImageUrl) {
    await discordBotApi(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      body: { embeds: [{ image: { url: fallbackImageUrl } }] },
    });
  }
}

function trackedRaidNameFromEventTitle(eventTitle) {
  const text = normalizeText(String(eventTitle || ""));
  if (!text) return null;
  if (text.includes("serpentshrine") || /\bssc\b/.test(text)) return "Serpentshrine Cavern";
  if (text.includes("tempest keep") || text.includes("the eye") || /\btk\b/.test(text)) return "The Eye";
  if (text.includes("karazhan") || /\bkara\b/.test(text)) return "Karazhan";
  if (text.includes("gruul")) return "Gruul's Lair";
  if (text.includes("magtheridon")) return "Magtheridon's Lair";
  return null;
}

function formatDurationForDm(msRaw) {
  const ms = Number(msRaw || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "n/a";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function raidStatsForEventTitle(eventTitle) {
  const titleText = normalizeText(String(eventTitle || ""));
  const hasGruul = titleText.includes("gruul");
  const hasMag = titleText.includes("mag");
  const raidNames = hasGruul && hasMag ? ["Gruul's Lair", "Magtheridon's Lair"] : [trackedRaidNameFromEventTitle(eventTitle)];
  const validRaidNames = raidNames.filter(Boolean);
  if (!validRaidNames.length) return null;
  const guildId = votingGuildId;
  if (!Number.isInteger(guildId) || guildId <= 0) return null;
  try {
    const reports = await getFilteredGuildReportsForGuild(guildId, 80);
    const allEntries = buildRecentRaidCalendarEntries(reports);
    const bestByRaid = new Map();
    const bestClearByRaid = new Map();
    for (const raidName of validRaidNames) {
      const entries = allEntries.filter((entry) => String(entry?.raidName || "") === raidName);
      if (!entries.length) continue;
      let bestProgress = entries[0];
      for (const entry of entries) {
        const k = Number(entry?.bossesKilled || 0);
        const b = Number(bestProgress?.bossesKilled || 0);
        if (k > b) bestProgress = entry;
      }
      bestByRaid.set(raidName, bestProgress);
      const fullClearMs = entries
        .filter((e) => e?.isFullClear && Number(e?.clearDurationMs || 0) > 0)
        .map((e) => Number(e.clearDurationMs));
      if (fullClearMs.length) bestClearByRaid.set(raidName, Math.min(...fullClearMs));
    }
    if (!bestByRaid.size) return { raidName: validRaidNames[0], progressText: null, bestClearText: null };
    const totalKilled = [...bestByRaid.values()].reduce((sum, row) => sum + Number(row?.bossesKilled || 0), 0);
    const totalBosses = [...bestByRaid.values()].reduce((sum, row) => sum + Number(row?.bossesTotal || 0), 0);
    let bestClearMs = 0;
    if (validRaidNames.length === 2 && bestClearByRaid.has(validRaidNames[0]) && bestClearByRaid.has(validRaidNames[1])) {
      bestClearMs = Number(bestClearByRaid.get(validRaidNames[0]) || 0) + Number(bestClearByRaid.get(validRaidNames[1]) || 0);
    } else if (bestClearByRaid.has(validRaidNames[0])) {
      bestClearMs = Number(bestClearByRaid.get(validRaidNames[0]) || 0);
    }
    return {
      raidName: validRaidNames.join(" + "),
      progressText: totalBosses > 0 ? `${totalKilled}/${totalBosses}` : null,
      bestClearText: bestClearMs > 0 ? formatDurationForDm(bestClearMs) : null,
    };
  } catch {
    return null;
  }
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

/**
 * Preferred lookup: WoW character for a given Discord user id. The
 * Account Assignment table now stores `discordUserId` per row (auto-populated
 * from Raid Helper signups, or hand-entered on /admin.html). Falls back to
 * legacy name matching at the call site if this returns null.
 */
function resolveLinkedWowCharacterByDiscordUserId(discordUserId) {
  const id = sanitizeDiscordUserId(discordUserId);
  if (!id) return null;
  if (materializeIdentityEnabled()) {
    try {
      const fromDb = identityResolveCharacterByDiscordId(id);
      if (fromDb !== null && fromDb !== undefined) return fromDb || null;
    } catch (error) {
      console.warn("[identity-cutover] resolveLinkedWowCharacterByDiscordUserId fallback:", error?.message || error);
    }
  }
  const links = Array.isArray(rhWclLinksState?.links) ? rhWclLinksState.links : [];
  for (const link of links) {
    const linkId = sanitizeDiscordUserId(link?.discordUserId);
    if (!linkId || linkId !== id) continue;
    const wcl = Array.isArray(link?.wclCharacterNames) ? link.wclCharacterNames.filter(Boolean) : [];
    const pick = String(wcl[0] || "").trim() || String(link?.raidHelperName || "").trim();
    return pick || null;
  }
  return null;
}

/** WoW character name from admin-maintained RH ↔ WCL roster (`rh-wcl-character-links.json`), matched on Discord display name. */
function resolveLinkedWowCharacterFromRhWcl(discordDisplayName) {
  const links = Array.isArray(rhWclLinksState?.links) ? rhWclLinksState.links : [];
  const dnKey = normalizeRaidHelperDisplayKey(String(discordDisplayName || ""));
  if (!dnKey) return null;

  for (const link of links) {
    const rhKey = normalizeRaidHelperDisplayKey(String(link?.raidHelperName || ""));
    if (rhKey && rhKey === dnKey) {
      const wcl = Array.isArray(link?.wclCharacterNames) ? link.wclCharacterNames.filter(Boolean) : [];
      const pick = String(wcl[0] || "").trim() || String(link?.raidHelperName || "").trim();
      return pick || null;
    }
  }
  for (const link of links) {
    const wcl = Array.isArray(link?.wclCharacterNames) ? link.wclCharacterNames : [];
    for (const cn of wcl) {
      const ck = normalizeRaidHelperDisplayKey(String(cn || ""));
      if (ck && ck === dnKey) return String(cn).trim();
    }
  }
  return null;
}

/* ============================================================================
 * Discord user ID → Raid Helper signup name cache.
 *
 * Raid Helper signup payloads include `entry.userId` (the actual Discord user
 * id) and `entry.name` (the RH display name as typed by the user). We harvest
 * those into a disk-cached map so any Discord-authenticated feature (Phase 2
 * demand table, future DM tooling, …) can resolve the canonical RH signup name
 * for a given Discord ID without depending on the volatile Discord global /
 * username string a user happens to have at submission time.
 *
 * Lookup chain at the call site (e.g. `/api/nether-vortex/needs`):
 *
 *   discordUserId → resolveRaidHelperNameByDiscordUserId() → rhSignupName →
 *   resolveLinkedWowCharacterFromRhWcl(rhSignupName) → wclCharacterName
 *
 * The cache is populated by background scans of recent past Raid Helper events
 * (re-uses {@link collectPastParticipantSignals}). It's intentionally
 * non-blocking: a cold request returns whatever we have on disk (possibly
 * empty) and triggers an async refresh; the *next* request gets the new map.
 * ============================================================================ */
const discordIdToRhNameCachePath = path.join(dataDir, "discord-id-rh-name-cache.json");
let discordIdToRhNameState = null;
let discordIdToRhNameLoadInflight = null;
let discordIdToRhNameRefreshInflight = null;

const DISCORD_RH_NAME_CACHE_TTL_MS = 60 * 60_000; // refresh after ~1h
const DISCORD_RH_NAME_CACHE_SCAN_EVENTS = 60;

async function ensureDiscordIdToRhNameCacheLoaded() {
  if (discordIdToRhNameState) return discordIdToRhNameState;
  if (discordIdToRhNameLoadInflight) return discordIdToRhNameLoadInflight;
  discordIdToRhNameLoadInflight = (async () => {
    try {
      const raw = await readFile(discordIdToRhNameCachePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.byUserId === "object" && parsed.byUserId) {
        discordIdToRhNameState = {
          byUserId: parsed.byUserId,
          updatedAt: Number(parsed.updatedAt) || 0,
        };
        return discordIdToRhNameState;
      }
    } catch (err) {
      if (err?.code !== "ENOENT") {
        console.warn("[discord-rh-cache] load failed:", err?.message || err);
      }
    }
    discordIdToRhNameState = { byUserId: {}, updatedAt: 0 };
    return discordIdToRhNameState;
  })().finally(() => {
    discordIdToRhNameLoadInflight = null;
  });
  return discordIdToRhNameLoadInflight;
}

async function persistDiscordIdToRhNameCache() {
  if (!discordIdToRhNameState) return;
  const tmp = `${discordIdToRhNameCachePath}.tmp`;
  await writeFile(tmp, JSON.stringify(discordIdToRhNameState, null, 2), "utf8");
  await rename(tmp, discordIdToRhNameCachePath);
  try {
    dualWriteDiscordIdRhNameCacheToIdentityDb(discordIdToRhNameState?.byUserId || {});
  } catch (error) {
    console.warn("[identity-dualwrite] discord-id-cache mirror failed:", error?.message || error);
  }
}

/**
 * Mirror the Discord-id -> last-seen-RH-name cache into `users` rows. We
 * never write characters from this source — it's purely a Discord <-> RH
 * name signal — but we do refresh `raid_helper_name` and create rows for
 * Discord ids we haven't seen anywhere else yet.
 */
function dualWriteDiscordIdRhNameCacheToIdentityDb(byUserId) {
  if (!byUserId || typeof byUserId !== "object") return;
  const now = Date.now();
  for (const [discordUserId, entry] of Object.entries(byUserId)) {
    const id = sanitizeDiscordUserId(discordUserId);
    if (!id) continue;
    const rhName = entry?.rhName ? String(entry.rhName).trim() : "";
    if (!rhName) continue;
    identityUserUpsert({
      discordUserId: id,
      raidHelperName: rhName,
      displayName: rhName,
      source: "dualwrite:discord-id-cache",
      updatedAt: now,
    });
  }
}

/**
 * Backfill `discordUserId` onto existing Account Assignment rows by matching
 * `raidHelperName` against the freshly-built `byUserId` map. Persists the
 * updated rh-wcl-character-links.json only if anything changed. Cheap to run
 * after every cache refresh — operations are O(n_links).
 */
async function backfillDiscordIdsOntoRhWclLinks(byUserId) {
  if (!byUserId || typeof byUserId !== "object") return;
  try {
    await ensureRhWclLinksStore();
  } catch {
    return;
  }
  const links = Array.isArray(rhWclLinksState?.links) ? rhWclLinksState.links : [];
  if (!links.length) return;

  // Build a name-key → Discord ID lookup once. Multiple Discord ids could in
  // theory map to the same RH key (Mainsadin|Mainzer style alts) — when that
  // happens we keep the most recently seen one to match what the resolver
  // would return for that name.
  const idByRhKey = new Map();
  const lastSeenByRhKey = new Map();
  for (const [userId, entry] of Object.entries(byUserId)) {
    const rhName = String(entry?.rhName || "").trim();
    const key = normalizeRaidHelperDisplayKey(rhName);
    if (!key) continue;
    const ts = Number(entry?.lastSeenAt || 0);
    if (ts >= (lastSeenByRhKey.get(key) || 0)) {
      idByRhKey.set(key, sanitizeDiscordUserId(userId));
      lastSeenByRhKey.set(key, ts);
    }
  }

  let dirty = false;
  for (const link of links) {
    if (sanitizeDiscordUserId(link?.discordUserId)) continue; // already set, leave alone
    const key = normalizeRaidHelperDisplayKey(String(link?.raidHelperName || ""));
    if (!key) continue;
    const id = idByRhKey.get(key);
    if (!id) continue;
    link.discordUserId = id;
    if (!link.discordUserIdSource) link.discordUserIdSource = "rh-scan";
    dirty = true;
  }

  if (dirty) {
    try {
      await persistRhWclLinksStore();
    } catch (err) {
      console.warn("[rh-wcl-links] backfill persist failed:", err?.message || err);
    }
  }
}

/**
 * Scan recent Raid Helper events and merge the (userId → RH display name) map
 * into the on-disk cache. Idempotent — concurrent callers share one inflight
 * Promise and re-use the latest signals snapshot.
 */
async function refreshDiscordIdToRhNameCache() {
  if (discordIdToRhNameRefreshInflight) return discordIdToRhNameRefreshInflight;
  discordIdToRhNameRefreshInflight = (async () => {
    try {
      await ensureDiscordIdToRhNameCacheLoaded();
      const signals = await collectPastParticipantSignals(DISCORD_RH_NAME_CACHE_SCAN_EVENTS);
      const next = { byUserId: { ...(discordIdToRhNameState?.byUserId || {}) }, updatedAt: Date.now() };
      for (const [userId, row] of signals) {
        const id = String(userId || "").trim();
        const rhName = String(row?.displayName || "").trim();
        if (!id || !rhName) continue;
        const lastSeenAt = Number(row?.lastSeenStartTime || 0) * 1000;
        const prev = next.byUserId[id];
        // Always overwrite — the most recent scan is authoritative for the
        // RH signup name. We only preserve a previous entry if this scan
        // didn't see the user (handled by the `{...prev}` spread above).
        next.byUserId[id] = {
          rhName,
          lastSeenAt: Math.max(Number(prev?.lastSeenAt || 0), lastSeenAt || 0),
        };
      }
      discordIdToRhNameState = next;
      try {
        await persistDiscordIdToRhNameCache();
      } catch (err) {
        console.warn("[discord-rh-cache] persist failed:", err?.message || err);
      }
      // Side-effect: now that we have a fresh ID-by-RH-name map, write the
      // canonical Discord id onto any Account Assignment rows that still lack
      // one. Means rh-wcl-character-links.json self-heals over time without
      // anyone touching the admin UI.
      try {
        await backfillDiscordIdsOntoRhWclLinks(next.byUserId);
      } catch (err) {
        console.warn("[rh-wcl-links] backfill failed:", err?.message || err);
      }
      return next;
    } catch (err) {
      console.warn("[discord-rh-cache] refresh failed:", err?.message || err);
      return discordIdToRhNameState;
    } finally {
      discordIdToRhNameRefreshInflight = null;
    }
  })();
  return discordIdToRhNameRefreshInflight;
}

/**
 * Synchronous-ish lookup: returns the RH signup display name for a Discord
 * user id from the disk-cached map. If the cache hasn't been populated yet,
 * or is stale (>1h), kicks off a background refresh — but never blocks the
 * caller, so the demand-table API stays snappy.
 */
async function resolveRaidHelperNameByDiscordUserId(userId) {
  const id = String(userId || "").trim();
  if (!id) return "";
  if (materializeIdentityEnabled()) {
    try {
      const fromDb = identityResolveRaidHelperNameByDiscordId(id);
      if (fromDb) {
        // Still trigger an async cache refresh in the background so future
        // dual-writes carry the freshest RH name from Raid Helper events.
        const cacheAge = Date.now() - Number(discordIdToRhNameState?.updatedAt || 0);
        const stale =
          cacheAge > DISCORD_RH_NAME_CACHE_TTL_MS || !discordIdToRhNameState?.updatedAt;
        if (stale && !discordIdToRhNameRefreshInflight) {
          refreshDiscordIdToRhNameCache().catch(() => {});
        }
        return fromDb;
      }
    } catch (error) {
      console.warn("[identity-cutover] resolveRaidHelperNameByDiscordUserId fallback:", error?.message || error);
    }
  }
  await ensureDiscordIdToRhNameCacheLoaded();
  const hit = discordIdToRhNameState?.byUserId?.[id];
  const cacheAge = Date.now() - Number(discordIdToRhNameState?.updatedAt || 0);
  const stale = cacheAge > DISCORD_RH_NAME_CACHE_TTL_MS || !discordIdToRhNameState?.updatedAt;
  if (stale && !discordIdToRhNameRefreshInflight) {
    refreshDiscordIdToRhNameCache().catch(() => {});
  }
  return String(hit?.rhName || "").trim();
}

function raiderIoCharacterProfileWebUrl(characterName) {
  const region = wowRosterRegion();
  const realm = wowRealmSlugForLookup(defaultWowRealmForRoster());
  const name = String(characterName || "").trim();
  if (!realm || !name) return "";
  return `https://raider.io/characters/${encodeURIComponent(region)}/${realm}/${encodeURIComponent(name)}`;
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
  if (t === "retribution") return "paladin";
  /** Restoration / Protection / Holy appear on two classes — rely on texture checks instead. */
  return "";
}

/** MVP voting list — normalize WCL combat `type` (often a spec name) to English class for UI + colors. */
function englishClassDisplayFromWclCombatType(typeRaw) {
  const raw = String(typeRaw || "").trim();
  if (!raw) return "";

  const displayFromSlug = (slug) => (slug && ENGLISH_CLASS_SLUG_TO_DISPLAY[slug]) || "";

  let slug = englishCanonicalClassSlugFromLocalizedDisplay(raw);
  if (slug) return displayFromSlug(slug);

  slug = classSlugFromWclDamageDoneType(typeRaw);
  if (slug) return displayFromSlug(slug);

  const t = slugifyLocaleText(raw);
  if (!t) return raw;

  const compoundClasses = [
    ["deathknight", "deathknight"],
    ["paladin", "paladin"],
    ["warrior", "warrior"],
    ["shaman", "shaman"],
    ["hunter", "hunter"],
    ["rogue", "rogue"],
    ["warlock", "warlock"],
    ["mage", "mage"],
    ["priest", "priest"],
    ["druid", "druid"],
  ];
  for (const [needle, cls] of compoundClasses) {
    if (t.includes(needle)) return displayFromSlug(cls);
  }

  return raw;
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

/** First guild full-clear per raid (based on available filtered WCL reports), with ranked-character participants. */
/**
 * Live-endpoint shim that delegates to the pure extraction in
 * `lib/compute/first-clears.mjs`. Kept for compatibility with existing
 * call sites; sync workers import the pure function directly so a slow
 * module-graph import doesn't impact request latency.
 */
function firstClearParticipantsByRaidFromReports(reports, raidNames) {
  return computeFirstClearParticipantsByRaid(reports, {
    trackedRaids: TRACKED_RAIDS,
    resolveRaidForFight: resolvedTrackedRaidForFight,
    getStartTimeMs: reportStartTimeMs,
    raidNames,
  });
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: apiKey },
    });
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        return null;
      }
    }
    const retryable = res.status === 429 || (res.status >= 500 && res.status <= 504);
    if (!retryable || attempt >= 1) return null;
    await sleepMs(250);
  }
  return null;
}

/** Memo TTL for full-history Raid Helper signup scans (one detail fetch per past event). */
function raidHelperSignupCountCacheTtlMs() {
  const n = Number(process.env.RAID_HELPER_SIGNUP_COUNT_CACHE_TTL_MS);
  if (Number.isFinite(n) && n >= 30_000) return Math.min(60 * 60_000, n);
  return 10 * 60_000;
}

let raidHelperPrimarySignupCountCache = {
  serverId: "",
  mode: "",
  /** @type {Map<string, number> | null} */
  counts: null,
  pastEventsScanned: 0,
  at: 0,
};

/**
 * Count primary Raid Helper signups per normalized RH key across **past**
 * posted events (same filters as the leaderboard "Events" KPI).
 *
 * @param maxPastEvents When `<= 0` or non-finite, scan **every** past posted
 *   event returned by the Raid Helper API (all pages, newest first). When
 *   `> 0`, cap to that many newest events. Results are memoized per-server for
 *   {@link raidHelperSignupCountCacheTtlMs} to avoid refetching hundreds of
 *   event payloads on every leaderboard poll.
 * @returns {Promise<{ counts: Map<string, number>, pastEventsScanned: number }>}
 */
async function countRaidHelperPrimarySignupsPerRhKey(maxPastEvents) {
  const serverId = raidHelperDiscordGuildId() || "711838953430319115";
  const excludedClasses = new Set(["Absence", "Bench", "Tentative", "Late"]);
  const nowSec = Math.floor(Date.now() / 1000);
  const raw = maxPastEvents == null ? NaN : Number(maxPastEvents);
  const scanAll = !Number.isFinite(raw) || raw <= 0;
  const cap = scanAll ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(raw));
  const mode = scanAll ? "all-v3" : `cap:${cap}`;

  const ttl = raidHelperSignupCountCacheTtlMs();
  const tNow = Date.now();
  if (
    raidHelperPrimarySignupCountCache.serverId === serverId &&
    raidHelperPrimarySignupCountCache.mode === mode &&
    raidHelperPrimarySignupCountCache.counts instanceof Map &&
    tNow - raidHelperPrimarySignupCountCache.at < ttl
  ) {
    return {
      counts: new Map(raidHelperPrimarySignupCountCache.counts),
      pastEventsScanned: raidHelperPrimarySignupCountCache.pastEventsScanned,
    };
  }

  const allEvents = await fetchRaidHelperServerEvents(serverId);
  const pastEvents = allEvents
    .map((event) => ({
      id: String(event.id || event.eventId || event.eventID || ""),
      startTime: Number(event.startTime || event.timestamp || event.time || event.start || 0),
    }))
    .filter((e) => e.id && e.startTime > 0 && e.startTime <= nowSec)
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, Number.isFinite(cap) && cap < Number.POSITIVE_INFINITY ? cap : undefined);

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

  const countsCopy = new Map(counts);
  raidHelperPrimarySignupCountCache = {
    serverId,
    mode,
    counts: countsCopy,
    pastEventsScanned: pastEvents.length,
    at: tNow,
  };
  return { counts: new Map(countsCopy), pastEventsScanned: pastEvents.length };
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

/** Admin test helper: fetch raw Raid-Helper comp board data by comp/event id. */
app.get("/api/admin/raid-helper/comps/:compId", async (req, res) => {
  try {
    const session = requireAdminSession(req, res);
    if (!session) return;
    const compId = String(req.params.compId || "").trim();
    if (!compId) {
      return res.status(400).json({ ok: false, error: "compId is required" });
    }
    const payload = await raidHelperRequest(`/comps/${encodeURIComponent(compId)}`);
    return res.json({ ok: true, compId, payload });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load Raid-Helper comp" });
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
      24,
      Math.max(1, Number(process.env.RAID_HELPER_FUTURE_EVENTS_CONCURRENCY || 8) || 8)
    );

    // Cold-call dominator: the WCL scan does **not** depend on the RH signups
    // or the on-disk stores, so we run all three in parallel instead of
    // letting WCL wait for the RH event fan-out to finish.
    const reportLimit = wclLimit;
    const [keyLists, , wclBundle] = await Promise.all([
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
      gatherAttendanceRaidSnapshots(guildId, reportLimit, { attendancePercentMetrics: true }),
    ]);

    const uniqueKeys = new Set(keyLists.flat());
    const { raidSnapshots, wclDisplayByLower, raidRankingPayloads } = wclBundle;
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

  if (materializeAttendanceEnabled()) {
    try {
      const rows = deathTotalsGetByWindow("last-rolling-window");
      if (rows.length) {
        const topParam = req.query.top;
        const top =
          topParam === undefined || topParam === ""
            ? 5
            : Math.min(500, Math.max(1, Math.floor(Number(topParam) || 5)));
        const leaderboard = rows
          .map((r) => ({
            name: r.mainCharacterName || r.displayName || `User #${r.userId}`,
            deaths: Number(r.deaths || 0),
            userId: r.userId,
            discordUserId: r.discordUserId || null,
          }))
          .slice(0, top);
        return res.json({
          guildId,
          source: "materialized",
          scannedReports: null,
          leaderboard,
        });
      }
    } catch (error) {
      console.warn("[death-leaderboard] materialised read failed:", error?.message || error);
    }
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

/**
 * Build the same payload shape `/api/wcl/guild/:gid/attendance` returns,
 * but sourced from `users` × `user_characters` × `raid_attendance` ×
 * `parse_summary`. Returns `null` if the materialised tables don't have
 * enough data yet so the caller can fall back to the live pipeline.
 */
function buildAttendancePayloadFromMaterialised(guildId, { top = 200 } = {}) {
  let attendanceWindow = [];
  try {
    const freshest = raidAttendanceGetFreshestWindow();
    if (!freshest) return null;
    attendanceWindow = raidAttendanceGetByWindow(freshest.windowLabel);
  } catch {
    return null;
  }
  if (!Array.isArray(attendanceWindow) || !attendanceWindow.length) return null;

  const users = identityUserListAll();
  if (!Array.isArray(users) || !users.length) return null;
  const usersById = new Map(users.map((u) => [u.id, u]));
  const charactersByUserId = new Map();
  const allCharacterIds = [];
  for (const u of users) {
    const chars = identityCharactersGetByUserId(u.id);
    charactersByUserId.set(u.id, chars);
    for (const c of chars) allCharacterIds.push(c.id);
  }
  const parseRowsByCharacterId = new Map();
  if (allCharacterIds.length) {
    const parseRows = parseSummaryGetByMainCharacterIds(allCharacterIds);
    for (const r of parseRows) {
      const arr = parseRowsByCharacterId.get(r.characterId) || [];
      arr.push(r);
      parseRowsByCharacterId.set(r.characterId, arr);
    }
  }

  /* Aggregate per-user parse summaries by collapsing each character's rows
     into the user's tank/heal/dps best. We keep the bracket's best across
     all of the user's characters (mirror of the live `parseSummaries`). */
  function bestParseRowForUserBracket(userId, bracket) {
    const chars = charactersByUserId.get(userId) || [];
    let best = null;
    for (const c of chars) {
      const rows = parseRowsByCharacterId.get(c.id) || [];
      for (const r of rows) {
        if (r.bracket !== bracket) continue;
        if (!best || Number(r.bestValue || 0) > Number(best.bestValue || 0)) best = r;
      }
    }
    return best;
  }

  const consideredRaids = Number(attendanceWindow[0]?.attendanceHistory?.length || 0);
  const leaderboard = [];
  for (const att of attendanceWindow) {
    const u = usersById.get(att.userId);
    if (!u) continue;
    const chars = charactersByUserId.get(u.id) || [];
    const wclCharacters = chars.map((c) => c.characterName).sort((a, b) => a.localeCompare(b));
    const tank = bestParseRowForUserBracket(u.id, "tank");
    const heal = bestParseRowForUserBracket(u.id, "heal");
    const dps = bestParseRowForUserBracket(u.id, "dps");
    const parseSummaries = {
      bestTank: tank?.bestValue || 0,
      bestTankEncounter: tank?.bestEncounter || null,
      bestTankReportCode: tank?.bestReportCode || null,
      bestTankFightId: tank?.bestFightId || null,
      bestTankEncounterTop: !!(tank && tank.encounterTopInBracket),
      bestHeal: heal?.bestValue || 0,
      bestHealEncounter: heal?.bestEncounter || null,
      bestHealReportCode: heal?.bestReportCode || null,
      bestHealFightId: heal?.bestFightId || null,
      bestHealEncounterTop: !!(heal && heal.encounterTopInBracket),
      bestDps: dps?.bestValue || 0,
      bestDpsEncounter: dps?.bestEncounter || null,
      bestDpsReportCode: dps?.bestReportCode || null,
      bestDpsFightId: dps?.bestFightId || null,
      bestDpsEncounterTop: !!(dps && dps.encounterTopInBracket),
      encounterTopTank: !!(tank && tank.encounterTopInBracket),
      encounterTopHeal: !!(heal && heal.encounterTopInBracket),
      encounterTopDps: !!(dps && dps.encounterTopInBracket),
    };
    leaderboard.push({
      name: u.displayName || u.raidHelperName || "",
      raidHelperName: u.raidHelperName || u.displayName || "",
      wclCharacters,
      raidsAttended: Number(att.raidsAttended || 0),
      attendanceRate: consideredRaids > 0 ? (Number(att.raidsAttended || 0) / consideredRaids) * 100 : 0,
      attendanceHistory: Array.isArray(att.attendanceHistory) ? att.attendanceHistory : [],
      parseSummaries,
      guildRole: normalizeRhWclGuildRole(u.guildRole),
      dbUserId: u.id,
      discordUserId: u.discordUserId || null,
    });
  }

  leaderboard.sort(
    (a, b) =>
      b.raidsAttended - a.raidsAttended ||
      b.attendanceRate - a.attendanceRate ||
      String(a.raidHelperName || "").localeCompare(String(b.raidHelperName || ""))
  );

  const trimmed = leaderboard.slice(0, top);
  const parseCeilingMax = computeParseCeilingMaxFromLeaderboard(trimmed);
  return {
    guildId,
    consideredRaids,
    raids: [],
    leaderboard: trimmed,
    parseCeilingMax,
    parseRankingReports: 0,
    attendanceLinking: true,
    rhWclLinkCount: users.length,
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
    source: "materialised",
  };
}

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

  if (materializeAttendanceEnabled() && String(req.query.refresh || "") !== "1") {
    try {
      const fast = buildAttendancePayloadFromMaterialised(guildId, { top });
      if (fast) return res.json(fast);
    } catch (error) {
      console.warn("[attendance] materialised read failed:", error?.message || error);
    }
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

/** Badge feed: participants from this guild's first full clear per raid (Kara/Gruul/Mag). */
app.get("/api/wcl/guild/:guildId/first-clear-participants", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const limit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(20, Number(req.query.limit || Math.max(80, wclAttendanceRecentRaidCount())))
  );
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }
  const raidNames = ["Karazhan", "Gruul's Lair", "Magtheridon's Lair"];

  if (materializeAttendanceEnabled()) {
    try {
      const grouped = firstClearParticipantsGet({ raidNames });
      const haveAny = raidNames.some((r) => grouped[r]?.participants?.length);
      if (haveAny) {
        const firstClears = {};
        for (const raidName of raidNames) firstClears[raidName] = grouped[raidName] || null;
        return res.json({
          guildId,
          source: "materialized",
          reportsScanned: null,
          firstClears,
        });
      }
    } catch (error) {
      console.warn("[first-clear-participants] materialised read failed:", error?.message || error);
    }
  }

  try {
    const reports = await getFilteredGuildReportsForGuild(guildId, limit);
    const firstClears = firstClearParticipantsByRaidFromReports(reports, raidNames);
    return res.json({
      guildId,
      reportsScanned: reports.length,
      firstClears,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

/**
 * Active roster: players with ≥1 attendance hit in the same capped recent
 * 25-player raids as `/attendance` (WCL_ATTENDANCE_RECENT_RAIDS, default 6),
 * enriched with Raider.io / WCL spec art like Events cards. Includes
 * `guildRole` from Account Assignment store. `rhPastEventCount` defaults to a
 * **full-history** Raid Helper primary-signup scan (`maxRhPastEvents=0`); pass
 * a positive integer to cap how many newest past events are scanned (max 5000).
 */
app.get("/api/wcl/guild/:guildId/active-roster", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const reportLimit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(10, Number(req.query.limit || 40))
  );
  const top = Math.min(300, Math.max(80, Number(req.query.top || 220)));
  const rawRhCap = Math.floor(Number(req.query.maxRhPastEvents ?? 0));
  const maxRhPastEvents =
    !Number.isFinite(rawRhCap) || rawRhCap <= 0 ? 0 : Math.min(5000, Math.max(1, rawRhCap));
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

/**
 * Build the same payload shape `fetchGuildLootReceived` returns, but
 * sourced from the materialised `loot_awards` table populated by
 * `runSyncLoot`. Used by `/api/loot-history` + `/api/wcl/guild/:gid/loot-received`
 * when MATERIALIZE_LOOT is on AND the table is non-empty.
 *
 * Returns `null` if the materialised table is empty so the caller can
 * fall back to the live `fetchGuildLootReceived` pipeline.
 */
function buildLootHistoryFromMaterialised(guildId) {
  let awards;
  try {
    awards = lootAwardsGetAll({ limit: 5000 });
  } catch {
    return null;
  }
  if (!Array.isArray(awards) || awards.length === 0) return null;

  const reportInfo = new Map();
  for (const a of awards) {
    if (!a?.reportCode) continue;
    if (reportInfo.has(a.reportCode)) continue;
    reportInfo.set(a.reportCode, {
      reportCode: a.reportCode,
      reportTitle: a.reportTitle || null,
      reportRaidName: a.reportRaidName || null,
      reportStartTime: Number(a.awardedAt || 0),
      reportUploader: a.reportUploader || null,
    });
  }
  const allRaids = [...reportInfo.values()]
    .filter((raid) => !isTenPlayerTbcLootRow(raid))
    .sort((a, b) => Number(b.reportStartTime || 0) - Number(a.reportStartTime || 0));

  const items = awards
    .map((a) => ({
      reportCode: a.reportCode || null,
      reportTitle: a.reportTitle || null,
      reportRaidName: a.reportRaidName || null,
      reportStartTime: Number(a.awardedAt || 0),
      itemId: a.itemId,
      itemName: a.itemName || null,
      recipient: a.characterName || null,
      rawType: a.rawType || null,
    }))
    .filter((row) => !isTenPlayerTbcLootRow(row));

  const selectedSet = new Set((gargulLootState?.selectedReportCodes || []).map((x) => String(x)));
  const visibleRaids = selectedSet.size
    ? allRaids.filter((raid) => selectedSet.has(String(raid.reportCode)))
    : allRaids;
  const visibleItems = selectedSet.size
    ? items.filter((item) => selectedSet.has(String(item?.reportCode || "")))
    : items;

  return {
    guildId,
    reportsChecked: allRaids.length,
    selectedReportCodes: [...selectedSet],
    raids: visibleRaids,
    allRaids,
    items: visibleItems,
    note:
      visibleItems.length === 0
        ? "No loot receipt events were returned by Warcraft Logs, and no Gargul import data is stored yet."
        : null,
    source: "materialised",
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
    if (!forceRefresh && materializeLootEnabled()) {
      const fast = buildLootHistoryFromMaterialised(guildId);
      if (fast) return res.json(fast);
    }
    const key = lootHistoryCacheKey(guildId, reportLimit);
    const loader = () => fetchGuildLootReceived(guildId, reportLimit);
    const payload = forceRefresh
      ? await forceRefreshCachedPayload(key, loader)
      : await getOrRefreshCachedPayload(key, {
          ttlMs: lootHistoryCacheTtlMs(),
          maxStaleMs: lootHistoryMaxStaleMs(),
          loader,
        });
    return res.json({ ...payload, source: "live" });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
  }
});

/**
 * Phase 7 cutover: per-user loot pulled from the materialised `loot_awards`
 * table. Returns the canonical user's awarded items (across all linked
 * characters) so the profile page can render a recent-loot list without
 * re-running the WCL loot-events graph.
 */
app.get("/api/profile/loot/me", async (req, res) => {
  if (!materializeLootEnabled()) {
    return res.json({ ok: true, source: "disabled", awards: [] });
  }
  try {
    const userId = req.session?.user?.id;
    const discordUserId = sanitizeDiscordUserId(userId);
    if (!discordUserId) return res.status(401).json({ ok: false, error: "Not signed in" });
    const canonical = identityUserGetByDiscordId(discordUserId);
    if (!canonical?.id) return res.json({ ok: true, source: "materialised", awards: [] });
    const awards = lootAwardsGetByUserId(canonical.id);
    return res.json({ ok: true, source: "materialised", dbUserId: canonical.id, awards });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load loot" });
  }
});

/**
 * Phase 7 cutover: per-canonical-user loot for the leaderboard expand
 * sub-row. Avoids the leaderboard having to filter the full
 * `/api/wcl/guild/:gid/loot-received` payload client-side for every row.
 */
app.get("/api/leaderboard/player/:dbUserId/loot", async (req, res) => {
  if (!materializeLootEnabled()) {
    return res.status(404).json({ ok: false, error: "Materialised loot disabled" });
  }
  const dbUserId = Number(req.params.dbUserId);
  if (!Number.isInteger(dbUserId) || dbUserId <= 0) {
    return res.status(400).json({ ok: false, error: "dbUserId must be a positive integer" });
  }
  try {
    const awards = lootAwardsGetByUserId(dbUserId);
    return res.json({ ok: true, source: "materialised", dbUserId, awards });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to load loot" });
  }
});

app.get("/api/loot-history", async (req, res) => {
  const reportLimit = Math.min(40, Math.max(5, Number(req.query.limit || 15)));
  const forceRefresh = String(req.query.refresh || "") === "1";
  try {
    if (!forceRefresh && materializeLootEnabled()) {
      const fast = buildLootHistoryFromMaterialised(votingGuildId);
      if (fast) return res.json(fast);
    }
    const key = lootHistoryCacheKey(votingGuildId, reportLimit);
    const loader = () => fetchGuildLootReceived(votingGuildId, reportLimit);
    const payload = forceRefresh
      ? await forceRefreshCachedPayload(key, loader)
      : await getOrRefreshCachedPayload(key, {
          ttlMs: lootHistoryCacheTtlMs(),
          maxStaleMs: lootHistoryMaxStaleMs(),
          loader,
        });
    return res.json({ ...payload, source: "live" });
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

/* =============================================================================
 * Sync workers — register tasks and start the runner.
 *
 * Each task is registered via `registerSyncTask` and the runner schedules
 * them at fixed intervals with single-flight semantics. Tasks read from the
 * existing disk caches + materialised tables and write to dedicated tables
 * (`badge_state`, `raid_attendance`, etc.). HTTP endpoints read from the
 * tables and never call the WCL / Raid Helper APIs themselves.
 * ============================================================================= */

/** Recompute server-side resolvable badge state for every known user. */
async function runSyncBadges() {
  const guildId = Number(eventsWclSpecIconGuildId() || votingGuildId);
  const reports =
    Number.isInteger(guildId) && guildId > 0
      ? await getFilteredGuildReportsForGuild(
          guildId,
          Math.min(wclMaxGuildReportsLimit(), Math.max(80, Number(wclAttendanceRecentRaidCount?.() || 80)))
        ).catch((error) => {
          console.warn("[sync:badges] reports fetch failed, using empty set:", error?.message || error);
          return [];
        })
      : [];

  const firstClears = computeFirstClearParticipantsByRaid(reports, {
    trackedRaids: TRACKED_RAIDS,
    resolveRaidForFight: resolvedTrackedRaidForFight,
    getStartTimeMs: reportStartTimeMs,
    raidNames: ["Karazhan", "Gruul's Lair", "Magtheridon's Lair"],
  });

  const firstClearKeySets = {
    "kara-first-time-clear": new Set(
      (firstClears?.["Karazhan"]?.participants || [])
        .map((n) => normalizeRaidHelperDisplayKey(String(n || "")))
        .filter(Boolean)
    ),
    "gruul-first-time-clear": new Set(
      (firstClears?.["Gruul's Lair"]?.participants || [])
        .map((n) => normalizeRaidHelperDisplayKey(String(n || "")))
        .filter(Boolean)
    ),
    "magtheridon-first-time-clear": new Set(
      (firstClears?.["Magtheridon's Lair"]?.participants || [])
        .map((n) => normalizeRaidHelperDisplayKey(String(n || "")))
        .filter(Boolean)
    ),
  };
  const firstClearEvidence = {
    "kara-first-time-clear": firstClears?.["Karazhan"] || null,
    "gruul-first-time-clear": firstClears?.["Gruul's Lair"] || null,
    "magtheridon-first-time-clear": firstClears?.["Magtheridon's Lair"] || null,
  };

  let hofWinnerKeys = new Set();
  try {
    await ensureVotingStore();
    for (const round of votingHallOfFame("", 200)) {
      const win = String(round?.winnerName || "").trim();
      if (!win) continue;
      const k = normalizeRaidHelperDisplayKey(win);
      if (k) hofWinnerKeys.add(k);
    }
  } catch (error) {
    console.warn("[sync:badges] hall-of-fame load failed:", error?.message || error);
  }

  let raidsByUserId = new Map();
  try {
    const fresh = raidAttendanceGetFreshestWindow();
    if (fresh?.windowLabel) {
      for (const row of raidAttendanceGetByWindow(fresh.windowLabel)) {
        const uid = Number(row.userId);
        if (!Number.isInteger(uid) || uid <= 0) continue;
        raidsByUserId.set(uid, {
          raidsAttended: Math.max(0, Math.floor(Number(row.raidsAttended) || 0)),
          raidsConsidered: Math.max(0, Math.floor(Number(row.raidsConsidered) || 0)),
          windowLabel: String(fresh.windowLabel),
        });
      }
    }
  } catch (error) {
    console.warn("[sync:badges] raid attendance snapshot read failed:", error?.message || error);
  }

  /* Phase 9: WCL-confirmed appearances per canonical user, scoped to the
     admin-curated Event Management selection. This is the new source of
     truth for the 5/10/25/50/100 raid milestone badges. We retain the
     full-history Raid Helper primary signup counts as a fallback for
     deployments where `raid_appearances` is empty (first sync hasn't run
     yet) so milestone badges keep working during transition. */
  const cutoverOn = materializeRaidAppearancesEnabled();
  /** @type {Map<number, number>} */
  let wclEventsByUserId = new Map();
  let wclMilestoneScope = "rh-signups";
  if (cutoverOn) {
    try {
      const totalRows = raidAppearancesDistinctReportCount();
      if (totalRows > 0) {
        const codes = Array.from(
          new Set(
            (gargulLootState?.selectedReportCodes || [])
              .map((x) => String(x || "").trim())
              .filter(Boolean)
          )
        );
        wclEventsByUserId = raidAppearancesCountsByUser(codes.length ? { reportCodes: codes } : {});
        wclMilestoneScope = codes.length ? "raid_appearances:selected" : "raid_appearances:all";
      }
    } catch (error) {
      console.warn("[sync:badges] raid_appearances lookup failed, falling back to RH signups:", error?.message || error);
      wclEventsByUserId = new Map();
    }
  }
  let rhSignupCountsByKey = new Map();
  if (wclMilestoneScope === "rh-signups") {
    try {
      const result = await countRaidHelperPrimarySignupsPerRhKey(0);
      rhSignupCountsByKey = result?.counts instanceof Map ? result.counts : new Map();
    } catch (error) {
      console.warn("[sync:badges] RH signup count load failed:", error?.message || error);
    }
  }

  let rowsChanged = 0;
  const now = Date.now();
  for (const user of identityUserListAll()) {
    const linkedNames = identityListLinkedCharacterNames({
      discordUserId: user.discordUserId,
      displayName: user.displayName,
    });
    const linkedKeys = new Set(linkedNames.map((c) => normalizeRaidHelperDisplayKey(c)).filter(Boolean));

    const earned = new Set();
    const evidenceById = new Map();

    const guildRoleSlug = String(user.guildRole || "Peon").toLowerCase().replace(/\s+/g, "-");
    if (guildRoleSlug === "guildlead" || guildRoleSlug === "puglead") earned.add("guildlead");
    else if (guildRoleSlug === "raidlead") earned.add("raidlead");
    else if (guildRoleSlug === "core") earned.add("core");
    else if (guildRoleSlug === "veteran") earned.add("veteran");
    else if (guildRoleSlug === "grunt") earned.add("grunt");
    else earned.add("peon");

    if (linkedKeys.size && [...linkedKeys].some((k) => hofWinnerKeys.has(k))) earned.add("hall-of-fame");

    for (const badgeId of Object.keys(firstClearKeySets)) {
      const keys = firstClearKeySets[badgeId];
      if (linkedKeys.size && [...linkedKeys].some((k) => keys.has(k))) {
        earned.add(badgeId);
        if (firstClearEvidence[badgeId]) evidenceById.set(badgeId, firstClearEvidence[badgeId]);
      }
    }

    const raidStats = raidsByUserId.get(user.id);
    let milestoneCount = 0;
    let milestoneSource = wclMilestoneScope;
    if (wclMilestoneScope !== "rh-signups") {
      milestoneCount = Number(wclEventsByUserId.get(user.id) || 0);
    }
    if (milestoneSource === "rh-signups") {
      let rhSignupsForUser = 0;
      for (const k of linkedKeys) {
        const c = Number(rhSignupCountsByKey.get(k) || 0);
        if (c > rhSignupsForUser) rhSignupsForUser = c;
      }
      milestoneCount = rhSignupsForUser;
    }
    const highestMilestoneT = highestRaidMilestoneThresholdMet(milestoneCount);
    if (highestMilestoneT > 0) {
      const bid = `raids-with-guild-${highestMilestoneT}`;
      earned.add(bid);
      evidenceById.set(bid, {
        type: "raid-milestone",
        threshold: highestMilestoneT,
        source: milestoneSource,
        raidsAttendedWindow: raidStats?.raidsAttended || 0,
        raidsConsideredWindow: raidStats?.raidsConsidered || 0,
        wclEventCount: milestoneSource !== "rh-signups" ? milestoneCount : null,
        rhPastEventCount: milestoneSource === "rh-signups" ? milestoneCount : null,
        windowLabel: raidStats?.windowLabel || null,
      });
    }

    const rows = [];
    for (const cat of BADGE_CATALOG) {
      for (const b of cat.badges) {
        rows.push({
          badgeId: b.id,
          earned: earned.has(b.id) ? 1 : 0,
          evidence: evidenceById.get(b.id) || null,
        });
      }
    }
    badgeStateReplaceForUser({ userId: user.id, rows, when: now });
    rowsChanged += rows.length;
  }
  return { rowsChanged };
}

registerSyncTask({
  id: "badges",
  intervalMs: 15 * 60_000,
  description: "Recompute server-side resolvable badges for every user.",
  run: runSyncBadges,
});

/**
 * Walk the rolling window of guild reports and materialise attendance,
 * deaths, first-clears, and best-time roster into their respective
 * tables. The endpoints under `/api/wcl/guild/:gid/...` then read from
 * SQLite instead of re-running this scan on every request.
 */
async function runSyncAttendance() {
  const guildId = Number(eventsWclSpecIconGuildId() || votingGuildId);
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return { rowsChanged: 0 };
  }

  const reportLimit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(80, Number(wclAttendanceRecentRaidCount?.() || 80))
  );
  const reports = await getFilteredGuildReportsForGuild(guildId, reportLimit).catch((error) => {
    console.warn("[sync:attendance] reports fetch failed:", error?.message || error);
    return [];
  });

  let totalRowsChanged = 0;

  // ---------- first_clear_participants -------------------------------------
  try {
    const raidNames = ["Karazhan", "Gruul's Lair", "Magtheridon's Lair"];
    const firstClears = computeFirstClearParticipantsByRaid(reports, {
      trackedRaids: TRACKED_RAIDS,
      resolveRaidForFight: resolvedTrackedRaidForFight,
      getStartTimeMs: reportStartTimeMs,
      raidNames,
    });
    const result = firstClearParticipantsReplace({ raidEntries: firstClears, raidNames });
    totalRowsChanged += result?.rows || 0;
  } catch (error) {
    console.warn("[sync:attendance] first-clears step failed:", error?.message || error);
  }

  // ---------- best_time_roster --------------------------------------------
  try {
    const bestByEncounter = new Map();
    for (const report of reports) {
      const fights = Array.isArray(report?.fights) ? report.fights : [];
      const rankedNames = Array.isArray(report?.rankedCharacters)
        ? report.rankedCharacters.map((c) => String(c?.name || "").trim()).filter(Boolean)
        : [];
      for (const fight of fights) {
        const raidName = resolvedTrackedRaidForFight(fight, report);
        if (!raidName || !TRACKED_RAIDS[raidName]) continue;
        if (!fight?.kill) continue;
        const encounterId = Number(fight?.encounterID || 0);
        if (!Number.isInteger(encounterId) || encounterId <= 0) continue;
        const durationMs = Number(fight?.endTime || 0) - Number(fight?.startTime || 0);
        if (!Number.isFinite(durationMs) || durationMs <= 0) continue;
        const prev = bestByEncounter.get(encounterId);
        if (!prev || durationMs < prev.durationMs) {
          bestByEncounter.set(encounterId, {
            encounterId,
            encounterName: String(fight?.name || ""),
            durationMs,
            reportCode: String(report?.code || ""),
            fightId: Number(fight?.id || 0),
            participants: rankedNames,
          });
        }
      }
    }
    const entries = [];
    for (const best of bestByEncounter.values()) {
      for (const characterName of best.participants) {
        entries.push({
          encounterId: best.encounterId,
          encounterName: best.encounterName,
          characterName,
          reportCode: best.reportCode,
          fightId: best.fightId,
          durationMs: best.durationMs,
        });
      }
    }
    const result = bestTimeRosterReplace({ entries });
    totalRowsChanged += result?.rows || 0;
  } catch (error) {
    console.warn("[sync:attendance] best-time step failed:", error?.message || error);
  }

  // ---------- death_totals (rolling window) -------------------------------
  // Mirrors /death-leaderboard logic, but writes per-user rows so multiple
  // alts collapse into one canonical user.
  try {
    const totals = new Map();
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
        const data = await queryWcl(deathQuery, { code: report.code, fightIds: chunk });
        const table = parseWclTable(data?.reportData?.report?.deaths);
        for (const entry of table?.entries || []) {
          const playerName = String(entry?.name || "").trim();
          if (!playerName) continue;
          const deaths = deathCountFromEntry(entry);
          if (deaths <= 0) continue;
          totals.set(playerName, (totals.get(playerName) || 0) + deaths);
        }
      }
    }
    const rowsArr = [...totals.entries()].map(([characterName, deaths]) => ({ characterName, deaths }));
    const result = deathTotalsReplaceForWindow({ windowLabel: "last-rolling-window", rows: rowsArr });
    totalRowsChanged += result?.rows || 0;
  } catch (error) {
    console.warn("[sync:attendance] death-totals step failed:", error?.message || error);
  }

  // ---------- raid_attendance (per-user rolling window) -------------------
  try {
    const { raidSnapshots, wclDisplayByLower } = await gatherAttendanceRaidSnapshots(guildId, reportLimit, {
      attendancePercentMetrics: false,
    });
    const totalRaids = raidSnapshots.length;
    if (totalRaids > 0) {
      const displayMap = wclDisplayByLower instanceof Map ? wclDisplayByLower : new Map();
      const presenceByName = new Map();
      raidSnapshots.forEach((raid, idx) => {
        const attendeesLower = raid?.attendeesLower instanceof Set ? raid.attendeesLower : new Set();
        for (const lower of attendeesLower) {
          const display = displayMap.get(lower) || lower;
          const key = normalizeRaidHelperDisplayKey(display) || lower;
          if (!presenceByName.has(key)) {
            presenceByName.set(key, {
              characterName: display,
              attendanceHistory: new Array(totalRaids).fill(0),
            });
          }
          presenceByName.get(key).attendanceHistory[idx] = 1;
        }
      });
      const rows = [...presenceByName.values()].map((row) => ({
        characterName: row.characterName,
        raidsAttended: row.attendanceHistory.reduce((acc, n) => acc + (n ? 1 : 0), 0),
        raidsConsidered: totalRaids,
        attendanceHistory: row.attendanceHistory,
      }));
      const result = raidAttendanceReplaceForWindow({
        windowLabel: `last-${totalRaids}-25man`,
        rows,
      });
      totalRowsChanged += result?.rows || 0;

      // ---------- raid_appearances (per-(user, report) lifetime log) -------
      // We keep one row per canonical user × WCL report code. The leaderboard
      // "Events" KPI and the 5/10/25/50/100 raid milestone badges count
      // distinct rows where `report_code` is in the admin-curated
      // `gargulLootState.selectedReportCodes` set. Updates are scoped to the
      // report codes we just gathered so older rows (admin selections
      // outside the current window) are preserved across syncs.
      try {
        const appearanceEntries = [];
        const seenCodes = new Set();
        raidSnapshots.forEach((raid) => {
          const reportCode = String(raid?.reportCode || "").trim();
          if (!reportCode) return;
          seenCodes.add(reportCode);
          const startedAtSec = Math.floor(Number(raid?.startTime || 0) / 1000) || null;
          const attendeesLower = raid?.attendeesLower instanceof Set ? raid.attendeesLower : new Set();
          for (const lower of attendeesLower) {
            const display = displayMap.get(lower) || lower;
            if (!display) continue;
            appearanceEntries.push({
              characterName: display,
              reportCode,
              reportStartedAt: startedAtSec,
            });
          }
        });
        if (seenCodes.size > 0) {
          const appResult = raidAppearancesReplaceForReports({
            reportCodes: [...seenCodes],
            entries: appearanceEntries,
          });
          totalRowsChanged += appResult?.rows || 0;
        }
      } catch (error) {
        console.warn("[sync:attendance] raid_appearances step failed:", error?.message || error);
      }
    }
  } catch (error) {
    console.warn("[sync:attendance] raid_attendance step failed:", error?.message || error);
  }

  return { rowsChanged: totalRowsChanged };
}

registerSyncTask({
  id: "attendance",
  intervalMs: 10 * 60_000,
  description: "Materialise raid attendance, deaths, first-clears, best-time.",
  run: runSyncAttendance,
});

/**
 * Materialise per-character parse summaries (best percentile per bracket)
 * by re-running the same gather + leaderboard pipeline the live
 * `/api/wcl/guild/.../attendance` endpoint already uses, then writing
 * one `parse_summary` row per user x bracket attached to their main
 * character (or first linked character when no main is set).
 */
async function runSyncParses() {
  const guildId = Number(eventsWclSpecIconGuildId() || votingGuildId);
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return { rowsChanged: 0 };
  }
  const reportLimit = Math.min(
    wclMaxGuildReportsLimit(),
    Math.max(80, Number(wclAttendanceRecentRaidCount?.() || 80))
  );

  let leaderboard = [];
  try {
    await ensureRhWclLinksStore();
    const { raidSnapshots, wclDisplayByLower, raidRankingPayloads } = await gatherAttendanceRaidSnapshots(
      guildId,
      reportLimit,
      { attendancePercentMetrics: true }
    );
    const linkedPayload = buildRhWclLinkedAttendanceLeaderboard(
      raidSnapshots,
      rhWclLinksState,
      Math.min(500, raidSnapshots.length ? 200 : 50),
      wclDisplayByLower,
      raidRankingPayloads
    );
    leaderboard = Array.isArray(linkedPayload?.leaderboard) ? linkedPayload.leaderboard : [];
  } catch (error) {
    console.warn("[sync:parses] gather/build pipeline failed:", error?.message || error);
    return { rowsChanged: 0 };
  }

  const entries = [];
  const seenCharacterIds = new Set();

  for (const row of leaderboard) {
    const rhKey = normalizeRaidHelperDisplayKey(String(row?.raidHelperName || row?.name || ""));
    if (!rhKey) continue;
    const user = identityUserGetByRaidHelperKey(rhKey);
    if (!user) continue;
    const characters = identityCharactersGetByUserId(user.id);
    if (!characters.length) continue;
    const mainCharacter = characters.find((c) => c.isMain) || characters[0];

    const ps = row?.parseSummaries;
    if (!ps || typeof ps !== "object") continue;

    const writeRow = (bracket, best, encounterField, reportCodeField, fightIdField) => {
      const bestValue = Number.isFinite(Number(best)) ? Number(best) : null;
      if (bestValue == null || bestValue <= 0) return;
      const cid = mainCharacter.id;
      if (seenCharacterIds.has(`${cid}:${bracket}`)) return;
      seenCharacterIds.add(`${cid}:${bracket}`);
      entries.push({
        characterId: cid,
        bracket,
        bestValue,
        bestEncounter: ps[encounterField] || null,
        bestReportCode: ps[reportCodeField] || null,
        bestFightId: ps[fightIdField] != null ? Number(ps[fightIdField]) : null,
        bestMetric: bracket === "heal" ? "hps" : "dps",
        bestAt: null,
        raidsInBracket: 0,
        encounterTopInBracket: ps[`${bracket}EncounterTop`] ? 1 : 0,
      });
    };

    writeRow("tank", ps.bestTank, "bestTankEncounter", "bestTankReportCode", "bestTankFightId");
    writeRow("heal", ps.bestHeal, "bestHealEncounter", "bestHealReportCode", "bestHealFightId");
    writeRow("dps", ps.bestDps, "bestDpsEncounter", "bestDpsReportCode", "bestDpsFightId");
  }

  const result = parseSummaryReplaceAll({ entries });
  return { rowsChanged: result?.rows || 0 };
}

registerSyncTask({
  id: "parses",
  intervalMs: 15 * 60_000,
  description: "Materialise per-character parse summaries (tank/heal/dps).",
  run: runSyncParses,
});

/**
 * Materialise loot awards by reusing the existing `fetchGuildLootReceived`
 * pipeline (which already merges WCL loot events with the gargul history
 * import). Each item is resolved to a canonical user / character via the
 * identity tables; orphans still get a row with `character_name` set.
 */
async function runSyncLoot() {
  const guildId = Number(votingGuildId);
  if (!Number.isInteger(guildId) || guildId <= 0) return { rowsChanged: 0 };
  const reportLimit = Math.min(40, Math.max(15, Number(wclAttendanceRecentRaidCount?.() || 30)));

  let payload;
  try {
    payload = await fetchGuildLootReceived(guildId, reportLimit);
  } catch (error) {
    console.warn("[sync:loot] fetchGuildLootReceived failed:", error?.message || error);
    return { rowsChanged: 0 };
  }
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) {
    lootAwardsReplaceAll({ entries: [] });
    return { rowsChanged: 0 };
  }

  /** Map of reportCode → uploader name pulled from the raids list, since
   *  the per-item rows from `fetchGuildLootReceived` don't carry it. */
  const uploaderByReportCode = new Map();
  for (const raid of payload?.allRaids || payload?.raids || []) {
    const code = String(raid?.reportCode || "");
    if (!code) continue;
    if (raid?.reportUploader && !uploaderByReportCode.has(code)) {
      uploaderByReportCode.set(code, String(raid.reportUploader));
    }
  }

  const entries = [];
  for (const item of items) {
    const itemId = Number(item?.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    const characterName = String(item?.recipient || "").trim();
    if (!characterName) continue;
    const reportCode = item?.reportCode ? String(item.reportCode) : null;
    const fightId = item?.fightId != null ? Number(item.fightId) : null;
    const source = String(item?.source || (item?.fromGargul ? "gargul" : "wcl")).trim().toLowerCase();
    const sourceRef = source === "gargul"
      ? (item?.gargulRowId ? `gargul:${item.gargulRowId}` : `gargul:${reportCode || ""}#${fightId || ""}`)
      : `${reportCode || ""}#${fightId != null ? fightId : ""}`;
    const awardedAt = Number.isFinite(Number(item?.reportStartTime))
      ? Math.floor(Number(item.reportStartTime))
      : Date.now();

    let owner = null;
    try {
      owner = identityResolveOwnerForCharacterName(characterName);
    } catch {
      owner = null;
    }
    entries.push({
      userId: owner?.userId || null,
      characterId: owner?.characterId || null,
      characterName,
      itemId,
      itemName: item?.itemName || null,
      awardedAt,
      source: source || "wcl",
      sourceRef,
      reportCode,
      reportTitle: item?.reportTitle || null,
      reportRaidName: item?.reportRaidName || null,
      reportUploader: reportCode ? uploaderByReportCode.get(reportCode) || null : null,
      rawType: item?.rawType || null,
    });
  }

  const result = lootAwardsReplaceAll({ entries });
  return { rowsChanged: result?.rows || 0 };
}

registerSyncTask({
  id: "loot",
  intervalMs: 30 * 60_000,
  description: "Materialise loot awards (WCL + gargul) and resolve canonical owners.",
  run: runSyncLoot,
});

startSyncRunner();

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
  ensureRoleAlertDmLogStore().catch((error) => {
    console.error("Failed to initialize role-alert DM log store:", error?.message || error);
  });
  startRaidHelperDmNotifier();
  ensureGargulLootHistoryStore().catch((error) => {
    console.error("Failed to initialize Gargul loot history store:", error?.message || error);
  });
  ensureNetherVortexStore().catch((error) => {
    console.error("Failed to initialize Nether Vortex store:", error?.message || error);
  });
  // Warm the Discord-ID → RH-signup-name cache so the first user opening the
  // Phase 2 demand table on a cold deploy gets canonical character names
  // immediately, without waiting for a stale-while-revalidate cycle. Run on
  // a delay so it doesn't compete with the initial WCL/RH bootstraps above.
  setTimeout(() => {
    refreshDiscordIdToRhNameCache().catch((error) => {
      console.warn("[discord-rh-cache] initial warm-up failed:", error?.message || error);
    });
  }, 5_000);
});
