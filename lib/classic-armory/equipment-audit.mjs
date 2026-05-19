/**
 * Classic Armory equipment audit — enchants & gems from POST /api/v1/character/equipment.
 */

import { classicArmoryCharacterPageUrl } from "../compute/character-specs.mjs";
import { inferTbcGemQuality } from "./tbc-gem-quality.mjs";

const TBC_ENCHANTABLE_SLOTS = new Set([
  "HEAD",
  "SHOULDER",
  "CHEST",
  "WRIST",
  "HANDS",
  "LEGS",
  "FEET",
  "BACK",
  "MAIN_HAND",
  "RANGED",
]);

const ENCHANT_SLOT_ORDER = [
  "HEAD",
  "SHOULDER",
  "CHEST",
  "WRIST",
  "HANDS",
  "LEGS",
  "FEET",
  "BACK",
  "MAIN_HAND",
  "RANGED",
];

const SKIP_SLOTS = new Set(["TABARD", "SHIRT", "BODY"]);

const SLOT_LABELS = {
  HEAD: "Head",
  NECK: "Neck",
  SHOULDER: "Shoulder",
  CHEST: "Chest",
  WAIST: "Waist",
  LEGS: "Legs",
  FEET: "Feet",
  WRIST: "Wrist",
  HANDS: "Hands",
  FINGER_1: "Ring 1",
  FINGER_2: "Ring 2",
  TRINKET_1: "Trinket 1",
  TRINKET_2: "Trinket 2",
  BACK: "Back",
  MAIN_HAND: "Main hand",
  OFF_HAND: "Off hand",
  RANGED: "Ranged",
  TABARD: "Tabard",
};

const GEM_SOCKET_IDS = new Set([2, 3, 4]);

/** Blizzard playable class ids (TBC). */
const TBC_CLASS_ID_TO_NAME = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  11: "Druid",
};

function resolveCharacterClassName(character) {
  const ch =
    character?.character && typeof character.character === "object" ? character.character : character;
  if (!ch || typeof ch !== "object") return null;
  for (const candidate of [
    ch.class_name,
    ch.className,
    ch.class,
    ch.character_class?.name,
  ]) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  const classId = Number(ch.class_id ?? ch.classId);
  if (Number.isInteger(classId) && classId > 0 && TBC_CLASS_ID_TO_NAME[classId]) {
    return TBC_CLASS_ID_TO_NAME[classId];
  }
  return null;
}

/** Ranged slot enchants (scope, etc.) are required for Hunters only. */
export function isHunterClass(className, classId) {
  const id = Number(classId);
  if (id === 3) return true;
  return /\bhunter\b/i.test(String(className || "").trim());
}

export function isEnchantRequiredSlot(slotType, className, classId) {
  const slot = String(slotType || "").toUpperCase();
  if (!TBC_ENCHANTABLE_SLOTS.has(slot)) return false;
  if (slot === "RANGED") return isHunterClass(className, classId);
  return true;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "fallen-tacticians-api/1.0 (+classic-armory-equipment)",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/**
 * @param {{ baseUrl?: string, region: string, flavor: string, realmSlug: string, characterName: string }} params
 */
export async function fetchClassicArmoryEquipment(params) {
  const base = String(params?.baseUrl || "https://classic-armory.org").replace(/\/+$/, "");
  return postJson(`${base}/api/v1/character/equipment`, {
    region: params.region,
    flavor: params.flavor,
    realm: params.realmSlug,
    name: params.characterName,
  });
}

function slotLabel(slotType) {
  return SLOT_LABELS[slotType] || String(slotType || "Slot").replace(/_/g, " ");
}

function permanentEnchant(row) {
  const list = Array.isArray(row?.enchantments) ? row.enchantments : [];
  const hit = list.find((e) => String(e?.enchantment_slot?.type || "").toUpperCase() === "PERMANENT");
  if (!hit) return null;
  const name =
    String(hit?.source_item?.name || "").trim() ||
    String(hit?.display_string || "")
      .replace(/^Enchanted:\s*/i, "")
      .trim();
  const spellId = Number(hit?.enchantment_id) || null;
  const itemId = Number(hit?.source_item?.id) || null;
  return {
    spellId,
    itemId: itemId || null,
    name: name || "Enchant",
  };
}

function buildEnchantSlots(slots, className, classId) {
  const byId = new Map(
    (Array.isArray(slots) ? slots : [])
      .filter((s) => isEnchantRequiredSlot(s?.slotId, className, classId))
      .filter((s) => s?.itemId || s?.itemName)
      .map((s) => [String(s.slotId).toUpperCase(), s])
  );
  return ENCHANT_SLOT_ORDER.filter((slotId) => byId.has(slotId)).map((slotId) => {
    const row = byId.get(slotId);
    const enchant = row?.enchant && typeof row.enchant === "object" ? row.enchant : null;
    const missing = !enchant;
    return {
      slotId,
      slotLabel: row?.slotLabel || slotLabel(slotId),
      missing,
      enchant: missing ? null : enchant,
    };
  });
}

function gemsFromRow(row) {
  const out = [];
  const list = Array.isArray(row?.enchantments) ? row.enchantments : [];
  for (const e of list) {
    if (String(e?.enchantment_slot?.type || "").toUpperCase() === "PERMANENT") continue;
    const socketIndex = Number(e?.enchantment_slot?.id);
    if (!GEM_SOCKET_IDS.has(socketIndex)) continue;
    const itemId = Number(e?.source_item?.id);
    const name = String(e?.source_item?.name || e?.display_string || "").trim();
    if (!itemId && !name) {
      out.push({ socketIndex, itemId: null, name: "", empty: true, quality: null });
      continue;
    }
    out.push({
      socketIndex,
      itemId: itemId || null,
      name,
      empty: false,
      quality: inferTbcGemQuality(itemId, name),
    });
  }

  const gemData = Array.isArray(row?.gem_data) ? row.gem_data : [];
  for (let i = 0; i < gemData.length; i += 1) {
    const g = gemData[i];
    const itemId = Number(g?.id);
    if (!itemId) {
      out.push({
        socketIndex: i + 2,
        itemId: null,
        name: String(g?.stat || "").trim(),
        empty: true,
        quality: null,
      });
    }
  }

  const bySocket = new Map();
  for (const g of out) {
    if (!bySocket.has(g.socketIndex) || (!bySocket.get(g.socketIndex).itemId && g.itemId)) {
      bySocket.set(g.socketIndex, g);
    }
  }
  return [...bySocket.values()].sort((a, b) => a.socketIndex - b.socketIndex);
}

function issuesForSlot(slotType, row, className, classId) {
  const issues = [];
  if (!row?.item_id && !row?.name) return issues;
  if (SKIP_SLOTS.has(slotType)) return issues;

  if (isEnchantRequiredSlot(slotType, className, classId)) {
    const enc = permanentEnchant(row);
    if (!enc) issues.push("missing_enchant");
  }

  const gems = gemsFromRow(row);
  const emptyGems = gems.filter((g) => g.empty);
  if (emptyGems.length) issues.push("empty_socket");

  const filledFromEnchant = gems.filter((g) => !g.empty).length;
  const gemDataFilled = (Array.isArray(row?.gem_data) ? row.gem_data : []).filter((g) => Number(g?.id) > 0)
    .length;
  const socketIds = new Set(
    (Array.isArray(row?.enchantments) ? row.enchantments : [])
      .filter((e) => GEM_SOCKET_IDS.has(Number(e?.enchantment_slot?.id)))
      .map((e) => Number(e.enchantment_slot.id))
  );
  if (socketIds.size > 0) {
    const expected = Math.max(...socketIds) - Math.min(...socketIds) + 1;
    const filled = Math.max(filledFromEnchant, gemDataFilled);
    if (filled < expected && !emptyGems.length) {
      issues.push("empty_socket");
    }
  }

  return [...new Set(issues)];
}

/**
 * @param {{
 *   character?: object,
 *   equipment?: object[],
 *   region?: string,
 *   flavor?: string,
 *   realmSlug?: string,
 *   characterName?: string,
 *   publicBaseUrl?: string,
 * }} input
 */
export function parseClassicArmoryEquipmentAudit(input) {
  const character = input?.character && typeof input.character === "object" ? input.character : {};
  const equipment = Array.isArray(input?.equipment) ? input.equipment : [];
  const characterName =
    String(input?.characterName || character?.name || "").trim() || "Unknown";
  const realmSlug = String(input?.realmSlug || character?.realm_slug || "").trim();
  const region = String(input?.region || character?.realm_region || "eu").trim().toLowerCase();
  const flavor = String(input?.flavor || character?.realm_flavor || "tbc-anniversary").trim();
  const className = resolveCharacterClassName(character) || String(input?.className || "").trim() || null;
  const chRoot =
    character?.character && typeof character.character === "object" ? character.character : character;
  const classIdRaw = Number(chRoot?.class_id ?? chRoot?.classId);
  const resolvedClassId = Number.isInteger(classIdRaw) && classIdRaw > 0 ? classIdRaw : null;

  const armoryUrl =
    classicArmoryCharacterPageUrl({
      publicBaseUrl: input?.publicBaseUrl,
      region,
      flavor,
      realmSlug,
      characterName,
    }) || null;

  const slots = [];
  let missingEnchants = 0;
  let emptySockets = 0;
  /** @type {string[]} */
  const missingEnchantSlotLabels = [];
  const gemQualityCounts = { green: 0, blue: 0, purple: 0, unknown: 0, empty: 0 };

  for (const row of equipment) {
    const slotType = String(row?.slot?.type || row?.slot_type || "").toUpperCase();
    if (!slotType) continue;
    const issues = issuesForSlot(slotType, row, className, resolvedClassId);
    const label = slotLabel(slotType);
    if (issues.includes("missing_enchant")) {
      missingEnchants += 1;
      missingEnchantSlotLabels.push(label);
    }
    if (issues.includes("empty_socket")) emptySockets += 1;

    const allGems = gemsFromRow(row);
    for (const g of allGems) {
      if (g.empty) {
        gemQualityCounts.empty += 1;
        continue;
      }
      const q = g.quality || inferTbcGemQuality(g.itemId, g.name);
      if (q === "green" || q === "blue" || q === "purple") gemQualityCounts[q] += 1;
      else gemQualityCounts.unknown += 1;
    }

    slots.push({
      slotId: slotType,
      slotLabel: label,
      itemName: String(row?.name || "").trim() || null,
      itemId: Number(row?.item_id) || null,
      enchant: permanentEnchant(row),
      gems: allGems.filter((g) => !g.empty),
      issues,
    });
  }

  const enchantSlots = buildEnchantSlots(slots, className, resolvedClassId);

  return {
    characterName,
    className,
    classId: resolvedClassId,
    armoryUrl,
    updatedAt: character?.updated_at || null,
    slots,
    summary: {
      missingEnchants,
      missingEnchantSlotLabels,
      enchantSlots,
      emptySockets,
      gemQualityCounts,
      ok: missingEnchants === 0 && emptySockets === 0,
      equippedCount: slots.length,
    },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {{
 *   players: { name: string, armoryName?: string }[],
 *   fetchEquipment: (name: string) => Promise<object|null>,
 *   throttleMs?: number,
 *   onProgress?: (info: { done: number, total: number, name: string }) => void,
 * }} opts
 */
export async function buildArmoryGearAuditForPlayers({
  players,
  fetchEquipment,
  throttleMs = 150,
  onProgress,
} = {}) {
  const list = Array.isArray(players) ? players : [];
  const results = [];
  let fetched = 0;
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    const displayName = String(row?.name || "").trim();
    const queryName = String(row?.armoryName || row?.name || "").trim();
    if (!queryName) continue;

    if (i > 0 && throttleMs > 0) await sleep(throttleMs);

    let payload = null;
    let fromCache = false;
    try {
      const out = await fetchEquipment(queryName);
      if (out && typeof out === "object" && "audit" in out) {
        payload = out.audit;
        fromCache = Boolean(out.cached);
      } else if (out) {
        payload = parseClassicArmoryEquipmentAudit({
          character: out.character,
          equipment: out.equipment,
          characterName: queryName,
          region: out.region,
          flavor: out.flavor,
          realmSlug: out.realmSlug,
          publicBaseUrl: out.publicBaseUrl,
        });
      }
    } catch {
      payload = null;
    }

    if (fromCache) cached += 1;
    else if (payload) fetched += 1;
    else failed += 1;

    if (onProgress) {
      onProgress({ done: i + 1, total: list.length, name: displayName || queryName });
    }

    results.push({
      name: displayName || queryName,
      armoryName: queryName,
      className: payload?.className || null,
      classId: payload?.classId ?? null,
      armoryUrl: payload?.armoryUrl || null,
      summary: payload?.summary || { missingEnchants: 0, emptySockets: 0, ok: false, equippedCount: 0 },
      slots: payload?.slots || [],
      updatedAt: payload?.updatedAt || null,
      error: payload ? null : "Armory lookup failed",
    });
  }

  return { players: results, meta: { fetched, cached, failed, total: list.length } };
}
