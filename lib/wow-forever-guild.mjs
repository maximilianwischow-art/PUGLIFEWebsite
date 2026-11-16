/**
 * World of Warcraft: Forever guild roster helpers (Blizzard Profile API).
 *
 * Guilds are realmless: /data/wow/guild/{slug}/roster?namespace=profile-forever-{region}
 * EU PvE is ruleset "Normal" (id 2).
 */

import { classById, raceById } from "./wow-forever-data.mjs";

/** Blizzard playable_class.id → Forever catalog class id */
export const FOREVER_CLASS_BY_BLIZZARD_ID = {
  1: "warrior",
  2: "paladin",
  3: "hunter",
  4: "rogue",
  5: "priest",
  7: "shaman",
  8: "mage",
  9: "warlock",
  11: "druid",
};

/**
 * Blizzard playable_race.id → Forever catalog race id.
 * 95/96 are the Skyborne faction variants (High Order / Windshaper).
 */
export const FOREVER_RACE_BY_BLIZZARD_ID = {
  1: "human",
  2: "orc",
  3: "dwarf",
  4: "nightelf",
  5: "undead",
  6: "tauren",
  7: "gnome",
  8: "troll",
  95: "skyborne",
  96: "skyborne",
};

export const FOREVER_RANK_LABELS = {
  0: "Guild Master",
  1: "Officer",
  2: "Veteran",
  3: "Member",
  4: "Initiate",
};

export function normalizeForeverNameKey(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function foreverCharacterDisplayName(given, surname) {
  return [String(given || "").trim(), String(surname || "").trim()].filter(Boolean).join(" ");
}

export function foreverCharacterSlug(given, surname) {
  const key = normalizeForeverNameKey(foreverCharacterDisplayName(given, surname));
  return key ? key.replace(/\s+/g, "-") : "";
}

export function mapBlizzardClass(id) {
  const classId = FOREVER_CLASS_BY_BLIZZARD_ID[Number(id)] || "";
  const cls = classId ? classById(classId) : null;
  return {
    classId,
    className: cls?.name || (classId ? classId : `Class ${id || "?"}`),
    classColor: cls?.color || "#94a3b8",
  };
}

export function mapBlizzardRace(id) {
  const raceId = FOREVER_RACE_BY_BLIZZARD_ID[Number(id)] || "";
  const race = raceId ? raceById(raceId) : null;
  return {
    raceId,
    raceName: race?.name || (raceId ? raceId : `Race ${id || "?"}`),
    isNewRace: Boolean(race?.isNewRace),
  };
}

export function mapGuildRosterMember(rawMember) {
  const character = rawMember?.character || {};
  const givenName = String(character.name || "").trim();
  const familyName = String(character.surname || "").trim();
  const characterName = foreverCharacterDisplayName(givenName, familyName);
  const slug = String(character.slug || foreverCharacterSlug(givenName, familyName)).trim();
  const level = Number(character.level) || 0;
  const rank = Number.isFinite(Number(rawMember?.rank)) ? Number(rawMember.rank) : null;
  const classMapped = mapBlizzardClass(character.playable_class?.id);
  const raceMapped = mapBlizzardRace(character.playable_race?.id);
  const faction = String(character.faction?.type || "").trim().toLowerCase();

  return {
    characterId: Number(character.id) || null,
    givenName,
    familyName,
    characterName,
    slug,
    level,
    rank,
    rankLabel: rank == null ? "" : FOREVER_RANK_LABELS[rank] || `Rank ${rank}`,
    faction,
    blizzardClassId: Number(character.playable_class?.id) || null,
    blizzardRaceId: Number(character.playable_race?.id) || null,
    ...classMapped,
    ...raceMapped,
    nameKey: normalizeForeverNameKey(characterName),
  };
}

/**
 * Build a lookup of Forever Discord picks keyed by normalized character name.
 * @param {Array<{ userId: string, displayName?: string, avatar?: string, characterName?: string, race?: string, classId?: string, faction?: string }>} picks
 */
export function buildForeverPickIndex(picks) {
  const byName = new Map();
  for (const pick of picks || []) {
    const key = normalizeForeverNameKey(pick?.characterName);
    if (!key) continue;
    const row = {
      userId: String(pick.userId || "").trim(),
      displayName: String(pick.displayName || "").trim(),
      avatar: String(pick.avatar || "").trim(),
      characterName: String(pick.characterName || "").trim(),
      race: String(pick.race || "").trim(),
      classId: String(pick.classId || "").trim(),
      faction: String(pick.faction || "").trim(),
    };
    if (!row.userId) continue;
    const existing = byName.get(key);
    if (!existing) byName.set(key, [row]);
    else existing.push(row);
  }
  return byName;
}

/**
 * Build a lookup from Forever character claims (Main/Twink) for guild LB attach.
 * Prefer main claims when multiple rows somehow share a key (should not happen).
 * @param {Array<{ userId: string, displayName?: string, avatar?: string, characterName?: string, nameKey?: string, raceId?: string, classId?: string, role?: string }>} claims
 */
export function buildForeverClaimIndex(claims) {
  const byName = new Map();
  const sorted = [...(claims || [])].sort((a, b) => {
    const ar = String(a?.role || "") === "main" ? 0 : 1;
    const br = String(b?.role || "") === "main" ? 0 : 1;
    return ar - br;
  });
  for (const claim of sorted) {
    const key = normalizeForeverNameKey(claim?.nameKey || claim?.characterName);
    if (!key) continue;
    const row = {
      userId: String(claim.userId || "").trim(),
      displayName: String(claim.displayName || "").trim(),
      avatar: String(claim.avatar || "").trim(),
      characterName: String(claim.characterName || "").trim(),
      race: String(claim.raceId || claim.race || "").trim(),
      classId: String(claim.classId || "").trim(),
      faction: "alliance",
      claimRole: String(claim.role || "twink") === "main" ? "main" : "twink",
    };
    if (!row.userId) continue;
    const existing = byName.get(key);
    if (!existing) byName.set(key, [row]);
    else existing.push(row);
  }
  return byName;
}

/**
 * Attach Discord Forever-pick + site-profile status onto mapped guild members.
 * @param {ReturnType<typeof mapGuildRosterMember>[]} members
 * @param {Map<string, any[]>} pickIndex
 * @param {(userId: string) => any} getProfile
 */
export function attachDiscordLinkStatus(members, pickIndex, getProfile) {
  return (members || []).map((member) => {
    const matches = pickIndex?.get(member.nameKey) || [];
    const primary = matches[0] || null;
    if (!primary) {
      return {
        ...member,
        discordLinked: false,
        discordProfileExists: false,
        discord: null,
      };
    }
    const profile = typeof getProfile === "function" ? getProfile(primary.userId) : null;
    const avatarUrl =
      primary.userId && primary.avatar
        ? `https://cdn.discordapp.com/avatars/${primary.userId}/${primary.avatar}.png?size=64`
        : "";
    const pictureUrl = profile?.pictureFilename
      ? `/api/profile/picture/${encodeURIComponent(primary.userId)}?v=${profile.pictureEtag || profile.pictureUpdatedAt || 0}`
      : String(profile?.pictureUrl || "").trim() || "";
    return {
      ...member,
      discordLinked: true,
      discordProfileExists: Boolean(profile),
      discord: {
        userId: primary.userId,
        displayName: primary.displayName || primary.userId,
        avatarUrl,
        pictureUrl,
        characterName: primary.characterName,
        claimRole: primary.claimRole === "main" ? "main" : "twink",
        race: primary.race,
        classId: primary.classId,
        matchCount: matches.length,
        profileExists: Boolean(profile),
        profileMainCharacterName: String(profile?.mainCharacterName || "").trim(),
      },
    };
  });
}

export async function fetchForeverGuildDocument({
  token,
  region = "eu",
  guildSlug = "bulwark",
  locale = "en_GB",
  pathSuffix = "",
}) {
  const host = String(region || "eu").trim().toLowerCase() || "eu";
  const slug = encodeURIComponent(String(guildSlug || "").trim().toLowerCase());
  const ns = `profile-forever-${host}`;
  const suffix = pathSuffix ? `/${String(pathSuffix).replace(/^\/+/, "")}` : "";
  const url =
    `https://${host}.api.blizzard.com/data/wow/guild/${slug}${suffix}` +
    `?namespace=${encodeURIComponent(ns)}&locale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `Forever guild ${pathSuffix || "profile"} failed (${res.status}): ${
        payload?.detail || payload?.title || payload?.error || "unknown error"
      }`
    );
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function skillFromProfessionRow(row) {
  const tiers = Array.isArray(row?.tiers) ? row.tiers : [];
  let best = null;
  for (const tier of tiers) {
    const skillPoints = Number(tier?.skill_points);
    const maxSkillPoints = Number(tier?.max_skill_points);
    if (!Number.isFinite(skillPoints) && !Number.isFinite(maxSkillPoints)) continue;
    const candidate = {
      skillPoints: Number.isFinite(skillPoints) ? skillPoints : null,
      maxSkillPoints: Number.isFinite(maxSkillPoints) ? maxSkillPoints : null,
    };
    if (!best || (candidate.maxSkillPoints || 0) >= (best.maxSkillPoints || 0)) best = candidate;
  }
  if (best) return best;
  const skillPoints = Number(row?.skill_points);
  const maxSkillPoints = Number(row?.max_skill_points);
  return {
    skillPoints: Number.isFinite(skillPoints) ? skillPoints : null,
    maxSkillPoints: Number.isFinite(maxSkillPoints) ? maxSkillPoints : null,
  };
}

/** First two primary professions from a Forever character professions document. */
export function primaryProfessionsFromPayload(data) {
  const rows = Array.isArray(data?.primaries) ? data.primaries : [];
  return rows.slice(0, 2).map((row) => {
    const name = String(row?.profession?.name || "").trim();
    if (!name) return null;
    return { name, ...skillFromProfessionRow(row) };
  });
}

const SECONDARY_PROFESSION_NAMES = new Set(["Cooking", "Fishing", "First Aid"]);

/** Secondary professions (Cooking / Fishing / First Aid) from the same document. */
export function secondaryProfessionsFromPayload(data) {
  const rows = Array.isArray(data?.secondaries) ? data.secondaries : [];
  const out = [];
  for (const row of rows) {
    const name = String(row?.profession?.name || "").trim();
    if (!name || !SECONDARY_PROFESSION_NAMES.has(name)) continue;
    out.push({ name, ...skillFromProfessionRow(row) });
  }
  return out;
}

function namespaceFromBlizzardHref(href) {
  try {
    const url = new URL(String(href || ""));
    return String(url.searchParams.get("namespace") || "").trim();
  } catch {
    return "";
  }
}

/** Collect known recipes across primary + secondary profession tiers. */
export function knownRecipesFromPayload(data) {
  const out = [];
  const seen = new Set();
  const buckets = [
    ...(Array.isArray(data?.primaries) ? data.primaries : []),
    ...(Array.isArray(data?.secondaries) ? data.secondaries : []),
  ];
  for (const row of buckets) {
    const profession = String(row?.profession?.name || "").trim();
    if (!profession) continue;
    const tiers = Array.isArray(row?.tiers) ? row.tiers : [];
    for (const tier of tiers) {
      const recipes = Array.isArray(tier?.known_recipes) ? tier.known_recipes : [];
      for (const recipe of recipes) {
        const recipeId = Number(recipe?.id);
        if (!Number.isFinite(recipeId) || recipeId <= 0 || seen.has(recipeId)) continue;
        seen.add(recipeId);
        out.push({
          recipeId,
          recipeName: String(recipe?.name || "").trim(),
          profession,
          namespace: namespaceFromBlizzardHref(recipe?.key?.href),
        });
      }
    }
  }
  out.sort((a, b) => a.profession.localeCompare(b.profession) || a.recipeName.localeCompare(b.recipeName));
  return out;
}

export function foreverSlugFromCharacterName(characterName) {
  const key = normalizeForeverNameKey(characterName);
  return key ? key.replace(/\s+/g, "-") : "";
}

/**
 * Known recipes for one Forever character (all professions).
 * @returns {Promise<Array<{ recipeId: number, recipeName: string, profession: string, namespace: string }>>}
 */
export async function fetchForeverCharacterKnownRecipes({
  token,
  region = "eu",
  locale = "en_GB",
  slug,
}) {
  const nameSlug = String(slug || "").trim().toLowerCase();
  if (!token || !nameSlug) return [];
  const host = String(region || "eu").trim().toLowerCase() || "eu";
  const url =
    `https://${host}.api.blizzard.com/profile/wow/character/${encodeURIComponent(nameSlug)}/professions` +
    `?namespace=${encodeURIComponent(`profile-forever-${host}`)}&locale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return [];
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return [];
  return knownRecipesFromPayload(data);
}

/** Gathering / non-craft professions excluded from Market Demand browse. */
const FOREVER_NON_CRAFT_PROFESSION_IDS = new Set([
  182, // Herbalism
  186, // Mining
  356, // Fishing
  393, // Skinning
  2933, // Test Profession [DNT]
]);

/**
 * Full Forever craftable recipe catalog (profession → categories → recipes).
 * Used by Market Hall Demand browse (auction-house style).
 */
export async function fetchForeverProfessionRecipeCatalog({
  token,
  region = "eu",
  locale = "en_GB",
  namespace = "",
} = {}) {
  if (!token) return { professions: [], recipes: [], fetchedAt: Date.now() };
  const host = String(region || "eu").trim().toLowerCase() || "eu";
  const ns =
    String(namespace || "").trim() ||
    String(process.env.WOW_FOREVER_STATIC_NAMESPACE || "").trim() ||
    `static-forever-${host}`;
  const auth = { Authorization: `Bearer ${token}` };
  const indexUrl =
    `https://${host}.api.blizzard.com/data/wow/profession/index` +
    `?namespace=${encodeURIComponent(ns)}&locale=${encodeURIComponent(locale)}`;
  const indexRes = await fetch(indexUrl, { headers: auth });
  const indexData = await indexRes.json().catch(() => null);
  if (!indexRes.ok || !indexData) {
    throw new Error(`Forever profession index failed (${indexRes.status})`);
  }
  const professions = (Array.isArray(indexData.professions) ? indexData.professions : [])
    .map((p) => ({
      id: Number(p?.id) || 0,
      name: String(p?.name || "").trim(),
    }))
    .filter((p) => p.id > 0 && p.name && !FOREVER_NON_CRAFT_PROFESSION_IDS.has(p.id));

  const recipes = [];
  for (const profession of professions) {
    const profUrl =
      `https://${host}.api.blizzard.com/data/wow/profession/${encodeURIComponent(String(profession.id))}` +
      `?namespace=${encodeURIComponent(ns)}&locale=${encodeURIComponent(locale)}`;
    const profRes = await fetch(profUrl, { headers: auth });
    const profData = await profRes.json().catch(() => null);
    if (!profRes.ok || !profData) continue;
    const tiers = Array.isArray(profData.skill_tiers) ? profData.skill_tiers : [];
    for (const tier of tiers) {
      const tierId = Number(tier?.id) || 0;
      if (tierId <= 0) continue;
      const tierUrl =
        `https://${host}.api.blizzard.com/data/wow/profession/${encodeURIComponent(String(profession.id))}` +
        `/skill-tier/${encodeURIComponent(String(tierId))}` +
        `?namespace=${encodeURIComponent(ns)}&locale=${encodeURIComponent(locale)}`;
      const tierRes = await fetch(tierUrl, { headers: auth });
      const tierData = await tierRes.json().catch(() => null);
      if (!tierRes.ok || !tierData) continue;
      for (const category of Array.isArray(tierData.categories) ? tierData.categories : []) {
        const categoryName = String(category?.name || "").trim() || "General";
        // Skip noisy seasonal / Do Not Translate buckets when empty of real crafts.
        if (/\[DNT\]/i.test(categoryName)) continue;
        for (const recipe of Array.isArray(category.recipes) ? category.recipes : []) {
          const recipeId = Number(recipe?.id) || 0;
          const recipeName = String(recipe?.name || "").trim();
          if (recipeId <= 0 || !recipeName) continue;
          recipes.push({
            recipeId,
            recipeName,
            craftedItemId: null,
            craftedItemName: recipeName,
            profession: profession.name,
            professionId: profession.id,
            category: categoryName,
            source: "forever-static",
          });
        }
      }
    }
  }

  recipes.sort(
    (a, b) =>
      a.profession.localeCompare(b.profession) ||
      a.category.localeCompare(b.category) ||
      a.recipeName.localeCompare(b.recipeName)
  );

  return {
    professions: professions.map((p) => p.name).sort((a, b) => a.localeCompare(b)),
    recipes,
    fetchedAt: Date.now(),
    namespace: ns,
  };
}

/**
 * Recipe detail (crafted item + reagents) for Forever static namespace.
 */
export async function fetchForeverRecipeDetail({
  token,
  region = "eu",
  locale = "en_GB",
  recipeId,
  namespace = "",
}) {
  const id = Number(recipeId);
  if (!token || !Number.isFinite(id) || id <= 0) return null;
  const host = String(region || "eu").trim().toLowerCase() || "eu";
  const ns =
    String(namespace || "").trim() ||
    String(process.env.WOW_FOREVER_STATIC_NAMESPACE || "").trim() ||
    `static-forever-${host}`;
  const url =
    `https://${host}.api.blizzard.com/data/wow/recipe/${encodeURIComponent(String(id))}` +
    `?namespace=${encodeURIComponent(ns)}&locale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return null;
  const crafted =
    data.crafted_item || data.alliance_crafted_item || data.horde_crafted_item || null;
  const reagents = (Array.isArray(data.reagents) ? data.reagents : [])
    .map((row) => ({
      itemId: Number(row?.reagent?.id) || null,
      name: String(row?.reagent?.name || "").trim(),
      quantity: Number(row?.quantity) || 1,
    }))
    .filter((row) => row.name || row.itemId);
  return {
    recipeId: id,
    recipeName: String(data.name || "").trim(),
    craftedItemId: crafted?.id != null ? Number(crafted.id) : null,
    craftedItemName: String(crafted?.name || "").trim(),
    reagents,
    namespace: ns,
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Primary + secondary professions for one Forever character. Level 10+ profiles only; 404 becomes empty.
 * @returns {Promise<{ profession1: object|null, profession2: object|null, secondaries: object[] }>}
 */
export async function fetchForeverCharacterPrimaryProfessions({
  token,
  region = "eu",
  locale = "en_GB",
  slug,
}) {
  const empty = { profession1: null, profession2: null, secondaries: [] };
  const nameSlug = String(slug || "").trim().toLowerCase();
  if (!token || !nameSlug) return empty;
  const host = String(region || "eu").trim().toLowerCase() || "eu";
  const url =
    `https://${host}.api.blizzard.com/profile/wow/character/${encodeURIComponent(nameSlug)}/professions` +
    `?namespace=${encodeURIComponent(`profile-forever-${host}`)}&locale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return empty;
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) return empty;
  const [profession1, profession2] = primaryProfessionsFromPayload(data);
  return {
    profession1: profession1 || null,
    profession2: profession2 || null,
    secondaries: secondaryProfessionsFromPayload(data),
  };
}

/** Fill profession1 / profession2 / secondaries on roster members. Missing or sub-10 characters stay null. */
export async function attachForeverPrimaryProfessions(members, { token, region = "eu", locale = "en_GB" } = {}) {
  const list = Array.isArray(members) ? members : [];
  const targets = list.filter((member) => Number(member?.level) >= 10 && member?.slug);
  await mapWithConcurrency(targets, 8, async (member) => {
    const profs = await fetchForeverCharacterPrimaryProfessions({
      token,
      region,
      locale,
      slug: member.slug,
    }).catch(() => ({ profession1: null, profession2: null, secondaries: [] }));
    member.profession1 = profs.profession1;
    member.profession2 = profs.profession2;
    member.secondaries = Array.isArray(profs.secondaries) ? profs.secondaries : [];
  });
  for (const member of list) {
    if (member.profession1 === undefined) member.profession1 = null;
    if (member.profession2 === undefined) member.profession2 = null;
    if (!Array.isArray(member.secondaries)) member.secondaries = [];
  }
  return list;
}

export async function fetchForeverGuildRosterBundle({
  token,
  region = "eu",
  guildSlug = "bulwark",
  locale = "en_GB",
}) {
  const [guild, roster] = await Promise.all([
    fetchForeverGuildDocument({ token, region, guildSlug, locale }),
    fetchForeverGuildDocument({ token, region, guildSlug, locale, pathSuffix: "roster" }),
  ]);
  const members = (Array.isArray(roster?.members) ? roster.members : [])
    .map(mapGuildRosterMember)
    .filter((m) => m.characterName);
  members.sort((a, b) => b.level - a.level || a.characterName.localeCompare(b.characterName));
  await attachForeverPrimaryProfessions(members, { token, region, locale });
  return {
    guild: {
      id: Number(guild?.id) || null,
      name: String(guild?.name || "").trim(),
      slug: String(guild?.slug || guildSlug).trim(),
      faction: String(guild?.faction?.type || "").trim().toLowerCase(),
      memberCount: Number(guild?.member_count) || members.length,
      rulesetId: Number(guild?.ruleset?.id) || null,
      rulesetName: String(guild?.ruleset?.name || "").trim(),
      createdTimestamp: Number(guild?.created_timestamp) || null,
    },
    members,
    fetchedAt: Date.now(),
  };
}

function countByKey(members, keyFn, labelFn) {
  const map = new Map();
  for (const member of members) {
    const key = keyFn(member);
    if (!key) continue;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { id: key, label: labelFn(member, key), count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
}

/**
 * Aggregate leveling / composition stats from a Forever guild roster.
 * @param {Array<object>} members
 * @param {{ linkedCount?: number, profileCount?: number }} [linkStats]
 */
export function buildForeverGuildLeaderboardStats(members, linkStats = {}) {
  const list = Array.isArray(members) ? members : [];
  const levels = list.map((m) => Number(m.level) || 0).filter((n) => n > 0);
  const linkedCount = Number(linkStats.linkedCount);
  const profileCount = Number(linkStats.profileCount);
  const resolvedLinked = Number.isFinite(linkedCount)
    ? linkedCount
    : list.filter((m) => m.discordLinked).length;
  const resolvedProfiles = Number.isFinite(profileCount)
    ? profileCount
    : list.filter((m) => m.discordProfileExists).length;

  const bandDefs = [
    { id: "1-9", label: "1–9", min: 1, max: 9 },
    { id: "10-19", label: "10–19", min: 10, max: 19 },
    { id: "20-29", label: "20–29", min: 20, max: 29 },
    { id: "30-39", label: "30–39", min: 30, max: 39 },
    { id: "40-49", label: "40–49", min: 40, max: 49 },
    { id: "50-59", label: "50–59", min: 50, max: 59 },
    { id: "60", label: "60", min: 60, max: 60 },
  ];
  const levelBands = bandDefs.map((band) => ({
    id: band.id,
    label: band.label,
    count: list.filter((m) => {
      const level = Number(m.level) || 0;
      return level >= band.min && level <= band.max;
    }).length,
  }));

  const guildMaster =
    list.find((m) => Number(m.rank) === 0) || list.find((m) => /guild master/i.test(String(m.rankLabel || "")));

  return {
    memberCount: list.length,
    linkedCount: resolvedLinked,
    unlinkedCount: Math.max(0, list.length - resolvedLinked),
    profileCount: resolvedProfiles,
    maxLevel: levels.length ? Math.max(...levels) : 0,
    minLevel: levels.length ? Math.min(...levels) : 0,
    avgLevel: levels.length
      ? Math.round((levels.reduce((a, b) => a + b, 0) / levels.length) * 10) / 10
      : 0,
    byClass: countByKey(
      list,
      (m) => String(m.classId || m.className || "").trim().toLowerCase(),
      (m, key) => String(m.className || key)
    ),
    byRace: countByKey(
      list,
      (m) => String(m.raceId || m.raceName || "").trim().toLowerCase(),
      (m, key) => String(m.raceName || key)
    ),
    byRank: countByKey(
      list,
      (m) => (m.rank == null ? "unknown" : String(m.rank)),
      (m, key) => String(m.rankLabel || (key === "unknown" ? "Unknown" : `Rank ${key}`))
    ),
    levelBands,
    topLevelCount: list.filter((m) => (Number(m.level) || 0) >= 60).length,
    nearCapCount: list.filter((m) => (Number(m.level) || 0) >= 50).length,
    skyborneCount: list.filter((m) => String(m.raceId || "").toLowerCase() === "skyborne" || /skyborne/i.test(String(m.raceName || ""))).length,
    officerCount: list.filter((m) => Number(m.rank) === 1 || /officer/i.test(String(m.rankLabel || ""))).length,
    guildMasterName: String(guildMaster?.characterName || "").trim(),
  };
}
