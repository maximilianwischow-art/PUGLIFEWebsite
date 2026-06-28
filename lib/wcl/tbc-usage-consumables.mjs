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
export const TBC_USAGE_CONSUMABLES = Object.freeze([
  usageRow("haste-potion", "Haste Potion", 28507, "cast", 22838),
  usageRow("destruction-potion", "Destruction Potion", 28508, "cast", 22839),
  usageRow("fel-mana-potion", "Fel Mana Potion", 38929, "cast-or-buff", 22832),
  usageRow("scroll-agility-v", "Scroll of Agility V", 33077, "cast-or-buff", 27498),
  usageRow("scroll-strength-v", "Scroll of Strength V", 33079, "cast-or-buff", 27503),
  usageRow("scroll-spirit-v", "Scroll of Spirit V", 33081, "cast-or-buff", 27501),
  usageRow("flask-pure-death", "Flask of Pure Death", 28540, "buff", 22866),
  usageRow("flask-relentless-assault", "Flask of Relentless Assault", 28520, "buff", 22854),
  usageRow("flask-blinding-light", "Flask of Blinding Light", 28521, "buff", 22861),
  usageRow("dark-rune", "Dark Rune", 27869, "cast", 20520),
  usageRow("demonic-rune", "Demonic Rune", 16666, "cast", 12662),
  usageRow("flame-cap", "Flame Cap", 28714, "cast", 22788),
]);

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
