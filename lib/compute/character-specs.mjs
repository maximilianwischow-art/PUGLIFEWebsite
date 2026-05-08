/**
 * Self-contained class + spec resolver used by both the in-server
 * `runSyncCharacterSpecs` worker and the standalone
 * `scripts/backfill-character-specs.mjs` CLI.
 *
 * Source priority for `wow_class` / `wow_spec`:
 *   1. Battle.net character summary (`/profile/wow/character/{realm}/{name}`)
 *   2. Battle.net specializations endpoint (only when summary lacks active spec)
 *   3. Raider.IO classic profile (fallback for whichever field is still missing)
 *
 * The module deliberately depends on nothing in `server.js` so it can be
 * imported from a CLI that opens its own SQLite connection. All
 * configuration is passed in via `config`; no global state.
 */

const ENGLISH_CLASS_DISPLAYS = [
  "Death Knight",
  "Druid",
  "Hunter",
  "Mage",
  "Paladin",
  "Priest",
  "Rogue",
  "Shaman",
  "Warlock",
  "Warrior",
];

const CLASS_DISPLAY_BY_LOWER = (() => {
  const map = new Map();
  for (const display of ENGLISH_CLASS_DISPLAYS) {
    map.set(display.toLowerCase(), display);
    map.set(display.toLowerCase().replace(/\s+/g, ""), display);
  }
  // A handful of common localized class names, kept short. The worker
  // requests `locale=en_US` so we mostly receive English already; this
  // map covers the case where a non-English locale slipped through.
  const localized = {
    krieger: "Warrior",
    schurke: "Rogue",
    magier: "Mage",
    priester: "Priest",
    hexenmeister: "Warlock",
    schamane: "Shaman",
    paladin: "Paladin",
    druide: "Druid",
    j臠er: "Hunter",
    j盲ger: "Hunter",
    todesritter: "Death Knight",
    guerrier: "Warrior",
    voleur: "Rogue",
    chasseur: "Hunter",
    mage: "Mage",
    pretre: "Priest",
    pr黻re: "Priest",
    pr锚tre: "Priest",
    druide_fr: "Druid",
    chaman: "Shaman",
    d茅moniste: "Warlock",
    demoniste: "Warlock",
  };
  for (const [k, v] of Object.entries(localized)) {
    map.set(k, v);
  }
  return map;
})();

/**
 * Map a raw class string (English or common localizations) onto a
 * canonical English display value. Returns `""` when the input is empty
 * or doesn't look like a class. Role-bucket strings ("Tank", "Healer",
 * etc.) are explicitly rejected so they never end up in `wow_class`.
 */
export function normalizeClassDisplayName(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const slug = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const collapsed = slug.replace(/[^a-z0-9]+/g, "");
  if (
    /^(tank|tanks|schutz|healer|healers|melee|ranged|caster|casters|mdps|rdps)$/.test(
      collapsed
    )
  ) {
    return "";
  }
  return CLASS_DISPLAY_BY_LOWER.get(collapsed) || CLASS_DISPLAY_BY_LOWER.get(slug) || "";
}

/**
 * Trim + collapse Raid-Helper style "Protection1" / "Protection2" labels
 * back to just "Protection". Mirrors `normalizeProtectionSpecLabel` in
 * server.js so values land identically on the same `wow_spec` column.
 */
export function normalizeSpecLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const slug = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
  if (/^protection\d+$/.test(slug)) return "Protection";
  return s;
}

/**
 * Realm slug suitable for Battle.net + Raider.IO URLs (lowercase, NFD-folded,
 * non-alphanumerics replaced with `-`). Mirrors `wowRealmSlugForLookup`.
 */
export function realmSlugForLookup(realmRaw) {
  return String(realmRaw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Battle.net OAuth token cache, scoped to a single resolver instance so a
 * long-running worker can share the bearer across many character lookups.
 */
function createBnetTokenFetcher({ clientId, clientSecret, tokenUrl }) {
  let cached = null;
  let inflight = null;
  return async function getToken() {
    if (cached && cached.expiresAt > Date.now() + 10_000) return cached.token;
    if (inflight) return inflight;
    inflight = (async () => {
      const body = new URLSearchParams({ grant_type: "client_credentials" });
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const res = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!res.ok) {
        throw new Error(`Battle.net token request failed: ${res.status}`);
      }
      const data = await res.json();
      const token = String(data?.access_token || "").trim();
      if (!token) throw new Error("Battle.net token response missing access_token");
      const ttlMs = Math.max(60_000, Number(data?.expires_in || 3600) * 1000);
      cached = { token, expiresAt: Date.now() + ttlMs - 30_000 };
      return token;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

/** Profile namespace candidates for TBC Anniversary realms. Same priority as server.js. */
function namespaceCandidates({ region, override }) {
  const r = String(region || "eu").trim().toLowerCase() || "eu";
  const out = [];
  const norm = (s) => {
    const v = String(s || "").trim();
    if (!v) return "";
    return v.toLowerCase().startsWith("profile-") ? v : `profile-${v}`;
  };
  const o = norm(override);
  if (o) out.push(o);
  for (const t of [`profile-classicann-${r}`, `profile-classic-${r}`, `profile-classic1x-${r}`]) {
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

async function fetchBnetCharacterSummary({ token, baseUrl, namespaces, locale, realmSlug, characterName }) {
  const r = encodeURIComponent(realmSlug);
  const c = encodeURIComponent(String(characterName || "").toLowerCase());
  for (const ns of namespaces) {
    const url = `${baseUrl}/profile/wow/character/${r}/${c}?namespace=${encodeURIComponent(ns)}&locale=${encodeURIComponent(locale)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") continue;
    const className = data?.character_class?.name || null;
    const sp = data?.active_spec ?? data?.active_specialization;
    const specName = sp && typeof sp === "object" && typeof sp.name === "string" ? sp.name : null;
    if (className || specName) {
      return {
        className: className ? String(className).trim() : null,
        specName: specName ? String(specName).trim() : null,
      };
    }
  }
  return null;
}

async function fetchBnetActiveSpec({ token, baseUrl, namespaces, locale, realmSlug, characterName }) {
  const r = encodeURIComponent(realmSlug);
  const c = encodeURIComponent(String(characterName || "").toLowerCase());
  for (const ns of namespaces) {
    const url = `${baseUrl}/profile/wow/character/${r}/${c}/specializations?namespace=${encodeURIComponent(ns)}&locale=${encodeURIComponent(locale)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const data = await res.json().catch(() => null);
    const groups = Array.isArray(data?.specializations) ? data.specializations : [];
    for (const g of groups) {
      const specs = Array.isArray(g?.specializations) ? g.specializations : [];
      const selected = specs.find((s) => s?.selected === true || s?.enabled === true);
      const n =
        selected?.specialization?.name ||
        selected?.playable_specialization?.name ||
        selected?.specialization_name ||
        selected?.name;
      if (typeof n === "string" && n.trim()) return n.trim();
    }
  }
  return null;
}

async function fetchRaiderIoClassicProfile({ baseUrl, region, realmSlug, characterName }) {
  const url = new URL(`${baseUrl}/characters/profile`);
  url.searchParams.set("region", region);
  url.searchParams.set("realm", realmSlug);
  url.searchParams.set("name", characterName);
  url.searchParams.append("fields", "gear");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "fallen-tacticians-api/1.0 (+character-specs sync)" },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object" || Number(data.statusCode) >= 400) return null;
  return data;
}

function classFromRaiderIoProfile(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.class,
    data.className,
    data.class_name,
    data.character?.class,
    data.character?.className,
    data.profile?.class,
    data.profile?.className,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return null;
}

function specFromRaiderIoProfile(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.active_spec_name,
    data.activeSpecName,
    data.active_spec_name_classic,
    data.spec_name,
    data.activeSpecializationName,
    data.spec?.name,
    data.specialization?.name,
    data.active_spec?.name,
    data.character?.active_spec_name,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return null;
}

/**
 * Build a resolver bound to the given configuration. Returns an async
 * `resolve({ characterName, realm })` that produces
 * `{ wowClass, wowSpec, source }` (any field may be `null`).
 *
 * @param {{
 *   blizzardClientId?: string,
 *   blizzardClientSecret?: string,
 *   blizzardTokenUrl?: string,
 *   blizzardApiBaseUrl: string,
 *   blizzardLocale: string,
 *   blizzardRegion: string,
 *   blizzardNamespaceOverride?: string,
 *   raiderIoApiBase: string,
 *   raiderIoRegion: string,
 *   defaultRealm?: string,
 * }} config
 */
export function createCharacterSpecResolver(config) {
  const {
    blizzardClientId,
    blizzardClientSecret,
    blizzardTokenUrl,
    blizzardApiBaseUrl,
    blizzardLocale,
    blizzardRegion,
    blizzardNamespaceOverride,
    raiderIoApiBase,
    raiderIoRegion,
    defaultRealm,
  } = config || {};

  const bnetReady = Boolean(
    blizzardClientId && blizzardClientSecret && blizzardTokenUrl && blizzardApiBaseUrl
  );
  const getBnetToken = bnetReady
    ? createBnetTokenFetcher({
        clientId: blizzardClientId,
        clientSecret: blizzardClientSecret,
        tokenUrl: blizzardTokenUrl,
      })
    : null;
  const namespaces = namespaceCandidates({
    region: blizzardRegion,
    override: blizzardNamespaceOverride,
  });

  return async function resolve({ characterName, realm } = {}) {
    const name = String(characterName || "").trim();
    if (!name) return { wowClass: null, wowSpec: null, source: null };
    const realmRaw = String(realm || "").trim() || String(defaultRealm || "").trim();
    if (!realmRaw) return { wowClass: null, wowSpec: null, source: null };
    const slug = realmSlugForLookup(realmRaw);
    if (!slug) return { wowClass: null, wowSpec: null, source: null };

    let wowClass = null;
    let wowSpec = null;
    let source = null;

    if (bnetReady) {
      let token = null;
      try {
        token = await getBnetToken();
      } catch {
        token = null;
      }
      if (token) {
        let summary = null;
        try {
          summary = await fetchBnetCharacterSummary({
            token,
            baseUrl: blizzardApiBaseUrl,
            namespaces,
            locale: blizzardLocale,
            realmSlug: slug,
            characterName: name,
          });
        } catch {
          summary = null;
        }
        if (summary?.className) {
          wowClass = normalizeClassDisplayName(summary.className) || null;
          if (wowClass) source = "bnet-summary";
        }
        if (summary?.specName) {
          wowSpec = normalizeSpecLabel(summary.specName) || null;
          if (wowSpec && !source) source = "bnet-summary";
        }
        if (!wowSpec) {
          let specName = null;
          try {
            specName = await fetchBnetActiveSpec({
              token,
              baseUrl: blizzardApiBaseUrl,
              namespaces,
              locale: blizzardLocale,
              realmSlug: slug,
              characterName: name,
            });
          } catch {
            specName = null;
          }
          if (specName) {
            wowSpec = normalizeSpecLabel(specName) || null;
            if (wowSpec && !source) source = "bnet-specializations";
          }
        }
      }
    }

    if (!wowClass || !wowSpec) {
      let profile = null;
      try {
        profile = await fetchRaiderIoClassicProfile({
          baseUrl: raiderIoApiBase,
          region: raiderIoRegion,
          realmSlug: slug,
          characterName: name,
        });
      } catch {
        profile = null;
      }
      if (profile) {
        if (!wowClass) {
          const c = classFromRaiderIoProfile(profile);
          const display = c ? normalizeClassDisplayName(c) : "";
          if (display) {
            wowClass = display;
            source = source || "raiderio";
          }
        }
        if (!wowSpec) {
          const s = specFromRaiderIoProfile(profile);
          const cleaned = s ? normalizeSpecLabel(s) : "";
          if (cleaned) {
            wowSpec = cleaned;
            source = source || "raiderio";
          }
        }
      }
    }

    return { wowClass, wowSpec, source };
  };
}
