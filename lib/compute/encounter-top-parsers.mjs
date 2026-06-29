import { normalizeRaidHelperDisplayKey } from "../rh-wcl-guess.mjs";

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function wclRankingEntryPercentile(entry) {
  if (!entry || typeof entry !== "object") return null;
  const a = Number(entry.rankPercent);
  if (Number.isFinite(a)) return a;
  const b = Number(entry.percentile);
  if (Number.isFinite(b)) return b;
  const rk = entry.rank;
  if (rk && typeof rk === "object") {
    const c = Number(rk.percentile ?? rk.rankPercent);
    if (Number.isFinite(c)) return c;
  }
  return null;
}

function wclRankingNoiseZeroAmountRow(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(entry, "amount")) return false;
  const amt = Number(entry.amount);
  return Number.isFinite(amt) && amt === 0;
}

function wclRankingCharacterDisplayName(entry) {
  if (!entry || typeof entry !== "object") return "";
  const n = String(entry.name || "").trim();
  if (n) return n;
  const ch = entry.character;
  if (ch && typeof ch === "object") return String(ch.name || "").trim();
  return "";
}

function fightCharactersForRole(fight, roleKeyPlural) {
  const roles = fight?.roles;
  if (!roles || typeof roles !== "object") return [];
  let bucket = roles[roleKeyPlural];
  if (!bucket?.characters) {
    if (roleKeyPlural === "tanks") bucket = roles.tank;
    else if (roleKeyPlural === "healers") bucket = roles.healer;
  }
  const chars = bucket?.characters;
  return Array.isArray(chars) ? chars : [];
}

function debugRankingsCharacterMatches(displayNameRaw, searchRaw) {
  const dn = String(displayNameRaw || "").trim().toLowerCase();
  const sn = String(searchRaw || "").trim().toLowerCase();
  if (dn && sn && dn === sn) return true;
  const kd = normalizeRaidHelperDisplayKey(displayNameRaw);
  const ks = normalizeRaidHelperDisplayKey(searchRaw);
  return Boolean(kd && ks && kd === ks);
}

export function resolveWclRankingsNameToRosterKey(groups, wclDisplayNameRaw, wclDisplayByLower) {
  const raw = String(wclDisplayNameRaw || "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  for (const g of groups.values()) {
    if (g.wclLower.has(low)) return normalizeRaidHelperDisplayKey(g.displayName);
  }
  const nTarget = normalizeRaidHelperDisplayKey(raw);
  for (const g of groups.values()) {
    const rk = normalizeRaidHelperDisplayKey(g.displayName);
    if (nTarget && (rk === nTarget || debugRankingsCharacterMatches(g.displayName, raw))) return rk;
    for (const altLow of g.wclLower) {
      const pretty = String(wclDisplayByLower?.get?.(altLow) ?? altLow ?? "").trim() || String(altLow);
      if (debugRankingsCharacterMatches(pretty, raw) || debugRankingsCharacterMatches(altLow, raw)) {
        return rk;
      }
      if (nTarget) {
        const nPretty = normalizeRaidHelperDisplayKey(pretty);
        const nAlt = normalizeRaidHelperDisplayKey(altLow);
        if (nPretty === nTarget || nAlt === nTarget) return rk;
      }
    }
  }
  return null;
}

function addEncounterTopKeysFromMergedMetric(mergedPayload, rolePlural, groups, wclDisplayByLower, outRosterKeySet) {
  const parsed = parseMaybeJson(mergedPayload);
  const fights = Array.isArray(parsed?.data) ? parsed.data : [];
  for (const fight of fights) {
    const chars = fightCharactersForRole(fight, rolePlural);
    const scored = [];
    for (const entry of chars) {
      if (wclRankingNoiseZeroAmountRow(entry)) continue;
      const nm = wclRankingCharacterDisplayName(entry);
      const rk = resolveWclRankingsNameToRosterKey(groups, nm, wclDisplayByLower);
      const rosterKey = rk || normalizeRaidHelperDisplayKey(nm);
      if (!rosterKey) continue;
      const pct = wclRankingEntryPercentile(entry);
      if (pct == null || !Number.isFinite(Number(pct))) continue;
      scored.push({ rk: rosterKey, pct: Number(pct) });
    }
    if (scored.length === 0) continue;
    const maxPct = Math.max(...scored.map((x) => x.pct));
    for (const row of scored) {
      if (Math.abs(row.pct - maxPct) <= 0.02 + 1e-9) outRosterKeySet.add(row.rk);
    }
  }
}

/** Encounter-top roster keys for one raid rankings payload (tied max percentile per fight). */
export function computeEncounterTopParserSetsForRaid(groups, rankingEntry, wclDisplayByLower) {
  const tank = new Set();
  const heal = new Set();
  const dps = new Set();
  if (!rankingEntry) return { tank, heal, dps };
  addEncounterTopKeysFromMergedMetric(rankingEntry?.mergedDps, "tanks", groups, wclDisplayByLower, tank);
  addEncounterTopKeysFromMergedMetric(rankingEntry?.mergedDps, "dps", groups, wclDisplayByLower, dps);
  addEncounterTopKeysFromMergedMetric(rankingEntry?.mergedHps, "healers", groups, wclDisplayByLower, heal);
  return { tank, heal, dps };
}

/** Encounter-top roster keys across every rankings payload in the window. */
export function computeEncounterTopParserSets(groups, raidRankingPayloads, wclDisplayByLower) {
  const tank = new Set();
  const heal = new Set();
  const dps = new Set();
  if (!Array.isArray(raidRankingPayloads)) return { tank, heal, dps };
  for (const entry of raidRankingPayloads) {
    const one = computeEncounterTopParserSetsForRaid(groups, entry, wclDisplayByLower);
    for (const k of one.tank) tank.add(k);
    for (const k of one.heal) heal.add(k);
    for (const k of one.dps) dps.add(k);
  }
  return { tank, heal, dps };
}

/** Seed display-name lookup from merged rankings payloads (for light single-report refresh). */
export function seedWclDisplayFromMergedRankings(mergedDps, mergedHps, wclDisplayByLower) {
  const map = wclDisplayByLower instanceof Map ? wclDisplayByLower : new Map();
  for (const payload of [mergedDps, mergedHps]) {
    const parsed = parseMaybeJson(payload);
    const fights = Array.isArray(parsed?.data) ? parsed.data : [];
    for (const fight of fights) {
      for (const role of ["tanks", "dps", "healers", "tank", "healer"]) {
        for (const entry of fightCharactersForRole(fight, role)) {
          const nm = wclRankingCharacterDisplayName(entry);
          const low = String(nm || "").trim().toLowerCase();
          if (low) map.set(low, nm);
        }
      }
    }
  }
  return map;
}

/** Ensure every name seen in rankings can map to a roster key (light refresh has no raid snapshot attendees). */
export function augmentGroupsFromWclDisplay(groups, wclDisplayByLower) {
  const out = groups instanceof Map ? groups : new Map();
  for (const [low, pretty] of wclDisplayByLower?.entries?.() || []) {
    const displayName = String(pretty || low || "").trim();
    const logicalKey = normalizeRaidHelperDisplayKey(displayName || low);
    if (!logicalKey) continue;
    const wclLower = new Set([String(low || "").trim().toLowerCase(), logicalKey].filter(Boolean));
    const prev = out.get(logicalKey);
    if (prev) {
      for (const n of wclLower) prev.wclLower.add(n);
    } else {
      out.set(logicalKey, { displayName: displayName || logicalKey, wclLower });
    }
  }
  return out;
}

/**
 * Build linked roster groups from RH/WCL links + raid attendee names (same as attendance leaderboard).
 * @param {object[]} raidSnapshots
 * @param {{ links?: object[] }} linksState
 * @param {Map<string, string>} wclDisplayByLower
 */
export function buildRhWclLinkedGroups(raidSnapshots, linksState, wclDisplayByLower) {
  const links = Array.isArray(linksState?.links) ? linksState.links : [];
  /** @type {Map<string, { displayName: string, wclLower: Set<string> }>} */
  const groups = new Map();

  for (const entry of links) {
    const displayName = String(entry?.raidHelperName || "").trim();
    if (!displayName) continue;
    const logicalKey = normalizeRaidHelperDisplayKey(displayName);
    const wclLower = new Set();
    for (const cn of Array.isArray(entry?.wclCharacterNames) ? entry.wclCharacterNames : []) {
      const low = String(cn || "").trim().toLowerCase();
      if (low) wclLower.add(low);
    }
    wclLower.add(logicalKey);
    const prev = groups.get(logicalKey);
    if (prev) {
      for (const n of wclLower) prev.wclLower.add(n);
    } else {
      groups.set(logicalKey, { displayName, wclLower });
    }
  }

  const allWclLower = new Set();
  for (const raid of raidSnapshots || []) {
    for (const n of raid.attendeesLower || []) allWclLower.add(n);
  }

  const claimedLower = new Set();
  for (const g of groups.values()) {
    for (const n of g.wclLower) claimedLower.add(n);
  }

  for (const low of allWclLower) {
    if (claimedLower.has(low)) continue;
    const pretty = wclDisplayByLower?.get?.(low) || low;
    groups.set(low, { displayName: pretty, wclLower: new Set([low]) });
  }

  return groups;
}
