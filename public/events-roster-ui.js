function initBackgroundStars() {
  const el = document.getElementById("stars");
  if (!el || el.childElementCount > 0) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 70; i += 1) {
    const s = document.createElement("div");
    s.className = "star";
    const sz = Math.random() * 1.8 + 0.4;
    const o = 0.08 + Math.random() * 0.35;
    s.style.cssText = `width:${sz}px;height:${sz}px;top:${Math.random() * 100}%;left:${Math.random() * 100}%;--d:${2 + Math.random() * 4}s;--dl:${Math.random() * 4}s;--o:${o}`;
    frag.appendChild(s);
  }
  el.appendChild(frag);
}

const DISCORD_INVITE_URL = "https://discord.gg/TBnt5f8DFc";
const IMAGE_ASSET_VERSION = "20260521d";
/** Same guild as Leaderboard (/) WCL widgets — attendance tiers on roster cards. */
const EVENTS_WCL_GUILD_ID = 817080;
/** Slugs under `/images/guild-roles/{slug}.png` — must match server `RH_WCL_GUILD_ROLES` via `.toLowerCase()`. */
const GUILD_ROLE_BADGE_SLUGS = new Set(["peon", "grunt", "veteran", "core", "guildlead", "raidlead"]);
/** Core / leads are set in Account Assignment; Peon–Veteran on site follow WCL attendance (last N raids). */
const MANUAL_ONLY_GUILD_ROLES = new Set(["Core", "Guildlead", "Raidlead"]);
const ROLE_ORDER = ["Tanks", "Healers", "Melee", "Ranged"];
/** @type {Map<string, { name: string, raidsAttended: number, attendanceRate: number }>} */
let attendanceLeaderboardByKey = new Map();
let attendanceConsideredRaids = 0;
/** Unique leaderboard rows from last attendance fetch — used for parse-ceiling maxima. */
let attendanceLeaderboardRows = [];
/** Normalized WCL names from `/boss-times` PB clears — same roster pool as Best Time Raids (Raid Performance). */
let pbBestTimeRankedNameKeys = new Set();
/** MVP winners from `/api/voting/hall-of-fame`. */
let hallOfFameWinnerNameKeys = new Set();
/** Max peak parse % per role bracket across linked raiders this attendance window. */
let parseCeilingMaxByBracket = { tank: null, heal: null, dps: null };
/** Official WoW class colours (default UI palette). */
const WOW_CLASS_COLORS = {
  Warrior: "#C79C6E",
  Paladin: "#F58CBA",
  Hunter: "#ABD473",
  Rogue: "#FFF569",
  Priest: "#FFFFFF",
  "Death Knight": "#C41F3B",
  Shaman: "#0070DD",
  Mage: "#69CCF0",
  Warlock: "#9482C9",
  Druid: "#FF7D0A",
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Mirrors server `LOCALIZED_CLASS_SLUG_TO_ENGLISH_SLUG` — Raid-Helper can send DE/FR/ES class names.
 * Without this, `classicon_krieger.jpg` etc. 404 and prot detection never matches `warrior` / `paladin`.
 */
const LOCALIZED_CLASS_SLUG_TO_ENGLISH_SLUG = {
  warrior: "warrior",
  paladin: "paladin",
  hunter: "hunter",
  rogue: "rogue",
  priest: "priest",
  shaman: "shaman",
  mage: "mage",
  warlock: "warlock",
  druid: "druid",
  deathknight: "deathknight",
  krieger: "warrior",
  jaeger: "hunter",
  jager: "hunter",
  schurke: "rogue",
  priester: "priest",
  schamane: "shaman",
  magier: "mage",
  hexenmeister: "warlock",
  druide: "druid",
  todesritter: "deathknight",
  guerrier: "warrior",
  chasseur: "hunter",
  voleur: "rogue",
  pretre: "priest",
  chaman: "shaman",
  demoniste: "warlock",
  chevalierdelamort: "deathknight",
  guerrero: "warrior",
  cazador: "hunter",
  picaro: "rogue",
  sacerdote: "priest",
  brujo: "warlock",
  druida: "druid",
};

const CANONICAL_SLUG_TO_COLOR_CLASS = {
  warrior: "Warrior",
  paladin: "Paladin",
  hunter: "Hunter",
  rogue: "Rogue",
  priest: "Priest",
  shaman: "Shaman",
  mage: "Mage",
  warlock: "Warlock",
  druid: "Druid",
  deathknight: "Death Knight",
};

/** Real classes only — RH may send spec labels (e.g. Protection) in the class field; ignore those for icons. */
const VALID_WOW_CLASS_SLUGS = new Set([
  "warrior",
  "paladin",
  "hunter",
  "rogue",
  "priest",
  "shaman",
  "mage",
  "warlock",
  "druid",
  "deathknight",
]);

/** Same as server `RAID_HELPER_FALSE_CLASS_SLUGS` — RH sometimes puts "Tank" in the class field. */
const RAID_HELPER_FALSE_CLASS_SLUGS = new Set([
  "tank",
  "tanks",
  "schutz",
  "healer",
  "healers",
  "melee",
  "ranged",
  "caster",
  "casters",
  "mdps",
  "rdps",
]);

/** Zamimg uses English race ids in filenames (`raceicon_human_male.jpg`). */
const LOCALIZED_RACE_SLUG_TO_ENGLISH = {
  human: "human",
  orc: "orc",
  dwarf: "dwarf",
  nightelf: "nightelf",
  gnome: "gnome",
  tauren: "tauren",
  troll: "troll",
  scourge: "scourge",
  undead: "scourge",
  forsaken: "scourge",
  bloodelf: "bloodelf",
  draenei: "draenei",
  mensch: "human",
  zwerg: "dwarf",
  nachtelf: "nightelf",
  gnom: "gnome",
  untoter: "scourge",
  untote: "scourge",
  blutelf: "bloodelf",
  humain: "human",
  elfedelanuit: "nightelf",
  elfe: "nightelf",
  mortvivant: "scourge",
};

const ZAM_ICON_LARGE = "https://wow.zamimg.com/images/wow/icons/large";

/** Same URLs as server `ZAMIMG_PROT_SPEC_ICON_URL` — always works even before `/tbc-spec-icons.json` loads. */
const CANONICAL_PROT_SPEC_BADGE_URL = {
  warrior_protection: `${ZAM_ICON_LARGE}/ability_warrior_defensivestance.jpg`,
  paladin_protection: `${ZAM_ICON_LARGE}/spell_holy_sealofprotection.jpg`,
};

/** Bust when regenerating `public/tbc-spec-icons.json` via `scripts/fetch-tbc-spec-icons.mjs`. */
const TBC_SPEC_ICONS_JSON_VER = "20260511b";

/** Populated from `/tbc-spec-icons.json` (Wowhead TBC spell pages → zamimg large icon). */
let tbcSpecIconByKey = null;

/** Texture-only fallback if JSON missing or fetch failed (same filenames as zamimg `large/`). */
const SPEC_SPELL_ICON_TEXTURE_FALLBACK = {
  warrior_arms: "ability_warrior_savageblow",
  warrior_fury: "ability_warrior_innerrage",
  warrior_protection: "ability_warrior_defensivestance",
  paladin_holy: "spell_holy_holybolt",
  /** Used only if `tbc-spec-icons.json` unavailable; live icons come from Wowhead spell pages. */
  paladin_protection: "spell_holy_sealofprotection",
  paladin_retribution: "spell_holy_auraoflight",
  hunter_beastmastery: "ability_hunter_beasttaming",
  hunter_marksmanship: "ability_marksmanship",
  hunter_survival: "ability_hunter_swiftstrike",
  rogue_assassination: "ability_rogue_eviscerate",
  rogue_combat: "ability_backstab",
  rogue_subtlety: "ability_stealth",
  priest_discipline: "spell_holy_powerwordshield",
  priest_holy: "spell_holy_heal02",
  priest_shadow: "spell_shadow_shadowwordpain",
  shaman_elemental: "spell_nature_lightning",
  shaman_enhancement: "spell_nature_lightningshield",
  shaman_restoration: "spell_nature_magicimmunity",
  mage_arcane: "spell_holy_magicalsentry",
  mage_fire: "spell_fire_firebolt02",
  mage_frost: "spell_frost_frostbolt02",
  warlock_affliction: "spell_shadow_deathcoil",
  warlock_demonology: "spell_shadow_metamorphosis",
  warlock_destruction: "spell_shadow_rainoffire",
  druid_balance: "spell_nature_starfall",
  druid_feralcombat: "ability_druid_catform",
  druid_restoration: "spell_nature_healingtouch",
};

async function loadTbcSpecIconMap() {
  if (tbcSpecIconByKey) return tbcSpecIconByKey;
  try {
    const api = window.plbSessionApiCache;
    const url = `/tbc-spec-icons.json?v=${TBC_SPEC_ICONS_JSON_VER}`;
    const data = api
      ? await api.getJson(url, { credentials: "same-origin" })
      : await (async () => {
          const res = await fetch(url, { credentials: "same-origin" });
          if (!res.ok) throw new Error(String(res.status));
          return res.json().catch(() => ({}));
        })();
    tbcSpecIconByKey = data?.byKey && typeof data.byKey === "object" ? data.byKey : {};
  } catch {
    tbcSpecIconByKey = {};
  }
  return tbcSpecIconByKey;
}

/** Preferred icon URL for a `warrior_arms`-style key (Wowhead JSON first, then texture table). */
function specIconZamimgUrlForKey(key, player) {
  if (!key) return "";
  const prot = CANONICAL_PROT_SPEC_BADGE_URL[key];
  if (prot) return prot;
  if (
    key === "druid_feralcombat" &&
    player &&
    effectiveRosterClassSlug(player) === "druid" &&
    isTankRoleSlug(normalizedRoleSlugForSpec(player))
  ) {
    return `${ZAM_ICON_LARGE}/ability_racial_bearform.jpg`;
  }
  const row = tbcSpecIconByKey?.[key];
  const u = row?.iconUrl ? String(row.iconUrl).trim() : "";
  if (/^https?:\/\//i.test(u)) return u;
  const t = SPEC_SPELL_ICON_TEXTURE_FALLBACK[key];
  return t ? `${ZAM_ICON_LARGE}/${t}.jpg` : "";
}

function normalizeSlug(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^a-z0-9]+/g, "");
}

function canonicalWowClassSlug(classRaw) {
  const slug = normalizeSlug(classRaw);
  if (!slug) return "";
  if (RAID_HELPER_FALSE_CLASS_SLUGS.has(slug)) return "";
  const mapped = LOCALIZED_CLASS_SLUG_TO_ENGLISH_SLUG[slug];
  const resolved = mapped || slug;
  if (!VALID_WOW_CLASS_SLUGS.has(resolved)) return "";
  return resolved;
}

function wowClassColor(classNameRaw) {
  const slug = canonicalWowClassSlug(classNameRaw);
  const colorKey = CANONICAL_SLUG_TO_COLOR_CLASS[slug];
  return colorKey ? WOW_CLASS_COLORS[colorKey] || "var(--text)" : "var(--text)";
}

/** Extra zamimg textures if primary 404 (CDN edge cases). Keys match {@link resolvedSpecIconKey}. */
const SPEC_ZAMIMG_FALLBACK = {
  paladin_protection: ["spell_holy_devotionaura", "spell_holy_sealofvengeance"],
  /** Primary is defensive stance; fallbacks must differ so onerror can advance. */
  warrior_protection: ["ability_warrior_shieldwall", "inv_shield_06"],
};

/** Map common Raid-Helper / player shorthand to canonical spec slug for icon lookup. */
function canonicalSpecSlug(classSlug, specSlug) {
  const base = specSlug;
  const aliases = {
    arms: "arms",
    fury: "fury",
    prot: "protection",
    schutz: "protection",
    protection: "protection",
    holy: "holy",
    ret: "retribution",
    retribution: "retribution",
    bm: "beastmastery",
    beast: "beastmastery",
    beastmastery: "beastmastery",
    mm: "marksmanship",
    marksmanship: "marksmanship",
    survival: "survival",
    mut: "assassination",
    assassination: "assassination",
    combat: "combat",
    subtlety: "subtlety",
    disc: "discipline",
    discipline: "discipline",
    shadow: "shadow",
    ele: "elemental",
    elemental: "elemental",
    enh: "enhancement",
    enhancement: "enhancement",
    resto: "restoration",
    restoration: "restoration",
    arcane: "arcane",
    fire: "fire",
    frost: "frost",
    aff: "affliction",
    affliction: "affliction",
    demo: "demonology",
    demonology: "demonology",
    destro: "destruction",
    destruction: "destruction",
    balance: "balance",
    boomkin: "balance",
    feral: "feralcombat",
    feralcombat: "feralcombat",
    guardian: "feralcombat",
    bear: "feralcombat",
  };
  let spec = aliases[base] || base;
  if (classSlug === "druid" && spec === "guardian") spec = "feralcombat";
  if (classSlug === "druid" && (base === "feral" || base === "cat")) spec = "feralcombat";
  if ((classSlug === "warrior" || classSlug === "paladin") && spec === "tank") spec = "protection";
  return spec;
}

/** Raid-Helper uses both `Tank` and `Tanks` depending on template/version. */
function isTankRoleSlug(roleSlug) {
  return roleSlug === "tank" || roleSlug === "tanks" || roleSlug === "schutz";
}

/** RH sends singular/plural/alternate labels; normalize so slug checks match. */
function normalizedRoleSlugForSpec(player) {
  const raw = String(player?.roleName || "").trim();
  const low = raw.toLowerCase();
  if (low === "tank" || low === "tanks" || low === "schutz") return "tanks";
  if (low === "healer" || low === "healers") return "healers";
  if (low === "melee" || low === "mdps") return "melee";
  if (low === "ranged" || low === "rdps" || low === "caster" || low === "casters") return "ranged";
  return normalizeSlug(raw);
}

function inferSpecSlugFromRole(classSlug, roleSlug, specSlug) {
  let raw = specSlug;
  if (raw === "tank" || raw === "tanks") {
    if (classSlug === "warrior" || classSlug === "paladin") return "protection";
    if (classSlug === "druid") return "feralcombat";
  }
  if (raw) return raw;
  if (classSlug === "warrior" && isTankRoleSlug(roleSlug)) return "protection";
  if (classSlug === "paladin" && isTankRoleSlug(roleSlug)) return "protection";
  if (classSlug === "druid" && isTankRoleSlug(roleSlug)) return "feralcombat";
  return "";
}

/** Same merge as server `englishCanonicalClassSlugForEventsIcons`: RH + Rio + optional Battle.net snapshot; plate dispute uses Rio. */
function effectiveRosterClassSlug(player) {
  const rh = canonicalWowClassSlug(player?.className);
  const rio = canonicalWowClassSlug(player?.raiderIoClassName);
  const bnet = canonicalWowClassSlug(player?.blizzardClassName);
  const plate = new Set(["paladin", "warrior"]);
  if (plate.has(rh) && plate.has(rio) && rh !== rio) return rio;
  if (rh) return rh;
  if (rio) return rio;
  return bnet || "";
}

/** Resolves `warrior_protection` / `paladin_protection` etc.; tanks override wrong RH spec labels. */
function resolvedSpecIconKey(player) {
  const cls = effectiveRosterClassSlug(player);
  const roleSlug = normalizedRoleSlugForSpec(player);
  let rawSpec = normalizeSlug(player?.specName);
  if (/^protection\d+$/.test(rawSpec)) rawSpec = "protection";
  if ((cls === "warrior" || cls === "paladin") && rawSpec.includes("protection")) rawSpec = "protection";
  if (cls === "paladin" && isTankRoleSlug(roleSlug)) rawSpec = "protection";
  else if (cls === "warrior" && isTankRoleSlug(roleSlug)) rawSpec = "protection";
  else {
    if ((cls === "warrior" || cls === "paladin") && rawSpec === "schutz") rawSpec = "protection";
    rawSpec = inferSpecSlugFromRole(cls, roleSlug, rawSpec) || rawSpec;
    if ((cls === "warrior" || cls === "paladin") && rawSpec === "tank") rawSpec = "protection";
  }
  if (!cls || !rawSpec) return "";
  const spec = canonicalSpecSlug(cls, rawSpec);
  return `${cls}_${spec}`;
}

function rosterClassIconFallbackUrl(player) {
  const cls = effectiveRosterClassSlug(player).replace(/[^a-z]/g, "");
  if (!cls) return `${ZAM_ICON_LARGE}/inv_misc_questionmark.jpg`;
  return `${ZAM_ICON_LARGE}/classicon_${cls}.jpg`;
}

function genderForRacePortrait(genderRaw) {
  const g = String(genderRaw || "").trim().toLowerCase();
  if (g === "female" || g === "f") return "female";
  if (g === "male" || g === "m") return "male";
  return "";
}

/** Race slug for `raceicon_<race>_<gender>` textures (UI-internal names). */
function normalizeRacePortraitKey(raceRaw) {
  const s = normalizeSlug(raceRaw);
  if (!s) return "";
  const mapped = LOCALIZED_RACE_SLUG_TO_ENGLISH[s] || s;
  if (mapped === "undead" || mapped === "forsaken") return "scourge";
  return mapped;
}

function championPortraitCandidates(raceRaw, genderRaw) {
  const rk = normalizeRacePortraitKey(raceRaw);
  if (!rk) return [];
  let g = genderForRacePortrait(genderRaw);
  if (!g) g = "male";
  const urls = [`${ZAM_ICON_LARGE}/raceicon_${rk}_${g}.jpg`];
  if (rk === "scourge") urls.push(`${ZAM_ICON_LARGE}/raceicon_undead_${g}.jpg`);
  return [...new Set(urls)];
}

/** Ordered URLs for the spec badge: WCL Damage Done icon when present, then Raid-Helper/API URL, zamimg chain, class crest.
 * Never rely on a single URL — Blizzard/RH links often 404 or block hotlinks; `onerror` must have targets.
 * Unknown tank + prot-like text: canonical prot spell art unless WCL already supplied an icon. */
/** When WCL texture disagrees with RH class (both tanks are "Protection"), ignore WCL so canonical prot badge wins. */
function wclProtIconConflictsWithRosterClass(wclUrl, player) {
  const cls = effectiveRosterClassSlug(player);
  const u = String(wclUrl || "").toLowerCase();
  const war =
    u.includes("ability_warrior_defensivestance") ||
    u.includes("ability_warrior_shieldwall") ||
    u.includes("inv_shield_06") ||
    u.includes("inv_shield_05");
  const pal =
    u.includes("spell_holy_sealofprotection") ||
    u.includes("spell_holy_devotionaura") ||
    u.includes("spell_holy_sealofvengeance") ||
    u.includes("spell_holy_righteousfury");
  const key = resolvedSpecIconKey(player);
  if (key === "paladin_protection" && war && !pal) return true;
  if (key === "warrior_protection" && pal && !war) return true;
  if (cls === "paladin" && war && !pal) return true;
  if (cls === "warrior" && pal && !war) return true;
  // No class on roster: still show WCL prot texture — blocking it left only the question-mark fallback.
  // WCL "Feral" is often cat art; tanking druids should use bear — same key as melee cat.
  if (
    key === "druid_feralcombat" &&
    cls === "druid" &&
    isTankRoleSlug(normalizedRoleSlugForSpec(player)) &&
    u.includes("ability_druid_catform") &&
    !u.includes("bear")
  ) {
    return true;
  }
  return false;
}

/** Mirror server `classSlugFromWclDamageDoneType` — WCL `player.wclCombatSpecType` vs merged roster class. */
function classSlugFromWclCombatType(typeRaw) {
  const t = normalizeSlug(typeRaw);
  if (!t) return "";
  if (t === "arms" || t === "fury") return "warrior";
  if (t === "elemental" || t === "enhancement") return "shaman";
  if (t === "balance" || t === "feral" || t === "guardian") return "druid";
  if (t === "arcane" || t === "fire" || t === "frost") return "mage";
  if (t === "affliction" || t === "demonology" || t === "destruction") return "warlock";
  if (t === "assassination" || t === "combat" || t === "subtlety") return "rogue";
  if (t === "beastmastery" || t === "marksmanship" || t === "survival") return "hunter";
  if (t === "shadow" || t === "discipline") return "priest";
  return "";
}

function wclCombatSpecTypeAgreesWithPlayer(wclTypeRaw, player) {
  const rosterCls = effectiveRosterClassSlug(player);
  const implied = classSlugFromWclCombatType(wclTypeRaw);
  if (!implied || !rosterCls) return true;
  return implied === rosterCls;
}

function wclIconTextureLooksShaman(uRaw) {
  const u = String(uRaw || "").toLowerCase();
  return (
    u.includes("spell_nature_lightning") ||
    u.includes("spell_nature_magicimmunity") ||
    u.includes("spell_shaman") ||
    u.includes("ability_shaman") ||
    u.includes("spell_fire_totem") ||
    u.includes("spell_nature_earthbind") ||
    u.includes("spell_nature_nullwolf") ||
    u.includes("spell_nature_healingwave") ||
    u.includes("spell_fire_elementaldevastation")
  );
}

function wclIconTextureLooksWarriorFuryOrArms(uRaw) {
  const u = String(uRaw || "").toLowerCase();
  return (
    u.includes("ability_warrior_savageblow") ||
    u.includes("ability_warrior_innerrage") ||
    u.includes("spell_nature_bloodlust") ||
    u.includes("ability_dualwield") ||
    u.includes("ability_whirlwind")
  );
}

/** Drop WCL Damage Done portrait when spec texture / type disagrees with Raid Helper + Rio class (e.g. Shaman icon on Fury Warrior). */
function wclDamageDonePortraitConflictsWithRoster(wclUrl, player) {
  if (wclProtIconConflictsWithRosterClass(wclUrl, player)) return true;
  const cls = effectiveRosterClassSlug(player);
  if (!cls) return false;
  const specType = String(player?.wclCombatSpecType || "").trim();
  if (!wclCombatSpecTypeAgreesWithPlayer(specType, player)) return true;
  const u = String(wclUrl || "").toLowerCase();
  if (cls === "warrior" && wclIconTextureLooksShaman(u)) return true;
  if (cls === "shaman" && wclIconTextureLooksWarriorFuryOrArms(u)) return true;
  return false;
}

/** RH embed / attachClassic spec URL must not override canonical plate-tank badge (wrong texture). */
function rhEmbedSpecIconConflictsWithProtKey(iconUrl, key) {
  if (key !== "paladin_protection" && key !== "warrior_protection") return false;
  const u = String(iconUrl || "").toLowerCase();
  const war =
    u.includes("ability_warrior_defensivestance") ||
    u.includes("ability_warrior_shieldwall") ||
    u.includes("inv_shield_06") ||
    u.includes("inv_shield_05");
  const pal =
    u.includes("spell_holy_sealofprotection") ||
    u.includes("spell_holy_devotionaura") ||
    u.includes("spell_holy_sealofvengeance") ||
    u.includes("spell_holy_righteousfury");
  if (key === "paladin_protection" && war && !pal) return true;
  if (key === "warrior_protection" && pal && !war) return true;
  return false;
}

/** RH / Blizzard sometimes attach cat-form art for all Feral profiles; bear tanks need bear texture. */
function rhEmbedSpecConflictsWithDruidTank(iconUrl, key, player) {
  if (key !== "druid_feralcombat") return false;
  if (effectiveRosterClassSlug(player) !== "druid") return false;
  if (!isTankRoleSlug(normalizedRoleSlugForSpec(player))) return false;
  const u = String(iconUrl || "").toLowerCase();
  return u.includes("ability_druid_catform") && !u.includes("bear");
}

function displaySpecNameForRoster(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const slug = normalizeSlug(s);
  if (/^protection\d+$/.test(slug)) return "Protection";
  return s;
}

function rosterProtectionLikeSpec(player) {
  const sp = normalizeSlug(player?.specName || "");
  return (
    /^protection\d+$/.test(sp) ||
    sp.includes("protection") ||
    sp === "prot" ||
    sp === "schutz" ||
    sp === "tank" ||
    sp === "tanks"
  );
}

/** Tank bucket + Protection-like spec (RH often omits class; Rio can guess wrong e.g. Shaman). */
function isRosterTankProtSlot(player) {
  return isTankRoleSlug(normalizedRoleSlugForSpec(player)) && rosterProtectionLikeSpec(player);
}

/** Dual prot zamimg when plate tank visuals are ambiguous (empty RH class + junk Rio, wrong spec key, etc.). */
function plateTankAmbiguousDualProtZamimgCandidates(player, resolvedKey) {
  if (!isRosterTankProtSlot(player)) return [];
  const rhSnap = canonicalWowClassSlug(player?.raidHelperClassName);
  if (rhSnap === "druid") return [];

  if (resolvedKey === "warrior_protection" || resolvedKey === "paladin_protection") return [];

  const merged = effectiveRosterClassSlug(player);
  if (resolvedKey === "druid_feralcombat" && merged === "druid") return [];

  const out = [
    CANONICAL_PROT_SPEC_BADGE_URL.warrior_protection,
    CANONICAL_PROT_SPEC_BADGE_URL.paladin_protection,
  ];
  for (const f of SPEC_ZAMIMG_FALLBACK.warrior_protection || []) {
    out.push(`${ZAM_ICON_LARGE}/${f}.jpg`);
  }
  for (const f of SPEC_ZAMIMG_FALLBACK.paladin_protection || []) {
    out.push(`${ZAM_ICON_LARGE}/${f}.jpg`);
  }
  return out;
}

function specBadgePortraitChain(player) {
  const fromWcl = String(player?.wclSpecIconUrl || "").trim();
  const wclOk =
    /^https?:\/\//i.test(fromWcl) && !wclDamageDonePortraitConflictsWithRoster(fromWcl, player);
  const fromApi = String(player?.specIconUrl || "").trim();
  const key = resolvedSpecIconKey(player);
  const primaryZam = key ? specIconZamimgUrlForKey(key, player) : "";
  let extras =
    key && SPEC_ZAMIMG_FALLBACK[key] ? [...SPEC_ZAMIMG_FALLBACK[key]] : [];
  if (
    key === "druid_feralcombat" &&
    effectiveRosterClassSlug(player) === "druid" &&
    isTankRoleSlug(normalizedRoleSlugForSpec(player))
  ) {
    extras = ["ability_druid_demoralizingroar", "ability_druid_catform"];
  }
  const extraUrls = extras.map((f) => `${ZAM_ICON_LARGE}/${f}.jpg`);
  let protKey = key === "paladin_protection" || key === "warrior_protection";
  const urls = [];
  for (const u of plateTankAmbiguousDualProtZamimgCandidates(player, key)) urls.push(u);
  // Canonical prot zamimg first — WCL Damage Done uses one icon type for both plate tanks.
  if (protKey && primaryZam) {
    urls.push(primaryZam);
    for (const u of extraUrls) urls.push(u);
  }
  if (wclOk) urls.push(fromWcl);
  const apiOk =
    /^https?:\/\//i.test(fromApi) &&
    !rhEmbedSpecIconConflictsWithProtKey(fromApi, key) &&
    !rhEmbedSpecConflictsWithDruidTank(fromApi, key, player);
  if (apiOk) urls.push(fromApi);
  if (!protKey && primaryZam) urls.push(primaryZam);
  if (!protKey) for (const u of extraUrls) urls.push(u);
  urls.push(rosterClassIconFallbackUrl(player));
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** One portrait: spec icons first (when known), then race champion art, deduped — removes nested “badge” overlay. */
function rosterPortraitChain(player) {
  const specUrls = specBadgePortraitChain(player);
  const race = String(player?.race || "").trim();
  const gender = String(player?.gender || "").trim();
  const raceUrls = championPortraitCandidates(race, gender);
  const seen = new Set();
  const out = [];
  for (const u of [...specUrls, ...raceUrls]) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out.length ? out : [rosterClassIconFallbackUrl(player)];
}

/** Match Raid-Helper names to WCL leaderboard rows (strip optional realm suffix). */
/**
 * Normalise Raid-Helper / Discord display names to match WCL character names.
 * Strips "Name/Alt" (slash), then realm suffix after dash — WCL leaderboard is usually plain name.
 */
function rosterNameKey(name) {
  let s = String(name || "")
    .trim()
    .replace(/\u00a0/g, " ");
  const slash = s.indexOf("/");
  if (slash > 0) s = s.slice(0, slash).trim();
  return s
    .replace(/\s*[-–—]\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-\s]*$/u, "")
    .toLowerCase();
}

/** Primary label on roster cards — WoW character from API (`characterName`), else Raid Helper signup `name`. */
function eventsRosterCharacterLabel(player) {
  const cn = String(player?.characterName ?? "").trim();
  if (cn) return cn;
  return String(player?.name ?? "").trim();
}

/** Names to try against WCL attendance map (character vs Discord-style signup). */
function attendanceLookupNameCandidates(player) {
  const cn = String(player?.characterName ?? "").trim();
  const nm = String(player?.name ?? "").trim();
  const rio = String(player?.rioProfileLookupName ?? "").trim();
  const out = [];
  if (cn) out.push(cn);
  if (nm) out.push(nm);
  if (rio && rio !== cn && rio !== nm) out.push(rio);
  for (const alt of Array.isArray(player?.wclCharacters) ? player.wclCharacters : []) {
    const s = String(alt || "").trim();
    if (!s) continue;
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}

function attendanceRowForRosterPlayerResolved(player) {
  for (const n of attendanceLookupNameCandidates(player)) {
    const row = attendanceRowForRosterPlayer(n);
    if (row) return row;
  }
  /** Active-roster embeds `parseSummaries` + attendance fields on each player; `/attendance` list can omit a row (top-N slice) while roster still returns them. */
  if (player?.parseSummaries && typeof player.parseSummaries === "object") {
    return player;
  }
  return null;
}

/** Stable key for roster-relative attendance tiers when comparing players on the same event. */
function rosterAttendanceCompareKey(player) {
  const cn = String(player?.characterName ?? "").trim();
  if (cn) return rosterNameKey(cn);
  return rosterNameKey(player?.name || "");
}

/** Lookup WCL attendance row — tries canonical key first, then rare alternate keys. */
function attendanceRowForRosterPlayer(playerName) {
  const primary = rosterNameKey(playerName);
  let row = attendanceLeaderboardByKey.get(primary);
  if (row) return row;
  const raw = String(playerName || "").trim().toLowerCase();
  if (raw !== primary) row = attendanceLeaderboardByKey.get(raw);
  return row || null;
}

/** RH sends singular/plural/alternate labels; normalize for parse bracket + Events grouping. */
function rosterBucketRoleName(roleName) {
  const low = String(roleName || "").trim().toLowerCase();
  if (low === "tank" || low === "tanks" || low === "schutz") return "Tanks";
  if (low === "healer" || low === "healers") return "Healers";
  if (low === "melee" || low === "mdps") return "Melee";
  if (low === "ranged" || low === "rdps" || low === "caster" || low === "casters") return "Ranged";
  const r = String(roleName || "").trim();
  return ROLE_ORDER.includes(r) ? r : "Ranged";
}

function rosterParseBracketForRole(roleNameRaw) {
  const r = rosterBucketRoleName(roleNameRaw);
  if (r === "Healers") return "heal";
  if (r === "Tanks") return "tank";
  return "dps";
}

function rosterParseBracketTooltipLabel(bracket) {
  if (bracket === "heal") return "healing (HPS)";
  if (bracket === "tank") return "tank (DPS metric)";
  return "DPS";
}

function rosterParseSourceForBracket(ps, bracket, usedFallback) {
  if (!ps || typeof ps !== "object") return null;
  if (bracket === "heal") return usedFallback ? ps.bestDpsSource || null : ps.bestHealSource || null;
  if (bracket === "tank") return usedFallback ? ps.bestDpsSource || null : ps.bestTankSource || null;
  return ps.bestDpsSource || null;
}

/** Hover line: boss + WCL report + fight + log character (from server best*Source). */
function rosterParseSourceTooltipFragment(src) {
  if (!src || typeof src !== "object") return "";
  const boss = String(src.encounterName || "").trim() || "Boss";
  const code = String(src.reportCode || "").trim();
  const fid = src.fightId != null && src.fightId !== "" ? String(src.fightId) : "";
  const who = String(src.wclCharacterName || "").trim();
  const metric = String(src.metric || "").trim().toUpperCase();
  const parts = [boss];
  if (code) parts.push(`report ${code}`);
  if (fid) parts.push(`fight #${fid}`);
  if (who) parts.push(`log name ${who}`);
  if (metric) parts.push(metric);
  let frag = ` · Source: ${parts.join(" · ")}`;
  if (code && fid) {
    frag += ` · https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}#fight=${encodeURIComponent(fid)}`;
  } else if (code) {
    frag += ` · https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}`;
  }
  return frag;
}

function rosterParseForDisplay(player, row) {
  const ps = row?.parseSummaries;
  const bracket = rosterParseBracketForRole(player?.roleName);
  if (!ps || typeof ps !== "object") {
    return { value: null, bracket, usedFallback: false, raidsWithBracket: 0, parseSource: null };
  }

  let value = null;
  let usedFallback = false;
  let raidsWithBracket = 0;

  const bt = finiteParseNumClient(ps.bestTank ?? ps.avgTank);
  const bd = finiteParseNumClient(ps.bestDps ?? ps.avgDps);
  const bh = finiteParseNumClient(ps.bestHeal ?? ps.avgHeal);
  /** 0 is often a sentinel or bad row; do not prefer it over a real DPS parse for heal/tank roles. */
  const hasTankParse = bt != null && bt > 0;
  const hasHealParse = bh != null && bh > 0;

  if (bracket === "heal") {
    raidsWithBracket = Number(ps.raidsHeal || 0);
    value = hasHealParse ? bh : bd;
    usedFallback = !hasHealParse && bd != null;
    if (usedFallback) raidsWithBracket = Number(ps.raidsDps || 0);
  } else if (bracket === "tank") {
    raidsWithBracket = Number(ps.raidsTank || 0);
    value = hasTankParse ? bt : bd;
    usedFallback = !hasTankParse && bd != null;
    if (usedFallback) raidsWithBracket = Number(ps.raidsDps || 0);
  } else {
    value = bd;
    raidsWithBracket = Number(ps.raidsDps || 0);
  }

  const parseSource = rosterParseSourceForBracket(ps, bracket, usedFallback);

  return {
    value: finiteParseNumClient(value),
    bracket,
    usedFallback,
    raidsWithBracket,
    parseSource,
  };
}

function rosterRelativeAttendanceHint(player, confirmedRoster) {
  const roster = Array.isArray(confirmedRoster) ? confirmedRoster : [];
  const keyed = [];
  for (const p of roster) {
    const row = attendanceRowForRosterPlayerResolved(p);
    if (row && Number.isFinite(Number(row.attendanceRate))) {
      keyed.push({ key: rosterAttendanceCompareKey(p), rate: Number(row.attendanceRate) });
    }
  }
  keyed.sort((a, b) => a.rate - b.rate || a.key.localeCompare(b.key));
  const idx = keyed.findIndex((k) => k.key === rosterAttendanceCompareKey(player));
  if (idx < 0 || keyed.length === 0) return "";
  return ` ${idx + 1}/${keyed.length} on this roster (low→high WCL %)`;
}

function finiteParseNumClient(x) {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function applyParseCeilingMaxFromPayload(raw) {
  if (!raw || typeof raw !== "object") return false;
  const tank = finiteParseNumClient(raw.tank);
  const heal = finiteParseNumClient(raw.heal);
  const dps = finiteParseNumClient(raw.dps);
  if (tank == null && heal == null && dps == null) return false;
  parseCeilingMaxByBracket = { tank, heal, dps };
  return true;
}

function recomputeParseCeilingMaxes() {
  parseCeilingMaxByBracket = { tank: null, heal: null, dps: null };
  const seen = new Set();
  for (const row of attendanceLeaderboardRows) {
    const id = String(row?.raidHelperName || row?.name || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ps = row?.parseSummaries;
    if (!ps || typeof ps !== "object") continue;
    const bt = finiteParseNumClient(ps.bestTank ?? ps.avgTank);
    const bh = finiteParseNumClient(ps.bestHeal ?? ps.avgHeal);
    const bd = finiteParseNumClient(ps.bestDps ?? ps.avgDps);
    if (bt != null && bt > 0) {
      const cur = parseCeilingMaxByBracket.tank;
      parseCeilingMaxByBracket.tank = cur == null ? bt : Math.max(cur, bt);
    }
    if (bh != null && bh > 0) {
      const cur = parseCeilingMaxByBracket.heal;
      parseCeilingMaxByBracket.heal = cur == null ? bh : Math.max(cur, bh);
    }
    if (bd != null && bd > 0) {
      const cur = parseCeilingMaxByBracket.dps;
      parseCeilingMaxByBracket.dps = cur == null ? bd : Math.max(cur, bd);
    }
  }
}

function playerMatchesAchievementNameSet(player, keySet) {
  if (!keySet?.size) return false;
  for (const n of attendanceLookupNameCandidates(player)) {
    const s = String(n || "").trim();
    if (!s) continue;
    if (keySet.has(rosterNameKey(s)) || keySet.has(s.toLowerCase())) return true;
  }
  for (const alt of Array.isArray(player?.wclCharacters) ? player.wclCharacters : []) {
    const s = String(alt || "").trim();
    if (!s) continue;
    if (keySet.has(rosterNameKey(s)) || keySet.has(s.toLowerCase())) return true;
  }
  return false;
}

function playerEarnedBestTimeParticipantBadge(player) {
  return playerMatchesAchievementNameSet(player, pbBestTimeRankedNameKeys);
}

function playerEarnedHallOfFameMvpBadge(player) {
  return playerMatchesAchievementNameSet(player, hallOfFameWinnerNameKeys);
}

function playerEarnedIronAttendanceBadge(player) {
  const row = attendanceRowForRosterPlayerResolved(player);
  const cap = attendanceConsideredRaids;
  if (!row || !cap) return false;
  return Number(row.raidsAttended || 0) === cap;
}

function parsePeakEqualsCeiling(value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m)) return false;
  // Same ceiling only — no Math.round tie-break (would award 98.x when max is 99.x).
  return Math.abs(v - m) <= 0.02 + 1e-9;
}

function playerEarnedParsingCeilingBadge(player) {
  const row = attendanceRowForRosterPlayerResolved(player);
  if (!row || attendanceConsideredRaids <= 0) return false;
  const { value, bracket, usedFallback } = rosterParseForDisplay(player, row);
  if (value == null || !Number.isFinite(Number(value))) return false;
  let k = bracket === "heal" ? "heal" : bracket === "tank" ? "tank" : "dps";
  if (usedFallback && (bracket === "heal" || bracket === "tank")) {
    k = "dps";
  }
  const max = parseCeilingMaxByBracket[k];
  if (max == null || !Number.isFinite(Number(max))) return false;
  return parsePeakEqualsCeiling(value, max);
}

/** Order: Best time → Hall of Fame → Iron attendance → Parsing ceiling (tooltips are full sentence for title=). */
function rosterAchievementBadgesHtml(player) {
  const badges = [
    {
      file: "best-time-participant.png",
      title:
        "Best time participant — Your Warcraft Logs character appears in the ranked roster of at least one guild fastest full-clear log (same names as Best Time Raids on Raid Performance).",
      alt: "Best time participant",
      ok: playerEarnedBestTimeParticipantBadge(player),
    },
    {
      file: "hall-of-fame.png",
      title:
        "MVP hall of fame — You won a raid MVP vote in a past round (listed on the Hall of Fame page).",
      alt: "MVP hall of fame",
      ok: playerEarnedHallOfFameMvpBadge(player),
    },
    {
      file: "iron-attendance.png",
      title:
        "Iron attendance — 100% attendance in the current tracked raid window (every raid counted on this card; typically all of the last six 25-player raids).",
      alt: "Iron attendance",
      ok: playerEarnedIronAttendanceBadge(player),
    },
    {
      file: "parsing-ceiling.png",
      title:
        "Parsing ceiling — Highest peak parse in your role this window among all linked raiders (tank, healer, or DPS vs your Raid Helper role bracket).",
      alt: "Parsing ceiling",
      ok: playerEarnedParsingCeilingBadge(player),
    },
  ];
  return badges
    .filter((b) => b.ok)
    .map(
      (b) =>
        `<span class="raider-badge-slot raider-badge-slot--achievement-earned" title="${escapeHtml(b.title)}"><img class="raider-badge-achievement-img" src="${escapeHtml(`/images/achievements/${b.file}?v=${IMAGE_ASSET_VERSION}`)}" alt="${escapeHtml(b.alt)}" width="44" height="44" loading="lazy" decoding="async" /></span>`
    )
    .join("");
}

async function loadWclAttendanceForEvents() {
  attendanceLeaderboardByKey = new Map();
  attendanceConsideredRaids = 0;
  attendanceLeaderboardRows = [];
  pbBestTimeRankedNameKeys = new Set();
  hallOfFameWinnerNameKeys = new Set();
  parseCeilingMaxByBracket = { tank: null, heal: null, dps: null };
  try {
    const api = window.plbSessionApiCache;
    const getJson = (url, init) =>
      api
        ? api.getJson(url, init)
        : fetch(url, { method: "GET", ...init }).then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || "Request failed");
            return body;
          });
    const [attPayload, btPayload, hofPayload] = await Promise.all([
      getJson(`/api/wcl/guild/${EVENTS_WCL_GUILD_ID}/attendance?limit=40&top=250`, { credentials: "include" }).catch(
        () => ({})
      ),
      getJson(`/api/wcl/guild/${EVENTS_WCL_GUILD_ID}/boss-times?limit=50`).catch(() => ({})),
      getJson(`/api/voting/hall-of-fame`, { credentials: "include" }).catch(() => ({})),
    ]);

    if (attPayload && typeof attPayload === "object") {
      attendanceConsideredRaids = Math.max(0, Number(attPayload.consideredRaids || 0));
      attendanceLeaderboardRows = Array.isArray(attPayload.leaderboard) ? attPayload.leaderboard : [];
      for (const row of attendanceLeaderboardRows) {
        const display = String(row?.raidHelperName || row?.name || "").trim();
        if (!display) continue;
        const key = rosterNameKey(display);
        attendanceLeaderboardByKey.set(key, row);
        const rawLower = display.toLowerCase();
        if (rawLower !== key) attendanceLeaderboardByKey.set(rawLower, row);
        for (const alt of Array.isArray(row?.wclCharacters) ? row.wclCharacters : []) {
          const ak = rosterNameKey(String(alt || ""));
          if (ak && !attendanceLeaderboardByKey.has(ak)) attendanceLeaderboardByKey.set(ak, row);
        }
      }
      if (!applyParseCeilingMaxFromPayload(attPayload.parseCeilingMax)) {
        recomputeParseCeilingMaxes();
      }
    }

    const rosterList = btPayload?.rosterInfo?.recentRankedRoster;
    if (Array.isArray(rosterList)) {
      for (const name of rosterList) {
        const s = String(name || "").trim();
        if (!s) continue;
        pbBestTimeRankedNameKeys.add(rosterNameKey(s));
        pbBestTimeRankedNameKeys.add(s.toLowerCase());
      }
    }

    if (hofPayload?.ok && Array.isArray(hofPayload.hallOfFame)) {
      for (const h of hofPayload.hallOfFame) {
        const w = String(h?.winnerName || "").trim();
        if (!w) continue;
        hallOfFameWinnerNameKeys.add(rosterNameKey(w));
        hallOfFameWinnerNameKeys.add(w.toLowerCase());
      }
    }
  } catch (err) {
    console.warn("[plb] loadWclAttendanceForEvents failed — achievement/KPI badges may be incomplete:", err);
  }
}

/** Matches Events / roster copy: same capped recent 25-player window as attendance %. */
function rosterLastRaidsKpiPhrase() {
  const n = attendanceConsideredRaids;
  if (!Number.isFinite(n) || n <= 0) return "recent raids";
  if (n === 6) return "last 6 raids";
  return `last ${n} raids`;
}

function rosterCardKpisHtml(player, confirmedRoster) {
  const row = attendanceRowForRosterPlayerResolved(player);
  const period = rosterLastRaidsKpiPhrase();
  const periodParen = `(${period})`;

  const mergedLogs =
    Array.isArray(row?.wclCharacters) && row.wclCharacters.length > 1
      ? ` · merged logs: ${row.wclCharacters.join(", ")}`
      : "";

  let attValue = "—";
  let attTitle =
    row && attendanceConsideredRaids > 0
      ? `WCL attendance (${period}): ${Number(row.raidsAttended || 0)}/${attendanceConsideredRaids} raids · ${Math.round(
          Number(row.attendanceRate || 0)
        )}% overall${mergedLogs}${rosterRelativeAttendanceHint(player, confirmedRoster)}`
      : row
        ? "Attendance rate unavailable for this window."
        : "No WCL attendance match in leaderboard.";
  if (row && attendanceConsideredRaids > 0) {
    attValue = `${Number(row.raidsAttended || 0)}/${attendanceConsideredRaids} · ${Math.round(
      Number(row.attendanceRate || 0)
    )}%`;
  }

  const { value, bracket, usedFallback, raidsWithBracket, parseSource } = rosterParseForDisplay(player, row);
  const bracketLabel = rosterParseBracketTooltipLabel(bracket);
  const sourceFrag = rosterParseSourceTooltipFragment(parseSource);
  const pctRounded = value != null && Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;

  let parseValue = "—";
  const fb = usedFallback ? " · used DPS bracket (heal/tank role had no HPS/tank row)" : "";
  let parseTitle =
    row && attendanceConsideredRaids > 0
      ? pctRounded != null
        ? `Peak parse (${period}): best single-boss ${pctRounded}% (${bracketLabel}) — max across tracked 25-player logs · rank data in ${raidsWithBracket}/${attendanceConsideredRaids} logs${mergedLogs}${sourceFrag}${fb}`
        : `No WCL parse for ${bracketLabel} in ${period}${mergedLogs}`
      : "No WCL attendance row — parse unavailable.";
  if (row && attendanceConsideredRaids > 0 && pctRounded != null) {
    parseValue = `${pctRounded}% · ${bracketLabel}${usedFallback ? " · DPS" : ""}`;
  }

  return `
    <div class="raider-card-kpis" role="group" aria-label="Warcraft Logs KPIs for ${escapeHtml(period)}">
      <div class="raider-kpi raider-kpi--attendance" title="${escapeHtml(attTitle)}">
        <span class="raider-kpi-heading">Attendance <span class="raider-kpi-period">${escapeHtml(periodParen)}</span></span>
        <span class="raider-kpi-metric">${escapeHtml(attValue)}</span>
      </div>
      <div class="raider-kpi raider-kpi--parse" title="${escapeHtml(parseTitle)}">
        <span class="raider-kpi-heading">Peak parse <span class="raider-kpi-period">${escapeHtml(periodParen)}</span></span>
        <span class="raider-kpi-metric">${escapeHtml(parseValue)}</span>
      </div>
    </div>
  `;
}

function rosterGuildRoleSlug(player) {
  const raw = String(player?.guildRole ?? "Peon").trim();
  const slug = raw.toLowerCase();
  return GUILD_ROLE_BADGE_SLUGS.has(slug) ? slug : "peon";
}

function assignedGuildRoleFromPlayer(player) {
  return String(player?.guildRole ?? "Peon").trim() || "Peon";
}

/** Raids attended in the same capped window as KPI / % (typically last 6 tracked 25-player raids). */
function attendanceRaidsCountForPlayer(player) {
  const direct = Number(player?.raidsAttended);
  if (Number.isFinite(direct) && direct >= 0) return Math.min(6, Math.floor(direct));
  const row = attendanceRowForRosterPlayerResolved(player);
  if (row) return Math.min(6, Math.floor(Number(row.raidsAttended || 0)));
  return 0;
}

/** 1 raid → Peon, 2–4 → Grunt, 5–6 → Veteran (within the attendance window). */
function attendanceTierGuildRoleFromRaids(raidsRaw) {
  const r = Math.max(0, Math.min(6, Math.floor(Number(raidsRaw) || 0)));
  if (r <= 1) return "Peon";
  if (r <= 4) return "Grunt";
  return "Veteran";
}

function attendanceTierGuildRole(player) {
  return attendanceTierGuildRoleFromRaids(attendanceRaidsCountForPlayer(player));
}

/** Primary rank label: manual Core / Guildlead / Raidlead; else attendance-based Peon–Veteran. */
function primaryGuildRankLabel(player) {
  const assigned = assignedGuildRoleFromPlayer(player);
  if (MANUAL_ONLY_GUILD_ROLES.has(assigned)) return assigned;
  return attendanceTierGuildRole(player);
}

function showAttendanceCompanionBadge(player) {
  return MANUAL_ONLY_GUILD_ROLES.has(assignedGuildRoleFromPlayer(player));
}

function rosterGuildRoleBadgeSrcForLabel(roleLabel) {
  const slug = rosterGuildRoleSlug({ guildRole: roleLabel });
  return `/images/guild-roles/${slug}.png?v=${IMAGE_ASSET_VERSION}`;
}

/** Primary guild rank badge (manual officer art OR attendance tier for everyone else). */
function rosterGuildRoleBadgeHtml(player) {
  const roleLabel = primaryGuildRankLabel(player);
  const title = `Guild rank: ${roleLabel}`;
  const src = escapeHtml(rosterGuildRoleBadgeSrcForLabel(roleLabel));
  const alt = escapeHtml(`Guild rank: ${roleLabel}`);
  return `<span class="raider-badge-slot raider-badge-slot--guild-role" title="${escapeHtml(title)}"><img class="raider-badge-role-img" src="${src}" alt="${alt}" width="44" height="44" loading="lazy" decoding="async" /></span>`;
}

/** Second badge for officers only: attendance-based Peon / Grunt / Veteran. */
function rosterAttendanceCompanionBadgeHtml(player) {
  if (!showAttendanceCompanionBadge(player)) return "";
  const tier = attendanceTierGuildRole(player);
  const raids = attendanceRaidsCountForPlayer(player);
  const cap = Math.max(1, attendanceConsideredRaids || 6);
  const title = `Attendance rank (last ${cap} tracked 25-player raids): ${tier} · ${raids}/${cap} raids`;
  const src = escapeHtml(rosterGuildRoleBadgeSrcForLabel(tier));
  const alt = escapeHtml(`Attendance rank: ${tier}`);
  return `<span class="raider-badge-slot raider-badge-slot--guild-role raider-badge-slot--attendance-companion" title="${escapeHtml(title)}"><img class="raider-badge-role-img" src="${src}" alt="${alt}" width="44" height="44" loading="lazy" decoding="async" /></span>`;
}

/** Section heading for guild roster page — rank badge + label (decorative img alt empty; label is visible). */
function rosterGuildRoleSectionTitleHtml(roleLabel, count) {
  const label = String(roleLabel ?? "Peon").trim() || "Peon";
  const slug = rosterGuildRoleSlug({ guildRole: label });
  const src = escapeHtml(`/images/guild-roles/${slug}.png?v=${IMAGE_ASSET_VERSION}`);
  const tip = escapeHtml(`Guild rank: ${label}`);
  return `
    <div class="roster-role-title roster-role-title--guild-tier">
      <span class="roster-section-guild-badge raider-badge-slot raider-badge-slot--guild-role" title="${tip}">
        <img class="raider-badge-role-img" src="${src}" alt="" width="28" height="28" loading="lazy" decoding="async" />
      </span>
      <span class="roster-role-title-text">${escapeHtml(label)} <span class="roster-role-title-count">(${Number(count) || 0})</span></span>
    </div>`;
}

function rosterBadgeRowHtml(player) {
  return `${rosterGuildRoleBadgeHtml(player)}${rosterAttendanceCompanionBadgeHtml(player)}${rosterAchievementBadgesHtml(player)}`;
}

/** English class label for roster text — matches {@link effectiveRosterClassSlug} (Rio wins Warrior vs Paladin disagreements). */
function mergedClassDisplayLabel(player) {
  let rh = String(player?.className ?? "").trim();
  let rio = String(player?.raiderIoClassName ?? "").trim();
  const bnet = String(player?.blizzardClassName ?? "").trim();
  const rhSnapSlug = canonicalWowClassSlug(player?.raidHelperClassName);
  const plateTankNoRhClass = isRosterTankProtSlot(player) && !rhSnapSlug;

  const slugLooksOffMetaPlateTank = (slug) =>
    Boolean(slug) && !["warrior", "paladin", "druid", "deathknight"].includes(slug);

  if (plateTankNoRhClass) {
    if (slugLooksOffMetaPlateTank(canonicalWowClassSlug(rh))) rh = "";
    if (slugLooksOffMetaPlateTank(canonicalWowClassSlug(rio))) rio = "";
  }

  const rhSlug = canonicalWowClassSlug(rh);
  const rioSlug = canonicalWowClassSlug(rio);
  const plate = new Set(["paladin", "warrior"]);
  if (plate.has(rhSlug) && plate.has(rioSlug) && rhSlug !== rioSlug) return rio;
  if (rh) return rh;
  if (rio) return rio;
  return bnet || "";
}

/** Hover text when Raid Helper and Raider.io disagree or supplement each other. */
function rosterClassSpecSourcesTooltip(player) {
  const rhC = String(player?.raidHelperClassName ?? "").trim();
  const rhS = String(player?.raidHelperSpecName ?? "").trim();
  const rioC = String(player?.raiderIoClassName ?? "").trim();
  const rioS = String(player?.raiderIoSpecName ?? "").trim();
  const parts = [];
  if (rhC) parts.push(`Raid Helper class: ${rhC}`);
  if (rhS) parts.push(`Raid Helper spec: ${rhS}`);
  if (rioC) parts.push(`Raider.io class: ${rioC}`);
  if (rioS) parts.push(`Raider.io spec: ${rioS}`);
  const bnetC = String(player?.blizzardClassName ?? "").trim();
  if (bnetC) parts.push(`Battle.net class: ${bnetC}`);
  return parts.join(" · ");
}

function rosterRaiderCard(player, confirmedRoster) {
  const displayName = eventsRosterCharacterLabel(player);
  const className = mergedClassDisplayLabel(player);
  const color = wowClassColor(className);
  const specLabel = displaySpecNameForRoster(String(player.specName || "").trim());
  const portraitChain = rosterPortraitChain(player);
  const portraitSrc = escapeHtml(portraitChain[0] || "");
  const portraitFb = portraitChain
    .slice(1)
    .map((u) => escapeHtml(u))
    .join("|");
  const portraitAlt = specLabel ? `${displayName} · ${className} · ${specLabel}` : `${displayName} · ${className}`;
  const priestGlow =
    effectiveRosterClassSlug(player) === "priest"
      ? "text-shadow:0 0 6px rgba(0,0,0,.85),0 1px 2px rgba(0,0,0,.9);"
      : "";
  const rhSignupTip =
    String(player?.name || "").trim() !== displayName
      ? ` · Raid Helper signup: ${String(player?.name || "").trim()}`
      : "";
  const sourcesTip = `${rosterClassSpecSourcesTooltip(player)}${rhSignupTip}`;
  const cardTitleAttr = sourcesTip ? ` title="${escapeHtml(sourcesTip)}"` : "";

  return `
    <div class="raider-card"${cardTitleAttr}>
      ${rosterCardKpisHtml(player, confirmedRoster)}
      <div class="raider-card-main">
        <div class="raider-portrait-stack">
          <img
            class="raider-champion-img"
            src="${portraitSrc}"
            alt="${escapeHtml(portraitAlt)}"
            width="48"
            height="48"
            loading="lazy"
            decoding="async"
            data-champ-fallbacks="${portraitFb}"
            onerror="(function(el){var raw=el.getAttribute('data-champ-fallbacks');if(!raw){el.onerror=null;return;}var parts=raw.split('|').filter(Boolean);var i=Number(el.dataset.champI||0);if(i<parts.length){el.dataset.champI=String(i+1);el.src=parts[i];}else{el.onerror=null;}})(this)"
          />
        </div>
        <div class="raider-text">
          <div class="raider-name-line">
            <span class="raider-name" style="color:${color};${priestGlow}">${escapeHtml(displayName)}</span>
            <span class="raider-guild-role-chip">${escapeHtml(primaryGuildRankLabel(player))}</span>
          </div>
          ${
            specLabel && className
              ? `<div class="raider-spec-line">${escapeHtml(specLabel)} · ${escapeHtml(className)}</div>`
              : `<div class="raider-spec-line">${escapeHtml(specLabel || className)}</div>`
          }
        </div>
      </div>
      <div class="raider-badges" role="group" aria-label="Guild rank, attendance rank for officers, and earned achievement badges">
        ${rosterBadgeRowHtml(player)}
      </div>
    </div>
  `;
}

window.plbEventsRoster = {
  initBackgroundStars,
  escapeHtml,
  DISCORD_INVITE_URL,
  IMAGE_ASSET_VERSION,
  EVENTS_WCL_GUILD_ID,
  ROLE_ORDER,
  loadTbcSpecIconMap,
  loadWclAttendanceForEvents,
  rosterRaiderCard,
  rosterGuildRoleSectionTitleHtml,
  primaryGuildRankLabel,
  rosterBucketRoleName,
  eventsRosterCharacterLabel,
  rosterParseForDisplay,
  rosterParseSourceTooltipFragment,
  rosterNameKey,
  rosterBadgeRowHtml,
  rosterPortraitChain,
  mergedClassDisplayLabel,
  displaySpecNameForRoster,
  wowClassColor,
  effectiveRosterClassSlug,
};