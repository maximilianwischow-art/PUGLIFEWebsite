import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 8787);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

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
  "Gruul's Lair": ["Gruul the Dragonkiller"],
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

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

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

async function queryWcl(query, variables) {
  const token = await getAccessToken();
  const maxAttempts = 3;
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

    const delayMs = attempt * 800;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(
    `WCL API request failed (${lastStatus})${lastMessage ? `: ${lastMessage.slice(0, 180)}` : ""}`
  );
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    return "/raid-images/ssc.jpg";
  }
  if (text.includes("kara") || text.includes("karazhan")) return "/raid-images/kara.jpg";
  if (text.includes("gruul") || text.includes("magtheridon") || text.includes("maggi") || text.includes("mag")) {
    return "/raid-images/gruul-mag.jpg";
  }
  return "/raid-images/kara.jpg";
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
    const reports = data?.reportData?.reports?.data || [];

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
  const reportLimit = Math.min(60, Math.max(5, Number(req.query.limit || 20)));
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
    const reports = wclData?.reportData?.reports?.data || [];
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
            !excludedClasses.has(String(entry?.className || ""))
        )
        .map((entry) => ({
          name: String(entry?.name || ""),
          className: String(entry?.className || ""),
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
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
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
            fights {
              id
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
    const data = await queryWcl(query, { guildId, limit });
    const reports = data?.reportData?.reports?.data || [];

    const raidSummary = Object.entries(TRACKED_RAIDS).map(([raidName, bosses]) => {
      const bestByBoss = new Map();
      let bestClear = null;
      for (const report of reports) {
        const raidBossKills = (report.fights || []).filter(
          (fight) =>
            (fight?.gameZone?.name || "") === raidName &&
            fight?.kill &&
            Number(fight?.encounterID || 0) > 0 &&
            bosses.includes(fight.name)
        );

        const uniqueBossKills = new Set(raidBossKills.map((fight) => fight.name));
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
                reportStartTime: report.startTime,
              };
            }
          }
        }

        for (const fight of report.fights || []) {
          const zoneName = fight?.gameZone?.name || "";
          if (zoneName !== raidName) continue;
          if (!fight?.kill || Number(fight?.encounterID || 0) <= 0) continue;
          if (!bosses.includes(fight.name)) continue;

          const durationMs = Number(fight.endTime || 0) - Number(fight.startTime || 0);
          if (!Number.isFinite(durationMs) || durationMs <= 0) continue;

          const existing = bestByBoss.get(fight.name);
          if (!existing || durationMs < existing.durationMs) {
            bestByBoss.set(fight.name, {
              bossName: fight.name,
              durationMs,
              fightId: fight.id,
              reportCode: report.code,
              reportTitle: report.title,
              reportStartTime: report.startTime,
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

    return res.json({ guildId, raidSummary });
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

  const reportsQuery = `
    query GuildReports($guildId: Int!, $limit: Int!) {
      reportData {
        reports(guildID: $guildId, limit: $limit) {
          data {
            code
            title
            startTime
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
    const reportData = await queryWcl(reportsQuery, { guildId, limit });
    const reports = reportData?.reportData?.reports?.data || [];

    const recentRaidReport = reports.find((report) =>
      (report.fights || []).some((fight) => {
        const zoneName = fight?.gameZone?.name || "";
        return (
          Object.prototype.hasOwnProperty.call(TRACKED_RAIDS, zoneName) &&
          Number(fight?.encounterID || 0) > 0
        );
      })
    );

    if (!recentRaidReport) {
      return res.status(404).json({ error: "No tracked raid report found for this guild yet." });
    }

    const bossFightIds = (recentRaidReport.fights || [])
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

    const mvpData = await queryWcl(mvpQuery, { code: recentRaidReport.code, fightIds: bossFightIds });
    const report = mvpData?.reportData?.report;
    const damageTable = parseWclTable(report?.damage);
    const healingTable = parseWclTable(report?.healing);
    const tankingTable = parseWclTable(report?.tanking);
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
      const parseData = await queryWcl(parseQuery, { code: recentRaidReport.code, fightIds: bossFightIds });
      const rankings = parseData?.reportData?.report || {};
      bestParses = {
        dps: bestRoleParse(rankings.dpsRankings, "dps", dps?.name),
        heal: bestRoleParse(rankings.hpsRankings, "healers", heal?.name),
        tank: bestRoleParse(rankings.dpsRankings, "tanks", tank?.name),
      };
    } catch {
      // Parse rankings are non-critical; keep MVP payload functional if ranking metric/schema varies.
    }

    return res.json({
      raid: {
        code: recentRaidReport.code,
        title: recentRaidReport.title,
        startTime: recentRaidReport.startTime,
        endTime: recentRaidReport.endTime,
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
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
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
            fights {
              id
              encounterID
              name
              gameZone { name }
            }
          }
        }
      }
    }
  `;

  try {
    const reportData = await queryWcl(reportsQuery, { guildId, limit });
    const reports = reportData?.reportData?.reports?.data || [];
    const totals = new Map();
    let scannedReports = 0;

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

      const deathsData = await queryWcl(deathQuery, { code: report.code, fightIds });
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
  const reportLimit = Math.min(100, Math.max(10, Number(req.query.limit || 40)));
  const top = Math.min(50, Math.max(5, Number(req.query.top || 25)));
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
    const reports = reportData?.reportData?.reports?.data || [];
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

    for (const { report, fightIds } of trackedReports) {
      const attendanceQuery = `
        query RaidAttendance($code: String!, $fightIds: [Int!]) {
          reportData {
            report(code: $code) {
              rankings: rankings(fightIDs: $fightIds, playerMetric: dps)
            }
          }
        }
      `;
      const data = await queryWcl(attendanceQuery, { code: report.code, fightIds });
      const attendeeNames = attendeeNamesFromRankings(data?.reportData?.report?.rankings);
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
    const reports = reportData?.reportData?.reports?.data || [];
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
      const mvpData = await queryWcl(mvpQuery, { code: report.code, fightIds });
      const r = mvpData?.reportData?.report;
      const dps = normalizeFightEntry(topFromTable(parseWclTable(r?.damage), "total"));
      const heal = normalizeFightEntry(topFromTable(parseWclTable(r?.healing), "total"));
      const tank = normalizeFightEntry(topFromTable(parseWclTable(r?.tanking), "total"));

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
  const reportLimit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  const reportsQuery = `
    query GuildReports($guildId: Int!, $limit: Int!) {
      reportData {
        reports(guildID: $guildId, limit: $limit) {
          data {
            code
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
    const reports = reportData?.reportData?.reports?.data || [];
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
  const reportLimit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
  if (!Number.isInteger(guildId) || guildId <= 0) {
    return res.status(400).json({ error: "guildId must be a positive integer" });
  }

  const reportsQuery = `
    query GuildReports($guildId: Int!, $limit: Int!) {
      reportData {
        reports(guildID: $guildId, limit: $limit) {
          data {
            code
            fights {
              encounterID
              id
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
    const reports = reportData?.reportData?.reports?.data || [];
    const byBoss = new Map();

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
      if (fightIds.length) {
        const deathsQuery = `
          query ReportDeaths($code: String!, $fightIds: [Int!]) {
            reportData {
              report(code: $code) {
                deaths: table(dataType: Deaths, fightIDs: $fightIds)
              }
            }
          }
        `;
        const deathsData = await queryWcl(deathsQuery, { code: report.code, fightIds });
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
    const reports = reportData?.reportData?.reports?.data || [];
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
    for (const { report, fightIds } of trackedReports) {
      const lootQuery = `
        query LootEvents($code: String!, $fightIds: [Int!]) {
          reportData {
            report(code: $code) {
              events(fightIDs: $fightIds, dataType: All, limit: 5000, filterExpression: "type='loot'") {
                data
              }
            }
          }
        }
      `;
      const lootData = await queryWcl(lootQuery, { code: report.code, fightIds });
      const events = lootData?.reportData?.report?.events?.data || [];

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
