import {
  debuffTrendRaidFilterMatches,
  debuffTrendRaidKeyFromTitle,
  debuffTrendRaidLabel,
} from "./debuff-trend-snapshots.mjs";

const PRIMARY_RAID_TO_KEY = {
  Karazhan: "kara",
  "Gruul's Lair": "gruul",
  "Magtheridon's Lair": "mag",
  "Serpentshrine Cavern": "ssc",
  "Tempest Keep": "tk",
};

export function raidKeyFromPrimaryRaid(primaryRaid) {
  const key = String(primaryRaid || "").trim();
  if (PRIMARY_RAID_TO_KEY[key]) return PRIMARY_RAID_TO_KEY[key];
  return debuffTrendRaidKeyFromTitle(key);
}

export function raidNameFromPrimaryRaid(primaryRaid) {
  const name = String(primaryRaid || "").trim();
  if (name) return name;
  return debuffTrendRaidLabel(raidKeyFromPrimaryRaid(primaryRaid)) || "—";
}

/** Mirrors Events roster `rosterParseBracketForRole`. */
export function parseBracketForRole(roleName) {
  const low = String(roleName || "").trim().toLowerCase();
  if (low === "tank" || low === "tanks" || low === "schutz") return "tank";
  if (low === "healer" || low === "healers") return "heal";
  return "dps";
}

function linkedWclNames(group, wclDisplayByLower) {
  return [...(group?.wclLower || [])]
    .sort()
    .map((low) => String(wclDisplayByLower?.get?.(low) || low || "").trim())
    .filter(Boolean);
}

/**
 * Per-report parse runs per bracket — extracted from `summarizeParsesForLinkedGroup`.
 * @param {Function} bracketParseFn — `bracketParseBestEncounterOneRaidDetailed`
 */
export function buildParseSeriesForLinkedGroup(group, raidRankingPayloads, wclDisplayByLower, bracketParseFn) {
  const empty = { tankRuns: [], dpsRuns: [], healRuns: [], names: [] };
  if (!group || !Array.isArray(raidRankingPayloads) || raidRankingPayloads.length === 0) return empty;
  if (typeof bracketParseFn !== "function") return empty;

  const names = linkedWclNames(group, wclDisplayByLower);
  const tankRuns = [];
  const dpsRuns = [];
  const healRuns = [];

  for (const entry of raidRankingPayloads) {
    const reportCode = String(entry?.reportCode || "");
    const reportStartTime = Number(entry?.startTime || 0);
    const primaryRaid = entry?.primaryRaid;
    const raidKey = raidKeyFromPrimaryRaid(primaryRaid);
    const raidName = raidNameFromPrimaryRaid(primaryRaid);
    const mergedDps = entry?.mergedDps;
    const mergedHps = entry?.mergedHps;

    const td = bracketParseFn(mergedDps, mergedHps, "tank", names);
    if (td) {
      tankRuns.push({
        ...td,
        bracket: "tank",
        reportCode,
        reportStartTime,
        raidKey,
        raidName,
        parsePct: td.percentile,
      });
    }

    const dd = bracketParseFn(mergedDps, mergedHps, "dps", names);
    if (dd) {
      dpsRuns.push({
        ...dd,
        bracket: "dps",
        reportCode,
        reportStartTime,
        raidKey,
        raidName,
        parsePct: dd.percentile,
      });
    }

    const hd = bracketParseFn(mergedDps, mergedHps, "heal", names);
    if (hd) {
      healRuns.push({
        ...hd,
        bracket: "heal",
        reportCode,
        reportStartTime,
        raidKey,
        raidName,
        parsePct: hd.percentile,
      });
    }
  }

  return { tankRuns, dpsRuns, healRuns, names };
}

/** Pick which bracket's per-event runs to graph (mirrors `rosterParseForDisplay` fallback). */
export function pickDisplayParseRuns(series, playerRole) {
  const bracket = parseBracketForRole(playerRole);
  const tankRuns = Array.isArray(series?.tankRuns) ? series.tankRuns : [];
  const dpsRuns = Array.isArray(series?.dpsRuns) ? series.dpsRuns : [];
  const healRuns = Array.isArray(series?.healRuns) ? series.healRuns : [];

  const hasTank = tankRuns.some((r) => r?.parsePct != null && Number.isFinite(Number(r.parsePct)));
  const hasHeal = healRuns.some((r) => r?.parsePct != null && Number.isFinite(Number(r.parsePct)));
  const hasDps = dpsRuns.some((r) => r?.parsePct != null && Number.isFinite(Number(r.parsePct)));

  if (bracket === "heal") {
    if (hasHeal) return { bracket: "heal", runs: healRuns, usedFallback: false };
    if (hasDps) return { bracket: "dps", runs: dpsRuns, usedFallback: true };
    return { bracket: "heal", runs: healRuns, usedFallback: false };
  }
  if (bracket === "tank") {
    if (hasTank) return { bracket: "tank", runs: tankRuns, usedFallback: false };
    if (hasDps) return { bracket: "dps", runs: dpsRuns, usedFallback: true };
    return { bracket: "tank", runs: tankRuns, usedFallback: false };
  }
  return { bracket: "dps", runs: dpsRuns, usedFallback: false };
}

export function filterSeriesByRaid(points, raidFilter) {
  const list = Array.isArray(points) ? points : [];
  const f = String(raidFilter || "all").trim().toLowerCase() || "all";
  if (!f || f === "all") return list;
  return list.filter((p) => debuffTrendRaidFilterMatches(p?.raidKey, f));
}

export function trendDeltaForSeries(points) {
  const scored = (Array.isArray(points) ? points : [])
    .map((p) => Number(p?.parsePct))
    .filter((n) => Number.isFinite(n));
  if (scored.length < 2) return null;
  return Math.round((scored[scored.length - 1] - scored[0]) * 10) / 10;
}

function attendeeSetForReport(raidSnapshots, reportCode) {
  const code = String(reportCode || "").trim();
  for (const snap of Array.isArray(raidSnapshots) ? raidSnapshots : []) {
    if (String(snap?.reportCode || "") === code) return snap.attendeesLower;
  }
  return null;
}

/** One display point per WCL report for the player's graph bracket. */
export function buildEventPointsForLinkedGroup(
  group,
  raidRankingPayloads,
  wclDisplayByLower,
  bracketParseFn,
  { playerRole = "", raidSnapshots = [] } = {}
) {
  const series = buildParseSeriesForLinkedGroup(group, raidRankingPayloads, wclDisplayByLower, bracketParseFn);
  const { bracket, runs } = pickDisplayParseRuns(series, playerRole);
  const wclLower = group?.wclLower;

  const points = runs
    .map((run) => {
      const attendees = attendeeSetForReport(raidSnapshots, run.reportCode);
      let attended = false;
      if (attendees && wclLower) {
        for (const n of wclLower) {
          if (attendees.has(n)) {
            attended = true;
            break;
          }
        }
      }
      return {
        reportCode: run.reportCode,
        reportStartTime: run.reportStartTime,
        raidKey: run.raidKey,
        raidName: run.raidName,
        parsePct: run.parsePct ?? run.percentile ?? null,
        bracket: run.bracket || bracket,
        encounterName: run.encounterName,
        fightId: run.fightId,
        wclCharacterName: run.wclCharacterName,
        metric: run.metric,
        attended,
      };
    })
    .sort((a, b) => Number(a.reportStartTime || 0) - Number(b.reportStartTime || 0));

  return { points, displayBracket: bracket, series };
}
