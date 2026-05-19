/** TBC raid consumable buff catalog for WCL event matching at boss pull. */

export const CONSUMABLE_CATEGORIES = Object.freeze([
  { id: "flask", label: "Flask" },
  { id: "battle", label: "Battle elixir" },
  { id: "guardian", label: "Guardian elixir" },
  { id: "food", label: "Food" },
]);

/**
 * @param {string} key
 * @param {"flask"|"battle"|"guardian"|"food"} category
 * @param {number|number[]} spellId WCL `abilityGameID` for the buff (not the item ID)
 * @param {string} name
 * @param {string[]} [wclNames]
 * @param {number} [itemId] TBC item ID (reference / tooltips only)
 */
function row(key, category, spellId, name, wclNames = [], itemId = 0) {
  const ids = Array.isArray(spellId) ? spellId : [spellId];
  const primary = Number(ids[0]) || 0;
  const names = new Set([String(name || "").trim(), ...wclNames.map((n) => String(n || "").trim())].filter(Boolean));
  return {
    key,
    category,
    spellId: primary,
    spellIds: ids.filter((id) => Number(id) > 0),
    name,
    wclNames: [...names],
    itemId: Number(itemId) || 0,
  };
}

/**
 * Guild-standard TBC consumables (item IDs from raid lead sheet → WCL buff spell IDs).
 * Spell IDs verified against WCL Fresh `masterData.abilities` where noted.
 *
 * @type {readonly import('./tbc-consumables.mjs').ConsumableRow[]}
 */
export const TBC_CONSUMABLES = Object.freeze([
  // —— Flasks (count as battle + guardian in TBC) ——
  row("flask-blinding-light", "flask", 28521, "Flask of Blinding Light", [], 22861),
  row("flask-fortification", "flask", 28518, "Flask of Fortification", [], 22851),
  row("flask-mighty-restoration", "flask", 28519, "Flask of Mighty Restoration", [], 22853),
  row("flask-pure-death", "flask", 28540, "Flask of Pure Death", [], 22866),
  row("flask-relentless-assault", "flask", 28520, "Flask of Relentless Assault", [], 22854),
  row("flask-supreme-power", "flask", 28505, "Flask of Supreme Power", [], 13512),
  row("flask-chromatic-resistance", "flask", [28542, 42735], "Flask of Chromatic Resistance"),
  row("flask-chromatic-wonder", "flask", 28541, "Flask of Chromatic Wonder"),

  // —— Battle elixirs ——
  row("elixir-adepts", "battle", 28503, "Adept's Elixir", ["Adepts Elixir"], 28103),
  row("elixir-demonslaying", "battle", 11406, "Elixir of Demonslaying", [], 9224),
  row("elixir-healing-power", "battle", 28491, "Elixir of Healing Power", ["Healing Power"], 22827),
  row("elixir-major-agility", "battle", 28507, "Elixir of Major Agility", [], 22831),
  row("elixir-major-strength", "battle", 28497, "Elixir of Major Strength", ["Mighty Agility"], 22824),
  row("elixir-spellpower", "battle", 33721, "Spellpower Elixir"),
  row("elixir-greater-arcane", "battle", 17539, "Greater Arcane Elixir"),
  row("elixir-mongoose", "battle", 17538, "Elixir of the Mongoose"),
  row("elixir-fel-strength", "battle", 38954, "Fel Strength Elixir"),
  row("elixir-onslaught", "battle", 28488, "Onslaught Elixir"),

  // —— Guardian elixirs ——
  row("elixir-draenic-wisdom", "guardian", 39627, "Elixir of Draenic Wisdom", [], 32067),
  row("elixir-major-defense", "guardian", 28513, "Elixir of Major Defense", [], 22834),
  row("elixir-major-fortitude", "guardian", 39625, "Elixir of Major Fortitude", [], 22847),
  row("elixir-major-mageblood", "guardian", 28511, "Elixir of Major Mageblood", [], 22840),
  row("potion-mageblood", "guardian", 24363, "Mageblood Potion", ["Mageblood"], 20007),
  row(
    "guardian-greater-mana-regen",
    "guardian",
    28509,
    "Greater Mana Regeneration",
    ["Greater Versatility", "Greater Mana Regeneration"],
    0
  ),
  row("elixir-ironskin", "guardian", 39628, "Elixir of Ironskin"),
  row("elixir-major-armor", "guardian", 28502, "Elixir of Major Armor"),

  // —— Food (each recipe applies its own "Well Fed" aura spell on WCL) ——
  row("food-blackened-basilisk", "food", 33257, "Blackened Basilisk", [], 27657),
  row("food-crunchy-serpent", "food", 33262, "Crunchy Serpent", [], 27662),
  row("food-fishermans-feast", "food", 33268, "Fisherman's Feast", [], 33052),
  row("food-golden-fish-sticks", "food", 33267, "Golden Fish Sticks", [], 27667),
  row("food-grilled-mudfish", "food", 33264, "Grilled Mudfish", [], 27664),
  row("food-roasted-clefthoof", "food", 33256, "Roasted Clefthoof", [], 27655),
  row("food-spicy-hot-talbuk", "food", 43764, "Spicy Hot Talbuk", [], 33872),
  row("food-ravager-dog", "food", 33254, "Ravager Dog"),
  // Fallback when WCL only exposes generic "Well Fed" without a mapped food spell
  row(
    "food-well-fed-generic",
    "food",
    [33261, 33263, 33265, 35272, 19711],
    "Well Fed",
    ["Well Fed"]
  ),
]);

const bySpellId = new Map();
const byNameKey = new Map();

function normNameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

for (const catalogRow of TBC_CONSUMABLES) {
  for (const id of catalogRow.spellIds) {
    if (!bySpellId.has(id)) bySpellId.set(id, catalogRow);
  }
  for (const n of catalogRow.wclNames) {
    const k = normNameKey(n);
    if (k && !byNameKey.has(k)) byNameKey.set(k, catalogRow);
  }
  const pk = normNameKey(catalogRow.name);
  if (pk && !byNameKey.has(pk)) byNameKey.set(pk, catalogRow);
}

export function consumableCatalogForApi() {
  return TBC_CONSUMABLES.map((r) => ({
    key: r.key,
    category: r.category,
    spellId: r.spellId,
    spellIds: r.spellIds,
    name: r.name,
    itemId: r.itemId || undefined,
  }));
}

export function allConsumableSpellIds() {
  const ids = new Set();
  for (const r of TBC_CONSUMABLES) {
    for (const id of r.spellIds) ids.add(id);
  }
  return [...ids];
}

export function categoryFromAbilityName(nameRaw) {
  const name = String(nameRaw || "").trim();
  if (!name) return null;
  if (/^flask of /i.test(name)) return "flask";
  if (/well fed/i.test(name)) return "food";
  if (
    /blackened basilisk|crunchy serpent|fisherman|fish stick|grilled mudfish|roasted clefthoof|spicy hot talbuk|ravager dog|warp burger|skullfish|bloodfin|dragonfin|broiled/i.test(
      name
    )
  ) {
    return "food";
  }
  if (
    /^elixir of /i.test(name) ||
    /adept's|adepts|demonslaying|greater arcane|onslaught|fel strength|spellpower elixir|mongoose|brute force|^healing power$/i.test(
      name
    )
  ) {
    if (
      /major defense|major fortitude|draenic wisdom|major mageblood|ironskin|major armor|dream vision|gordok green|mageblood potion|greater mana regen|greater versatility/i.test(
        name
      )
    ) {
      return "guardian";
    }
    return "battle";
  }
  return null;
}

export function matchConsumableFromEvent(ev, abilityNameByGameId = null) {
  const gameId = Number(ev?.abilityGameID ?? ev?.ability?.gameID ?? ev?.ability?.id ?? 0);
  if (gameId > 0 && bySpellId.has(gameId)) {
    const matched = bySpellId.get(gameId);
    return { category: matched.category, row: matched };
  }
  const resolvedName =
    String(ev?.ability?.name || "").trim() ||
    (abilityNameByGameId && gameId > 0 ? String(abilityNameByGameId.get(gameId) || "").trim() : "");
  const nk = normNameKey(resolvedName);
  if (nk && byNameKey.has(nk)) {
    const matched = byNameKey.get(nk);
    return { category: matched.category, row: matched };
  }
  const cat = categoryFromAbilityName(resolvedName);
  if (cat) {
    return {
      category: cat,
      row: {
        key: `name:${nk || cat}`,
        category: cat,
        spellId: gameId || 0,
        spellIds: gameId ? [gameId] : [],
        name: resolvedName || cat,
        wclNames: resolvedName ? [resolvedName] : [],
        itemId: 0,
      },
    };
  }
  return null;
}

export function buildConsumableEventsFilter({ includeRemove = true } = {}) {
  const types = includeRemove
    ? "('applybuff','refreshbuff','removebuff')"
    : "('applybuff','refreshbuff')";
  return `type in ${types}`;
}

export function emptyConsumableSlot() {
  return { ok: false, label: null, spellId: null, key: null };
}

export function consumableSlotFromRow(row) {
  if (!row) return emptyConsumableSlot();
  return {
    ok: true,
    label: row.name,
    spellId: row.spellId,
    key: row.key,
  };
}
