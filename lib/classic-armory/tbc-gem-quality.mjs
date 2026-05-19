/**
 * TBC socketed gem item rarity (tooltip quality):
 * green = Uncommon, blue = Rare, purple = Epic.
 *
 * Most Outland JC cuts (Living Ruby, Nightseye, Noble Topaz, Dawnstone, …) are
 * Rare-quality items. Epic is reserved for meta gems and T5/T6-tier cuts
 * (Crimson Sun, Stone of Blades, MH/BT gems, etc.).
 */

/** @type {Set<number>} */
const UNCOMMON_GEM_IDS = new Set([
  23094, 23095, 23096, 23097, 23100, 23110, 23114, 23118, 27777, 27785, 28461, 28465, 28466, 28469,
]);

/**
 * Standard TBC jewelcrafting cuts (blue tooltip) — 24xxx Outland rare-gem cuts.
 * @type {Set<number>}
 */
const RARE_GEM_IDS = new Set([
  24027, 24028, 24029, 24030, 24033, 24047, 24048, 24049, 24050, 24051, 24052, 24054, 24055, 24056, 24057,
  24058, 24059, 24060, 24061, 24062, 24063, 24064, 24065, 24066, 24067, 30549, 30550, 30554, 30564, 30590,
  30605, 30606, 31117,
]);

/** Meta + high-end raid / arena epic cuts (purple tooltip). */
const EPIC_GEM_IDS = new Set([
  25896, 25897, 25901, 28118, 28120, 28123, 28363, 30582, 30584, 30586, 30593, 30603, 30604, 31861, 31863,
  31867, 32409, 32836, 33131, 33143, 34220, 34831, 31116, 31118,
]);

/**
 * @param {number|null|undefined} itemId
 * @param {string} [itemName]
 * @returns {'green'|'blue'|'purple'|'unknown'}
 */
export function inferTbcGemQuality(itemId, itemName = "") {
  const id = Number(itemId);
  if (Number.isInteger(id) && id > 0) {
    if (UNCOMMON_GEM_IDS.has(id)) return "green";
    if (RARE_GEM_IDS.has(id)) return "blue";
    if (EPIC_GEM_IDS.has(id)) return "purple";
    // 24xxx cuts default to Rare unless listed as Epic above
    if (id >= 24000 && id < 25000) return "blue";
  }
  const n = String(itemName || "").toLowerCase();
  if (!n) return "unknown";
  if (/blood garnet|deep peridot|shadow draenite|golden draenite|azure moonstone|flame spessarite|tourmaline|zircon|rough /.test(n)) {
    return "green";
  }
  if (/earthstorm|skyfire|crimson sun|stone of blades|eye of the sea|deadly fire opal|pulsing amethyst|relentless|bracing|insightful|powerful/.test(n)) {
    return "purple";
  }
  if (/living ruby|dawnstone|nightseye|noble topaz|talasite|star of elune|fire opal|shadow pearl/.test(n)) {
    return "blue";
  }
  return "unknown";
}

export const GEM_QUALITY_LABEL = Object.freeze({
  green: "Uncommon",
  blue: "Rare",
  purple: "Epic",
  unknown: "?",
});
