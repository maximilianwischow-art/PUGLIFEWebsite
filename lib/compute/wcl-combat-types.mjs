/**
 * Pure transformer that distils per-character combat type evidence from
 * Warcraft Logs samples (table entries or rankings characters) into a
 * single best `wow_spec` value per `user_characters.character_name_key`.
 *
 * Source-of-truth signal: the `type` field on a WCL `damageDone` /
 * `healing` / `damageTaken` table entry, which carries the player's
 * spec verbatim ("Arms", "Holy", "Protection", etc.). Rankings entries
 * sometimes carry the same data on `entry.spec` / `entry.class`, so the
 * caller can mix samples from both sources.
 *
 * Lives in `lib/compute/` so the in-server worker and any future CLI
 * can share it without dragging server.js along.
 */

import { rhNameKey } from "../item-needs-db.mjs";

/**
 * Canonical spec display labels for TBC. Maps the slugified raw value
 * we receive from WCL onto the form we want stored in
 * `user_characters.wow_spec`. Anything not in this map is rejected so
 * class names ("Warrior", "Mage", "Druid") never end up as a spec.
 */
const SPEC_DISPLAY_BY_SLUG = Object.freeze({
  // Warrior
  arms: "Arms",
  fury: "Fury",
  protection: "Protection",
  // Paladin
  holy: "Holy",
  retribution: "Retribution",
  // Hunter
  beastmastery: "Beast Mastery",
  marksmanship: "Marksmanship",
  survival: "Survival",
  // Rogue
  assassination: "Assassination",
  combat: "Combat",
  subtlety: "Subtlety",
  // Priest
  discipline: "Discipline",
  shadow: "Shadow",
  // Death Knight (kept for forward compat; not in TBC)
  blood: "Blood",
  unholy: "Unholy",
  // Shaman
  elemental: "Elemental",
  enhancement: "Enhancement",
  restoration: "Restoration",
  // Mage
  arcane: "Arcane",
  fire: "Fire",
  // Frost is shared with mage; mage spec wins when class is Mage,
  // shaman/death-knight callers should never reach `frost` as an
  // ambiguous spec because their class column already disambiguates.
  frost: "Frost",
  // Warlock
  affliction: "Affliction",
  demonology: "Demonology",
  destruction: "Destruction",
  // Druid
  balance: "Balance",
  feralcombat: "Feral Combat",
});

const SPEC_SLUG_ALLOWLIST = new Set(Object.keys(SPEC_DISPLAY_BY_SLUG));

/**
 * TBC talent tree order per class as returned by WCL `damageDone` /
 * `healing` table entries. Each entry's `talents[]` array has exactly
 * three elements; `talents[i].guid` is the number of points spent in
 * tree `i`. The spec is the tree with the most points.
 *
 * The class name is taken from `entry.type` (which on TBC carries
 * the class, not the spec — so the existing class-from-WCL behaviour
 * is preserved while we extract spec separately from talents).
 */
const SPEC_TREE_ORDER_BY_CLASS = Object.freeze({
  warrior: ["Arms", "Fury", "Protection"],
  paladin: ["Holy", "Protection", "Retribution"],
  hunter: ["Beast Mastery", "Marksmanship", "Survival"],
  rogue: ["Assassination", "Combat", "Subtlety"],
  priest: ["Discipline", "Holy", "Shadow"],
  shaman: ["Elemental", "Enhancement", "Restoration"],
  mage: ["Arcane", "Fire", "Frost"],
  warlock: ["Affliction", "Demonology", "Destruction"],
  druid: ["Balance", "Feral Combat", "Restoration"],
  deathknight: ["Blood", "Frost", "Unholy"],
});

/** Slugify with diacritic folding so "Protéction" still resolves. */
function specSlug(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Map a raw WCL combat-type / spec string onto its canonical display
 * form. Returns `""` when the input is empty or doesn't match a known
 * spec slug (e.g. when WCL gave us back the class name instead of the
 * spec, which happens on low-evidence fights).
 */
export function normalizeCombatTypeAsSpec(raw) {
  const slug = specSlug(raw);
  if (!slug || !SPEC_SLUG_ALLOWLIST.has(slug)) return "";
  return SPEC_DISPLAY_BY_SLUG[slug];
}

/**
 * Resolve a TBC spec from the class name + WCL talent point distribution.
 * On TBC, WCL `damageDone` / `healing` table entries carry a 3-element
 * `talents` array where `talents[i].guid` is the number of points spent
 * in tree `i`. The spec is the tree with the most points (ties broken by
 * tree order so Holy beats Retribution at the same point count, matching
 * what WCL displays in its UI).
 *
 * @param {string} className raw class string (e.g. "Shaman", "Druid")
 * @param {Array<{ guid?: number, type?: number }>|null|undefined} talents
 *   per-tree point arrays as returned by WCL
 * @returns {string} canonical spec display, or "" when no signal
 */
export function specFromClassAndTalents(className, talents) {
  if (!Array.isArray(talents) || talents.length < 3) return "";
  const classSlug = String(className || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const order = SPEC_TREE_ORDER_BY_CLASS[classSlug];
  if (!order) return "";
  const points = talents.slice(0, 3).map((t) => {
    const n = Number(t?.guid ?? t?.points ?? 0);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const total = points.reduce((s, n) => s + n, 0);
  // Need at least ~30 points spent to confidently pick a spec — anything
  // lower is almost certainly an alt with a respec in progress or WCL
  // failing to read the talent inspect packet on that pull.
  if (total < 30) return "";
  let bestIdx = 0;
  for (let i = 1; i < 3; i += 1) {
    if (points[i] > points[bestIdx]) bestIdx = i;
  }
  // Hybrid 31/30/0 builds (e.g. Druid SF/Resto, Paladin Holy/Prot) are
  // edge cases — pick the deepest tree, which is what WCL does too.
  return order[bestIdx] || "";
}

/**
 * Pick the best per-character spec across many samples. Each input
 * row is one observation of a character on one fight; the transformer
 * groups by `character_name_key` (matching the SQLite identity index)
 * and returns a single winning spec per character.
 *
 * Selection rule per character:
 *   1. Group identical normalised specs together.
 *   2. Score each group by `weight = hits + 1 if isKill else 0` so kill
 *      fights count double — they're more representative of the player's
 *      "real" spec than a wipe where they may have been using a backup
 *      build.
 *   3. Pick the highest-weighted spec. Tie-break by `latestStartTime`
 *      so a recent respec wins when it's eclipsed an older spec.
 *
 * @param {Array<{
 *   characterName: string,
 *   combatType: string,
 *   role?: "tanks"|"healers"|"dps",
 *   reportCode?: string,
 *   reportStartTime?: number,
 *   isKill?: boolean,
 * }>} samples
 * @returns {Map<string, {
 *   specName: string,
 *   characterName: string,
 *   role: string,
 *   hits: number,
 *   weight: number,
 *   reportCode: string,
 *   reportStartTime: number,
 * }>}
 */
export function buildLatestCombatTypeMap(samples) {
  /** @type {Map<string, Map<string, { hits: number, weight: number, latestStartTime: number, latestReport: string, latestRole: string, displayName: string }>>} */
  const byKey = new Map();
  for (const s of samples || []) {
    const name = String(s?.characterName || "").trim();
    const key = rhNameKey(name);
    if (!key) continue;
    const spec = normalizeCombatTypeAsSpec(s?.combatType);
    if (!spec) continue;
    let inner = byKey.get(key);
    if (!inner) {
      inner = new Map();
      byKey.set(key, inner);
    }
    let cur = inner.get(spec);
    if (!cur) {
      cur = {
        hits: 0,
        weight: 0,
        latestStartTime: 0,
        latestReport: "",
        latestRole: "",
        displayName: name,
      };
      inner.set(spec, cur);
    }
    cur.hits += 1;
    cur.weight += s?.isKill ? 2 : 1;
    const startTime = Number(s?.reportStartTime || 0);
    if (Number.isFinite(startTime) && startTime > cur.latestStartTime) {
      cur.latestStartTime = startTime;
      cur.latestReport = String(s?.reportCode || "");
      cur.latestRole = String(s?.role || "");
      if (name) cur.displayName = name;
    }
  }

  const out = new Map();
  for (const [key, specMap] of byKey) {
    let best = null;
    let bestSpec = "";
    for (const [spec, stats] of specMap) {
      if (
        !best ||
        stats.weight > best.weight ||
        (stats.weight === best.weight && stats.latestStartTime > best.latestStartTime)
      ) {
        best = stats;
        bestSpec = spec;
      }
    }
    if (best) {
      out.set(key, {
        specName: bestSpec,
        characterName: best.displayName,
        role: best.latestRole,
        hits: best.hits,
        weight: best.weight,
        reportCode: best.latestReport,
        reportStartTime: best.latestStartTime,
      });
    }
  }
  return out;
}

/**
 * Convenience: extract `{ characterName, combatType, role, reportCode,
 * reportStartTime, isKill }` samples from one merged WCL rankings
 * payload (the kind returned by `gatherAttendanceRaidSnapshots(...)
 * { attendancePercentMetrics: true }` in `mergedDps` / `mergedHps`).
 *
 * Defensively reads `entry.spec`, `entry.type`, `entry.class` so we
 * pick up whichever field WCL populates for the active TBC zone.
 *
 * @param {*} mergedRankings  parsed JSON rankings payload (`.data[]` of fights)
 * @param {string} reportCode
 * @param {number} reportStartTime
 * @returns {Array}
 */
export function combatTypeSamplesFromMergedRankings(
  mergedRankings,
  reportCode,
  reportStartTime
) {
  const samples = [];
  if (!mergedRankings || typeof mergedRankings !== "object") return samples;
  const fights = Array.isArray(mergedRankings.data) ? mergedRankings.data : [];
  const startTime = Number(reportStartTime || 0);
  const code = String(reportCode || "");
  for (const fight of fights) {
    const isKill = Boolean(fight?.kill ?? fight?.encounter?.kill ?? true);
    const roles = fight?.roles;
    if (!roles || typeof roles !== "object") continue;
    for (const roleKey of ["tanks", "healers", "dps"]) {
      const bucket = roles[roleKey] || roles[roleKey.replace(/s$/, "")];
      const characters = Array.isArray(bucket?.characters) ? bucket.characters : [];
      for (const c of characters) {
        const name = String(c?.name || c?.character?.name || "").trim();
        if (!name) continue;
        // Defensive field probe: `spec` is the most common, then `type`,
        // then `class`. We hand all three to the normaliser so whichever
        // one is the actual spec wins.
        const candidates = [c?.spec, c?.type, c?.specName, c?.class, c?.className]
          .map((v) => String(v || "").trim())
          .filter(Boolean);
        for (const cand of candidates) {
          if (normalizeCombatTypeAsSpec(cand)) {
            samples.push({
              characterName: name,
              combatType: cand,
              role: roleKey,
              reportCode: code,
              reportStartTime: startTime,
              isKill,
            });
            break;
          }
        }
      }
    }
  }
  return samples;
}

/**
 * Convenience: extract samples from a WCL `table(dataType: ...)` payload
 * (the kind `parseWclTable(...)` returns). On TBC the relevant fields
 * are:
 *
 *   - `entry.type`: class name (e.g. "Shaman") — NOT the spec.
 *   - `entry.talents[i].guid`: points spent in tree `i`.
 *
 * The transformer derives the spec via {@link specFromClassAndTalents}
 * and emits a sample carrying the canonical spec display string in
 * `combatType`. Entries without a usable talent distribution are
 * skipped so they don't pollute the most-frequent tally.
 *
 * @param {{ entries?: Array<any> } | null} table
 * @param {string} reportCode
 * @param {number} reportStartTime
 * @param {"dps"|"healers"|"tanks"} [role]
 */
export function combatTypeSamplesFromTable(table, reportCode, reportStartTime, role) {
  const samples = [];
  const entries = Array.isArray(table?.entries) ? table.entries : [];
  const startTime = Number(reportStartTime || 0);
  const code = String(reportCode || "");
  for (const entry of entries) {
    const name = String(entry?.name || "").trim();
    if (!name) continue;
    const className = String(entry?.type || "").trim();
    /** Talent-derived spec (TBC primary signal). */
    const specFromTalents = specFromClassAndTalents(className, entry?.talents);
    if (specFromTalents) {
      samples.push({
        characterName: name,
        combatType: specFromTalents,
        role: role || "dps",
        reportCode: code,
        reportStartTime: startTime,
        isKill: true,
      });
      continue;
    }
    /** Modern-WCL retail fallback: `type` already carries the spec. */
    if (className && normalizeCombatTypeAsSpec(className)) {
      samples.push({
        characterName: name,
        combatType: className,
        role: role || "dps",
        reportCode: code,
        reportStartTime: startTime,
        isKill: true,
      });
    }
  }
  return samples;
}
