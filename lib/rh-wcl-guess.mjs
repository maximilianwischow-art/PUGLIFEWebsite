/**
 * Heuristic Raid Helper display name ↔ Warcraft Logs character name matching.
 * Not ML — string similarity, prefixes, and common alt suffixes.
 */

/** @typedef {{ raidHelperName: string, wclCharacterNames: string[], wclSources?: string[], wclGuessConfidence?: number[], guildRole?: string }} RhWclLinkRow */

/** Canonical guild roles for Account Assignment (persisted on each roster row). */
export const RH_WCL_GUILD_ROLES = Object.freeze(["Peon", "Grunt", "Veteran", "Core", "Puglead", "Raidlead"]);

export function normalizeRhWclGuildRole(raw) {
  const s = String(raw ?? "").trim();
  if (s === "Guildlead") return "Puglead";
  return RH_WCL_GUILD_ROLES.includes(s) ? s : "Peon";
}

/** Mirrors server `normalizeRaidHelperDisplayKey` — keep in sync. */
export function normalizeRaidHelperDisplayKey(name) {
  let s = String(name || "")
    .trim()
    .replace(/\u00a0/g, " ");
  const slash = s.indexOf("/");
  if (slash > 0) s = s.slice(0, slash).trim();
  return s
    .replace(/\s*[-–—]\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-\s]*$/u, "")
    .toLowerCase();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * @returns {{ score: number, kind: string } | null}
 */
export function scoreRhWclPair(rhDisplay, wclDisplay) {
  const rhN = normalizeRaidHelperDisplayKey(rhDisplay);
  const wclN = normalizeRaidHelperDisplayKey(wclDisplay);
  if (!rhN || !wclN) return null;

  if (rhN === wclN) return { score: 100, kind: "exact" };

  if (wclN.startsWith(rhN) && rhN.length >= 3) {
    const bonus = Math.min(5, wclN.length - rhN.length);
    return { score: 94 + Math.min(4, bonus), kind: "guess_prefix" };
  }
  if (rhN.startsWith(wclN) && wclN.length >= 3) {
    return { score: 91, kind: "guess_prefix_rev" };
  }

  const altStripped = wclN.replace(/(bank|bmk|alt|main|heal|tank|bear|cat|boom|resto|tree)$/u, "");
  if (altStripped === rhN && altStripped.length >= 3) return { score: 89, kind: "guess_alt_suffix" };

  const maxLen = Math.max(rhN.length, wclN.length);
  const dist = levenshtein(rhN, wclN);
  const ratio = maxLen ? 1 - dist / maxLen : 0;

  if (dist === 1 && maxLen <= 14) return { score: Math.round(78 + ratio * 18), kind: "guess_fuzzy" };
  if (dist === 2 && maxLen >= 6 && maxLen <= 16) return { score: Math.round(72 + ratio * 12), kind: "guess_fuzzy_loose" };
  if (dist <= 2 && ratio >= 0.72 && maxLen <= 12) return { score: Math.round(70 + ratio * 10), kind: "guess_fuzzy_loose" };

  return null;
}

const MANUAL_SOURCE = "manual";

function rowKey(displayName) {
  return normalizeRaidHelperDisplayKey(displayName);
}

/** Unassigned rows (no linked WCL character names) first, then alphabetical by Raid Helper name. */
export function sortRhWclLinkRows(links) {
  const arr = Array.isArray(links) ? [...links] : [];
  arr.sort((a, b) => {
    const aN = Array.isArray(a?.wclCharacterNames) ? a.wclCharacterNames.filter(Boolean).length : 0;
    const bN = Array.isArray(b?.wclCharacterNames) ? b.wclCharacterNames.filter(Boolean).length : 0;
    const aUn = aN === 0;
    const bUn = bN === 0;
    if (aUn !== bUn) return aUn ? -1 : 1;
    return String(a?.raidHelperName || "").localeCompare(String(b?.raidHelperName || ""));
  });
  return arr;
}

/**
 * Merge heuristic assignments with existing saved links.
 * Existing WCL names stay attached to their Raid Helper row and stay `manual` unless already tagged.
 *
 * @param {RhWclLinkRow[]} existingLinks
 * @param {string[]} raidHelperDisplayNames from Raid Helper signups (unique displays)
 * @param {string[]} wclDisplayNames from recent logs
 * @param {{ minScore?: number, orphanMinScore?: number, keepEmptyRaidHelperRows?: boolean }} [opts]
 * @returns {{ links: RhWclLinkRow[], stats: object }}
 */
export function mergeRhWclGuess(existingLinks, raidHelperDisplayNames, wclDisplayNames, opts = {}) {
  const minScore = Number.isFinite(Number(opts.minScore)) ? Math.max(60, Math.min(99, Number(opts.minScore))) : 72;
  const orphanMin =
    Number.isFinite(Number(opts.orphanMinScore)) ? Math.max(55, Math.min(79, Number(opts.orphanMinScore))) : 62;
  const keepEmptyRaidHelperRows = opts.keepEmptyRaidHelperRows !== false;

  const conflicts = [];
  /** @type {Map<string, RhWclLinkRow>} — key = normalize RH key, value = working row */
  const byKey = new Map();

  const preservedRhKeys = new Set();
  for (const entry of Array.isArray(existingLinks) ? existingLinks : []) {
    const k = rowKey(String(entry?.raidHelperName || ""));
    if (k) preservedRhKeys.add(k);
  }

  const ensureRow = (rhDisplay) => {
    const k = rowKey(rhDisplay);
    if (!k) return null;
    let row = byKey.get(k);
    if (!row) {
      row = {
        raidHelperName: rhDisplay,
        wclCharacterNames: [],
        wclSources: [],
        wclGuessConfidence: [],
        guildRole: "Peon",
      };
      byKey.set(k, row);
    }
    return row;
  };

  /** wcl lower -> locked */
  const lockedWcl = new Set();

  for (const entry of Array.isArray(existingLinks) ? existingLinks : []) {
    const rh = String(entry?.raidHelperName || "").trim();
    if (!rh) continue;
    const row = ensureRow(rh);
    if (!row) continue;
    const names = Array.isArray(entry?.wclCharacterNames) ? entry.wclCharacterNames : [];
    const srcIn = Array.isArray(entry?.wclSources) ? entry.wclSources : [];
    const confIn = Array.isArray(entry?.wclGuessConfidence) ? entry.wclGuessConfidence : [];
    for (let i = 0; i < names.length; i++) {
      const wcl = String(names[i] || "").trim();
      if (!wcl) continue;
      const low = wcl.toLowerCase();
      if (lockedWcl.has(low)) continue;
      lockedWcl.add(low);
      row.wclCharacterNames.push(wcl);
      row.wclSources.push(String(srcIn[i] || MANUAL_SOURCE).trim() || MANUAL_SOURCE);
      const c = confIn[i];
      row.wclGuessConfidence.push(typeof c === "number" && Number.isFinite(c) ? Math.round(c) : null);
    }
    row.guildRole = normalizeRhWclGuildRole(entry?.guildRole);
  }

  const manualLockedWclCount = lockedWcl.size;

  const rhList = [...new Set(raidHelperDisplayNames.map((s) => String(s || "").trim()).filter(Boolean))];
  const wclList = [...new Set(wclDisplayNames.map((s) => String(s || "").trim()).filter(Boolean))];

  /** @type {{ rh: string, wcl: string, score: number, kind: string }[]} */
  const pairs = [];
  for (const rh of rhList) {
    for (const wcl of wclList) {
      const low = wcl.toLowerCase();
      if (lockedWcl.has(low)) continue;
      const sc = scoreRhWclPair(rh, wcl);
      if (!sc || sc.score < minScore) continue;
      pairs.push({ rh, wcl, score: sc.score, kind: sc.kind });
    }
  }

  pairs.sort((a, b) => b.score - a.score || a.wcl.localeCompare(b.wcl));

  let guessedPairs = 0;
  let skippedLowScore = 0;

  const claimedGuess = new Set();
  for (const p of pairs) {
    const low = p.wcl.toLowerCase();
    if (claimedGuess.has(low)) continue;
    const row = ensureRow(p.rh);
    if (!row) continue;
    claimedGuess.add(low);
    lockedWcl.add(low);
    row.wclCharacterNames.push(p.wcl);
    row.wclSources.push(p.kind);
    row.wclGuessConfidence.push(Math.round(p.score));
    guessedPairs += 1;
  }

  /** Best-effort: attach log names that scored below minScore onto the closest RH signup (never creates RH rows from WCL). */
  let orphanGuessPairs = 0;
  const orphanQueue = [];
  for (const wcl of wclList) {
    const wLow = wcl.toLowerCase();
    if (lockedWcl.has(wLow)) continue;
    let best = null;
    for (const rh of rhList) {
      const sc = scoreRhWclPair(rh, wcl);
      if (!sc || sc.score < orphanMin) continue;
      if (!best || sc.score > best.score || (sc.score === best.score && rh.localeCompare(best.rh) < 0))
        best = { rh, wcl, sc };
    }
    if (best) orphanQueue.push(best);
  }
  orphanQueue.sort((a, b) => b.sc.score - a.sc.score || a.wcl.localeCompare(b.wcl));
  for (const p of orphanQueue) {
    const low = p.wcl.toLowerCase();
    if (lockedWcl.has(low)) continue;
    const row = ensureRow(p.rh);
    if (!row) continue;
    lockedWcl.add(low);
    row.wclCharacterNames.push(p.wcl);
    const srcTag = p.sc.score < minScore ? `${p.sc.kind}_orphan` : p.sc.kind;
    row.wclSources.push(srcTag);
    row.wclGuessConfidence.push(Math.round(p.sc.score));
    orphanGuessPairs += 1;
  }

  for (const rh of rhList) {
    ensureRow(rh);
  }

  const rhKeySet = new Set(rhList.map((r) => rowKey(r)).filter(Boolean));

  const links = [...byKey.values()].filter((r) => {
    if (!String(r.raidHelperName || "").trim()) return false;
    if (r.wclCharacterNames.length > 0) return true;
    const k = rowKey(r.raidHelperName);
    if (preservedRhKeys.has(k)) return true;
    if (keepEmptyRaidHelperRows && rhKeySet.has(k)) return true;
    return false;
  });
  const unmatchedWclNames = wclList
    .filter((w) => !lockedWcl.has(w.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  return {
    links: sortRhWclLinkRows(links),
    stats: {
      guessedPairs,
      orphanGuessPairs,
      manualLockedWclCount,
      skippedLowScore,
      conflicts,
      rhCandidateCount: rhList.length,
      wclCandidateCount: wclList.length,
      minScore,
      orphanMinScore: orphanMin,
      unmatchedWclCount: unmatchedWclNames.length,
      unmatchedWclSample: unmatchedWclNames.slice(0, 80),
    },
  };
}
