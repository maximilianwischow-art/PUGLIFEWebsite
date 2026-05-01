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
const IMAGE_ASSET_VERSION = "20260428f";
const ROLE_ORDER = ["Tanks", "Healers", "Melee", "Ranged"];
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

const ZAM_ICON_LARGE = "https://wow.zamimg.com/images/wow/icons/large";

/** TBC-style spell icons for talents/specs (fallback when Raid-Helper does not send `specIconUrl`). */
const SPEC_SPELL_ICON = {
  warrior_arms: "ability_warrior_savageblow",
  warrior_fury: "ability_warrior_innerrage",
  warrior_protection: "ability_warrior_defensivestance",
  paladin_holy: "spell_holy_holybolt",
  /** Matches TBC Holy Shield (Blizzard spell 20911 uses same artwork family). */
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

function normalizeSlug(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^a-z0-9]+/g, "");
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

/** Resolves `warrior_protection` / `paladin_protection` etc.; tanks override wrong RH spec labels. */
function resolvedSpecIconKey(player) {
  const cls = normalizeSlug(player?.className);
  const roleSlug = normalizedRoleSlugForSpec(player);
  let rawSpec = normalizeSlug(player?.specName);
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

function classIconFallbackUrl(className) {
  const cls = normalizeSlug(className).replace(/[^a-z]/g, "") || "warrior";
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
  if (s === "undead" || s === "forsaken") return "scourge";
  return s;
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

/** Large portrait: race/gender champion icon, else class crest. Spec icon is layered separately (smaller). */
function championPortraitPrimaryUrl(player) {
  const race = String(player?.race || "").trim();
  const gender = String(player?.gender || "").trim();
  const cands = championPortraitCandidates(race, gender);
  if (cands.length) return cands[0];
  return classIconFallbackUrl(player?.className);
}

function championPortraitFallbackChain(player) {
  const race = String(player?.race || "").trim();
  const gender = String(player?.gender || "").trim();
  const cands = championPortraitCandidates(race, gender);
  const chain = [...cands.slice(1), classIconFallbackUrl(player?.className)];
  return [...new Set(chain)].filter(Boolean);
}

/** Ordered URLs for the spec badge: API URL first (if any), then zamimg spell chain, then class crest.
 * Never return only the API URL — Blizzard/RH links often 404 or block hotlinks; `onerror` must have targets. */
function specBadgePortraitChain(player) {
  const fromApi = String(player?.specIconUrl || "").trim();
  const key = resolvedSpecIconKey(player);
  const spell = key ? SPEC_SPELL_ICON[key] : "";
  const urls = [];
  if (/^https?:\/\//i.test(fromApi)) urls.push(fromApi);
  if (spell) urls.push(`${ZAM_ICON_LARGE}/${spell}.jpg`);
  const extras = key && SPEC_ZAMIMG_FALLBACK[key] ? SPEC_ZAMIMG_FALLBACK[key] : [];
  for (const f of extras) urls.push(`${ZAM_ICON_LARGE}/${f}.jpg`);
  urls.push(classIconFallbackUrl(player?.className));
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

const RAIDER_BADGE_SLOTS = 4;

function rosterAchievementBadgeSlots() {
  return Array.from({ length: RAIDER_BADGE_SLOTS })
    .map(
      () =>
        `<span class="raider-badge-slot" title="Achievement badge slot" aria-hidden="true"></span>`
    )
    .join("");
}

function rosterRaiderCard(player) {
  const className = String(player.className || "").trim();
  const color = WOW_CLASS_COLORS[className] || "var(--text)";
  const specLabel = String(player.specName || "").trim();
  const champSrc = escapeHtml(championPortraitPrimaryUrl(player));
  const champFb = championPortraitFallbackChain(player)
    .map((u) => escapeHtml(u))
    .join("|");
  const specChain = specBadgePortraitChain(player);
  const specBadgeSrc = escapeHtml(specChain[0] || classIconFallbackUrl(className));
  const specBadgeFb = specChain
    .slice(1)
    .map((u) => escapeHtml(u))
    .join("|");
  const specAlt = specLabel ? `${className} · ${specLabel}` : className;
  const priestGlow = className === "Priest" ? "text-shadow:0 0 6px rgba(0,0,0,.85),0 1px 2px rgba(0,0,0,.9);" : "";

  return `
    <div class="raider-card">
      <div class="raider-card-main">
        <div class="raider-portrait-stack">
          <img
            class="raider-champion-img"
            src="${champSrc}"
            alt=""
            width="56"
            height="56"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            data-champ-fallbacks="${champFb}"
            onerror="(function(el){var raw=el.getAttribute('data-champ-fallbacks');if(!raw){el.onerror=null;return;}var parts=raw.split('|').filter(Boolean);var i=Number(el.dataset.champI||0);if(i<parts.length){el.dataset.champI=String(i+1);el.src=parts[i];}else{el.onerror=null;}})(this)"
          />
          <img
            class="raider-spec-attach"
            src="${specBadgeSrc}"
            alt="${escapeHtml(specAlt)}"
            width="22"
            height="22"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            data-spec-fallbacks="${specBadgeFb}"
            onerror="(function(el){var raw=el.getAttribute('data-spec-fallbacks');if(!raw){el.onerror=null;return;}var parts=raw.split('|').filter(Boolean);var i=Number(el.dataset.specI||0);if(i<parts.length){el.dataset.specI=String(i+1);el.src=parts[i];}else{el.onerror=null;}})(this)"
          />
        </div>
        <div class="raider-text">
          <div class="raider-name-line">
            <span class="raider-name" style="color:${color};${priestGlow}">${escapeHtml(player.name)}</span>
          </div>
          ${specLabel ? `<div class="raider-spec-line">${escapeHtml(specLabel)} · ${escapeHtml(className)}</div>` : `<div class="raider-spec-line">${escapeHtml(className)}</div>`}
        </div>
      </div>
      <div class="raider-badges" role="group" aria-label="Achievement badges">${rosterAchievementBadgeSlots()}</div>
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
        const groupedRosterHtml = ROLE_ORDER.filter((role) => groupedRoster.get(role).length > 0)
          .map(
            (role) => `
              <div class="roster-role-group">
                <div class="roster-role-title">${escapeHtml(role)} (${groupedRoster.get(role).length})</div>
                <div class="raider-grid">${groupedRoster.get(role).map(rosterRaiderCard).join("")}</div>
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
