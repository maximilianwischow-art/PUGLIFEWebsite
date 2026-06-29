import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultCachePath = path.join(__dirname, "..", "..", "data", "best-parse-last-raid-keys.json");

/** True when any linked name key tied for the highest overall parse in the last 25-man raid. */
export function bestParseLastRaidEarnedForNameKeys(nameKeys, winnerKeys) {
  const keys = nameKeys instanceof Set ? nameKeys : new Set(nameKeys || []);
  const winners = winnerKeys instanceof Set ? winnerKeys : new Set(winnerKeys || []);
  for (const k of keys) {
    if (winners.has(String(k))) return true;
  }
  return false;
}

export async function readBestParseLastRaidCache(cachePath = defaultCachePath) {
  try {
    const raw = JSON.parse(await readFile(cachePath, "utf8"));
    return {
      reportCode: String(raw?.reportCode || "").trim(),
      startMs: Number(raw?.startMs || 0) || null,
      updatedAt: Number(raw?.updatedAt || 0),
      bestValue: Number.isFinite(Number(raw?.bestValue)) ? Number(raw.bestValue) : null,
      winnerKeys: new Set(Array.isArray(raw?.winnerKeys) ? raw.winnerKeys.map(String) : []),
    };
  } catch {
    return null;
  }
}

export async function writeBestParseLastRaidCache(payload, cachePath = defaultCachePath) {
  const dir = path.dirname(cachePath);
  await mkdir(dir, { recursive: true });
  const winnerKeys = payload?.winnerKeys instanceof Set ? [...payload.winnerKeys] : payload?.winnerKeys || [];
  const body = {
    reportCode: String(payload?.reportCode || "").trim(),
    startMs: Number(payload?.startMs || 0) || null,
    updatedAt: Number(payload?.updatedAt || Date.now()),
    bestValue: Number.isFinite(Number(payload?.bestValue)) ? Number(payload.bestValue) : null,
    winnerKeys: Array.isArray(winnerKeys) ? winnerKeys.map(String) : [],
  };
  const tmp = `${cachePath}.tmp`;
  await writeFile(tmp, JSON.stringify(body, null, 2), "utf8");
  await rename(tmp, cachePath);
  return body;
}
