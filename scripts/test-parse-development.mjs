import {
  buildParseSeriesForLinkedGroup,
  buildEventPointsForLinkedGroup,
  filterSeriesByRaid,
  isCoreParseEligibleGuildRole,
  pickDisplayParseRuns,
  raidKeyFromPrimaryRaid,
  resolveParseDisplayCombatRole,
  trendDeltaForSeries,
} from "../lib/wcl/parse-development.mjs";

function mockBracketParse(mergedDps, mergedHps, bracketKey, names) {
  const code = mergedDps?.code || mergedHps?.code || "";
  const pctByBracket = {
    tank: mergedDps?.tankPct,
    dps: mergedDps?.dpsPct,
    heal: mergedHps?.healPct,
  };
  const pct = pctByBracket[bracketKey];
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  return {
    percentile: Number(pct),
    encounterName: `${bracketKey}-boss`,
    fightId: 12,
    wclCharacterName: names[0] || "Player",
    metric: bracketKey === "heal" ? "hps" : "dps",
  };
}

const group = {
  displayName: "Testraider",
  wclLower: new Set(["testchar"]),
};

const raidRankingPayloads = [
  {
    reportCode: "abc111",
    startTime: 1_700_000_000,
    primaryRaid: "Serpentshrine Cavern",
    mergedDps: { code: "abc111", tankPct: 55, dpsPct: 72 },
    mergedHps: { code: "abc111", healPct: null },
  },
  {
    reportCode: "abc222",
    startTime: 1_700_086_400,
    primaryRaid: "Karazhan",
    mergedDps: { code: "abc222", tankPct: null, dpsPct: 81 },
    mergedHps: { code: "abc222", healPct: null },
  },
  {
    reportCode: "abc333",
    startTime: 1_700_172_800,
    primaryRaid: "Serpentshrine Cavern",
    mergedDps: { code: "abc333", tankPct: null, dpsPct: 88 },
    mergedHps: { code: "abc333", healPct: null },
  },
];

const wclDisplayByLower = new Map([["testchar", "Testchar"]]);
const series = buildParseSeriesForLinkedGroup(group, raidRankingPayloads, wclDisplayByLower, mockBracketParse);

console.assert(series.dpsRuns.length === 3, "three dps runs");
console.assert(series.tankRuns.length === 1, "one tank run");
console.assert(raidKeyFromPrimaryRaid("Serpentshrine Cavern") === "ssc", "ssc raid key");
console.assert(raidKeyFromPrimaryRaid("Karazhan") === "kara", "kara raid key");

const displayRuns = pickDisplayParseRuns(series, "Ranged");
console.assert(displayRuns.bracket === "dps", "ranged maps to dps runs");
console.assert(displayRuns.runs.length === 3, "three display runs");

const built = buildEventPointsForLinkedGroup(group, raidRankingPayloads, wclDisplayByLower, mockBracketParse, {
  playerRole: "Ranged",
  raidSnapshots: [
    { reportCode: "abc111", attendeesLower: new Set(["testchar"]) },
    { reportCode: "abc222", attendeesLower: new Set(["other"]) },
    { reportCode: "abc333", attendeesLower: new Set(["testchar"]) },
  ],
});
console.assert(built.points.length === 3, "three event points");
console.assert(built.points[0].attended === true, "first event attended");
console.assert(built.points[1].attended === false, "second event not attended");
console.assert(built.points[2].parsePct === 88, "latest parse");

const sscOnly = filterSeriesByRaid(built.points, "ssc");
console.assert(sscOnly.length === 2, "ssc filter keeps two nights");

const delta = trendDeltaForSeries(built.points);
console.assert(delta === 16, `trend delta 16 got ${delta}`);

console.assert(isCoreParseEligibleGuildRole("Core"), "Core eligible");
console.assert(isCoreParseEligibleGuildRole("Raidlead"), "Raidlead eligible");
console.assert(!isCoreParseEligibleGuildRole("Veteran"), "Veteran not eligible");

const bxziRole = resolveParseDisplayCombatRole({
  guildRole: "Core",
  rhRoleName: "Ranged",
  className: "Hunter",
  specName: "Marksmanship",
});
console.assert(bxziRole === "Ranged", `bxzi-style hunter is ranged, got ${bxziRole}`);

const tankParseNoise = resolveParseDisplayCombatRole({
  guildRole: "Core",
  rhRoleName: "Ranged",
});
console.assert(tankParseNoise === "Ranged", "RH ranged beats incidental tank parse");

const healLead = resolveParseDisplayCombatRole({ guildRole: "Heallead", rhRoleName: "Tanks" });
console.assert(healLead === "Healers", "Heallead pins heal bracket");

const baseUrl = process.argv[2];
if (baseUrl) {
  const url = new URL("/api/raid-lead/core-parse-development", baseUrl);
  url.searchParams.set("limit", "5");
  const res = await fetch(url, { credentials: "include" });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    console.warn("[smoke] API skipped or failed:", payload?.error || res.status);
  } else {
    console.log("[smoke] ok", {
      players: payload.players?.length,
      reports: payload.meta?.reportCount,
    });
  }
}

console.log("ok", {
  dpsRuns: series.dpsRuns.length,
  sscPoints: sscOnly.length,
  trendDelta: delta,
});
