import { debuffTrendRaidKeyFromTitle } from "./debuff-trend-snapshots.mjs";
import { parseWclTablePayload } from "./debuff-uptime.mjs";

/** Boss lists aligned with server `TRACKED_RAIDS` (TBC progression). */
export const TRACKED_RAIDS = {
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
  "Serpentshrine Cavern": [
    "Hydross the Unstable",
    "The Lurker Below",
    "Leotheras the Blind",
    "Fathom-Lord Karathress",
    "Morogrim Tidewalker",
    "Lady Vashj",
  ],
  "Tempest Keep": ["Al'ar", "Void Reaver", "High Astromancer Solarian", "Kael'thas Sunstrider"],
  "Hyjal Summit": [
    "Rage Winterchill",
    "Anetheron",
    "Kaz'rogal",
    "Azgalor",
    "Archimonde",
  ],
  "Black Temple": [
    "High Warlord Naj'entus",
    "Supremus",
    "Shade of Akama",
    "Teron Gorefiend",
    "Gurtogg Bloodboil",
    "Reliquary of Souls",
    "Mother Shahraz",
    "The Illidari Council",
    "Illidan Stormrage",
  ],
};

const TREND_KEY_TO_RAID = {
  ssc: "Serpentshrine Cavern",
  tk: "Tempest Keep",
  kara: "Karazhan",
  gruul: "Gruul's Lair",
  mag: "Magtheridon's Lair",
};

const DAMAGE_DONE_QUERY = `
  query WclRaidDamageDone($code: String!, $fightIds: [Int!]!) {
    reportData {
      report(code: $code) {
        damage: table(dataType: DamageDone, fightIDs: $fightIds)
      }
    }
  }
`;

function normalizeWclLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u2019|\u2018/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function chunkPositiveInts(ids, size) {
  const list = (Array.isArray(ids) ? ids : [])
    .map((n) => Math.floor(Number(n)))
    .filter((n) => Number.isInteger(n) && n > 0);
  const chunkSize = Math.max(1, Math.floor(Number(size) || 12));
  const out = [];
  for (let i = 0; i < list.length; i += chunkSize) out.push(list.slice(i, i + chunkSize));
  return out;
}

/** Infer tracked tier from boss names already stored on a snapshot. */
export function resolveRaidTiersFromBosses(bosses) {
  const names = new Set(
    (Array.isArray(bosses) ? bosses : [])
      .map((b) => normalizeWclLabel(b?.name))
      .filter(Boolean)
  );
  if (!names.size) return [];
  const matched = [];
  for (const [tier, list] of Object.entries(TRACKED_RAIDS)) {
    if (list.some((boss) => names.has(normalizeWclLabel(boss)))) matched.push(tier);
  }
  return matched;
}

/** Which tracked raid tiers this report night covers (title + filter key + bosses). */
export function resolveRaidTiersForReport({ title, raidKey, bosses } = {}) {
  const text = normalizeWclLabel(title);
  const hasGruul = text.includes("gruul");
  const hasMag = text.includes("mag");
  if (hasGruul && hasMag) return ["Gruul's Lair", "Magtheridon's Lair"];

  const fromKey = TREND_KEY_TO_RAID[String(raidKey || "").trim().toLowerCase()];
  if (fromKey) return [fromKey];

  const fromTitleKey = debuffTrendRaidKeyFromTitle(title);
  const fromTitle = fromTitleKey ? TREND_KEY_TO_RAID[fromTitleKey] : null;
  if (fromTitle) return [fromTitle];

  if (text.includes("serpentshrine") || /\bssc\b/.test(text)) return ["Serpentshrine Cavern"];
  if (text.includes("tempest") || text.includes("the eye") || /\btk\b/.test(text)) return ["Tempest Keep"];
  if (text.includes("karazhan") || /\bkara\b/.test(text)) return ["Karazhan"];
  if (hasGruul) return ["Gruul's Lair"];
  if (hasMag) return ["Magtheridon's Lair"];

  const fromBosses = resolveRaidTiersFromBosses(bosses);
  if (fromBosses.length) return fromBosses;

  return [];
}

/** Clear window + boss kill fight IDs for tracked tier(s) in this log. */
export function computeReportRaidMetrics(fights, tierNames) {
  const tiers = (Array.isArray(tierNames) ? tierNames : []).filter((n) => TRACKED_RAIDS[n]);
  if (!tiers.length) {
    return {
      clearDurationMs: null,
      isFullClear: false,
      bossesKilled: 0,
      bossesTotal: 0,
      fightIds: [],
    };
  }

  const allKills = [];
  const uniqueKilled = new Set();
  let bossesTotal = 0;

  for (const tier of tiers) {
    const bosses = TRACKED_RAIDS[tier];
    bossesTotal += bosses.length;
    const kills = (Array.isArray(fights) ? fights : []).filter(
      (fight) =>
        fight?.kill &&
        Number(fight?.encounterID || fight?.encounterId || 0) > 0 &&
        bossListMatchesFightName(bosses, fight.name)
    );
    for (const fight of kills) {
      uniqueKilled.add(`${tier}::${resolveBossCanonicalName(bosses, fight.name)}`);
      allKills.push(fight);
    }
  }

  const bossesKilled = uniqueKilled.size;
  const isFullClear = bossesTotal > 0 && bossesKilled === bossesTotal;
  let clearDurationMs = null;
  if (allKills.length) {
    const clearStart = Math.min(...allKills.map((fight) => Number(fight.startTime || 0)));
    const clearEnd = Math.max(...allKills.map((fight) => Number(fight.endTime || 0)));
    const clearMs = clearEnd - clearStart;
    if (Number.isFinite(clearMs) && clearMs > 0) clearDurationMs = clearMs;
  }

  const fightIds = [...new Set(allKills.map((fight) => Number(fight.id)).filter((id) => id > 0))];

  return {
    clearDurationMs,
    isFullClear,
    bossesKilled,
    bossesTotal,
    fightIds,
  };
}

function sumDamageTable(tableValue) {
  const parsed = parseWclTablePayload(tableValue);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  let sum = 0;
  for (const entry of entries) {
    const n = Number(entry?.total || 0);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

/** Sum DamageDone across boss kill fights (chunked for WCL limits). */
export async function fetchTotalDamageForFights(
  reportCode,
  fightIds,
  { queryWcl, maxFightIdsPerChunk = 12 } = {}
) {
  if (typeof queryWcl !== "function") throw new Error("queryWcl is required");
  const code = String(reportCode || "").trim();
  const ids = (Array.isArray(fightIds) ? fightIds : [])
    .map((n) => Math.floor(Number(n)))
    .filter((n) => n > 0);
  if (!code || !ids.length) return null;

  let total = 0;
  for (const chunk of chunkPositiveInts(ids, maxFightIdsPerChunk)) {
    const data = await queryWcl(DAMAGE_DONE_QUERY, { code, fightIds: chunk });
    total += sumDamageTable(data?.reportData?.report?.damage);
  }
  return total > 0 ? total : null;
}

export function raidStatsFromMetrics(metrics, totalDamage) {
  const clearDurationMs =
    metrics?.clearDurationMs != null && Number(metrics.clearDurationMs) > 0
      ? Number(metrics.clearDurationMs)
      : null;
  const damage = totalDamage != null && Number(totalDamage) > 0 ? Number(totalDamage) : null;
  let totalDps = null;
  if (damage != null && clearDurationMs != null) {
    const sec = clearDurationMs / 1000;
    if (sec > 0) totalDps = Math.round(damage / sec);
  }
  return {
    clearDurationMs,
    isFullClear: Boolean(metrics?.isFullClear),
    bossesKilled: Number(metrics?.bossesKilled || 0),
    bossesTotal: Number(metrics?.bossesTotal || 0),
    totalDamage: damage,
    totalDps,
  };
}

export async function buildReportRaidStats({
  reportCode,
  fights,
  title,
  raidKey,
  bosses,
  queryWcl,
  maxFightIdsPerChunk,
}) {
  const tierNames = resolveRaidTiersForReport({ title, raidKey, bosses });
  const metrics = computeReportRaidMetrics(fights, tierNames);
  if (!metrics.fightIds.length) {
    return raidStatsFromMetrics(metrics, null);
  }
  try {
    const totalDamage = await fetchTotalDamageForFights(reportCode, metrics.fightIds, {
      queryWcl,
      maxFightIdsPerChunk,
    });
    return raidStatsFromMetrics(metrics, totalDamage);
  } catch {
    return raidStatsFromMetrics(metrics, null);
  }
}
