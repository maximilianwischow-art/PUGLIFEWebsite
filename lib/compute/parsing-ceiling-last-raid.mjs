import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultCachePath = path.join(__dirname, "..", "..", "data", "parsing-ceiling-last-raid-keys.json");

export {
  buildRhWclLinkedGroups,
  computeEncounterTopParserSets,
  computeEncounterTopParserSetsForRaid,
} from "./encounter-top-parsers.mjs";

function setsToArrays(topKeys) {
  const src = topKeys && typeof topKeys === "object" ? topKeys : {};
  return {
    tank: [...(src.tank || [])],
    heal: [...(src.heal || [])],
    dps: [...(src.dps || [])],
  };
}

function arraysToSets(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const src = row.topKeys && typeof row.topKeys === "object" ? row.topKeys : row;
  return {
    tank: new Set(Array.isArray(src.tank) ? src.tank.map(String) : []),
    heal: new Set(Array.isArray(src.heal) ? src.heal.map(String) : []),
    dps: new Set(Array.isArray(src.dps) ? src.dps.map(String) : []),
  };
}

/** True when any linked name key topped at least one encounter in the last raid (any bracket). */
export function parsingCeilingEarnedForNameKeys(nameKeys, topKeys) {
  const keys = nameKeys instanceof Set ? nameKeys : new Set(nameKeys || []);
  const tops = topKeys || { tank: new Set(), heal: new Set(), dps: new Set() };
  const all = new Set([...(tops.tank || []), ...(tops.heal || []), ...(tops.dps || [])]);
  for (const k of keys) {
    if (all.has(String(k))) return true;
  }
  return false;
}

export async function readParsingCeilingLastRaidCache(cachePath = defaultCachePath) {
  try {
    const raw = JSON.parse(await readFile(cachePath, "utf8"));
    return {
      reportCode: String(raw?.reportCode || "").trim(),
      startMs: Number(raw?.startMs || 0) || null,
      updatedAt: Number(raw?.updatedAt || 0),
      topKeys: arraysToSets(raw),
    };
  } catch {
    return null;
  }
}

export async function writeParsingCeilingLastRaidCache(payload, cachePath = defaultCachePath) {
  const dir = path.dirname(cachePath);
  await mkdir(dir, { recursive: true });
  const topKeys = payload?.topKeys || { tank: new Set(), heal: new Set(), dps: new Set() };
  const body = {
    reportCode: String(payload?.reportCode || "").trim(),
    startMs: Number(payload?.startMs || 0) || null,
    updatedAt: Number(payload?.updatedAt || Date.now()),
    topKeys: setsToArrays(topKeys),
  };
  const tmp = `${cachePath}.tmp`;
  await writeFile(tmp, JSON.stringify(body, null, 2), "utf8");
  await rename(tmp, cachePath);
  return body;
}
