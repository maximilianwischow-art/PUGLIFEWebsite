import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultCachePath = path.join(__dirname, "..", "..", "data", "consumables-leaderboard-last6-ranks.json");

function setsToArrays(rankKeys) {
  return {
    rank1: [...(rankKeys?.rank1 || [])],
    rank2: [...(rankKeys?.rank2 || [])],
    rank3: [...(rankKeys?.rank3 || [])],
  };
}

function arraysToSets(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const src = row.rankKeys && typeof row.rankKeys === "object" ? row.rankKeys : row;
  return {
    rank1: new Set(Array.isArray(src.rank1) ? src.rank1.map(String) : []),
    rank2: new Set(Array.isArray(src.rank2) ? src.rank2.map(String) : []),
    rank3: new Set(Array.isArray(src.rank3) ? src.rank3.map(String) : []),
  };
}

export async function readConsumablesLast6RanksCache(cachePath = defaultCachePath) {
  try {
    const raw = JSON.parse(await readFile(cachePath, "utf8"));
    return {
      updatedAt: Number(raw?.updatedAt || 0),
      reportsScanned: Number(raw?.reportsScanned || 0),
      fightsScanned: Number(raw?.fightsScanned || 0),
      topPlayers: Array.isArray(raw?.topPlayers) ? raw.topPlayers : [],
      rankKeys: arraysToSets(raw),
    };
  } catch {
    return null;
  }
}

export async function writeConsumablesLast6RanksCache(payload, cachePath = defaultCachePath) {
  const dir = path.dirname(cachePath);
  await mkdir(dir, { recursive: true });
  const body = {
    updatedAt: Number(payload?.updatedAt || Date.now()),
    reportsScanned: Number(payload?.reportsScanned || 0),
    fightsScanned: Number(payload?.fightsScanned || 0),
    topPlayers: Array.isArray(payload?.topPlayers) ? payload.topPlayers : [],
    rankKeys: setsToArrays(payload?.rankKeys),
  };
  const tmp = `${cachePath}.tmp`;
  await writeFile(tmp, JSON.stringify(body, null, 2), "utf8");
  await rename(tmp, cachePath);
  return body;
}
