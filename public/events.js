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

const eventsList = document.querySelector("#eventsList");
const DISCORD_INVITE_URL = "https://discord.gg/TBnt5f8DFc";
const IMAGE_ASSET_VERSION = "20260503q";
/** Same guild as dashboard WCL widgets — attendance tiers on roster cards. */
const EVENTS_WCL_GUILD_ID = 817080;
/** Generic dashed slots (beyond attendance). CSS size ≈ 56×56 px — icons should be square 1:1. */
const GENERIC_ACHIEVEMENT_SLOT_COUNT = 3;
const ROLE_ORDER = ["Tanks", "Healers", "Melee", "Ranged"];
/** @type {Map<string, { name: string, raidsAttended: number, attendanceRate: number }>} */
let attendanceLeaderboardByKey = new Map();
let attendanceConsideredRaids = 0;
let authMe = null;
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
    const res = await fetch(`/tbc-spec-icons.json?v=${TBC_SPEC_ICONS_JSON_VER}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json().catch(() => ({}));
    tbcSpecIconByKey = data?.byKey && typeof data.byKey === "object" ? data.byKey : {};
  } catch {
    tbcSpecIconByKey = {};
  }
  return tbcSpecIconByKey;
}

/** Preferred icon URL for a `warrior_arms`-style key (Wowhead JSON first, then texture table). */
function specIconZamimgUrlForKey(key) {
  if (!key) return "";
  const prot = CANONICAL_PROT_SPEC_BADGE_URL[key];
  if (prot) return prot;
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
  if (raw) return raw;
  if (classSlug === "warrior" && isTankRoleSlug(roleSlug)) return "protection";
  if (classSlug === "paladin" && isTankRoleSlug(roleSlug)) return "protection";
  return "";
}

/** Same merge as server `englishCanonicalClassSlugForEventsIcons`: RH + Rio; Paladin vs Warrior uses Rio when they disagree. */
function effectiveRosterClassSlug(player) {
  const rh = canonicalWowClassSlug(player?.className);
  const rio = canonicalWowClassSlug(player?.raiderIoClassName);
  const plate = new Set(["paladin", "warrior"]);
  if (plate.has(rh) && plate.has(rio) && rh !== rio) return rio;
  if (rh) return rh;
  return rio || "";
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
  // No class on roster (RH role-as-class etc.): reject single-flavour prot textures like server-side enrichment.
  if (!cls && war && !pal) return true;
  if (!cls && pal && !war) return true;
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

function displaySpecNameForRoster(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const slug = normalizeSlug(s);
  if (/^protection\d+$/.test(slug)) return "Protection";
  return s;
}

function specBadgePortraitChain(player) {
  const fromWcl = String(player?.wclSpecIconUrl || "").trim();
  const wclOk = /^https?:\/\//i.test(fromWcl) && !wclProtIconConflictsWithRosterClass(fromWcl, player);
  const fromApi = String(player?.specIconUrl || "").trim();
  const key = resolvedSpecIconKey(player);
  const primaryZam = key ? specIconZamimgUrlForKey(key) : "";
  const extras = key && SPEC_ZAMIMG_FALLBACK[key] ? SPEC_ZAMIMG_FALLBACK[key] : [];
  const extraUrls = extras.map((f) => `${ZAM_ICON_LARGE}/${f}.jpg`);
  let protKey = key === "paladin_protection" || key === "warrior_protection";
  const urls = [];
  // Canonical prot zamimg first — WCL Damage Done uses one icon type for both plate tanks.
  if (protKey && primaryZam) {
    urls.push(primaryZam);
    for (const u of extraUrls) urls.push(u);
  }
  if (wclOk) urls.push(fromWcl);
  const apiOk =
    /^https?:\/\//i.test(fromApi) && !rhEmbedSpecIconConflictsWithProtKey(fromApi, key);
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

/** Lookup WCL attendance row — tries canonical key first, then rare alternate keys. */
function attendanceRowForRosterPlayer(playerName) {
  const primary = rosterNameKey(playerName);
  let row = attendanceLeaderboardByKey.get(primary);
  if (row) return row;
  const raw = String(playerName || "").trim().toLowerCase();
  if (raw !== primary) row = attendanceLeaderboardByKey.get(raw);
  return row || null;
}

/**
 * Roster-relative standing for glow colour: sort confirmed players who have WCL % (worst→best).
 * Returns 0..5 (0 = lowest on this roster, 5 = highest). Null if this player has no WCL row.
 */
function rosterRelativeGlowTier(player, confirmedRoster) {
  const roster = Array.isArray(confirmedRoster) ? confirmedRoster : [];
  const keyed = [];
  for (const p of roster) {
    const row = attendanceRowForRosterPlayer(p.name);
    if (row && Number.isFinite(Number(row.attendanceRate))) {
      keyed.push({ key: rosterNameKey(p.name), rate: Number(row.attendanceRate) });
    }
  }
  const myKey = rosterNameKey(player.name);
  if (!keyed.some((k) => k.key === myKey)) return null;
  if (keyed.length === 1) return 3;
  keyed.sort((a, b) => a.rate - b.rate || a.key.localeCompare(b.key));
  const idx = keyed.findIndex((k) => k.key === myKey);
  if (idx < 0) return null;
  const p = idx / (keyed.length - 1);
  return Math.min(5, Math.floor(p * 6 - 1e-9));
}

/** If roster-relative fails, map overall WCL % to a glow band (0..5). */
function globalAttendanceGlowTier(rate) {
  const x = Math.max(0, Math.min(100, Number(rate || 0)));
  return Math.min(5, Math.floor((x / 100) * 6 - 1e-9));
}

function rosterRelativeAttendanceHint(player, confirmedRoster) {
  const roster = Array.isArray(confirmedRoster) ? confirmedRoster : [];
  const keyed = [];
  for (const p of roster) {
    const row = attendanceRowForRosterPlayer(p.name);
    if (row && Number.isFinite(Number(row.attendanceRate))) {
      keyed.push({ key: rosterNameKey(p.name), rate: Number(row.attendanceRate) });
    }
  }
  keyed.sort((a, b) => a.rate - b.rate || a.key.localeCompare(b.key));
  const idx = keyed.findIndex((k) => k.key === rosterNameKey(player.name));
  if (idx < 0 || keyed.length === 0) return "";
  return ` ${idx + 1}/${keyed.length} on this roster (low→high WCL %)`;
}

async function loadWclAttendanceForEvents() {
  attendanceLeaderboardByKey = new Map();
  attendanceConsideredRaids = 0;
  try {
    const res = await fetch(
      `/api/wcl/guild/${EVENTS_WCL_GUILD_ID}/attendance?limit=40&top=150`,
      { credentials: "include" }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return;
    attendanceConsideredRaids = Math.max(0, Number(payload.consideredRaids || 0));
    for (const row of payload.leaderboard || []) {
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
  } catch {
    // optional widget — roster still renders
  }
}

function rosterAttendanceBadgeHtml(player, confirmedRoster) {
  const row = attendanceRowForRosterPlayer(player.name);
  const pctRounded = row ? Math.round(Number(row.attendanceRate || 0)) : null;
  const mergedLogs =
    Array.isArray(row?.wclCharacters) && row.wclCharacters.length > 1
      ? ` · merged logs: ${row.wclCharacters.join(", ")}`
      : "";
  const titleCore = row
    ? `WCL: ${Number(row.raidsAttended || 0)}/${attendanceConsideredRaids || "?"} raids · ${pctRounded}% overall${mergedLogs}`
    : "No WCL attendance match in leaderboard";
  if (!row || attendanceConsideredRaids <= 0) {
    return `<div class="raider-badge-slot raider-badge-slot--pending" title="${escapeHtml(titleCore)}"></div>`;
  }
  let glowTier = rosterRelativeGlowTier(player, confirmedRoster);
  if (glowTier === null) glowTier = globalAttendanceGlowTier(row.attendanceRate);
  const title = `${titleCore}${rosterRelativeAttendanceHint(player, confirmedRoster)}`;
  const badgeSrc = `/images/badge-tiers/attendance-portal-badge.png?v=${IMAGE_ASSET_VERSION}`;
  return `
    <div class="raider-badge-tier raider-badge-tier--glow-${glowTier}" title="${escapeHtml(title)}">
      <div class="raider-badge-tier-mask">
        <img class="raider-badge-tier-portal" src="${escapeHtml(badgeSrc)}" alt="" width="56" height="56" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      </div>
      <div class="raider-badge-tier-readout">
        <span class="raider-badge-tier-pct">${pctRounded}%</span>
      </div>
    </div>
  `;
}

function rosterGenericAchievementSlotsHtml() {
  const hint =
    "Achievement badge slot — square 1:1 icons (e.g. design at 128×128 px for ~56×56 display)";
  return Array.from({ length: GENERIC_ACHIEVEMENT_SLOT_COUNT })
    .map(() => `<span class="raider-badge-slot" title="${escapeHtml(hint)}"></span>`)
    .join("");
}

/** English class label for roster text — matches {@link effectiveRosterClassSlug} (Rio wins Warrior vs Paladin disagreements). */
function mergedClassDisplayLabel(player) {
  const rh = String(player?.className ?? "").trim();
  const rio = String(player?.raiderIoClassName ?? "").trim();
  const rhSlug = canonicalWowClassSlug(rh);
  const rioSlug = canonicalWowClassSlug(rio);
  const plate = new Set(["paladin", "warrior"]);
  if (plate.has(rhSlug) && plate.has(rioSlug) && rhSlug !== rioSlug) return rio;
  if (rh) return rh;
  return rio || "";
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
  return parts.join(" · ");
}

function rosterRaiderCard(player, confirmedRoster) {
  const className = mergedClassDisplayLabel(player);
  const color = wowClassColor(className);
  const specLabel = displaySpecNameForRoster(String(player.specName || "").trim());
  const portraitChain = rosterPortraitChain(player);
  const portraitSrc = escapeHtml(portraitChain[0] || "");
  const portraitFb = portraitChain
    .slice(1)
    .map((u) => escapeHtml(u))
    .join("|");
  const portraitAlt = specLabel ? `${className} · ${specLabel}` : className;
  const priestGlow =
    effectiveRosterClassSlug(player) === "priest"
      ? "text-shadow:0 0 6px rgba(0,0,0,.85),0 1px 2px rgba(0,0,0,.9);"
      : "";
  const sourcesTip = rosterClassSpecSourcesTooltip(player);
  const cardTitleAttr = sourcesTip ? ` title="${escapeHtml(sourcesTip)}"` : "";

  return `
    <div class="raider-card"${cardTitleAttr}>
      <div class="raider-card-main">
        <div class="raider-portrait-stack">
          <img
            class="raider-champion-img"
            src="${portraitSrc}"
            alt="${escapeHtml(portraitAlt)}"
            width="56"
            height="56"
            loading="lazy"
            decoding="async"
            data-champ-fallbacks="${portraitFb}"
            onerror="(function(el){var raw=el.getAttribute('data-champ-fallbacks');if(!raw){el.onerror=null;return;}var parts=raw.split('|').filter(Boolean);var i=Number(el.dataset.champI||0);if(i<parts.length){el.dataset.champI=String(i+1);el.src=parts[i];}else{el.onerror=null;}})(this)"
          />
        </div>
        <div class="raider-text">
          <div class="raider-name-line">
            <span class="raider-name" style="color:${color};${priestGlow}">${escapeHtml(player.name)}</span>
          </div>
          ${
            specLabel && className
              ? `<div class="raider-spec-line">${escapeHtml(specLabel)} · ${escapeHtml(className)}</div>`
              : `<div class="raider-spec-line">${escapeHtml(specLabel || className)}</div>`
          }
        </div>
      </div>
      <div class="raider-badges" role="group" aria-label="Achievements and attendance">
        ${rosterAttendanceBadgeHtml(player, confirmedRoster)}
        ${rosterGenericAchievementSlotsHtml()}
      </div>
    </div>
  `;
}

function fmtEventDate(unixSec) {
  if (!unixSec) return "-";
  const dt = new Date(Number(unixSec) * 1000);
  return Number.isNaN(dt.getTime())
    ? "-"
    : dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtEventTime(unixSec) {
  if (!unixSec) return "-";
  const dt = new Date(Number(unixSec) * 1000);
  return Number.isNaN(dt.getTime())
    ? "-"
    : dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function versionedImagePath(path) {
  return `${path}?v=${IMAGE_ASSET_VERSION}`;
}

function rosterCapacityForEvent(event) {
  const raids = detectEventRaids(event);
  if (!raids.some((raid) => raid.rosterCap === 25)) return 10;
  return 25;
}

function detectEventRaids(event) {
  const text = `${event?.title || ""} ${event?.description || ""}`.toLowerCase();
  const matches = [];
  if (text.includes("karazhan") || /\bkara\b/.test(text)) {
    matches.push({ id: "kara", image: versionedImagePath("/raid-images/pb-header-kara.png"), rosterCap: 10 });
  }
  if (text.includes("gruul")) {
    matches.push({ id: "gruul", image: versionedImagePath("/raid-images/pb-header-gruul.png"), rosterCap: 25 });
  }
  if (text.includes("magtheridon") || /\bmag\b/.test(text)) {
    matches.push({
      id: "mag",
      image: versionedImagePath("/raid-images/pb-header-magtheridon.png"),
      rosterCap: 25,
    });
  }
  if (text.includes("serpentshrine") || /\bssc\b/.test(text)) {
    matches.push({ id: "ssc", image: versionedImagePath("/raid-images/pb-header-ssc.png"), rosterCap: 25 });
  }
  if (text.includes("tempest keep") || /\btk\b/.test(text) || text.includes("the eye")) {
    matches.push({ id: "tk", image: versionedImagePath("/raid-images/pb-header-tk.png"), rosterCap: 25 });
  }
  if (text.includes("zul'aman") || text.includes("zul aman") || /\bza\b/.test(text)) {
    matches.push({ id: "za", image: versionedImagePath("/raid-images/pb-header-kara.png"), rosterCap: 10 });
  }

  if (!matches.length) {
    return [{ id: "fallback", image: versionedImagePath("/raid-images/pb-header-kara.png"), rosterCap: 25 }];
  }
  return matches.slice(0, 2);
}

function eventHeaderMarkup(event) {
  const raids = detectEventRaids(event);
  if (raids.length === 1) {
    return `<div class="event-raid-header"><img src="${escapeHtml(raids[0].image)}" alt="" loading="lazy" decoding="async" /></div>`;
  }
  return `
    <div class="event-raid-header event-raid-header--split">
      <img src="${escapeHtml(raids[0].image)}" alt="" loading="lazy" decoding="async" />
      <img src="${escapeHtml(raids[1].image)}" alt="" loading="lazy" decoding="async" />
    </div>
  `;
}

function rosterBucketRoleName(roleName) {
  const low = String(roleName || "").trim().toLowerCase();
  if (low === "tank" || low === "tanks" || low === "schutz") return "Tanks";
  if (low === "healer" || low === "healers") return "Healers";
  if (low === "melee" || low === "mdps") return "Melee";
  if (low === "ranged" || low === "rdps" || low === "caster" || low === "casters") return "Ranged";
  const r = String(roleName || "").trim();
  return ROLE_ORDER.includes(r) ? r : "Ranged";
}

function groupedRosterByRole(confirmedRoster) {
  const grouped = new Map(ROLE_ORDER.map((role) => [role, []]));
  for (const player of confirmedRoster || []) {
    const role = rosterBucketRoleName(player?.roleName);
    grouped.get(role).push(player);
  }
  for (const role of ROLE_ORDER) {
    grouped.get(role).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }
  return grouped;
}

function formatCountdownRemaining(totalSec) {
  if (totalSec <= 0) return "Starting soon";
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d >= 1) return `${d}d ${h}h ${m}m`;
  if (totalSec >= 3600) return `${h}h ${m}m ${s}s`;
  if (totalSec >= 60) return `${m}m ${s}s`;
  return `${s}s`;
}

let countdownIntervalId = null;

function updateEventCountdowns() {
  const now = Math.floor(Date.now() / 1000);
  document.querySelectorAll("[data-event-start]").forEach((el) => {
    const start = Number(el.getAttribute("data-event-start"));
    const inner = el.querySelector(".event-countdown-value");
    if (!inner || !start) return;
    inner.textContent = formatCountdownRemaining(start - now);
  });
}

function startEventCountdowns() {
  if (countdownIntervalId != null) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
  updateEventCountdowns();
  countdownIntervalId = setInterval(updateEventCountdowns, 1000);
}

async function loadAuthMe() {
  if (authMe !== null) return authMe;
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    const payload = await res.json().catch(() => ({}));
    authMe = payload?.authenticated ? payload : { authenticated: false };
  } catch {
    authMe = { authenticated: false };
  }
  return authMe;
}

function signupActionsMarkup(event, isAuthenticated) {
  const eventId = String(event?.id || "");
  if (!isAuthenticated) {
    const next = encodeURIComponent("/events.html");
    return `<a href="/auth/discord/login?next=${next}" class="event-signup-btn">Login to Sign up</a>`;
  }
  const currentStatus = String(event?.currentUserSignup?.status || "").toLowerCase();
  const isSignedUp = currentStatus === "primary";
  return `
    <button type="button" class="event-signup-btn" data-event-signup-action="${isSignedUp ? "signoff" : "signup"}" data-event-id="${escapeHtml(eventId)}">
      ${isSignedUp ? "Sign off" : "Sign up"}
    </button>
    <a href="${escapeHtml(DISCORD_INVITE_URL)}" target="_blank" rel="noreferrer" class="event-signup-btn event-signup-btn--softres">Discord</a>
  `;
}

async function submitEventSignupAction(eventId, action) {
  const method = action === "signoff" ? "DELETE" : "POST";
  const res = await fetch(`/api/raid-helper/events/${encodeURIComponent(eventId)}/signup`, {
    method,
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const next = encodeURIComponent("/events.html");
    window.location.href = `/auth/discord/login?next=${next}`;
    return;
  }
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error || "Failed to update signup");
  }
}

async function loadEvents() {
  try {
    await loadTbcSpecIconMap();
    await loadWclAttendanceForEvents();
    const me = await loadAuthMe();
    const isAuthenticated = Boolean(me?.authenticated);
    const res = await fetch("/api/raid-helper/future-events", { credentials: "include" });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Failed to load events");

    const rows = (payload?.events || []).filter(
      (event) => String(event?.title || "").trim().toLowerCase() !== "p2 raids"
    );
    if (!rows.length) {
      eventsList.innerHTML = `<article class="card"><h2>No upcoming events.</h2></article>`;
      return;
    }

    eventsList.innerHTML = rows
      .map((event) => {
        const softresBtn = event.softres?.enabled
          ? `<a href="${escapeHtml(event.softres.url)}" target="_blank" rel="noreferrer" class="event-signup-btn event-signup-btn--softres">SoftRes</a>`
          : "";
        const directSignupMarkup = signupActionsMarkup(event, isAuthenticated);
        const linksRow = event.softres?.enabled ? `${softresBtn}${directSignupMarkup}` : directSignupMarkup;

        const signups = Number(event?.signups?.total || 0);
        const rosterCapacity = rosterCapacityForEvent(event);
        const groupedRoster = groupedRosterByRole(event.confirmedRoster);
        const card = (p) => rosterRaiderCard(p, event.confirmedRoster);
        const groupedRosterHtml = ROLE_ORDER.filter((role) => groupedRoster.get(role).length > 0)
          .map(
            (role) => `
              <div class="roster-role-group">
                <div class="roster-role-title">${escapeHtml(role)} (${groupedRoster.get(role).length})</div>
                <div class="raider-grid">${groupedRoster.get(role).map(card).join("")}</div>
              </div>
            `
          )
          .join("");

        const headerMarkup = eventHeaderMarkup(event);
        const startSec = Number(event.startTime || 0);

        return `
          <article class="card event-card">
            ${headerMarkup}
            <div class="event-card-inner">
            <div class="event-main-row">
              <div class="event-time-col">
                <div class="event-date">${escapeHtml(fmtEventDate(event.startTime))}</div>
                <div class="event-time">${escapeHtml(fmtEventTime(event.startTime))}</div>
                <div class="event-countdown" data-event-start="${startSec}">
                  <span class="event-countdown-label">Starts in</span>
                  <span class="event-countdown-value">—</span>
                </div>
              </div>
              <div class="event-boss-col">
                <h2>${escapeHtml(event.title)}</h2>
                <p class="subtle">${escapeHtml(event.description || "No description")}</p>
                <p class="subtle">Roster: T ${event.rosterByRole.Tanks} / H ${event.rosterByRole.Healers} / M ${event.rosterByRole.Melee} / R ${event.rosterByRole.Ranged}</p>
              </div>
              <div class="event-signup-col">
                <div class="event-signup-summary">
                  <span class="event-signup-count">${signups}<span>/${rosterCapacity}</span></span>
                </div>
                <div class="event-links">${linksRow}</div>
              </div>
            </div>
            ${groupedRosterHtml || `<div class="subtle">No confirmed roster yet.</div>`}
            </div>
          </article>
        `;
      })
      .join("");

    startEventCountdowns();
  } catch (error) {
    eventsList.innerHTML = `<article class="card"><h2>Failed to load events.</h2><p class="subtle">${escapeHtml(error.message || "Unknown error")}</p></article>`;
  }
}

document.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-event-signup-action][data-event-id]");
  if (!btn) return;
  const eventId = String(btn.getAttribute("data-event-id") || "").trim();
  const action = String(btn.getAttribute("data-event-signup-action") || "").trim();
  if (!eventId || !action) return;
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = action === "signoff" ? "Signing off..." : "Signing up...";
  try {
    await submitEventSignupAction(eventId, action);
    await loadEvents();
  } catch (error) {
    btn.textContent = originalText;
    btn.disabled = false;
    window.alert(error?.message || "Failed to update signup");
  }
});

initBackgroundStars();
loadEvents();
