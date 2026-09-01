/**
 * Guild-tracked TBC consumables — count uses per raider from WCL cast/buff events.
 * Spell IDs verified on Fresh WCL reports (see scripts/probe-consumables-usage.mjs).
 */

/** @typedef {"cast"|"buff"} UsageCountMethod */

/**
 * @param {string} key
 * @param {string} name
 * @param {number|number[]} spellId
 * @param {UsageCountMethod} countMethod
 * @param {number} [itemId]
 */
function usageRow(key, name, spellId, countMethod, itemId = 0) {
  const ids = (Array.isArray(spellId) ? spellId : [spellId]).filter((id) => Number(id) > 0);
  return {
    key,
    name,
    spellId: ids[0] || 0,
    spellIds: ids,
    countMethod,
    itemId: Number(itemId) || 0,
  };
}

/** @type {readonly object[]} */
export const TBC_FLASK_USAGE_ROWS = Object.freeze([
  usageRow("flask-blinding-light", "Flask of Blinding Light", 28521, "buff", 22861),
  usageRow("flask-chromatic-resistance", "Flask of Chromatic Resistance", [28542, 42735], "buff", 22849),
  usageRow("flask-chromatic-wonder", "Flask of Chromatic Wonder", [28541, 42735], "buff", 33208),
  usageRow("flask-fortification", "Flask of Fortification", 28518, "buff", 22851),
  usageRow("flask-mighty-restoration", "Flask of Mighty Restoration", 28519, "buff", 22853),
  usageRow("flask-pure-death", "Flask of Pure Death", 28540, "buff", 22866),
  usageRow("flask-relentless-assault", "Flask of Relentless Assault", 28520, "buff", 22854),
  usageRow("flask-supreme-power", "Flask of Supreme Power", 28505, "buff", 13512),
]);

/** @type {readonly object[]} */
export const TBC_USAGE_CONSUMABLES = Object.freeze([
  usageRow("haste-potion", "Haste Potion", 28507, "cast", 22838),
  usageRow("destruction-potion", "Destruction Potion", 28508, "cast", 22839),
  usageRow("fel-mana-potion", "Fel Mana Potion", 38929, "cast-or-buff", 22832),
  usageRow("super-mana-potion", "Super Mana Potion", 28530, "cast-or-buff", 22836),
  usageRow("mana-potion-injector", "Mana Potion Injector", 38931, "cast", 33093),
  usageRow("scroll-agility-v", "Scroll of Agility V", 33077, "cast-or-buff", 27498),
  usageRow("scroll-strength-v", "Scroll of Strength V", 33079, "cast-or-buff", 27503),
  usageRow("scroll-spirit-v", "Scroll of Spirit V", 33081, "cast-or-buff", 27501),
  ...TBC_FLASK_USAGE_ROWS,
  usageRow("dark-rune", "Dark Rune", 27869, "cast", 20520),
  usageRow("demonic-rune", "Demonic Rune", 16666, "cast", 12662),
  usageRow("flame-cap", "Flame Cap", 28714, "cast", 22788),
]);

/** Combat/mana pots tracked for Marks decisions — flasks are tracked separately (all TBC flasks). */
export const TBC_P3_MARKS_POTION_KEYS = Object.freeze([
  "haste-potion",
  "destruction-potion",
  "fel-mana-potion",
  "super-mana-potion",
  "mana-potion-injector",
]);

/** Phase 3 Marks — every TBC flask plus selected combat/mana consumables. */
export const TBC_P3_MARKS_USAGE_KEYS = Object.freeze([
  ...TBC_FLASK_USAGE_ROWS.map((row) => row.key),
  ...TBC_P3_MARKS_POTION_KEYS,
]);

const p3MarksKeySet = new Set(TBC_P3_MARKS_USAGE_KEYS);

const P3_MARKS_SHORT_LABELS = Object.freeze({
  "flask-blinding-light": "Blinding",
  "flask-chromatic-resistance": "Chroma Res",
  "flask-chromatic-wonder": "Chroma Won",
  "flask-fortification": "Fort",
  "flask-mighty-restoration": "Rest",
  "flask-relentless-assault": "Relentless",
  "flask-supreme-power": "Supreme",
  "flask-pure-death": "Pure Death",
  "haste-potion": "Haste",
  "destruction-potion": "Destr",
  "fel-mana-potion": "Fel Mana",
  "super-mana-potion": "Super Mana",
  "mana-potion-injector": "Mana Inj",
});

/** Leaderboard ranks potions, scrolls, runes, and flame cap — no flasks. */
export const TBC_LEADERBOARD_USAGE_KEYS = Object.freeze([
  "haste-potion",
  "destruction-potion",
  "fel-mana-potion",
  "scroll-agility-v",
  "scroll-strength-v",
  "scroll-spirit-v",
  "dark-rune",
  "demonic-rune",
  "flame-cap",
]);

const leaderboardKeySet = new Set(TBC_LEADERBOARD_USAGE_KEYS);

const spellIdToRow = new Map();
for (const row of TBC_USAGE_CONSUMABLES) {
  for (const id of row.spellIds) {
    if (!spellIdToRow.has(id)) spellIdToRow.set(id, row);
  }
}

export function usageConsumableCatalogForApi() {
  return TBC_USAGE_CONSUMABLES.map((r) => ({
    key: r.key,
    name: r.name,
    spellId: r.spellId,
    spellIds: r.spellIds,
    countMethod: r.countMethod,
    itemId: r.itemId || undefined,
  }));
}

export function leaderboardUsageConsumableCatalogForApi() {
  return usageConsumableCatalogForApi().filter((row) => leaderboardKeySet.has(row.key));
}

export function p3MarksUsageConsumableCatalogForApi() {
  return usageConsumableCatalogForApi()
    .filter((row) => p3MarksKeySet.has(row.key))
    .map((row) => ({
      ...row,
      shortLabel: P3_MARKS_SHORT_LABELS[row.key] || row.name,
      kind: String(row.key || "").startsWith("flask-") ? "flask" : "potion",
    }));
}

export function allUsageConsumableSpellIds() {
  return [...spellIdToRow.keys()];
}

export function usageConsumableRowFromSpellId(spellId) {
  const id = Number(spellId || 0);
  return id > 0 ? spellIdToRow.get(id) || null : null;
}

/** WCL events filterExpression for tracked usage consumables. */
export function buildUsageConsumablesEventsFilter({ includeBuffs = true } = {}) {
  const ids = allUsageConsumableSpellIds();
  const idExpr = ids.map((id) => `ability.id=${id}`).join(" OR ");
  const types = includeBuffs ? "('cast','applybuff','refreshbuff')" : "('cast')";
  return `type in ${types} and (${idExpr})`;
}
