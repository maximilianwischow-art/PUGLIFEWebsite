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
const IMAGE_ASSET_VERSION = "20260513master-crafters3";
/** Same guild as Leaderboard (/) WCL widgets — attendance tiers on roster cards. */
const EVENTS_WCL_GUILD_ID = 817080;
/** Slugs under `/images/guild-roles/{slug}.png` — must match server `RH_WCL_GUILD_ROLES` via `.toLowerCase()`. */
const GUILD_ROLE_BADGE_SLUGS = new Set([
  "peon",
  "grunt",
  "veteran",
  "core",
  "puglead",
  "guildlead",
  "raidlead",
  "dpslead",
  "heallead",
]);
/** Core / leads are set in Account Assignment; Peon–Veteran on site follow WCL attendance (last N raids). */
const MANUAL_ONLY_GUILD_ROLES = new Set(["Core", "Puglead", "Guildlead", "Raidlead", "Dpslead", "Heallead"]);
const GUILD_ROLE_SORT_ORDER = ["Puglead", "Raidlead", "Heallead", "Dpslead", "Core", "Veteran", "Grunt", "Peon"];
const ROLE_ORDER = ["Tanks", "Healers", "Melee", "Ranged"];
const PUG_MASTER_CRAFTER_ROLE_BADGES = [
  {
    badgeId: "master-crafter-tailoring",
    slug: "tailoring",
    name: "PUG Master Crafter: Tailoring",
    description: "Legendary role badge for a trusted PUG master crafter in Tailoring.",
    characterKeys: new Set(["mightyboom"]),
  },
  {
    badgeId: "master-crafter-leatherworking",
    slug: "leatherworking",
    name: "PUG Master Crafter: Leatherworking",
    description: "Legendary role badge for a trusted PUG master crafter in Leatherworking.",
    characterKeys: new Set(["gernig", "gerning"]),
  },
  {
    badgeId: "master-crafter-blacksmithing",
    slug: "blacksmithing",
    name: "PUG Master Crafter: Blacksmithing",
    description: "Legendary role badge for a trusted PUG master crafter in Blacksmithing.",
    characterKeys: new Set(["grandmadeath"]),
  },
];
/** @type {Map<string, { name: string, raidsAttended: number, attendanceRate: number }>} */
let attendanceLeaderboardByKey = new Map();
let attendanceConsideredRaids = 0;
/** Unique leaderboard rows from last attendance fetch — used for parse-ceiling maxima. */
let attendanceLeaderboardRows = [];
/** Normalized WCL names from `/boss-times` PB clears — same roster pool as Best Time Raids (Raid Performance). */
let pbBestTimeRankedNameKeys = new Set();
/** MVP winners from `/api/voting/hall-of-fame`. */
let hallOfFameWinnerNameKeys = new Set();
/** Top death totals from `/death-leaderboard` over the last 6 raids (ties included). */
let mostDeathsLastSixNameKeys = new Set();
/** First-clear participants by raid from `/first-clear-participants`. */
let firstClearKaraNameKeys = new Set();
let firstClearGruulNameKeys = new Set();
let firstClearMagNameKeys = new Set();
/** Uploaded profile pictures keyed by Discord user id ⇒ absolute URL (or null if explicitly cleared). */
const rosterProfilePictureByDiscordId = new Map();
/** Same pictures keyed by `rosterNameKey`-style normalized character name — populated by the
 *  character-name fallback when a player row has no Discord id available yet. */
const rosterProfilePictureByCharacterKey = new Map();
/** Discord ids we've already asked the batch endpoint about — avoids spamming network on re-renders. */
const rosterProfilePictureRequestedIds = new Set();
/** Character keys we've already asked the fallback endpoint about — same dedupe goal as above. */
const rosterProfilePictureRequestedCharacterKeys = new Set();
/** Resolves once the very first batch lookup for a render returns, so callers can await it before painting. */
let rosterProfilePicturesPendingFetch = null;
/** Classic Armory gear audit summaries keyed by lowercase character/signup name. */
let rosterGearSummaryByKey = new Map();
/** Legacy fallback: global max peak parse % per bracket (used when API has no encounter-top flags). */
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

const badgeTooltipById = new Map();
let badgeTooltipCatalogPromise = null;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badgeIdFromAchievementFile(fileName) {
  return String(fileName || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .trim();
}

function badgeTooltipFallbackDescription(rawTitle, fallbackName) {
  const title = String(rawTitle || "").trim();
  const name = String(fallbackName || "").trim();
  const sep = title.indexOf(" — ");
  if (sep >= 0) return title.slice(sep + 3).trim();
  return title && title !== name ? title : "";
}

function loadBadgeTooltipsOnce() {
  if (badgeTooltipCatalogPromise) return badgeTooltipCatalogPromise;
  badgeTooltipCatalogPromise = fetch("/api/badge-tooltips", { credentials: "include" })
    .then((res) => (res.ok ? res.json() : { rows: [] }))
    .then((payload) => {
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      for (const row of rows) {
        const id = String(row?.badgeId || "").trim();
        if (!id) continue;
        badgeTooltipById.set(id, {
          name: String(row?.name || "").trim(),
          description: String(row?.description || "").trim(),
          rarity: String(row?.rarity || "epic").trim() || "epic",
        });
      }
      return badgeTooltipById;
    })
    .catch(() => badgeTooltipById);
  return badgeTooltipCatalogPromise;
}

function badgeTooltipMeta(badgeId, fallbackName, fallbackDescription, rarity) {
  const fromCatalog = badgeTooltipById.get(String(badgeId || "").trim()) || {};
  const id = String(badgeId || "").trim();
  return {
    id,
    name: String(fromCatalog.name || fallbackName || "").trim(),
    description: String(fromCatalog.description || fallbackDescription || "").trim(),
    rarity: String(fromCatalog.rarity || rarity || "epic").trim() || "epic",
    glowColor: badgeTooltipGlowColor(id, String(fromCatalog.rarity || rarity || "epic")),
  };
}

function badgeTooltipGlowColor(badgeId, rarity) {
  const id = String(badgeId || "").trim();
  const byId = {
    "iron-attendance": "#22c55e",
    "parsing-ceiling": "#ef4444",
    "most-deaths-last-6-raids": "#f97316",
    "hall-of-fame": "#f97316",
    "best-time-participant": "#a855f7",
    "aoe-cleave": "#f97316",
    "ssc-first-event": "#14b8a6",
  };
  if (byId[id]) return byId[id];
  if (id.includes("first-time-clear")) return "#22c55e";
  if (id.startsWith("raids-with-guild-")) return "#a855f7";
  if (rarity === "legendary") return "#f97316";
  if (rarity === "rare") return "#0070de";
  if (rarity === "common") return "#9e9e9e";
  return "#a855f7";
}

function badgeTooltipRarityColor(rarity) {
  if (rarity === "legendary") return "rgba(255, 128, 0, 0.8)";
  if (rarity === "rare") return "rgba(0, 112, 222, 0.6)";
  if (rarity === "common") return "rgba(158, 158, 158, 0.5)";
  return "rgba(163, 53, 238, 0.7)";
}

function achievementTooltipHtml(meta) {
  const rarity = ["common", "rare", "epic", "legendary"].includes(meta.rarity) ? meta.rarity : "epic";
  const description = String(meta.description || "").trim();
  const style = `--achievement-glow-color:${meta.glowColor};--achievement-rarity-color:${badgeTooltipRarityColor(rarity)};`;
  return `
    <span class="achievement-tooltip" aria-hidden="true">
      <span class="achievement-tooltip-box rarity-${escapeHtml(rarity)}" style="${escapeHtml(style)}">
        <span class="achievement-name">${escapeHtml(meta.name)}</span>
        ${description ? `<span class="achievement-description">${escapeHtml(description)}</span>` : ""}
        <span class="achievement-rarity"><span class="achievement-rarity-text">${escapeHtml(rarity)}</span></span>
      </span>
    </span>`;
}

function achievementBadgeFrameAttrs(meta, extraClass = "") {
  const rarity = ["common", "rare", "epic", "legendary"].includes(meta?.rarity) ? meta.rarity : "epic";
  const classes = ["achievement-badge-frame", `achievement-badge-frame--${rarity}`, extraClass].filter(Boolean).join(" ");
  return `class="${escapeHtml(classes)}"`;
}

function achievementBadgeSlotAttrs(meta, baseClass) {
  const rarity = ["common", "rare", "epic", "legendary"].includes(meta?.rarity) ? meta.rarity : "epic";
  return `class="${escapeHtml(`${baseClass} achievement-badge-slot--${rarity}`)}"`;
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

/** Temporary class corrections for known roster-name mismatches in upstream payloads. */
const CLASS_OVERRIDE_BY_NAME_KEY = {
  mightyboom: "mage",
  therodox: "shaman",
};

function classOverrideSlugForPlayer(player) {
  const candidates = [
    String(player?.characterName || "").trim(),
    String(player?.name || "").trim(),
    String(player?.rioProfileLookupName || "").trim(),
  ];
  for (const c of candidates) {
    const k = rosterNameKey(c);
    if (!k) continue;
    const ov = CLASS_OVERRIDE_BY_NAME_KEY[k];
    if (ov) return ov;
  }
  return "";
}

/** Same merge as server `englishCanonicalClassSlugForEventsIcons`: RH + Rio + optional Battle.net snapshot; plate dispute uses Rio. */
/**
 * Last-resort class slug from a Warcraft Logs spec icon URL.
 * WCL Classic icons follow `…/icons/<class>-<spec>.jpg` — e.g. `mage-fire.jpg`,
 * `warrior-fury.jpg`, `priest-shadow.jpg`. When RH / Raider.io / Bnet armory
 * lookups all fail (cold cache on a fresh deploy), this still resolves a
 * sensible class crest instead of falling back to the red `?` placeholder.
 */
function classSlugFromWclSpecIconUrl(urlRaw) {
  const u = String(urlRaw || "").trim();
  if (!u) return "";
  // assets.rpglogs.com (and a few legacy WCL paths) serve spec icons as
  // `<basename>/<class>-<spec>.<ext>` — match the final segment regardless of
  // which folder it came from. Spell-icon URLs like `inv_misc_questionmark`
  // intentionally fall through `canonicalWowClassSlug` and yield "".
  const m = u.match(/([a-zA-Z]+)(?:-[a-zA-Z]+)?\.(?:jpg|jpeg|png|webp)(?:\?|$)/i);
  if (!m) return "";
  const candidate = String(m[1] || "").toLowerCase();
  return canonicalWowClassSlug(candidate);
}

function effectiveRosterClassSlug(player) {
  const override = classOverrideSlugForPlayer(player);
  if (override) return override;
  const rh = canonicalWowClassSlug(player?.className);
  const rio = canonicalWowClassSlug(player?.raiderIoClassName);
  const bnet = canonicalWowClassSlug(player?.blizzardClassName);
  const plate = new Set(["paladin", "warrior"]);
  if (plate.has(rh) && plate.has(rio) && rh !== rio) return rio;
  if (rh) return rh;
  if (rio) return rio;
  if (bnet) return bnet;
  // WCL Damage Done / Healing tables expose the player's class even when our
  // RH / Rio / Bnet enrichment chain has not warmed up yet — prefer that over
  // the inv_misc_questionmark.jpg placeholder.
  const wclType = classSlugFromWclCombatType(player?.wclCombatSpecType);
  if (wclType) return wclType;
  const wclIcon = classSlugFromWclSpecIconUrl(player?.wclSpecIconUrl);
  if (wclIcon) return wclIcon;
  return "";
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
  // WCL also returns the class display directly ("Mage", "Death Knight", etc.)
  // depending on the report’s table columns — accept those so that callers
  // can rely on this for class-fallback resolution, not just spec lookup.
  const classCandidate = canonicalWowClassSlug(typeRaw);
  if (classCandidate) return classCandidate;
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

/**
 * Look up the uploaded profile picture URL for a roster player (if any).
 * Tries the Discord-id-keyed map first (canonical), then falls back to the
 * character-name-keyed map for rows whose Account Assignment entry hasn't
 * been backfilled with a `discordUserId` yet — common right after a fresh
 * upload from someone whose admin-table row only has their RH display
 * name. Both maps are populated by `prefetchRosterProfilePictures`.
 */
function profilePictureUrlForRosterPlayer(player) {
  const id = String(player?.discordUserId || "").trim();
  if (id) {
    const direct = rosterProfilePictureByDiscordId.get(id);
    if (direct) return String(direct);
  }
  const candidates = [
    String(player?.characterName || "").trim(),
    String(player?.name || "").trim(),
    ...(Array.isArray(player?.wclCharacters) ? player.wclCharacters : []).map((x) => String(x || "").trim()),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = rosterNameKey(candidate);
    if (!key) continue;
    const url = rosterProfilePictureByCharacterKey.get(key);
    if (url) return String(url);
  }
  return "";
}

/**
 * Batch-fetch uploaded profile pictures for every roster player.
 * Two passes:
 *   1. Discord-ID lookup for rows that already declare `discordUserId`
 *      (canonical, fastest, populates `rosterProfilePictureByDiscordId`).
 *   2. Character-name fallback for rows still without a picture — covers
 *      users whose Account Assignment entry hasn't been backfilled with a
 *      Discord id yet but who already uploaded a picture and either set a
 *      main character or have a link row that lists their WCL name.
 *
 * Both passes cache "asked already" sets so re-renders don't re-fetch.
 *
 * @param {Array<{ discordUserId?: string | null, characterName?: string, name?: string, wclCharacters?: string[] }>} players
 * @returns {Promise<{ updatedCount: number }>}
 */
async function prefetchRosterProfilePictures(players) {
  const list = Array.isArray(players) ? players : [];
  const ids = [];
  const seenIds = new Set();
  for (const p of list) {
    const id = String(p?.discordUserId || "").trim();
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    if (rosterProfilePictureRequestedIds.has(id)) continue;
    ids.push(id);
  }

  rosterProfilePicturesPendingFetch = (async () => {
    let updated = 0;

    // Pass 1: Discord-id batch.
    if (ids.length) {
      try {
        const res = await fetch(`/api/profiles/by-user-ids?ids=${encodeURIComponent(ids.join(","))}`, {
          credentials: "include",
        });
        if (res.ok) {
          const payload = await res.json();
          const profiles = payload?.profiles && typeof payload.profiles === "object" ? payload.profiles : {};
          for (const id of ids) {
            rosterProfilePictureRequestedIds.add(id);
            const url = profiles[id]?.pictureUrl || null;
            if (url) {
              rosterProfilePictureByDiscordId.set(id, url);
              updated++;
            } else {
              rosterProfilePictureByDiscordId.set(id, null);
            }
          }
        }
      } catch {
        /* fall through to pass 2 */
      }
    }

    // Pass 2: character-name fallback for any player still without a hit.
    const missingNames = [];
    const nameKeysIncluded = new Set();
    for (const p of list) {
      if (profilePictureUrlForRosterPlayer(p)) continue;
      const candidates = [
        String(p?.characterName || "").trim(),
        String(p?.name || "").trim(),
      ].filter(Boolean);
      for (const candidate of candidates) {
        const key = rosterNameKey(candidate);
        if (!key) continue;
        if (rosterProfilePictureRequestedCharacterKeys.has(key)) continue;
        if (nameKeysIncluded.has(key)) continue;
        nameKeysIncluded.add(key);
        missingNames.push(candidate);
        // Only ask once per player; the server checks all variants for us.
        break;
      }
    }
    if (missingNames.length) {
      try {
        const res = await fetch(
          `/api/profiles/by-character-names?names=${encodeURIComponent(missingNames.join(","))}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const payload = await res.json();
          const profiles = payload?.profiles && typeof payload.profiles === "object" ? payload.profiles : {};
          for (const name of missingNames) {
            const key = rosterNameKey(name);
            if (!key) continue;
            rosterProfilePictureRequestedCharacterKeys.add(key);
            const url = profiles[name]?.pictureUrl || null;
            if (url) {
              rosterProfilePictureByCharacterKey.set(key, url);
              updated++;
            } else {
              rosterProfilePictureByCharacterKey.set(key, null);
            }
          }
        }
      } catch {
        /* leaderboard still renders with class crests */
      }
    }

    return { updatedCount: updated };
  })();
  return rosterProfilePicturesPendingFetch;
}

/**
 * Discard cached profile-picture URLs (e.g. after the user uploads a new image
 * via /profile.html and re-navigates to the leaderboard). Currently unused at
 * runtime but exported for future re-render flows.
 */
function resetRosterProfilePictureCache() {
  rosterProfilePictureByDiscordId.clear();
  rosterProfilePictureByCharacterKey.clear();
  rosterProfilePictureRequestedIds.clear();
  rosterProfilePictureRequestedCharacterKeys.clear();
  rosterProfilePicturesPendingFetch = null;
}

/** One portrait: profile-picture override → spec icons → race champion art → class crest fallback. */
function rosterPortraitChain(player) {
  const specUrls = specBadgePortraitChain(player);
  const race = String(player?.race || "").trim();
  const gender = String(player?.gender || "").trim();
  const raceUrls = championPortraitCandidates(race, gender);
  const profileUrl = profilePictureUrlForRosterPlayer(player);
  const seen = new Set();
  const out = [];
  // Profile picture wins so a raider who uploaded an avatar always sees it on
  // Leaderboard / Hall of Fame, regardless of how rich their WCL data is.
  if (profileUrl) {
    seen.add(profileUrl);
    out.push(profileUrl);
  }
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
  if (player?.preResolvedBadges?.bestTimeParticipant === true) return true;
  return playerMatchesAchievementNameSet(player, pbBestTimeRankedNameKeys);
}

function playerEarnedHallOfFameMvpBadge(player) {
  /* Phase 9 cutover: the leaderboard bundle (`/api/leaderboard`) stamps
     `mvpAwardCount` on each row from the materialised `mvp_awards` SQLite
     table, so the badge resolves without ever calling the live HoF
     pipeline. We still fall back to the legacy name-set when the bundle
     hasn't populated the field (other pages keep the old contract). */
  const fromBundle = Number(player?.mvpAwardCount);
  if (Number.isFinite(fromBundle) && fromBundle > 0) return true;
  if (player?.preResolvedBadges?.hallOfFameMvp === true) return true;
  return playerMatchesAchievementNameSet(player, hallOfFameWinnerNameKeys);
}

function playerEarnedMostDeathsLastSixBadge(player) {
  if (player?.preResolvedBadges?.mostDeathsLastSix === true) return true;
  return playerMatchesAchievementNameSet(player, mostDeathsLastSixNameKeys);
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
  const ps = row?.parseSummaries;
  const { value, bracket, usedFallback } = rosterParseForDisplay(player, row);
  let k = bracket === "heal" ? "heal" : bracket === "tank" ? "tank" : "dps";
  if (usedFallback && (bracket === "heal" || bracket === "tank")) {
    k = "dps";
  }
  if (ps && typeof ps === "object") {
    const hasEncounterFlags =
      ps.encounterTopTank !== undefined ||
      ps.encounterTopHeal !== undefined ||
      ps.encounterTopDps !== undefined;
    if (hasEncounterFlags) {
      if (k === "tank") return Boolean(ps.encounterTopTank);
      if (k === "heal") return Boolean(ps.encounterTopHeal);
      return Boolean(ps.encounterTopDps);
    }
  }
  if (value == null || !Number.isFinite(Number(value))) return false;
  const max = parseCeilingMaxByBracket[k];
  if (max == null || !Number.isFinite(Number(max))) return false;
  return parsePeakEqualsCeiling(value, max);
}

function playerEarnedFirstClearKaraBadge(player) {
  if (player?.preResolvedBadges?.firstClearKara === true) return true;
  return playerMatchesAchievementNameSet(player, firstClearKaraNameKeys);
}

function playerEarnedFirstClearGruulBadge(player) {
  if (player?.preResolvedBadges?.firstClearGruul === true) return true;
  return playerMatchesAchievementNameSet(player, firstClearGruulNameKeys);
}

function playerEarnedFirstClearMagBadge(player) {
  if (player?.preResolvedBadges?.firstClearMag === true) return true;
  return playerMatchesAchievementNameSet(player, firstClearMagNameKeys);
}

/**
 * Specific-raid attendance awards (e.g. "AOE Cleave — May 7 2026") are
 * resolved server-side from `raid_appearances` and stamped onto the
 * leaderboard payload as `player.specificEventBadges = ["aoe-cleave", ...]`.
 * No name-set lookup needed — we just check whether the badge id is in the
 * list the server attached for this canonical user.
 */
function playerEarnedSpecificEventBadge(player, badgeId) {
  const id = String(badgeId || "").trim();
  if (!id) return false;
  const list = Array.isArray(player?.specificEventBadges) ? player.specificEventBadges : null;
  if (!list) return false;
  return list.indexOf(id) !== -1;
}

function achievementBadgeIconUrlWithFallback(fileName) {
  const file = String(fileName || "").trim();
  const png = `/images/achievements/${file}?v=${IMAGE_ASSET_VERSION}`;
  if (!/\.png$/i.test(file)) {
    return { src: png, onerror: "" };
  }
  const svgFile = file.replace(/\.png$/i, ".svg");
  const svg = `/images/achievements/${svgFile}?v=${IMAGE_ASSET_VERSION}`;
  return { src: svg, onerror: ` onerror="this.onerror=null;this.src='${png}'"` };
}

/**
 * Raid milestone badges: distinct WCL guild raid reports the player
 * appeared in, scoped to the admin Event Management selection. We read
 * `wclEventCount` first (the Phase 9 cutover field), and fall back to
 * the legacy `rhPastEventCount` for older API payloads. The same
 * curated set now also drives `raidsAttended` and the rank pill, so the
 * Events tile, the Peon/Grunt/Veteran badge, and the Attendance % all
 * count the same raids.
 */
function raidsWithGuildCountForPlayer(player) {
  const fromWcl = Number(player?.wclEventCount);
  if (Number.isFinite(fromWcl) && fromWcl >= 0) return Math.floor(fromWcl);
  const fromRh = Number(player?.rhPastEventCount || 0);
  if (Number.isFinite(fromRh) && fromRh >= 0) return Math.floor(fromRh);
  return 0;
}

function playerEarnedRaidsWithGuildMilestone(player, threshold) {
  const t = Math.floor(Number(threshold) || 0);
  if (t <= 0) return false;
  return raidsWithGuildCountForPlayer(player) >= t;
}

/** Highest raid-milestone tier (5/10/25/50/100) the player has reached, or 0. */
function highestEarnedRaidsWithGuildMilestoneThreshold(player) {
  const c = raidsWithGuildCountForPlayer(player);
  for (const tier of [100, 50, 25, 10, 5]) {
    if (c >= tier) return tier;
  }
  return 0;
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
      file: "raids-with-guild-100.png",
      title:
        "100 raids with the guild — Appeared in at least 100 distinct WCL guild raid reports flagged in admin Event Management (your Events total on the leaderboard). Only your highest milestone badge is shown in this row.",
      alt: "100 raids with the guild",
      ok: highestEarnedRaidsWithGuildMilestoneThreshold(player) === 100,
    },
    {
      file: "raids-with-guild-50.png",
      title:
        "50 raids with the guild — Appeared in at least 50 distinct WCL guild raid reports flagged in admin Event Management (your Events total on the leaderboard). Only your highest milestone badge is shown in this row.",
      alt: "50 raids with the guild",
      ok: highestEarnedRaidsWithGuildMilestoneThreshold(player) === 50,
    },
    {
      file: "raids-with-guild-25.png",
      title:
        "25 raids with the guild — Appeared in at least 25 distinct WCL guild raid reports flagged in admin Event Management (your Events total on the leaderboard). Only your highest milestone badge is shown in this row.",
      alt: "25 raids with the guild",
      ok: highestEarnedRaidsWithGuildMilestoneThreshold(player) === 25,
    },
    {
      file: "raids-with-guild-10.png",
      title:
        "10 raids with the guild — Appeared in at least 10 distinct WCL guild raid reports flagged in admin Event Management (your Events total on the leaderboard). Only your highest milestone badge is shown in this row.",
      alt: "10 raids with the guild",
      ok: highestEarnedRaidsWithGuildMilestoneThreshold(player) === 10,
    },
    {
      file: "raids-with-guild-5.png",
      title:
        "5 raids with the guild — Appeared in at least 5 distinct WCL guild raid reports flagged in admin Event Management (your Events total on the leaderboard). Only your highest milestone badge is shown in this row.",
      alt: "5 raids with the guild",
      ok: highestEarnedRaidsWithGuildMilestoneThreshold(player) === 5,
    },
    {
      file: "most-deaths-last-6-raids.png",
      title:
        "Most deaths (last 6 raids) — You are currently tied for the highest total deaths across the tracked last six raids window.",
      alt: "Most deaths last 6 raids",
      ok: playerEarnedMostDeathsLastSixBadge(player),
    },
    {
      file: "aoe-cleave.png",
      title:
        "AOE Cleave — Attended the raid on May 7, 2026. Awarded to every raider with a Warcraft Logs appearance in any guild raid report from that night.",
      alt: "AOE Cleave",
      ok: playerEarnedSpecificEventBadge(player, "aoe-cleave"),
    },
    {
      file: "ssc-first-event.png",
      title:
        "SSC First Event — Participated in the guild's first Serpentshrine Cavern raid event. Awarded to linked raiders who appear in a Warcraft Logs roster from that night's SSC logs.",
      alt: "SSC First Event",
      ok: playerEarnedSpecificEventBadge(player, "ssc-first-event"),
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
        "Parsing ceiling — On at least one boss in the tracked raid window, your parse tied for best among linked raiders in your role bracket for that fight (tank / healer / DPS).",
      alt: "Parsing ceiling",
      ok: playerEarnedParsingCeilingBadge(player),
    },
    {
      file: "kara-first-time-clear.png",
      title:
        "Karazhan first clear — You were in the ranked roster on the guild's first Karazhan full clear report.",
      alt: "Karazhan first clear",
      ok: playerEarnedFirstClearKaraBadge(player),
    },
    {
      file: "gruul-first-time-clear.png",
      title:
        "Gruul first clear — You were in the ranked roster on the guild's first Gruul's Lair full clear report.",
      alt: "Gruul first clear",
      ok: playerEarnedFirstClearGruulBadge(player),
    },
    {
      file: "magtheridon-first-time-clear.png",
      title:
        "Magtheridon first clear — You were in the ranked roster on the guild's first Magtheridon's Lair full clear report.",
      alt: "Magtheridon first clear",
      ok: playerEarnedFirstClearMagBadge(player),
    },
  ];
  return badges
    .filter((b) => b.ok)
    .map((b) => {
      const badgeId = badgeIdFromAchievementFile(b.file);
      const meta = badgeTooltipMeta(badgeId, b.alt, badgeTooltipFallbackDescription(b.title, b.alt), "epic");
      const icon = achievementBadgeIconUrlWithFallback(b.file);
      const fallbackTitle = `${meta.name}${meta.description ? ` — ${meta.description}` : ""}`;
      return `<span ${achievementBadgeSlotAttrs(meta, "raider-badge-slot raider-badge-slot--achievement-earned achievement-badge-container")} aria-label="${escapeHtml(fallbackTitle)}">
        <span ${achievementBadgeFrameAttrs(meta)}>
          <img class="raider-badge-achievement-img achievement-badge-img" src="${escapeHtml(icon.src)}" alt="${escapeHtml(b.alt)}" width="44" height="44" loading="lazy" decoding="async"${icon.onerror} />
          <span class="achievement-badge-glow" aria-hidden="true"></span>
        </span>
        ${achievementTooltipHtml(meta)}
      </span>`;
    })
    .join("");
}

/**
 * Load WCL attendance + badge feeds (boss-times PB roster, HoF winners,
 * first-clear participants, death leaderboard). Used by Events roster,
 * Leaderboard, Hall of Fame, and the Profile badge grid.
 *
 * @param {{ skipCache?: boolean }} [opts] Pass `{ skipCache: true }` from the
 *        Profile page so badge resolution always hits the origin — otherwise
 *        `plbSessionApiCache` can replay an empty or stale first response for
 *        the whole tab session (same failure mode we fixed on the Leaderboard).
 */
async function loadWclAttendanceForEvents(opts = {}) {
  const skipCache = Boolean(opts?.skipCache);
  const cacheInit = skipCache ? { skipCache: true } : {};
  attendanceLeaderboardByKey = new Map();
  attendanceConsideredRaids = 0;
  attendanceLeaderboardRows = [];
  pbBestTimeRankedNameKeys = new Set();
  hallOfFameWinnerNameKeys = new Set();
  mostDeathsLastSixNameKeys = new Set();
  firstClearKaraNameKeys = new Set();
  firstClearGruulNameKeys = new Set();
  firstClearMagNameKeys = new Set();
  parseCeilingMaxByBracket = { tank: null, heal: null, dps: null };
  try {
    await loadBadgeTooltipsOnce();
    const api = window.plbSessionApiCache;
    const getJson = (url, init) => {
      const merged = { ...(init || {}), ...cacheInit };
      return api
        ? api.getJson(url, merged)
        : fetch(url, { method: "GET", ...merged }).then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || "Request failed");
            return body;
          });
    };
    const [attPayload, btPayload, hofPayload, firstClearPayload, deathPayload] = await Promise.all([
      getJson(`/api/wcl/guild/${EVENTS_WCL_GUILD_ID}/attendance?limit=40&top=250`, {
        credentials: "include",
        ...cacheInit,
      }).catch(() => ({})),
      getJson(`/api/wcl/guild/${EVENTS_WCL_GUILD_ID}/boss-times?limit=50`, cacheInit).catch(() => ({})),
      getJson(`/api/voting/hall-of-fame`, { credentials: "include", ...cacheInit }).catch(() => ({})),
      getJson(`/api/wcl/guild/${EVENTS_WCL_GUILD_ID}/first-clear-participants?limit=150`, cacheInit).catch(
        () => ({})
      ),
      getJson(`/api/wcl/guild/${EVENTS_WCL_GUILD_ID}/death-leaderboard?limit=6&top=400`, cacheInit).catch(
        () => ({})
      ),
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

    const firstClears =
      firstClearPayload?.firstClears && typeof firstClearPayload.firstClears === "object" ? firstClearPayload.firstClears : {};
    const addRowsToSet = (rows, outSet) => {
      for (const raw of Array.isArray(rows) ? rows : []) {
        const s = String(raw || "").trim();
        if (!s) continue;
        outSet.add(rosterNameKey(s));
        outSet.add(s.toLowerCase());
      }
    };
    if (Array.isArray(deathPayload?.leaderboard)) {
      const maxDeaths = deathPayload.leaderboard.reduce((max, row) => {
        const deaths = Number(row?.deaths || 0);
        return Number.isFinite(deaths) ? Math.max(max, deaths) : max;
      }, 0);
      if (maxDeaths > 0) {
        const topDeathNames = deathPayload.leaderboard
          .filter((row) => Number(row?.deaths || 0) === maxDeaths)
          .map((row) => row?.name);
        addRowsToSet(topDeathNames, mostDeathsLastSixNameKeys);
      }
    }
    addRowsToSet(firstClears?.["Karazhan"]?.participants, firstClearKaraNameKeys);
    addRowsToSet(firstClears?.["Gruul's Lair"]?.participants, firstClearGruulNameKeys);
    addRowsToSet(firstClears?.["Magtheridon's Lair"]?.participants, firstClearMagNameKeys);
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

function rosterGearSummaryForPlayer(player) {
  const keys = attendanceLookupNameCandidates(player);
  const label = eventsRosterCharacterLabel(player);
  if (label) keys.unshift(label);
  for (const key of keys) {
    const hit = rosterGearSummaryByKey.get(String(key || "").trim().toLowerCase());
    if (hit) return hit;
  }
  return rosterGearSummaryByKey.has(String(label || "").trim().toLowerCase())
    ? rosterGearSummaryByKey.get(String(label || "").trim().toLowerCase())
    : null;
}

function rosterGearSummaryHtml(player) {
  const summary = rosterGearSummaryForPlayer(player);
  const display = window.plbGearAuditDisplay;
  if (display?.buildGearAuditSummaryHtml) {
    return `<div class="raider-gear-summary">${display.buildGearAuditSummaryHtml(summary, escapeHtml)}</div>`;
  }
  return `<div class="raider-gear-summary raider-gear-summary--empty">—</div>`;
}

async function loadRosterGearSummaries(players, { warmMissing = true } = {}) {
  const names = [
    ...new Set(
      (Array.isArray(players) ? players : [])
        .map((p) => eventsRosterCharacterLabel(p))
        .filter(Boolean)
    ),
  ];
  if (!names.length) {
    rosterGearSummaryByKey = new Map();
    return;
  }
  try {
    const res = await fetch("/api/classic-armory/gear-summaries", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ names, warmMissing: Boolean(warmMissing), maxWarm: 20 }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${res.status}`);
    const next = new Map();
    const summaries =
      payload?.summaries && typeof payload.summaries === "object" ? payload.summaries : {};
    for (const [key, row] of Object.entries(summaries)) {
      next.set(String(key || "").trim().toLowerCase(), row && typeof row === "object" ? row : null);
    }
    rosterGearSummaryByKey = next;
  } catch (err) {
    console.warn("[plb] loadRosterGearSummaries failed:", err?.message || err);
    rosterGearSummaryByKey = new Map();
  }
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
  const slug = (raw === "Guildlead" ? "Puglead" : raw).toLowerCase();
  return GUILD_ROLE_BADGE_SLUGS.has(slug) ? slug : "peon";
}

function guildRoleBadgeImageSlug(roleLabel) {
  const raw = String(roleLabel || "").trim();
  const normalized = raw === "Guildlead" ? "Puglead" : raw;
  const slug = String(normalized || "Peon")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (slug === "puglead" || slug === "guildlead") return "guildlead";
  if (slug === "raidlead") return "raidlead";
  if (slug === "dpslead") return "dpslead";
  if (slug === "heallead") return "heallead";
  return GUILD_ROLE_BADGE_SLUGS.has(slug) ? slug : "peon";
}

function assignedGuildRoleFromPlayer(player) {
  const raw = String(player?.guildRole ?? "Peon").trim() || "Peon";
  const compact = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "puglead" || compact === "guildlead") return "Puglead";
  if (compact === "raidlead") return "Raidlead";
  if (compact === "dpslead") return "Dpslead";
  if (compact === "heallead") return "Heallead";
  return raw === "Guildlead" ? "Puglead" : raw;
}

function displayGuildRoleLabel(roleLabel) {
  const raw = String(roleLabel || "").trim();
  const compact = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "puglead" || compact === "guildlead") return "PUG Lead";
  if (compact === "raidlead") return "Raid Lead";
  if (compact === "dpslead") return "DPS Lead";
  if (compact === "heallead") return "Heal Lead";
  return raw;
}

/** Raids attended in the same capped window as KPI / % (last 6 admin-curated Event Management raids when curation is set, else rolling last-6 tracked 25-player raids). */
function attendanceRaidsCountForPlayer(player) {
  const direct = Number(player?.raidsAttended);
  if (Number.isFinite(direct) && direct >= 0) return Math.min(6, Math.floor(direct));
  const row = attendanceRowForRosterPlayerResolved(player);
  if (row) return Math.min(6, Math.floor(Number(row.raidsAttended || 0)));
  return 0;
}

/** ≤1 raid → Peon, 2–4 → Grunt, 5–6 → Veteran (within the same Event Management window that drives `wclEventCount`). */
function attendanceTierGuildRoleFromRaids(raidsRaw) {
  const r = Math.max(0, Math.min(6, Math.floor(Number(raidsRaw) || 0)));
  if (r <= 1) return "Peon";
  if (r <= 4) return "Grunt";
  return "Veteran";
}

function attendanceTierGuildRole(player) {
  return attendanceTierGuildRoleFromRaids(attendanceRaidsCountForPlayer(player));
}

/** Primary rank label: manual Core / PUG Lead / Raidlead; else attendance-based Peon–Veteran. */
function primaryGuildRankLabel(player) {
  const assigned = assignedGuildRoleFromPlayer(player);
  if (MANUAL_ONLY_GUILD_ROLES.has(assigned)) return assigned;
  return attendanceTierGuildRole(player);
}

function effectiveGuildRole(player) {
  const assigned = assignedGuildRoleFromPlayer(player);
  const attendanceLabel = attendanceTierGuildRole(player);
  const isManual = MANUAL_ONLY_GUILD_ROLES.has(assigned);
  const label = isManual ? assigned : attendanceLabel;
  const displayLabel = displayGuildRoleLabel(label);
  const slug = guildRoleBadgeImageSlug(label);
  return {
    label,
    displayLabel,
    slug,
    source: isManual ? "assigned" : "attendance",
    attendanceLabel,
    sortIndex: (() => {
      const i = GUILD_ROLE_SORT_ORDER.indexOf(label);
      return i === -1 ? 999 : i;
    })(),
  };
}

function showAttendanceCompanionBadge(player) {
  return MANUAL_ONLY_GUILD_ROLES.has(assignedGuildRoleFromPlayer(player));
}

function rosterGuildRoleBadgeSrcForLabel(roleLabel) {
  const slug = guildRoleBadgeImageSlug(roleLabel);
  return `/images/guild-roles/${slug}.png?v=${IMAGE_ASSET_VERSION}`;
}

/** Primary guild rank token (manual officer art OR attendance tier for everyone else). */
function rosterRoleIconHtml(player, opts = {}) {
  const role = effectiveGuildRole(player);
  const displayLabel = role.displayLabel;
  const badgeId = role.slug;
  const isLeadBadge = ["guildlead", "raidlead", "dpslead", "heallead"].includes(badgeId);
  const sourceText =
    role.source === "assigned"
      ? "Assigned guild role"
      : `Attendance rank over the last ${Math.max(1, attendanceConsideredRaids || 6)} tracked raids`;
  const meta = badgeTooltipMeta(badgeId, displayLabel, `${sourceText}: ${displayLabel}`, isLeadBadge ? "rare" : "common");
  const title = `${meta.name}${meta.description ? ` — ${meta.description}` : ""}`;
  const src = escapeHtml(rosterGuildRoleBadgeSrcForLabel(role.label));
  const alt = escapeHtml(`Guild rank: ${displayLabel}`);
  const label = opts?.hideLabel ? "" : `<span class="guild-role-token-label">${escapeHtml(displayLabel)}</span>`;
  const classes = [
    "guild-role-token",
    `guild-role-token--${escapeHtml(role.source)}`,
    `guild-role-token--${escapeHtml(badgeId)}`,
    opts?.className ? String(opts.className) : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<span class="${escapeHtml(classes)}" aria-label="${escapeHtml(title)}">
    <span class="guild-role-token-frame achievement-badge-frame--${escapeHtml(meta.rarity)}">
      <img class="guild-role-token-img" src="${src}" alt="${alt}" width="34" height="34" loading="lazy" decoding="async" />
      <span class="achievement-badge-glow" aria-hidden="true"></span>
    </span>
    ${label}
    ${achievementTooltipHtml(meta)}
  </span>`;
}

function playerEarnedPugMasterCrafterBadge(player, badgeId) {
  const cfg = PUG_MASTER_CRAFTER_ROLE_BADGES.find((badge) => badge.badgeId === String(badgeId || "").trim());
  if (!cfg) return false;
  for (const name of attendanceLookupNameCandidates(player)) {
    const key = rosterNameKey(name);
    if (key && cfg.characterKeys.has(key)) return true;
  }
  for (const name of Array.isArray(player?.wclCharacters) ? player.wclCharacters : []) {
    const key = rosterNameKey(name);
    if (key && cfg.characterKeys.has(key)) return true;
  }
  return false;
}

function rosterPugMasterCrafterBadgesHtml(player, opts = {}) {
  return PUG_MASTER_CRAFTER_ROLE_BADGES
    .filter((badge) => playerEarnedPugMasterCrafterBadge(player, badge.badgeId))
    .map((badge) => {
      const meta = badgeTooltipMeta(badge.badgeId, badge.name, badge.description, "legendary");
      const title = `${meta.name}${meta.description ? ` — ${meta.description}` : ""}`;
      const src = escapeHtml(`/images/guild-roles/${badge.slug}.png?v=${IMAGE_ASSET_VERSION}`);
      const classes = [
        "guild-role-token",
        "guild-role-token--assigned",
        `guild-role-token--${escapeHtml(badge.badgeId)}`,
        opts?.className ? String(opts.className) : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<span class="${escapeHtml(classes)}" aria-label="${escapeHtml(title)}">
        <span class="guild-role-token-frame achievement-badge-frame--${escapeHtml(meta.rarity)}">
          <img class="guild-role-token-img" src="${src}" alt="${escapeHtml(badge.name)}" width="34" height="34" loading="lazy" decoding="async" />
          <span class="achievement-badge-glow" aria-hidden="true"></span>
        </span>
        ${achievementTooltipHtml(meta)}
      </span>`;
    })
    .join("");
}

/** Back-compat alias for old call sites; new layouts should use `rosterRoleIconHtml`. */
function rosterGuildRoleBadgeHtml(player) {
  return rosterRoleIconHtml(player, { hideLabel: true });
}

/** Second badge for officers only: attendance-based Peon / Grunt / Veteran. */
function rosterAttendanceCompanionBadgeHtml(player) {
  if (!showAttendanceCompanionBadge(player)) return "";
  const tier = attendanceTierGuildRole(player);
  const raids = attendanceRaidsCountForPlayer(player);
  const cap = Math.max(1, attendanceConsideredRaids || 6);
  const badgeId = guildRoleBadgeImageSlug(tier);
  const meta = badgeTooltipMeta(
    badgeId,
    displayGuildRoleLabel(tier),
    `Attendance rank over the last ${cap} Event Management raids: ${raids}/${cap} raids.`,
    "common"
  );
  const title = `${meta.name}${meta.description ? ` — ${meta.description}` : ""}`;
  const src = escapeHtml(rosterGuildRoleBadgeSrcForLabel(tier));
  const alt = escapeHtml(`Attendance rank: ${tier}`);
  return `<span ${achievementBadgeSlotAttrs(meta, "raider-badge-slot raider-badge-slot--guild-role raider-badge-slot--attendance-companion achievement-badge-container")} aria-label="${escapeHtml(title)}">
    <span ${achievementBadgeFrameAttrs(meta, "achievement-badge-frame--guild")}>
      <img class="raider-badge-role-img achievement-badge-img" src="${src}" alt="${alt}" width="44" height="44" loading="lazy" decoding="async" />
      <span class="achievement-badge-glow" aria-hidden="true"></span>
    </span>
    ${achievementTooltipHtml(meta)}
  </span>`;
}

/** Section heading for guild roster page — rank badge + label (decorative img alt empty; label is visible). */
function rosterGuildRoleSectionTitleHtml(roleLabel, count) {
  const label = String(roleLabel ?? "Peon").trim() || "Peon";
  const displayLabel = displayGuildRoleLabel(label);
  const slug = guildRoleBadgeImageSlug(label);
  const src = escapeHtml(`/images/guild-roles/${slug}.png?v=${IMAGE_ASSET_VERSION}`);
  const meta = badgeTooltipMeta(slug, displayLabel, `Guild rank: ${displayLabel}`, ["guildlead", "raidlead", "dpslead", "heallead"].includes(slug) ? "rare" : "common");
  const tip = escapeHtml(`${meta.name}${meta.description ? ` — ${meta.description}` : ""}`);
  return `
    <div class="roster-role-title roster-role-title--guild-tier">
      <span ${achievementBadgeSlotAttrs(meta, "roster-section-guild-badge raider-badge-slot raider-badge-slot--guild-role achievement-badge-container")} aria-label="${tip}">
        <span ${achievementBadgeFrameAttrs(meta, "achievement-badge-frame--guild")}>
          <img class="raider-badge-role-img achievement-badge-img" src="${src}" alt="" width="28" height="28" loading="lazy" decoding="async" />
          <span class="achievement-badge-glow" aria-hidden="true"></span>
        </span>
        ${achievementTooltipHtml(meta)}
      </span>
      <span class="roster-role-title-text">${escapeHtml(displayLabel)} <span class="roster-role-title-count">(${Number(count) || 0})</span></span>
    </div>`;
}

function rosterAchievementBadgeRowHtml(player) {
  return rosterAchievementBadgesHtml(player);
}

function rosterBadgeRowHtml(player) {
  return rosterAchievementBadgeRowHtml(player);
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
  if (bnet) return bnet;
  // Mirror effectiveRosterClassSlug: when the API didn't supply a class label
  // (cold cache), fall back to whatever the WCL Damage Done / icon URL imply.
  const wclTypeSlug = classSlugFromWclCombatType(player?.wclCombatSpecType);
  const wclIconSlug = classSlugFromWclSpecIconUrl(player?.wclSpecIconUrl);
  const fallbackSlug = wclTypeSlug || wclIconSlug || "";
  if (fallbackSlug) {
    const display = fallbackSlug.charAt(0).toUpperCase() + fallbackSlug.slice(1);
    return fallbackSlug === "deathknight" ? "Death Knight" : display;
  }
  return "";
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
  const role = effectiveGuildRole(player);
  const roleToken = rosterRoleIconHtml(player, { className: "raider-role-token" });

  return `
    <div class="raider-card"${cardTitleAttr}>
      ${rosterCardKpisHtml(player, confirmedRoster)}
      ${rosterGearSummaryHtml(player)}
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
            <span class="raider-guild-role-chip">${escapeHtml(role.displayLabel)}</span>
          </div>
          ${
            specLabel && className
              ? `<div class="raider-spec-line">${escapeHtml(specLabel)} · ${escapeHtml(className)}</div>`
              : `<div class="raider-spec-line">${escapeHtml(specLabel || className)}</div>`
          }
        </div>
        ${roleToken}
      </div>
      <div class="raider-badges" role="group" aria-label="Earned achievement badges">
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
  loadRosterGearSummaries,
  rosterGearSummaryForPlayer,
  rosterRaiderCard,
  rosterGuildRoleSectionTitleHtml,
  effectiveGuildRole,
  primaryGuildRankLabel,
  rosterRoleIconHtml,
  rosterPugMasterCrafterBadgesHtml,
  playerEarnedPugMasterCrafterBadge,
  rosterAchievementBadgeRowHtml,
  rosterBucketRoleName,
  eventsRosterCharacterLabel,
  rosterParseForDisplay,
  rosterParseSourceTooltipFragment,
  rosterNameKey,
  resolvedSpecIconKey,
  specIconZamimgUrlForKey,
  specBadgePortraitChain,
  rosterBadgeRowHtml,
  rosterPortraitChain,
  prefetchRosterProfilePictures,
  resetRosterProfilePictureCache,
  mergedClassDisplayLabel,
  displaySpecNameForRoster,
  wowClassColor,
  effectiveRosterClassSlug,
  // Badge resolvers — exposed so the profile page can light up the same
  // achievement tiles the leaderboard does without re-implementing the logic.
  // Caller must `await loadWclAttendanceForEvents()` first (optionally with
  // `{ skipCache: true }` when resolving Profile badges).
  playerEarnedBestTimeParticipantBadge,
  playerEarnedHallOfFameMvpBadge,
  playerEarnedMostDeathsLastSixBadge,
  playerEarnedIronAttendanceBadge,
  playerEarnedParsingCeilingBadge,
  playerEarnedFirstClearKaraBadge,
  playerEarnedFirstClearGruulBadge,
  playerEarnedFirstClearMagBadge,
  playerEarnedSpecificEventBadge,
  playerEarnedRaidsWithGuildMilestone,
  highestEarnedRaidsWithGuildMilestoneThreshold,
  attendanceRowForRosterPlayerResolved,
};