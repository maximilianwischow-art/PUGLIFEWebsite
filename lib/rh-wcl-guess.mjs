/**
 * Heuristic Raid Helper display name ↔ Warcraft Logs character name matching.
 * Not ML — string similarity, prefixes, and common alt suffixes.
 */

/** @typedef {{ raidHelperName: string, wclCharacterNames: string[], wclSources?: string[], wclGuessConfidence?: number[], guildRole?: string, mainCharacterName?: string, verifiedAt?: string | null, discordUserId?: string, discordUserIdSource?: string }} RhWclLinkRow */

/** Canonical guild roles for Account Assignment (persisted on each roster row). */
export const RH_WCL_GUILD_ROLES = Object.freeze([
  "Peon",
  "Grunt",
  "Veteran",
  "Core",
  "Puglead",
  "Raidlead",
  "Dpslead",
  "Heallead",
]);

export function normalizeRhWclGuildRole(raw) {
  const s = String(raw ?? "").trim();
  if (s === "Guildlead") return "Puglead";
  const compact = s.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "puglead" || compact === "guildlead") return "Puglead";
  if (compact === "raidlead") return "Raidlead";
  if (compact === "dpslead") return "Dpslead";
  if (compact === "heallead") return "Heallead";
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
    if (entry?.verifiedAt) {
      const t = String(entry.verifiedAt).trim();
      if (t) row.verifiedAt = t;
    }
    const did = String(entry?.discordUserId || "").trim();
    if (/^\d{17,20}$/.test(did)) row.discordUserId = did;
    const didSrc = String(entry?.discordUserIdSource || "").trim();
    if (didSrc) row.discordUserIdSource = didSrc;
    const mainRaw = String(entry?.mainCharacterName || "").trim();
    if (mainRaw) {
      const mainMatch = row.wclCharacterNames.find((n) => n.toLowerCase() === mainRaw.toLowerCase());
      if (mainMatch) row.mainCharacterName = mainMatch;
    }
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
      unmatchedWclNames,
    },
  };
}

/**
 * Confidence classifier for a single (kind, score) pair on a merged row entry.
 * Used by both the background worker (split saved vs proposal) and the UI
 * (Verified vs Auto-matched vs Needs review chip).
 *
 * High-confidence: manual entries, exact matches, prefix matches (any score),
 * or any heuristic at score >= 85. Anything tagged `*_orphan` is always
 * low-confidence regardless of score (the suffix already encodes "below the
 * main threshold; best-effort attach").
 */
export function isHighConfidenceSource(kind, score) {
  const k = String(kind || "").trim();
  if (!k) return false;
  if (k.endsWith("_orphan")) return false;
  if (k === MANUAL_SOURCE) return true;
  if (k === "manual:proposal") return true;
  if (k === "exact" || k === "guess_prefix" || k === "guess_prefix_rev") return true;
  if (typeof score === "number" && Number.isFinite(score) && score >= 85) return true;
  return false;
}

/**
 * Diff a freshly merged result against the rows that were on disk before the
 * merge ran. Newly added WCL names get partitioned by `isHighConfidenceSource`:
 * high-confidence names stay on the row in `autoApplyLinks`, low-confidence
 * names are stripped out and emitted as `pendingProposals` entries that the UI
 * surfaces in the to-do panel for human Accept/Reject.
 *
 * The function never modifies the input arrays. `existingLinks` is matched by
 * `normalizeRaidHelperDisplayKey(raidHelperName)` so display-case differences
 * don't leak through.
 *
 * @param {{ links: RhWclLinkRow[], stats: object }} mergeResult
 * @param {RhWclLinkRow[]} existingLinks
 * @param {{ rejectedWclNames?: Set<string> }} [opts]
 * @returns {{ autoApplyLinks: RhWclLinkRow[], pendingProposals: Array<{wclCharacterName:string,suggestedRaidHelperName:string,score:number|null,kind:string}>, prunedNames: string[] }}
 */
export function splitMergeByConfidence(mergeResult, existingLinks, opts = {}) {
  const rejected =
    opts.rejectedWclNames instanceof Set
      ? opts.rejectedWclNames
      : new Set(Array.isArray(opts.rejectedWclNames) ? opts.rejectedWclNames : []);
  const rejectedLower = new Set([...rejected].map((s) => String(s || "").toLowerCase()));

  /** Map<rhKey, Set<wclLower>> — names already on disk before this merge. */
  const existingNamesByKey = new Map();
  for (const e of Array.isArray(existingLinks) ? existingLinks : []) {
    const k = rowKey(String(e?.raidHelperName || ""));
    if (!k) continue;
    const set = existingNamesByKey.get(k) || new Set();
    for (const n of Array.isArray(e?.wclCharacterNames) ? e.wclCharacterNames : []) {
      const v = String(n || "").trim();
      if (v) set.add(v.toLowerCase());
    }
    existingNamesByKey.set(k, set);
  }

  const autoApplyLinks = [];
  const pendingProposals = [];
  const prunedNames = [];

  for (const row of Array.isArray(mergeResult?.links) ? mergeResult.links : []) {
    const rh = String(row?.raidHelperName || "").trim();
    if (!rh) continue;
    const key = rowKey(rh);
    const previouslyOnRow = existingNamesByKey.get(key) || new Set();

    const names = Array.isArray(row.wclCharacterNames) ? row.wclCharacterNames : [];
    const sources = Array.isArray(row.wclSources) ? row.wclSources : [];
    const confs = Array.isArray(row.wclGuessConfidence) ? row.wclGuessConfidence : [];

    const keptNames = [];
    const keptSources = [];
    const keptConfs = [];

    for (let i = 0; i < names.length; i++) {
      const name = String(names[i] || "").trim();
      if (!name) continue;
      const low = name.toLowerCase();
      const kind = String(sources[i] || MANUAL_SOURCE).trim() || MANUAL_SOURCE;
      const score = typeof confs[i] === "number" && Number.isFinite(confs[i]) ? Math.round(confs[i]) : null;
      const wasExisting = previouslyOnRow.has(low);

      if (wasExisting) {
        keptNames.push(name);
        keptSources.push(kind);
        keptConfs.push(score);
        continue;
      }
      if (rejectedLower.has(low)) {
        prunedNames.push(name);
        continue;
      }
      if (isHighConfidenceSource(kind, score)) {
        keptNames.push(name);
        keptSources.push(kind);
        keptConfs.push(score);
        continue;
      }
      pendingProposals.push({
        wclCharacterName: name,
        suggestedRaidHelperName: rh,
        score,
        kind,
      });
      prunedNames.push(name);
    }

    autoApplyLinks.push({
      ...row,
      wclCharacterNames: keptNames,
      wclSources: keptSources,
      wclGuessConfidence: keptConfs,
    });
  }

  return { autoApplyLinks: sortRhWclLinkRows(autoApplyLinks), pendingProposals, prunedNames };
}

