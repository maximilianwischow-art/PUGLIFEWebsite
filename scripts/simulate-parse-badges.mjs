/**
 * Fetches attendance + active-roster from API_BASE and prints who earns the parsing-ceiling badge.
 * Usage: node scripts/simulate-parse-badges.mjs [http://localhost:8787]
 */
const API_BASE = process.argv[2] || "http://localhost:8787";
const GUILD_ID = 817080;

function finiteParseNum(x) {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function rosterBucketRoleName(roleName) {
  const low = String(roleName || "").trim().toLowerCase();
  if (low === "tank" || low === "tanks" || low === "schutz") return "Tanks";
  if (low === "healer" || low === "healers") return "Healers";
  if (low === "melee" || low === "mdps") return "Melee";
  if (low === "ranged" || low === "rdps" || low === "caster" || low === "casters") return "Ranged";
  const ROLE_ORDER = ["Tanks", "Healers", "Melee", "Ranged"];
  const r = String(roleName || "").trim();
  return ROLE_ORDER.includes(r) ? r : "Ranged";
}

function rosterParseBracketForRole(roleNameRaw) {
  const r = rosterBucketRoleName(roleNameRaw);
  if (r === "Healers") return "heal";
  if (r === "Tanks") return "tank";
  return "dps";
}

function rosterParseForDisplay(player, row) {
  const ps = row?.parseSummaries;
  const bracket = rosterParseBracketForRole(player?.roleName);
  if (!ps || typeof ps !== "object") {
    return { value: null, bracket, usedFallback: false };
  }

  let value = null;
  let usedFallback = false;
  const bt = finiteParseNum(ps.bestTank ?? ps.avgTank);
  const bd = finiteParseNum(ps.bestDps ?? ps.avgDps);
  const bh = finiteParseNum(ps.bestHeal ?? ps.avgHeal);
  const hasTankParse = bt != null && bt > 0;
  const hasHealParse = bh != null && bh > 0;

  if (bracket === "heal") {
    value = hasHealParse ? bh : bd;
    usedFallback = !hasHealParse && bd != null;
  } else if (bracket === "tank") {
    value = hasTankParse ? bt : bd;
    usedFallback = !hasTankParse && bd != null;
  } else {
    value = bd;
  }

  return {
    value: finiteParseNum(value),
    bracket,
    usedFallback,
  };
}

function parsePeakEqualsCeiling(value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m)) return false;
  return Math.abs(v - m) <= 0.02 + 1e-9;
}

function earningsBadge(player, row, parseCeilingMax, consideredRaids) {
  if (!row || consideredRaids <= 0) return false;
  const ps = row?.parseSummaries;
  const { value, bracket, usedFallback } = rosterParseForDisplay(player, row);
  let k = bracket === "heal" ? "heal" : bracket === "tank" ? "tank" : "dps";
  if (usedFallback && (bracket === "heal" || bracket === "tank")) {
    k = "dps";
  }
  if (ps && typeof ps === "object") {
    const hasEncounterFlags =
      ps.encounterTopTank !== undefined ||
      ps.encounterTopHeal !== undefined ||
      ps.encounterTopDps !== undefined;
    if (hasEncounterFlags) {
      if (k === "tank") return Boolean(ps.encounterTopTank);
      if (k === "heal") return Boolean(ps.encounterTopHeal);
      return Boolean(ps.encounterTopDps);
    }
  }
  if (value == null || !Number.isFinite(Number(value))) return false;
  const max = parseCeilingMax[k];
  if (max == null || !Number.isFinite(Number(max))) return false;
  return parsePeakEqualsCeiling(value, max);
}

async function main() {
  const attUrl = `${API_BASE}/api/wcl/guild/${GUILD_ID}/attendance?limit=40&top=250`;
  const rosterUrl = `${API_BASE}/api/wcl/guild/${GUILD_ID}/active-roster?limit=40&top=250`;

  const [attRes, rosterRes] = await Promise.all([fetch(attUrl), fetch(rosterUrl)]);
  const att = await attRes.json();
  const rosterPayload = await rosterRes.json();

  if (!attRes.ok) {
    console.error("Attendance failed:", att.error || attRes.status);
    process.exit(1);
  }

  const ceiling = att.parseCeilingMax || {};
  const parseCeilingMax = {
    tank: finiteParseNum(ceiling.tank),
    heal: finiteParseNum(ceiling.heal),
    dps: finiteParseNum(ceiling.dps),
  };

  console.log("consideredRaids:", att.consideredRaids);
  console.log("parseRankingReports:", att.parseRankingReports);
  console.log("parseCeilingMax:", parseCeilingMax);

  const leaderboardByName = new Map();
  for (const row of att.leaderboard || []) {
    const id = String(row?.raidHelperName || row?.name || "").trim();
    if (id) leaderboardByName.set(id.toLowerCase(), row);
  }

  const players = rosterPayload.players || [];
  const winners = [];
  for (const p of players) {
    const name = String(p.name || "").trim();
    const row = leaderboardByName.get(name.toLowerCase());
    const ok = earningsBadge(p, row, parseCeilingMax, att.consideredRaids);
    if (ok) {
      const { value, bracket, usedFallback } = rosterParseForDisplay(p, row);
      let k = bracket === "heal" ? "heal" : bracket === "tank" ? "tank" : "dps";
      if (usedFallback && (bracket === "heal" || bracket === "tank")) k = "dps";
      const ps = row?.parseSummaries;
      winners.push({
        name: p.name,
        role: p.roleName,
        bracket: k,
        value,
        max: parseCeilingMax[k],
        usedFallback,
        encounterTopTank: ps?.encounterTopTank,
        encounterTopHeal: ps?.encounterTopHeal,
        encounterTopDps: ps?.encounterTopDps,
      });
    }
  }

  console.log("\nParsing badge (per-encounter top among linked raiders, simulated):", winners.length, "player(s)");
  for (const w of winners) console.log(JSON.stringify(w));
  if (winners.length === 0) {
    console.log("\nNo qualifiers — checking top DPS vs ceiling...");
    for (const p of players.slice(0, 5)) {
      const row = leaderboardByName.get(String(p.name || "").toLowerCase());
      const ps = row?.parseSummaries;
      console.log(p.name, "role=", p.roleName, "bd=", ps?.bestDps, "row?", !!row);
    }
  }

  // Healer with heal=0 uses DPS fallback for bracket → badge uses encounterTopDps when flags exist.
  const teowRow = leaderboardByName.get("teowlee");
  if (teowRow) {
    const fakeHealer = { name: "Teowlee", characterName: "Teowlee", roleName: "Healers" };
    const ok = earningsBadge(fakeHealer, teowRow, parseCeilingMax, att.consideredRaids);
    const ps = teowRow?.parseSummaries;
    console.log(
      "\nTeowlee as Raid-Helper Healer (heal=0, uses DPS fallback) earns badge:",
      ok,
      "encounterTopDps=",
      ps?.encounterTopDps
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
