/** Raid debuff catalog for WCL uptime (descriptions are local, not from WCL). */
export const DEBUFF_CATEGORIES = Object.freeze([
  { id: "armor", label: "Armor reduction" },
  { id: "spell", label: "Spell damage taken" },
  { id: "attack", label: "Attack speed / AP" },
  { id: "healing", label: "Healing mitigation" },
]);

export const IMPORTANT_DEBUFFS = Object.freeze([
  {
    key: "sunder-armor",
    spellId: 25225,
    name: "Sunder Armor",
    appliedBy: "Warrior",
    category: "armor",
    description:
      "Reduces boss armor by 520 per stack (stacks up to 5 times for -2,600 armor). Must be maintained at all times.",
  },
  {
    key: "expose-armor",
    spellId: 26866,
    name: "Expose Armor",
    appliedBy: "Rogue",
    category: "armor",
    orNote: "or Sunder Armor",
    description:
      "Reduces boss armor by 2,050. If the Rogue has 2/2 Improved Expose Armor talent (14169), it reduces armor by 3,075. Note: This completely overwrites Sunder Armor and is a net raid DPS increase if you have heavy physical DPS.",
  },
  {
    key: "faerie-fire",
    spellId: 26993,
    name: "Faerie Fire",
    appliedBy: "Druid",
    category: "armor",
    description: "Reduces boss armor by 610.",
  },
  {
    key: "curse-of-recklessness",
    spellId: 27226,
    name: "Curse of Recklessness",
    appliedBy: "Warlock",
    category: "armor",
    description: "Reduces boss armor by 800 (but increases the boss's attack power by 135).",
  },
  {
    key: "curse-of-the-elements",
    spellId: 27228,
    name: "Curse of the Elements",
    appliedBy: "Warlock",
    category: "spell",
    description:
      "Increases Arcane, Fire, Frost, and Shadow damage taken by the boss by 10% (13% if talented into Malediction).",
  },
  {
    key: "improved-scorch",
    spellId: 22959,
    name: "Improved Scorch",
    appliedBy: "Fire Mage",
    category: "spell",
    description:
      "Increases Fire damage taken by the boss by 3% per stack (stacks up to 5 times for 15% total).",
  },
  {
    key: "shadow-weaving",
    spellId: 15258,
    name: "Shadow Weaving",
    appliedBy: "Shadow Priest",
    category: "spell",
    description:
      "Increases Shadow damage taken by the boss by 2% per stack (stacks up to 5 times for 10% total).",
  },
  {
    key: "misery",
    spellId: 33198,
    name: "Misery",
    appliedBy: "Shadow Priest",
    category: "spell",
    description: "Spells cast against the target deal 5% additional damage. Affects all spell schools.",
  },
  {
    key: "thunder-clap",
    spellId: 25264,
    name: "Thunder Clap",
    appliedBy: "Warrior / Thunderfury",
    category: "attack",
    description:
      "Reduces the boss's attack speed by 10% (or 20% if the Warrior has 3/3 Improved Thunder Clap).",
  },
  {
    key: "demoralizing-shout",
    spellId: 25203,
    name: "Demoralizing Shout",
    appliedBy: "Warrior",
    category: "attack",
    orNote: "or Demoralizing Roar",
    description:
      "Reduces the melee attack power of the target by 300 (up to 420 with 5/5 Improved Demoralizing Shout).",
  },
  {
    key: "demoralizing-roar",
    spellId: 26998,
    name: "Demoralizing Roar",
    appliedBy: "Feral Druid",
    category: "attack",
    orNote: "or Demoralizing Shout",
    description:
      "Alternative to Demo Shout; reduces attack power by 300 (up to 420 with Feral Aggression).",
  },
  {
    key: "inspiration",
    spellId: 15363,
    spellIds: [15363, 16237],
    name: "Inspiration",
    appliedBy: "Priest / Shaman",
    category: "healing",
    orNote: "Ancestral Fortitude",
    description:
      "While these are technical friendly player buffs applied upon landing a critical heal, they mitigate 25% of the tank's armor against boss hits and should be tracked closely.",
  },
  {
    key: "ancestral-fortitude",
    spellId: 16237,
    spellIds: [16237, 15363],
    name: "Ancestral Fortitude",
    appliedBy: "Priest / Shaman",
    category: "healing",
    orNote: "Inspiration",
    description:
      "While these are technical friendly player buffs applied upon landing a critical heal, they mitigate 25% of the tank's armor against boss hits and should be tracked closely.",
  },
]);

/** @deprecated use IMPORTANT_DEBUFFS */
export const IMPORTANT_ARMOR_DEBUFFS = IMPORTANT_DEBUFFS.filter((row) => row.category === "armor");

export function debuffCatalogForApi() {
  return IMPORTANT_DEBUFFS.map((row) => ({
    key: row.key,
    spellId: row.spellId,
    spellIds: row.spellIds || [row.spellId],
    name: row.name,
    appliedBy: row.appliedBy,
    appliedByClass: row.appliedBy,
    category: row.category,
    categoryLabel: DEBUFF_CATEGORIES.find((c) => c.id === row.category)?.label || row.category,
    orNote: row.orNote || null,
    description: row.description,
  }));
}

export function debuffAbilityNames() {
  return IMPORTANT_DEBUFFS.map((row) => row.name);
}

export function catalogRowSpellIds(row) {
  const ids = Array.isArray(row?.spellIds) ? row.spellIds : [];
  const primary = Number(row?.spellId);
  const merged = [...ids, primary].filter((id) => Number.isFinite(id) && id > 0);
  return [...new Set(merged)];
}

export function importantDebuffBySpellId(spellId) {
  const id = Number(spellId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return (
    IMPORTANT_DEBUFFS.find((row) => catalogRowSpellIds(row).includes(id)) || null
  );
}

export function importantDebuffByKey(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  return IMPORTANT_DEBUFFS.find((row) => row.key === k) || null;
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
    IMPORTANT_DEBUFFS.find((row) => {
      const rowKey = String(row.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      return rowKey === nameKey || nameKey.includes(rowKey) || rowKey.includes(nameKey);
    }) || null
  );
}
