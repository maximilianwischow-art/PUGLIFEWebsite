/** Achievement badges for top consumables users in the last 6 logged 25-man raids. */
export const CONSUMABLES_LAST6_LEADERBOARD_RAIDS = 6;

export const CONSUMABLES_LAST6_BADGE_IDS = Object.freeze([
  "consumables-last6-1st",
  "consumables-last6-2nd",
  "consumables-last6-3rd",
]);

export const CONSUMABLES_LAST6_BADGE_CATALOG = Object.freeze([
  {
    id: "consumables-last6-1st",
    name: "Consumables champion (last 6)",
    icon: "/images/achievements/consumables-last6-1st.png",
    phase: "performance",
    description:
      "Ranked #1 for tracked consumable uses (potions, scrolls, runes, flame cap) across the guild's last six logged 25-man raids.",
  },
  {
    id: "consumables-last6-2nd",
    name: "Consumables runner-up (last 6)",
    icon: "/images/achievements/consumables-last6-2nd.png",
    phase: "performance",
    description:
      "Ranked #2 for tracked consumable uses across the guild's last six logged 25-man raids.",
  },
  {
    id: "consumables-last6-3rd",
    name: "Consumables third place (last 6)",
    icon: "/images/achievements/consumables-last6-3rd.png",
    phase: "performance",
    description:
      "Ranked #3 for tracked consumable uses across the guild's last six logged 25-man raids.",
  },
]);

const RANK_BADGE_BY_DISTINCT = Object.freeze([
  "consumables-last6-1st",
  "consumables-last6-2nd",
  "consumables-last6-3rd",
]);

/**
 * Distinct-rank tiers from a consumables leaderboard player list.
 * Ties share a rank; the next distinct total starts the following tier.
 *
 * @param {Array<{ name?: string, totalUses?: number }>} players
 * @param {(name: string) => string} normalizeKey
 */
export function topThreeConsumablesRankKeys(players, normalizeKey) {
  const norm = typeof normalizeKey === "function" ? normalizeKey : (v) => String(v || "").trim().toLowerCase();
  /** @type {Map<number, Set<string>>} */
  const byDistinctRank = new Map([
    [1, new Set()],
    [2, new Set()],
    [3, new Set()],
  ]);
  /** @type {Array<{ rank: number, name: string, totalUses: number }>} */
  const topPlayers = [];

  const sorted = (Array.isArray(players) ? players : [])
    .map((p) => ({
      name: String(p?.name || "").trim(),
      totalUses: Number(p?.totalUses || 0),
    }))
    .filter((p) => p.name && p.totalUses > 0)
    .sort((a, b) => {
      if (b.totalUses !== a.totalUses) return b.totalUses - a.totalUses;
      return a.name.localeCompare(b.name);
    });

  let distinctRank = 0;
  let prevTotal = null;
  for (const player of sorted) {
    if (player.totalUses !== prevTotal) {
      distinctRank += 1;
      prevTotal = player.totalUses;
    }
    if (distinctRank > 3) break;
    const key = norm(player.name);
    if (key) byDistinctRank.get(distinctRank)?.add(key);
    topPlayers.push({ rank: distinctRank, name: player.name, totalUses: player.totalUses });
  }

  const trimmedTop = topPlayers.filter((row) => row.rank >= 1 && row.rank <= 3);

  return {
    rank1: byDistinctRank.get(1) || new Set(),
    rank2: byDistinctRank.get(2) || new Set(),
    rank3: byDistinctRank.get(3) || new Set(),
    topPlayers: trimmedTop,
  };
}

/**
 * @param {Set<string>} linkedKeys normalized character keys for one user
 * @param {{ rank1?: Set<string>, rank2?: Set<string>, rank3?: Set<string> }} rankKeys
 */
export function consumablesLeaderboardBadgeIdsForLinkedKeys(linkedKeys, rankKeys) {
  const keys = linkedKeys instanceof Set ? linkedKeys : new Set(linkedKeys || []);
  const earned = new Set();
  if ([...keys].some((k) => rankKeys?.rank1?.has(k))) earned.add("consumables-last6-1st");
  if ([...keys].some((k) => rankKeys?.rank2?.has(k))) earned.add("consumables-last6-2nd");
  if ([...keys].some((k) => rankKeys?.rank3?.has(k))) earned.add("consumables-last6-3rd");
  return earned;
}

export function consumablesLast6BadgeIdForDistinctRank(distinctRank) {
  const n = Math.floor(Number(distinctRank) || 0);
  return RANK_BADGE_BY_DISTINCT[n - 1] || null;
}
