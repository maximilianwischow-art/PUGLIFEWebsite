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

/** One name token: 2–12 letters, optional apostrophe in the middle (Kel'thuzad). */
export function sanitizeNamePart(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.length < 2 || s.length > 12) return null;
  if (!/^[A-Za-z][A-Za-z']{0,10}[A-Za-z]$/.test(s)) return null;
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

  const hasSplitFields = body?.givenName != null || body?.familyName != null;
  const parsedName = hasSplitFields
    ? parseForeverCharacterName(body.givenName, body.familyName ?? "")
    : parseForeverCharacterName(body?.characterName);
  if (!parsedName) {
    return {
      ok: false,
      error: "Given name and family name are 2–12 letters each. Family name is optional.",
    };
  }

  return {
    ok: true,
    pick: {
      race: raceId,
      faction,
      gender,
      classId,
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
    races: RACES,
    classesByRace: FOREVER_CLASSES_BY_RACE,
    vanillaClassesByRace: VANILLA_CLASSES_BY_RACE,
    newCombos: newCombosList(),
    notes: [
      "World of Warcraft: Forever is Classic+ announced at BlizzCon 2026 (12 Sep). Level cap 60 for the foreseeable future.",
      "Skyborne are a new neutral race (Zephras Isle). Alliance Skyborne can mage; Horde Skyborne can shaman. Shared: warrior, hunter, rogue, druid.",
      "Gnome Priest is listed on the BlizzCon demo (Warcraft Tavern). Gnome Warrior is kept as a vanilla option that list omitted.",
      "Forever character names may include an optional family name (given name + surname), unlike Classic’s single 12-letter name.",
      "Draenei, Blood Elves, and later Allied Races are not in Forever — this is a Year One / vanilla-plus branch.",
    ],
  };
}
