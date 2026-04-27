import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

app.use(express.json({ limit: "24kb" }));

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
const allowedTbcZones = new Set(
  (process.env.WCL_ALLOWED_GAME_ZONES || DEFAULT_TBC_ZONES.join(","))
    .split(",")
    .map((zone) => zone.trim())
    .filter(Boolean)
);

let cachedToken = null;
let cachedTokenExpiresAt = 0;

// Explicit page routes keep frontend reachable in all environments.
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/events.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "events.html"));
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

function collectRankPercents(node, targetName, bucket) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectRankPercents(item, targetName, bucket);
    return;
  }
  if (typeof node !== "object") return;

  if (
    typeof node.name === "string" &&
    node.name.toLowerCase() === String(targetName || "").toLowerCase() &&
    typeof node.rankPercent === "number"
  ) {
    bucket.push(node.rankPercent);
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

function averageRoleRankPercent(rankingsPayload, roleKey, playerName) {
  const parsed = parseMaybeJson(rankingsPayload);
  if (!parsed || !playerName) return null;
  const fights = Array.isArray(parsed?.data) ? parsed.data : [];
  const values = [];
  for (const fight of fights) {
    const characters = fight?.roles?.[roleKey]?.characters;
    if (!Array.isArray(characters)) continue;
    const match = characters.find(
      (entry) => String(entry?.name || "").toLowerCase() === String(playerName).toLowerCase()
    );
    if (typeof match?.rankPercent === "number") {
      values.push(match.rankPercent);
    }
  }
  if (!values.length) return null;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function bestRoleParse(rankingsPayload, roleKey, playerName) {
  const parsed = parseMaybeJson(rankingsPayload);
  if (!parsed || !playerName) return null;
  const fights = Array.isArray(parsed?.data) ? parsed.data : [];

  let best = null;
  for (const fight of fights) {
    const characters = fight?.roles?.[roleKey]?.characters;
    if (!Array.isArray(characters)) continue;
    const match = characters.find(
      (entry) => String(entry?.name || "").toLowerCase() === String(playerName).toLowerCase()
    );
    if (typeof match?.rankPercent !== "number") continue;

    if (!best || match.rankPercent > best.rankPercent) {
      best = {
        rankPercent: match.rankPercent,
        bossName: fight?.encounter?.name || fight?.name || "Unknown boss",
        fightId: fight?.fightID || null,
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
    const roles = fight?.roles || {};
    for (const roleKey of ["tanks", "healers", "dps"]) {
      const chars = roles?.[roleKey]?.characters;
      if (!Array.isArray(chars)) continue;
      for (const char of chars) {
        const name = String(char?.name || "").trim();
        if (name) names.add(name);
      }
    }
  }
  return names;
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

function chunkPositiveInts(ids, chunkSize) {
  const uniq = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  const size = Math.max(1, chunkSize);
  const out = [];
  for (let i = 0; i < uniq.length; i += size) {
    out.push(uniq.slice(i, i + size));
  }
  return out;
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
    return "/raid-images/ssc.svg";
  }
  if (text.includes("kara") || text.includes("karazhan")) return "/raid-images/kara.png";
  // Distinct Blizzard encounter portraits (same boss icons WCL uses in rankings); assets.rpglogs.com hotlinks often 403 off-site.
  if (text.includes("magtheridon")) return "/raid-images/magtheridon.png";
  if (text.includes("gruul")) return "/raid-images/gruul.png";
  return "/raid-images/kara.png";
}

function raidImageFromRaidName(raidName) {
  const text = normalizeText(raidName || "");
  if (text.includes("serpentshrine") || text === "ssc") return "/raid-images/ssc.svg";
  if (text.includes("karazhan") || text === "kara") return "/raid-images/kara.png";
  if (text.includes("magtheridon")) return "/raid-images/magtheridon.png";
  if (text.includes("gruul")) return "/raid-images/gruul.png";
  return raidImageFromTitle(raidName || "");
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
    entry?.className ?? entry?.class ?? entry?.wowClass ?? entry?.playerClass ?? ""
  ).trim();
  if (/^\d+$/.test(s)) return "";
  return s;
}

/** Reuse filtered guild reports across endpoints so the dashboard does not queue 6 identical WCL pulls (GraphQL calls are serialized). */
function wclGuildReportsCacheTtlMs() {
  const n = Number(process.env.WCL_GUILD_REPORTS_CACHE_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(600_000, n);
  return 45_000;
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
  const serverId = process.env.RAID_HELPER_SERVER_ID || "711838953430319115";
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

app.get("/api/raid-helper/future-events", async (_req, res) => {
  const serverId = process.env.RAID_HELPER_SERVER_ID || "711838953430319115";
  const nowSec = Math.floor(Date.now() / 1000);
  const excludedClasses = new Set(["Absence", "Bench", "Tentative", "Late"]);

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

    const detailed = [];
    for (const event of future) {
      const detail = await fetchRaidHelperEventDetail(event.id);
      const signUps = Array.isArray(detail?.signUps) ? detail.signUps : [];

      const confirmedRoster = signUps
        .filter(
          (entry) =>
            String(entry?.status || "").toLowerCase() === "primary" &&
            !excludedClasses.has(raidHelperClassNameFromSignUpEntry(entry))
        )
        .map((entry) => ({
          name: String(entry?.name || ""),
          className: raidHelperClassNameFromSignUpEntry(entry),
          specName: String(entry?.specName || ""),
          roleName: String(entry?.roleName || ""),
        }))
        .filter((entry) => entry.name)
        .sort((a, b) => a.name.localeCompare(b.name));

      const rosterByRole = {
        Tanks: confirmedRoster.filter((x) => x.roleName === "Tanks").length,
        Healers: confirmedRoster.filter((x) => x.roleName === "Healers").length,
        Melee: confirmedRoster.filter((x) => x.roleName === "Melee").length,
        Ranged: confirmedRoster.filter((x) => x.roleName === "Ranged").length,
      };

      detailed.push({
        ...event,
        raidImage: raidImageFromTitle(`${event.title} ${event.description}`),
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
        rosterByRole,
        confirmedRoster,
      });
    }

    return res.json({
      serverId,
      count: detailed.length,
      events: detailed,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
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
        raidName: primaryTrackedRaidNameFromReport(recentRaidReport),
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

    const leaderboard = [...totals.entries()]
      .map(([name, deaths]) => ({ name, deaths }))
      .sort((a, b) => b.deaths - a.deaths)
      .slice(0, 5);

    return res.json({
      guildId,
      scannedReports,
      leaderboard,
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
  const top = Math.min(50, Math.max(5, Number(req.query.top || 25)));
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  try {
    const reports = await getFilteredGuildReportsForGuild(guildId, reportLimit);
    const trackedReports = reports
      .map((report) => {
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
        return { report, fightIds };
      })
      .filter((entry) => entry.fightIds.length > 0);

    const raidSnapshots = [];
    const cappedForAttendance = trackedReports.slice(0, wclPerReportDetailCap());

    for (const { report, fightIds } of cappedForAttendance) {
      const attendanceQuery = `
        query RaidAttendance($code: String!, $fightIds: [Int!]) {
          reportData {
            report(code: $code) {
              rankings: rankings(fightIDs: $fightIds, playerMetric: dps)
            }
          }
        }
      `;
      const attendeeNames = new Set();
      for (const chunk of chunkPositiveInts(fightIds, wclMaxFightIdsPerQuery())) {
        const data = await queryWcl(attendanceQuery, { code: report.code, fightIds: chunk });
        const chunkNames = attendeeNamesFromRankings(data?.reportData?.report?.rankings);
        for (const name of chunkNames) attendeeNames.add(name);
      }
      if (!attendeeNames.size) continue;

      raidSnapshots.push({
        reportCode: report.code,
        startTime: Number(report.startTime || 0),
        attendees: attendeeNames,
      });
    }

    const consideredRaids = raidSnapshots.length;
    const allPlayers = new Set();
    for (const raid of raidSnapshots) {
      for (const name of raid.attendees.keys()) allPlayers.add(name);
    }

    const leaderboard = [...allPlayers]
      .map((name) => {
        let raidsAttended = 0;
        const attendanceHistory = [];
        for (const raid of raidSnapshots) {
          const attended = raid.attendees.has(name);
          attendanceHistory.push(attended ? 1 : 0);
          if (!attended) continue;
          raidsAttended += 1;
        }
        return {
          name,
          raidsAttended,
          attendanceRate: consideredRaids > 0 ? (raidsAttended / consideredRaids) * 100 : 0,
          attendanceHistory,
        };
      })
      .sort(
        (a, b) =>
          b.raidsAttended - a.raidsAttended ||
          b.attendanceRate - a.attendanceRate ||
          a.name.localeCompare(b.name)
      )
      .slice(0, top);

    return res.json({
      guildId,
      consideredRaids,
      raids: raidSnapshots.map((raid) => ({ reportCode: raid.reportCode, startTime: raid.startTime })),
      leaderboard,
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

app.get("/api/wcl/guild/:guildId/loot-received", async (req, res) => {
  const guildId = Number(req.params.guildId);
  const reportLimit = Math.min(40, Math.max(5, Number(req.query.limit || 15)));
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

  try {
    const reportData = await queryWcl(reportsQuery, { guildId, limit: reportLimit });
    const reports = filterGuildRaidReports(reportData?.reportData?.reports?.data || []);
    const trackedReports = reports
      .map((report) => {
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
        return { report, fightIds };
      })
      .filter((entry) => entry.fightIds.length > 0);

    const receivedItems = [];
    const lootEventsCap = wclLootEventsLimit();
    for (const { report, fightIds } of trackedReports.slice(0, wclPerReportDetailCap())) {
      const lootQuery = `
        query LootEvents($code: String!, $fightIds: [Int!], $lootLimit: Int!) {
          reportData {
            report(code: $code) {
              events(fightIDs: $fightIds, dataType: All, limit: $lootLimit, filterExpression: "type='loot'") {
                data
              }
            }
          }
        }
      `;
      const events = [];
      for (const chunk of chunkPositiveInts(fightIds, wclMaxFightIdsPerQuery())) {
        const lootData = await queryWcl(lootQuery, {
          code: report.code,
          fightIds: chunk,
          lootLimit: lootEventsCap,
        });
        events.push(...(lootData?.reportData?.report?.events?.data || []));
      }

      for (const event of events) {
        const itemId = Number(event?.itemID || event?.itemId || 0);
        const recipient = String(event?.target?.name || event?.targetName || event?.name || "").trim();
        receivedItems.push({
          reportCode: report.code,
          reportTitle: report.title,
          reportStartTime: report.startTime,
          itemId: itemId > 0 ? itemId : null,
          itemName: event?.itemName || null,
          recipient: recipient || null,
          rawType: event?.type || null,
        });
      }
    }

    return res.json({
      guildId,
      reportsChecked: trackedReports.length,
      items: receivedItems,
      note:
        receivedItems.length === 0
          ? "No loot receipt events were returned by Warcraft Logs for the checked reports."
          : null,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unknown server error" });
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
});
