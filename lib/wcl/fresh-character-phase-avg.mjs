/** TBC Fresh character-page zone IDs (Warcraft Logs Fresh subdomain). */
export const WCL_FRESH_PHASE_ZONES = Object.freeze({
  kara: 1047,
  gruulMag: 1048,
  sscTk: 1056,
});

export const WCL_FRESH_PHASE_ZONE_KEYS = Object.freeze(["kara", "gruulMag", "sscTk"]);

/** One round-trip per character (all three TBC phases). */
const PHASE_AVGS_BATCH_QUERY = `
  query WclFreshPhaseAvgs($name: String!, $slug: String!, $region: String!) {
    characterData {
      character(name: $name, serverSlug: $slug, serverRegion: $region) {
        id
        kara: zoneRankings(zoneID: 1047, metric: dps)
        gruulMag: zoneRankings(zoneID: 1048, metric: dps)
        sscTk: zoneRankings(zoneID: 1056, metric: dps)
      }
    }
  }
`;

export function wclFreshServerRegionFromConfig(regionRaw) {
  const r = String(regionRaw || "eu").trim().toLowerCase();
  if (r === "us") return "US";
  if (r === "kr") return "KR";
  if (r === "tw") return "TW";
  return "EU";
}

export function slugifyFreshCharacterName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function slugifyFreshRealmSlug(realmRaw) {
  return String(realmRaw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Public Fresh character page (default Kara zone for quick link). */
export function buildFreshCharacterPageUrl({ region = "eu", realmSlug, nameSlug, zoneId = WCL_FRESH_PHASE_ZONES.kara }) {
  const r = String(region || "eu").trim().toLowerCase() || "eu";
  const rs = slugifyFreshRealmSlug(realmSlug);
  const ns = encodeURIComponent(String(nameSlug || "").trim().toLowerCase());
  if (!rs || !ns) return null;
  const base = `https://fresh.warcraftlogs.com/character/${r}/${rs}/${ns}`;
  const z = Number(zoneId);
  return Number.isFinite(z) && z > 0 ? `${base}?zone=${z}` : base;
}

export function parseZoneRankingsPayload(raw) {
  if (raw == null) return null;
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const n = Number(obj.bestPerformanceAverage);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}

/**
 * @param {object} opts
 * @param {(query: string, variables?: object) => Promise<object>} opts.queryFreshWcl
 * @param {string} opts.serverRegion - EU | US
 * @param {string} opts.realmSlug
 * @param {string} opts.characterName
 * @param {Record<string, number>} [opts.zones]
 */
export async function fetchCharacterPhaseAvgsFromWcl(opts) {
  const queryFreshWcl = opts?.queryFreshWcl;
  if (typeof queryFreshWcl !== "function") {
    throw new Error("fetchCharacterPhaseAvgsFromWcl requires queryFreshWcl");
  }
  const serverRegion = wclFreshServerRegionFromConfig(opts?.serverRegion || "EU");
  const realmSlug = slugifyFreshRealmSlug(opts?.realmSlug);
  const characterName = String(opts?.characterName || "").trim();
  const nameSlug = slugifyFreshCharacterName(characterName);
  const zones = opts?.zones && typeof opts.zones === "object" ? opts.zones : WCL_FRESH_PHASE_ZONES;
  const errors = [];
  const out = {
    characterName,
    realmSlug,
    karaBestPerfAvg: null,
    gruulMagBestPerfAvg: null,
    sscTkBestPerfAvg: null,
  };

  if (!realmSlug || !characterName) {
    errors.push("missing realm or character name");
    return { ...out, errors };
  }

  try {
    const data = await queryFreshWcl(PHASE_AVGS_BATCH_QUERY, {
      name: characterName,
      slug: realmSlug,
      region: serverRegion,
    });
    const character = data?.characterData?.character;
    if (!character?.id) {
      errors.push("character not found on WCL Fresh");
      return { ...out, errors };
    }
    for (const key of WCL_FRESH_PHASE_ZONE_KEYS) {
      const zoneID = Number(zones[key]);
      if (!Number.isFinite(zoneID) || zoneID <= 0) continue;
      const avg = parseZoneRankingsPayload(character[key]);
      if (key === "kara") out.karaBestPerfAvg = avg;
      else if (key === "gruulMag") out.gruulMagBestPerfAvg = avg;
      else if (key === "sscTk") out.sscTkBestPerfAvg = avg;
    }
  } catch (err) {
    errors.push(err?.message || String(err));
  }

  return { ...out, errors };
}
