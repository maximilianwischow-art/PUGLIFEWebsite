/** TBC armor-reduction debuffs tracked for per-encounter uptime (descriptions are local, not from WCL). */
export const IMPORTANT_ARMOR_DEBUFFS = Object.freeze([
  {
    spellId: 25225,
    name: "Sunder Armor",
    appliedByClass: "Warrior",
    description:
      "Reduces boss armor by 520 per stack (stacks up to 5 times for -2,600 armor). Must be maintained at all times.",
  },
  {
    spellId: 26866,
    name: "Expose Armor",
    appliedByClass: "Rogue",
    description:
      "Reduces boss armor by 2,050. With 2/2 Improved Expose Armor (14169), reduces armor by 3,075. Overwrites Sunder Armor and is a net raid DPS increase with heavy physical DPS.",
  },
  {
    spellId: 26993,
    name: "Faerie Fire",
    appliedByClass: "Druid",
    description: "Reduces boss armor by 610.",
  },
  {
    spellId: 27226,
    name: "Curse of Recklessness",
    appliedByClass: "Warlock",
    description: "Reduces boss armor by 800 (but increases the boss's attack power by 135).",
  },
]);

export function importantDebuffBySpellId(spellId) {
  const id = Number(spellId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return IMPORTANT_ARMOR_DEBUFFS.find((row) => Number(row.spellId) === id) || null;
}

export function matchImportantDebuffFromEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const spellId = Number(entry.guid ?? entry.id ?? entry.gameID ?? entry.abilityGameID ?? 0);
  if (Number.isFinite(spellId) && spellId > 0) {
    const hit = importantDebuffBySpellId(spellId);
    if (hit) return hit;
  }
  const nameKey = String(entry.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!nameKey) return null;
  return (
    IMPORTANT_ARMOR_DEBUFFS.find((row) => {
      const rowKey = String(row.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      return rowKey === nameKey || nameKey.includes(rowKey) || rowKey.includes(nameKey);
    }) || null
  );
}
