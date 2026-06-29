/**
 * Prints who earns the parsing-ceiling badge from last-raid encounter-top cache + leaderboard bundle.
 * Usage: node scripts/simulate-parse-badges.mjs [http://localhost:8787]
 */
const API_BASE = process.argv[2] || "http://localhost:8787";
const GUILD_ID = 817080;

function normalizeKey(name) {
  let s = String(name || "")
    .trim()
    .replace(/\u00a0/g, " ");
  const slash = s.indexOf("/");
  if (slash > 0) s = s.slice(0, slash).trim();
  return s
    .replace(/\s*[-–—]\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-\s]*$/u, "")
    .toLowerCase();
}

function earnedFromLastRaidCache(player, cache) {
  const tops = cache?.topKeys;
  if (!tops) return false;
  const keys = new Set();
  for (const cn of [
    player?.name,
    player?.characterName,
    player?.mainCharacterName,
    player?.raidHelperName,
  ]) {
    const k = normalizeKey(cn);
    if (k) keys.add(k);
  }
  const all = new Set([...(tops.tank || []), ...(tops.heal || []), ...(tops.dps || [])]);
  for (const k of keys) {
    if (all.has(k)) return true;
  }
  return false;
}

async function main() {
  const leaderboardUrl = `${API_BASE}/api/leaderboard?guildId=${GUILD_ID}`;
  const healthUrl = `${API_BASE}/api/health`;

  const [lbRes, healthRes] = await Promise.all([fetch(leaderboardUrl), fetch(healthUrl)]);
  const lb = await lbRes.json();
  const health = await healthRes.json().catch(() => ({}));

  if (!lbRes.ok || !lb?.ok) {
    console.error("Leaderboard failed:", lb?.error || lbRes.status);
    process.exit(1);
  }

  console.log("buildId:", health?.buildId || "(unknown)");
  console.log("lastRaid:", lb.lastRaid || null);
  console.log("players:", (lb.players || []).length);

  const winners = [];
  for (const p of lb.players || []) {
    const earnedIds = Array.isArray(p.earnedBadgeIds) ? p.earnedBadgeIds : [];
    const pre = p?.preResolvedBadges?.parsingCeiling === true;
    const inEarned = earnedIds.includes("parsing-ceiling");
    if (pre || inEarned) {
      winners.push({
        name: p.name || p.raidHelperName || p.mainCharacterName,
        preResolvedParsingCeiling: pre,
        inEarnedBadgeIds: inEarned,
        encounterTopTank: p?.parseSummaries?.encounterTopTank,
        encounterTopHeal: p?.parseSummaries?.encounterTopHeal,
        encounterTopDps: p?.parseSummaries?.encounterTopDps,
      });
    }
  }

  console.log("\nParsing ceiling (last raid, from /api/leaderboard):", winners.length, "player(s)");
  for (const w of winners) console.log(JSON.stringify(w));

  if (winners.length === 0) {
    console.log("\nNo qualifiers in bundle — cache may be empty until sync:parses runs.");
    const sample = (lb.players || []).slice(0, 5);
    for (const p of sample) {
      console.log(
        p.name || p.raidHelperName,
        "earnedBadgeIds=",
        (p.earnedBadgeIds || []).slice(0, 8).join(",")
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
