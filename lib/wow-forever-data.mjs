/**
 * World of Warcraft: Forever (Classic+) race/class matrix.
 *
 * Sourced from BlizzCon 2026 coverage published 12 Sep 2026 — not TBC Classic.
 * Vanilla combos are treated as kept unless a demo report dropped them.
 * New combos and the Skyborne race come from the BlizzCon demo / What's Next panel.
 */

export const FOREVER_AS_OF = "2026-09-12";
export const FOREVER_LAUNCH = "2026-11-04";
export const FOREVER_BETA = "2026-09-17";
export const FOREVER_LEVEL_CAP = 60;

export const FOREVER_SOURCES = [
  {
    name: "Warcraft Tavern — Undead Paladins & race/class combos",
    url: "https://www.warcrafttavern.com/forever/news/undead-paladins-other-race-class-combos-in-world-of-warcraft-forever/",
    note: "BlizzCon demo character create. Published 12 Sep 2026.",
  },
  {
    name: "GameFragger — Skyborne faction split",
    url: "https://gamefragger.com/pc/warcraft/world-of-warcraft-forevers-skyborne-race-is-on-both-factions-has-custom-forms-and-more-a29774",
    note: "What's Next panel: Skyborne are a neutral race. Shared warrior/hunter/rogue/druid; Alliance mage; Horde shaman.",
  },
  {
    name: "PC Gamer — Forever reveal",
    url: "https://www.pcgamer.com/games/world-of-warcraft/the-wow-classic-rumors-were-true-world-of-warcraft-forever-promises-to-be-another-timelines-bizzarro-version-of-the-mmo/",
    note: "Level 60 cap, Skyborne Elves, trailer combos (Forsaken paladin, dwarf shaman, orc mage). Launch 4 Nov 2026. Beta 17 Sep 2026.",
  },
  {
    name: "Wowhead — Undead Paladins in Forever",
    url: "https://www.wowhead.com/news/undead-paladins-coming-to-world-of-warcraft-forever-382823",
    note: "Cinematic confirms Forsaken Paladins in Forever (and Midnight 12.2).",
  },
];

export const CLASSES = [
  { id: "warrior", name: "Warrior", color: "#C79C6E" },
  { id: "paladin", name: "Paladin", color: "#F58CBA" },
  { id: "hunter", name: "Hunter", color: "#ABD473" },
  { id: "rogue", name: "Rogue", color: "#FFF569" },
  { id: "priest", name: "Priest", color: "#FFFFFF" },
  { id: "shaman", name: "Shaman", color: "#0070DD" },
  { id: "mage", name: "Mage", color: "#69CCF0" },
  { id: "warlock", name: "Warlock", color: "#9482C9" },
  { id: "druid", name: "Druid", color: "#FF7D0A" },
];

export const ROLES = [
  { id: "tank", name: "Tank", icon: "inv_shield_06" },
  { id: "dps", name: "DPS", icon: "inv_sword_27" },
  { id: "heal", name: "Heal", icon: "spell_holy_flashheal" },
];

/**
 * Vanilla / Forever talent trees by raid role.
 * DPS rows with 2+ specs are shown as a submenu on character create
 * (Shaman Ele / Enh, Warrior Arms / Fury, Hunter / Mage / Rogue / Warlock trees, Druid Boomkin / Cat).
 */
export const CLASS_ROLES = {
  warrior: {
    tank: [{ id: "protection", name: "Protection", shortName: "Prot", icon: "ability_warrior_defensivestance" }],
    dps: [
      { id: "arms", name: "Arms", icon: "ability_warrior_savageblow" },
      { id: "fury", name: "Fury", icon: "ability_warrior_innerrage" },
    ],
  },
  paladin: {
    tank: [{ id: "protection", name: "Protection", shortName: "Prot", icon: "spell_holy_devotionaura" }],
    dps: [{ id: "retribution", name: "Retribution", shortName: "Ret", icon: "spell_holy_auraoflight", aliases: ["ret"] }],
    heal: [{ id: "holy", name: "Holy", icon: "spell_holy_holybolt" }],
  },
  hunter: {
    dps: [
      { id: "beast-mastery", name: "Beast Mastery", shortName: "BM", icon: "ability_hunter_beasttaming", aliases: ["bm", "beastmastery"] },
      { id: "marksmanship", name: "Marksmanship", shortName: "MM", icon: "ability_marksmanship", aliases: ["mm", "marks"] },
      { id: "survival", name: "Survival", shortName: "SV", icon: "ability_hunter_swiftstrike", aliases: ["surv"] },
    ],
  },
  rogue: {
    dps: [
      { id: "assassination", name: "Assassination", shortName: "Assa", icon: "ability_rogue_eviscerate", aliases: ["assa", "mut"] },
      { id: "combat", name: "Combat", icon: "ability_backstab" },
      { id: "subtlety", name: "Subtlety", shortName: "Sub", icon: "ability_stealth", aliases: ["sub"] },
    ],
  },
  priest: {
    dps: [{ id: "shadow", name: "Shadow", shortName: "SP", icon: "spell_shadow_shadowwordpain", aliases: ["sp", "shadowpriest"] }],
    heal: [
      { id: "holy", name: "Holy", icon: "spell_holy_holybolt" },
      { id: "discipline", name: "Discipline", shortName: "Disc", icon: "spell_holy_wordfortitude", aliases: ["disc"] },
    ],
  },
  shaman: {
    dps: [
      { id: "elemental", name: "Elemental", shortName: "Ele", icon: "spell_nature_lightning", aliases: ["ele"] },
      { id: "enhancement", name: "Enhancement", shortName: "Enhancer", icon: "spell_nature_lightningshield", aliases: ["enhance", "enhancer", "enh"] },
    ],
    heal: [{ id: "restoration", name: "Restoration", shortName: "Resto", icon: "spell_nature_magicimmunity", aliases: ["resto"] }],
  },
  mage: {
    dps: [
      { id: "arcane", name: "Arcane", icon: "spell_holy_magicalsentry" },
      { id: "fire", name: "Fire", icon: "spell_fire_firebolt02" },
      { id: "frost", name: "Frost", icon: "spell_frost_frostbolt02" },
    ],
  },
  warlock: {
    dps: [
      { id: "affliction", name: "Affliction", shortName: "Affli", icon: "spell_shadow_deathcoil", aliases: ["affli", "aff"] },
      { id: "demonology", name: "Demonology", shortName: "Demo", icon: "spell_shadow_metamorphosis", aliases: ["demo"] },
      { id: "destruction", name: "Destruction", shortName: "Destro", icon: "spell_shadow_rainoffire", aliases: ["destro"] },
    ],
  },
  druid: {
    tank: [{ id: "feral-bear", name: "Bear", icon: "ability_racial_bearform", aliases: ["bear", "guardian", "feralbear"] }],
    dps: [
      { id: "balance", name: "Balance", shortName: "Boomkin", icon: "spell_nature_starfall", aliases: ["boomkin", "moonkin"] },
      { id: "feral-cat", name: "Cat", icon: "ability_druid_catform", aliases: ["cat", "feral", "feralcat"] },
    ],
    heal: [{ id: "restoration", name: "Restoration", shortName: "Resto", icon: "spell_nature_healingtouch", aliases: ["resto"] }],
  },
};

export const RACES = [
  { id: "human", name: "Human", faction: "alliance", portraitKey: "human" },
  { id: "dwarf", name: "Dwarf", faction: "alliance", portraitKey: "dwarf" },
  { id: "nightelf", name: "Night Elf", faction: "alliance", portraitKey: "nightelf" },
  { id: "gnome", name: "Gnome", faction: "alliance", portraitKey: "gnome" },
  {
    id: "skyborne",
    name: "Skyborne",
    faction: "both",
    portraitKey: "skyborne",
    isNewRace: true,
    note: "Neutral race. Start on Zephras Isle, pick Alliance or Horde at create. Shop pack from $29.99.",
  },
  { id: "orc", name: "Orc", faction: "horde", portraitKey: "orc" },
  { id: "undead", name: "Undead", faction: "horde", portraitKey: "scourge" },
  { id: "tauren", name: "Tauren", faction: "horde", portraitKey: "tauren" },
  { id: "troll", name: "Troll", faction: "horde", portraitKey: "troll" },
];

/** Vanilla Classic (1.12) combos — used to flag what Forever actually added. */
export const VANILLA_CLASSES_BY_RACE = {
  human: ["mage", "paladin", "priest", "rogue", "warlock", "warrior"],
  dwarf: ["hunter", "paladin", "priest", "rogue", "warrior"],
  nightelf: ["druid", "hunter", "priest", "rogue", "warrior"],
  gnome: ["mage", "rogue", "warlock", "warrior"],
  orc: ["hunter", "rogue", "shaman", "warlock", "warrior"],
  undead: ["mage", "priest", "rogue", "warlock", "warrior"],
  tauren: ["druid", "hunter", "shaman", "warrior"],
  troll: ["hunter", "mage", "priest", "rogue", "shaman", "warrior"],
};

/**
 * Forever create-a-character lists.
 * Skyborne is faction-split (keys `skyborne:alliance` / `skyborne:horde`).
 * Gnome Priest is demo-reported (Warcraft Tavern). Gnome Warrior is kept as a vanilla option
 * the Tavern gnome list omitted.
 */
export const FOREVER_CLASSES_BY_RACE = {
  human: ["hunter", "mage", "paladin", "priest", "rogue", "warlock", "warrior"],
  dwarf: ["hunter", "paladin", "priest", "rogue", "shaman", "warrior"],
  nightelf: ["druid", "hunter", "priest", "rogue", "warrior"],
  gnome: ["mage", "priest", "rogue", "warlock", "warrior"],
  orc: ["hunter", "mage", "rogue", "shaman", "warlock", "warrior"],
  undead: ["mage", "paladin", "priest", "rogue", "warlock", "warrior"],
  tauren: ["druid", "hunter", "shaman", "warrior"],
  troll: ["hunter", "mage", "priest", "rogue", "shaman", "warlock", "warrior"],
  "skyborne:alliance": ["druid", "hunter", "mage", "rogue", "warrior"],
  "skyborne:horde": ["druid", "hunter", "rogue", "shaman", "warrior"],
};

export function classById(id) {
  return CLASSES.find((c) => c.id === id) || null;
}

export function roleById(id) {
  return ROLES.find((r) => r.id === id) || null;
}

export function rolesForClass(classId) {
  const row = CLASS_ROLES[classId] || {};
  return ROLES.filter((role) => Array.isArray(row[role.id]) && row[role.id].length > 0);
}

export function specsForRole(classId, roleId) {
  return [...(CLASS_ROLES[classId]?.[roleId] || [])];
}

export function needsDpsSpecPicker(classId, roleId) {
  return String(roleId || "") === "dps" && specsForRole(classId, roleId).length >= 2;
}

function specKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function matchSpec(classId, roleId, raw) {
  const key = specKey(raw);
  if (!key) return null;
  return (
    specsForRole(classId, roleId).find((spec) => {
      const keys = [spec.id, spec.name, spec.shortName, ...(spec.aliases || [])].map(specKey);
      return keys.includes(key);
    }) || null
  );
}

export function specById(classId, roleId, specId) {
  return matchSpec(classId, roleId, specId);
}

function formatSpecChoiceError(specs) {
  const names = specs.map((spec) => spec.shortName || spec.name);
  if (names.length <= 1) return `Pick ${names[0] || "a spec"}.`;
  const last = names[names.length - 1];
  return `Pick ${names.slice(0, -1).join(", ")} or ${last}.`;
}

export function raceById(id) {
  return RACES.find((r) => r.id === id) || null;
}

export function comboKey(raceId, faction) {
  const race = raceById(raceId);
  if (!race) return "";
  if (race.faction === "both") {
    const side = String(faction || "").toLowerCase();
    if (side !== "alliance" && side !== "horde") return "";
    return `${race.id}:${side}`;
  }
  return race.id;
}

export function classesFor(raceId, faction) {
  const key = comboKey(raceId, faction);
  return key ? [...(FOREVER_CLASSES_BY_RACE[key] || [])] : [];
}

export function resolvedFaction(raceId, faction) {
  const race = raceById(raceId);
  if (!race) return "";
  if (race.faction !== "both") return race.faction;
  const side = String(faction || "").toLowerCase();
  return side === "alliance" || side === "horde" ? side : "";
}

export function isNewCombo(raceId, classId) {
  const race = raceById(raceId);
  if (!race) return false;
  if (race.isNewRace) return true;
  const vanilla = VANILLA_CLASSES_BY_RACE[race.id] || [];
  return !vanilla.includes(classId);
}

export const FOREVER_NAME_MIN = 2;
export const FOREVER_NAME_MAX = 24;

/** One name token: 2–24 letters, optional apostrophe in the middle (Kel'thuzad). */
export function sanitizeNamePart(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.length < FOREVER_NAME_MIN || s.length > FOREVER_NAME_MAX) return null;
  const middle = FOREVER_NAME_MAX - 2;
  const partRe = new RegExp(`^[A-Za-z][A-Za-z']{0,${middle}}[A-Za-z]$`);
  if (!partRe.test(s)) return null;
  if (s.includes("''")) return null;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Forever names: given name, optional family name.
 * Pass `familyRaw` when the UI sent split fields. Otherwise parse `"Jaina Proudmoore"`.
 * Returns `{ givenName, familyName, characterName }` or `null` if invalid.
 */
export function parseForeverCharacterName(raw, familyRaw) {
  let given;
  let family;
  if (familyRaw !== undefined) {
    given = sanitizeNamePart(raw);
    family = sanitizeNamePart(familyRaw);
  } else {
    const s = String(raw || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!s) return { givenName: "", familyName: "", characterName: "" };
    const parts = s.split(" ");
    if (parts.length > 2) return null;
    given = sanitizeNamePart(parts[0]);
    family = parts.length === 2 ? sanitizeNamePart(parts[1]) : "";
  }
  if (given === null || family === null) return null;
  if (!given && family) return null;
  return {
    givenName: given,
    familyName: family,
    characterName: [given, family].filter(Boolean).join(" "),
  };
}

export function sanitizeCharacterName(raw, familyRaw) {
  const parsed = parseForeverCharacterName(raw, familyRaw);
  if (!parsed) return null;
  return parsed.characterName;
}

export function validateWowForeverPick(body) {
  const raceId = String(body?.race || "").trim().toLowerCase();
  const gender = String(body?.gender || "").trim().toLowerCase();
  const classId = String(body?.classId || body?.class || "").trim().toLowerCase();
  const race = raceById(raceId);
  if (!race) return { ok: false, error: "Pick a World of Warcraft Forever race." };
  if (gender !== "male" && gender !== "female") {
    return { ok: false, error: "Pick male or female." };
  }
  if (!classById(classId)) return { ok: false, error: "Pick a class." };

  const faction = resolvedFaction(raceId, body?.faction);
  if (!faction) {
    return { ok: false, error: "Skyborne choose Alliance or Horde at character create." };
  }

  const allowed = classesFor(raceId, faction);
  if (!allowed.includes(classId)) {
    const cls = classById(classId);
    return {
      ok: false,
      error: `${race.name} cannot be ${cls?.name || classId} on that faction in WoW Forever.`,
    };
  }

  const roleId = String(body?.role || "").trim().toLowerCase();
  if (!roleById(roleId)) {
    return { ok: false, error: "Pick Tank, DPS, or Heal." };
  }
  const allowedRoles = rolesForClass(classId);
  if (!allowedRoles.some((role) => role.id === roleId)) {
    const cls = classById(classId);
    const role = roleById(roleId);
    return {
      ok: false,
      error: `${cls?.name || classId} cannot play ${role?.name || roleId} in WoW Forever.`,
    };
  }

  const specs = specsForRole(classId, roleId);
  const matched = matchSpec(classId, roleId, body?.specId ?? body?.spec);
  let specId = matched?.id || "";
  if (needsDpsSpecPicker(classId, roleId)) {
    if (!specId) {
      return { ok: false, error: formatSpecChoiceError(specs) };
    }
  } else if (!specId && specs.length) {
    specId = specs[0].id;
  }

  const hasSplitFields = body?.givenName != null || body?.familyName != null;
  const parsedName = hasSplitFields
    ? parseForeverCharacterName(body.givenName, body.familyName ?? "")
    : parseForeverCharacterName(body?.characterName);
  if (!parsedName) {
    return {
      ok: false,
      error: "Given name and family name are 2–24 letters each. Family name is optional.",
    };
  }

  return {
    ok: true,
    pick: {
      race: raceId,
      faction,
      gender,
      classId,
      role: roleId,
      specId,
      characterName: parsedName.characterName,
      givenName: parsedName.givenName,
      familyName: parsedName.familyName,
      isNewCombo: isNewCombo(raceId, classId),
    },
  };
}

export function newCombosList() {
  const out = [];
  for (const race of RACES) {
    const factions = race.faction === "both" ? ["alliance", "horde"] : [race.faction];
    for (const faction of factions) {
      for (const classId of classesFor(race.id, faction)) {
        if (!isNewCombo(race.id, classId)) continue;
        out.push({
          race: race.id,
          raceName: race.name,
          faction,
          classId,
          className: classById(classId)?.name || classId,
        });
      }
    }
  }
  return out;
}

export function publicCatalog() {
  return {
    asOf: FOREVER_AS_OF,
    launch: FOREVER_LAUNCH,
    beta: FOREVER_BETA,
    levelCap: FOREVER_LEVEL_CAP,
    sources: FOREVER_SOURCES,
    classes: CLASSES,
    roles: ROLES,
    classRoles: CLASS_ROLES,
    races: RACES,
    classesByRace: FOREVER_CLASSES_BY_RACE,
    vanillaClassesByRace: VANILLA_CLASSES_BY_RACE,
    newCombos: newCombosList(),
    notes: [
      "World of Warcraft: Forever is Classic+ announced at BlizzCon 2026 (12 Sep). Level cap 60 for the foreseeable future.",
      "Skyborne are a new neutral race (Zephras Isle). Alliance Skyborne can mage; Horde Skyborne can shaman. Shared: warrior, hunter, rogue, druid.",
      "Gnome Priest is listed on the BlizzCon demo (Warcraft Tavern). Gnome Warrior is kept as a vanilla option that list omitted.",
      "Forever character names may include an optional family name (given name + surname). Each part is 2–24 letters.",
      "Pick Tank, DPS, or Heal. Classes with two or more DPS specs (Shaman Ele/Enhancer, Warrior Arms/Fury, Hunter, Mage, Rogue, Warlock, Druid Boomkin/Cat) choose a spec after DPS.",
      "Draenei, Blood Elves, and later Allied Races are not in Forever — this is a Year One / vanilla-plus branch.",
    ],
  };
}
