/**
 * Aggregate per-raid Hall of Fame rows into deduplicated player cards.
 */
import { normalizeRaidHelperDisplayKey } from "./rh-wcl-guess.mjs";

export function defaultHallOfFamePlayerKey(row) {
  const uid = Number(row?.player?.dbUserId);
  if (Number.isInteger(uid) && uid > 0) return `uid:${uid}`;
  const name = String(row?.winnerName || row?.player?.characterName || row?.player?.name || "").trim();
  const key = normalizeRaidHelperDisplayKey(name);
  return key ? `name:${key}` : "name:unknown";
}

/**
 * @param {object[]} rows enriched HoF winner rows (one per closed round)
 * @param {{ resolvePlayerKey?: (row: object) => string }} [options]
 */
export function aggregateHallOfFameByPlayer(rows, options = {}) {
  const resolvePlayerKey = options.resolvePlayerKey || defaultHallOfFamePlayerKey;
  const sorted = [...(Array.isArray(rows) ? rows : [])].sort(
    (a, b) => Number(b?.raidStartTime || 0) - Number(a?.raidStartTime || 0)
  );

  /** @type {Map<string, { playerKey: string, winnerName: string, player: object | null, wins: object[] }>} */
  const groups = new Map();

  for (const row of sorted) {
    const playerKey = resolvePlayerKey(row);
    if (!groups.has(playerKey)) {
      groups.set(playerKey, {
        playerKey,
        winnerName: String(row?.winnerName || "Unknown"),
        player: row?.player || null,
        wins: [],
      });
    }
    const group = groups.get(playerKey);
    group.wins.push(row);
    if (group.wins.length === 1) {
      group.winnerName = String(row?.winnerName || group.winnerName);
      group.player = row?.player || group.player;
    }
  }

  const players = [...groups.values()]
    .map((group) => {
      const wins = [...group.wins].sort(
        (a, b) => Number(b?.raidStartTime || 0) - Number(a?.raidStartTime || 0)
      );
      const latest = wins[0] || null;
      return {
        playerKey: group.playerKey,
        winnerName: String(latest?.winnerName || group.winnerName || "Unknown"),
        mvpCount: wins.length,
        latestRaidStartTime: Number(latest?.raidStartTime || 0),
        latestRaidName: String(latest?.raidName || latest?.raidCode || "").trim(),
        player: latest?.player || group.player,
        customQuote: String(
          latest?.customQuote ||
            wins.map((w) => String(w?.customQuote || "").trim()).find(Boolean) ||
            ""
        ),
        wins,
      };
    })
    .sort(
      (a, b) =>
        Number(b.mvpCount || 0) - Number(a.mvpCount || 0) ||
        Number(b.latestRaidStartTime || 0) - Number(a.latestRaidStartTime || 0)
    );

  return {
    hallOfFame: sorted,
    latestChampion: sorted[0] || null,
    players,
  };
}

export function buildHallOfFameApiPayload(rows, options = {}) {
  return aggregateHallOfFameByPlayer(rows, options);
}
