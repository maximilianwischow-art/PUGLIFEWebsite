/**
 * Pure transformer that distils per-character spec evidence from
 * Raid-Helper signup data into a single best `wow_spec` value per
 * `user_characters.character_name_key`.
 *
 * Used as the Tier 2 fallback (after WCL combat type) inside
 * `runSyncCharacterSpecsFromGuildSignals`. Players who never log a
 * fight but do sign up still get a usable `wow_spec` this way.
 *
 * The transformer is intentionally I/O-free: callers feed it the
 * payloads they've already fetched from `fetchRaidHelperEventDetail`.
 */

import { rhNameKey } from "../item-needs-db.mjs";
import { normalizeCombatTypeAsSpec } from "./wcl-combat-types.mjs";

/**
 * Mirror of `RAID_HELPER_FALSE_CLASS_SLUGS` in server.js: Raid Helper
 * sometimes drops the role bucket label into the spec/class column
 * ("Tank", "Healer", "DPS"). Those values must never end up as a spec.
 */
const ROLE_BUCKET_SLUGS = new Set([
  "tank",
  "tanks",
  "schutz",
  "healer",
  "healers",
  "heal",
  "melee",
  "ranged",
  "caster",
  "casters",
  "mdps",
  "rdps",
  "dps",
  "dd",
  "absence",
  "bench",
  "tentative",
  "late",
]);

/** Slugify with diacritic folding so "Schütze" / "Protéction" match. */
function slugify(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Read the spec field off a Raid-Helper signup entry, defensively
 * trying every shape the v3/v4 APIs have used. Returns "" when none
 * carry a non-empty value.
 */
export function specRawFromSignupEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  const candidates = [
    entry.specName,
    entry.cSpecName,
    entry.specialization,
    entry.specializationName,
    entry.spec,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return "";
}

/**
 * Map an RH signup spec string to its canonical TBC display value.
 * Drops role-bucket strings ("Tank", "Healer") and unknown values so
 * `wow_spec` always carries a real spec like "Arms" or "Holy". Also
 * folds RH's "Protection1" / "Protection2" duplicate-spec suffixes.
 */
export function normalizeSignupSpec(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const slug = slugify(trimmed);
  if (!slug) return "";
  if (ROLE_BUCKET_SLUGS.has(slug)) return "";
  // RH appends a digit when two players pick the same spec ("Protection1",
  // "Protection2") — collapse it back before normalising.
  const collapsed = slug.replace(/\d+$/, "");
  if (collapsed === "protection") return "Protection";
  // Reuse the WCL spec allowlist so the two sources land identical
  // values in `wow_spec`. RH spec labels and WCL combat types use the
  // same English vocabulary in TBC.
  return normalizeCombatTypeAsSpec(trimmed);
}

/**
 * Pull a comparable timestamp off either the event metadata or the
 * signup entry itself so newer signups beat older ones.
 *
 * @param {*} entry
 * @param {number} eventStartTime  ms epoch fallback when the entry
 *   carries no timestamp of its own.
 */
function entryTimestamp(entry, eventStartTime) {
  const candidates = [
    entry?.signupTimestamp,
    entry?.signupTime,
    entry?.signedUpAt,
    entry?.createdAt,
    entry?.entryTime,
    entry?.timestamp,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) {
      // RH sometimes returns seconds, sometimes ms. Anything below
      // ~year-2000-in-ms is almost certainly seconds.
      return n < 10_000_000_000 ? n * 1000 : n;
    }
  }
  return Number(eventStartTime || 0);
}

/**
 * Take a list of `{ eventId, startTime, signUps }` objects (each shaped
 * like a `fetchRaidHelperEventDetail` response) and return the most
 * recent valid signup-derived spec per `character_name_key`.
 *
 * @param {Array<{ eventId?: string, id?: string, startTime?: number, time?: number, signUps?: Array<any> }>} events
 * @returns {Map<string, {
 *   specName: string,
 *   characterName: string,
 *   eventId: string,
 *   signupAt: number,
 * }>}
 */
export function buildLatestSignupSpecMap(events) {
  /** @type {Map<string, { specName: string, characterName: string, eventId: string, signupAt: number }>} */
  const out = new Map();
  for (const ev of events || []) {
    if (!ev || typeof ev !== "object") continue;
    const eventId = String(ev.eventId || ev.id || "");
    const evStartRaw = Number(ev.startTime || ev.time || ev.start || 0);
    const evStart =
      evStartRaw < 10_000_000_000 ? evStartRaw * 1000 : evStartRaw;
    const signUps = Array.isArray(ev.signUps) ? ev.signUps : [];
    for (const entry of signUps) {
      const status = String(entry?.status || "").toLowerCase();
      if (status && status !== "primary") continue;
      const name = String(entry?.name || "").trim();
      const key = rhNameKey(name);
      if (!key) continue;
      const spec = normalizeSignupSpec(specRawFromSignupEntry(entry));
      if (!spec) continue;
      const at = entryTimestamp(entry, evStart);
      const prev = out.get(key);
      if (!prev || at > prev.signupAt) {
        out.set(key, {
          specName: spec,
          characterName: name,
          eventId,
          signupAt: at,
        });
      }
    }
  }
  return out;
}
