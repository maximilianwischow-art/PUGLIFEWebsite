/** Raid debuff catalog for WCL uptime (descriptions are local, not from WCL). */
export const DEBUFF_CATEGORIES = Object.freeze([
  { id: "armor", label: "Armor reduction" },
  { id: "spell", label: "Spell damage taken" },
  { id: "attack", label: "Attack speed / AP" },
]);

export const IMPORTANT_DEBUFFS = Object.freeze([
  {
    key: "sunder-armor",
    spellId: 25225,
    name: "Sunder Armor",
    appliedBy: "Warrior",
    category: "armor",
    orGroup: "armor-major",
    description:
      "Reduces boss armor by 520 per stack (stacks up to 5 times for -2,600 armor). Must be maintained at all times.",
  },
  {
    key: "expose-armor",
    spellId: 26866,
    name: "Expose Armor",
    appliedBy: "Rogue",
    category: "armor",
    orGroup: "armor-major",
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
    key: "expose-weakness",
    spellId: 34889,
    name: "Expose Weakness",
    appliedBy: "Survival Hunter",
    category: "armor",
    description:
      "On critical strikes, reduces the target's armor by 25% for 30 seconds (Survival talent). Stacks with other armor debuffs.",
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
    key: "judgment-of-the-crusader",
    spellId: 27159,
    name: "Judgement of the Crusader",
    appliedBy: "Paladin",
    category: "spell",
    description:
      "Increases Holy damage taken by the target. Multiple Paladins can each maintain their own Judgment.",
  },
  {
    key: "judgment-of-wisdom",
    spellId: 27164,
    name: "Judgement of Wisdom",
    appliedBy: "Paladin",
    category: "spell",
    description:
      "Grants mana on attacks against the target. Often run alongside Crusader from a second Paladin.",
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
    key: "improved-hunters-mark",
    spellId: 19425,
    name: "Improved Hunter's Mark",
    appliedBy: "Hunter",
    category: "attack",
    description:
      "Increases ranged attack power against the target (110 AP base; +25% with 3/3 Improved Hunter's Mark talent).",
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
    orGroup: "demo",
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
    orGroup: "demo",
    orNote: "or Demoralizing Shout",
    description:
      "Alternative to Demo Shout; reduces attack power by 300 (up to 420 with Feral Aggression).",
  },
]);

/** @deprecated use IMPORTANT_DEBUFFS */
export const IMPORTANT_ARMOR_DEBUFFS = IMPORTANT_DEBUFFS.filter((row) => row.category === "armor");

/** Mutually exclusive “either/or” debuff sets (uptime is combined, not stacked). */
export const DEBUFF_OR_GROUP_LABELS = Object.freeze({
  "armor-major": "Sunder or Expose",
  demo: "Demo Shout or Roar",
});

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
    orGroup: row.orGroup || null,
    orNote: row.orNote || null,
    description: row.description,
  }));
}

export function catalogDefsForOrGroup(catalog, orGroupId) {
  const id = String(orGroupId || "").trim();
  if (!id) return [];
  return (Array.isArray(catalog) ? catalog : []).filter((row) => row.orGroup === id);
}

/**
 * Combined uptime for an either/or debuff set (exclusive substitutes).
 * Uses sum capped at 100% — correct when only one can be active at a time.
 */
export function combineExclusiveOrGroupUptime(debuffRows, memberDefs) {
  const pcts = [];
  for (const def of Array.isArray(memberDefs) ? memberDefs : []) {
    const row = (Array.isArray(debuffRows) ? debuffRows : []).find(
      (d) =>
        (def?.key && d?.key === def.key) ||
        Number(d?.spellId) === Number(def?.spellId)
    );
    const n = Number(row?.uptimePct);
    if (Number.isFinite(n) && n >= 0) pcts.push(n);
  }
  if (!pcts.length) return null;
  if (pcts.every((n) => n === 0)) return 0;
  return Math.min(100, pcts.reduce((sum, n) => sum + n, 0));
}

export function orGroupLabel(orGroupId, memberDefs) {
  const preset = DEBUFF_OR_GROUP_LABELS[String(orGroupId || "").trim()];
  if (preset) return preset;
  const names = (memberDefs || []).map((d) => d?.name).filter(Boolean);
  return names.length ? names.join(" or ") : String(orGroupId || "Combined");
}

export function debuffOrGroupsForApi(catalog) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(catalog) ? catalog : []) {
    const id = String(row?.orGroup || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const members = catalogDefsForOrGroup(catalog, id);
    out.push({
      id,
      label: orGroupLabel(id, members),
      keys: members.map((m) => m.key),
    });
  }
  return out;
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
