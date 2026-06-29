/**
 * Raid Leaderboard (/): active roster + attendance + merged death totals, sortable table.
 */
const plb = window.plbEventsRoster;
const leaderboardTbody = document.querySelector("#leaderboardTableBody");
const leaderboardTable = document.querySelector("#leaderboardTable");
const leaderboardSortBar = document.querySelector("#leaderboardSortBar");

/** Display / default sort: highest rank first (PUG Lead → Peon). */
const RAID_RANK_SORT_ORDER = ["Puglead", "Raidlead", "Heallead", "Dpslead", "Core", "Veteran", "Grunt", "Peon"];

/** @type {{ key: string, dir: "asc"|"desc" }} */
let sortState = { key: "raidRank", dir: "asc" };

/** @type {object[]} */
let leaderboardRows = [];

/** Normalized display-name key of the open row (badge sub-row), or null. */
let expandedPlayerKey = null;

/** Achievement badge catalog from `GET /api/badge-tooltips` (session-cached). */
let leaderboardBadgeCatalog = [];
/** Full catalog incl. guild-rank — used by the per-row badge expand panel. */
let leaderboardBadgeCatalogFull = [];
let leaderboardBadgeCatalogPromise = null;
let leaderboardAchievementBadgeTotal = 0;

/**
 * Session-only cache (tab lifetime) to avoid re-fetching the leaderboard
 * bundle on every navigation.
 *
 * Bumped to v5 (2026-05-08) to invalidate stale session rows that were
 * captured from snapshot responses that could lag behind Attendance sync.
 * Fresh fetches now force a snapshot refresh.
 *
 * Previous v4 entries can carry truncated/stale roster state and must be
 * discarded.
 *
 * Bumped to v4 (2026-05-08) for the SQLite bundle cutover: rows now come
 * from `/api/leaderboard` (single SQLite-only call). Previous v3 entries
 * still carry the legacy multi-fetch shape and must be discarded.
 */
const LEADERBOARD_SESSION_CACHE_KEY = "plb-lb-sess-v7";
const LEADERBOARD_SESSION_TTL_MS = 5 * 60 * 1000;
/** If more than this fraction of cached rows lack className, treat the cache as poisoned. */
const LEADERBOARD_CACHE_CLASS_MISS_THRESHOLD = 0.2;

function lbApiGetJson(url, init) {
  const c = window.plbSessionApiCache;
  if (c) return c.getJson(url, init);
  return fetch(url, { method: "GET", ...init }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Request failed");
    return body;
  });
}

function rowsAppearPoisoned(rows) {
  if (!Array.isArray(rows) || !rows.length) return false;
  let missing = 0;
  for (const r of rows) {
    const cls = String(r?.className || r?.blizzardClassName || r?.raiderIoClassName || "").trim();
    if (!cls) missing++;
  }
  return missing / rows.length > LEADERBOARD_CACHE_CLASS_MISS_THRESHOLD;
}

function readLeaderboardSessionCache(guildId) {
  try {
    const key = `${LEADERBOARD_SESSION_CACHE_KEY}:${guildId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.at !== "number" || !Array.isArray(o.rows)) return null;
    if (Date.now() - o.at > LEADERBOARD_SESSION_TTL_MS) return null;
    // Defence-in-depth: if a previous session captured rows that were missing
    // className for too many players, those rows would render the question-mark
    // portrait fallback. Drop the cache so we re-fetch from server.
    if (rowsAppearPoisoned(o.rows)) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

function writeLeaderboardSessionCache(guildId, rows) {
  try {
    sessionStorage.setItem(
      `${LEADERBOARD_SESSION_CACHE_KEY}:${guildId}`,
      JSON.stringify({
        at: Date.now(),
        rows,
      })
    );
  } catch {
    /* QuotaExceeded / private mode — skip */
  }
}

async function ensureBadgeCatalogLoaded() {
  if (leaderboardBadgeCatalog.length) return leaderboardBadgeCatalog;
  if (leaderboardBadgeCatalogPromise) return leaderboardBadgeCatalogPromise;
  leaderboardBadgeCatalogPromise = (async () => {
    try {
      const payload = await lbApiGetJson("/api/badge-tooltips");
      const categories = Array.isArray(payload?.categories) ? payload.categories : [];
      window.plbAchievementBadgeCombos = Array.isArray(payload?.combos) ? payload.combos : [];
      const ui = window.plbBadgeCatalogUi;
      leaderboardBadgeCatalogFull = categories.filter((cat) => (cat.badges || []).length > 0);
      leaderboardBadgeCatalog = ui
        ? ui.achievementCategoriesFromCatalog(categories)
        : categories.filter((cat) => cat.id !== "guild-rank" && (cat.badges || []).length > 0);
      leaderboardAchievementBadgeTotal = ui
        ? ui.countAchievementBadges(leaderboardBadgeCatalog)
        : leaderboardBadgeCatalog.reduce((n, cat) => n + (cat.badges || []).length, 0);
    } catch {
      leaderboardBadgeCatalog = [];
      leaderboardBadgeCatalogFull = [];
      leaderboardAchievementBadgeTotal = 0;
      leaderboardBadgeCatalogPromise = null;
    }
    return leaderboardBadgeCatalog;
  })();
  return leaderboardBadgeCatalogPromise;
}

function recentBadgeIdsForPlayer(p) {
  if (Array.isArray(p?.recentBadgeIds)) return p.recentBadgeIds;
  return [];
}

function earnedBadgeIdsForPlayer(p) {
  if (Array.isArray(p?.earnedBadgeIds)) return p.earnedBadgeIds;
  return [];
}

function earnedBadgeIdsForPanel(p) {
  const base = earnedBadgeIdsForPlayer(p);
  const guild =
    plb && typeof plb.earnedGuildBadgeIdsForPlayer === "function" ? plb.earnedGuildBadgeIdsForPlayer(p) : [];
  return [...new Set([...base, ...guild])];
}

function leaderboardBadgeCellsHtml(p, isOpen) {
  const roleBadge = plb.rosterRoleIconHtml
    ? plb.rosterRoleIconHtml(p, { hideLabel: true, className: "role-badge-group-token leaderboard-role-badge-token" })
    : "";
  const attendanceCompanion =
    typeof plb.rosterAttendanceCompanionBadgeHtml === "function"
      ? plb.rosterAttendanceCompanionBadgeHtml(p)
      : "";
  const crafterRoleBadges = plb.rosterPugMasterCrafterBadgesHtml
    ? plb.rosterPugMasterCrafterBadgesHtml(p, { className: "role-badge-group-token leaderboard-role-badge-token" })
    : "";
  const earnedIds = earnedBadgeIdsForPlayer(p);
  const recentBadgeIds = recentBadgeIdsForPlayer(p);
  const roleEarnedBadges =
    typeof plb.leaderboardRowRoleBadgesHtml === "function"
      ? plb.leaderboardRowRoleBadgesHtml(p, { catalog: leaderboardBadgeCatalog, earnedIds, recentBadgeIds })
      : "";
  const roleBadges = `${roleBadge}${attendanceCompanion}${crafterRoleBadges}${roleEarnedBadges}`;
  const ui = window.plbBadgeCatalogUi;
  const earned = ui
    ? ui.countEarnedAchievementBadges(leaderboardBadgeCatalog, earnedIds)
    : earnedIds.length;
  const total = leaderboardAchievementBadgeTotal || 0;
  const rowBadges =
    typeof plb.leaderboardRowBadgesHtml === "function"
      ? plb.leaderboardRowBadgesHtml(p, { catalog: leaderboardBadgeCatalog, earnedIds, recentBadgeIds })
      : "";
  const dynamicBadges =
    typeof plb.leaderboardRowDynamicBadgesHtml === "function"
      ? plb.leaderboardRowDynamicBadgesHtml(p, { catalog: leaderboardBadgeCatalog, earnedIds, recentBadgeIds })
      : "";
  const summaryChip =
    typeof plb.leaderboardBadgeSummaryChipHtml === "function"
      ? plb.leaderboardBadgeSummaryChipHtml(earned, total, isOpen)
      : `<span class="leaderboard-badge-chip leaderboard-badge-chip--summary">${earned}/${total} earned</span>`;
  const categoryIcons = (kind, html) =>
    `<div class="leaderboard-badge-category leaderboard-badge-category--${kind}"><div class="leaderboard-badge-category-icons">${html}</div></div>`;
  return {
    role: categoryIcons("role", roleBadges),
    dynamic: categoryIcons("dynamic", dynamicBadges),
    achievements: `<div class="leaderboard-badge-category leaderboard-badge-category--achievements">
      <div class="leaderboard-badge-strip-achievements">${rowBadges}</div>
      ${summaryChip}
    </div>`,
  };
}

function leaderboardBadgePanelHtml(p) {
  const ui = window.plbBadgeCatalogUi;
  const panelCatalog = leaderboardBadgeCatalogFull.length ? leaderboardBadgeCatalogFull : leaderboardBadgeCatalog;
  if (!ui || !panelCatalog.length) {
    return `<div class="leaderboard-badge-panel"><p class="subtle">Loading badges…</p></div>`;
  }
  return ui.renderPhasedBadgePanel(panelCatalog, earnedBadgeIdsForPanel(p), {
    includeMeta: true,
    panelClass: "leaderboard-badge-panel",
    title: "Badge collection",
    recentBadgeIds: recentBadgeIdsForPlayer(p),
  });
}

/**
 * Match roster / Gargul / WCL names: strip realm & /alt (via `rosterNameKey`), lowercase, fold diacritics.
 * Fixes loot/death rows when the log says "Toffiy-Realm" but the roster is "Toffiy".
 */
function rosterMatchKey(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  let k;
  if (plb && typeof plb.rosterNameKey === "function") {
    k = plb.rosterNameKey(raw);
  } else {
    k = raw.toLowerCase();
  }
  try {
    return k.normalize("NFD").replace(/\p{M}/gu, "");
  } catch {
    return k;
  }
}

function buildDeathTotalsMap(deathLeaderboard) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const row of deathLeaderboard || []) {
    const k = rosterMatchKey(row?.name);
    if (!k) continue;
    const d = Number(row?.deaths || 0);
    if (!Number.isFinite(d) || d <= 0) continue;
    m.set(k, (m.get(k) || 0) + d);
  }
  return m;
}

function lootItemsForPlayer(player, allItems) {
  const nameKeys = new Set();
  const add = (n) => {
    const k = rosterMatchKey(n);
    if (k) nameKeys.add(k);
  };
  for (const w of Array.isArray(player?.wclCharacters) ? player.wclCharacters : []) add(w);
  add(player?.name);
  add(player?.characterName);
  add(player?.rioProfileLookupName);
  const out = [];
  for (const it of allItems || []) {
    const rk = rosterMatchKey(it?.recipient);
    if (!rk || !nameKeys.has(rk)) continue;
    out.push(it);
  }
  out.sort((a, b) => Number(b?.reportStartTime || 0) - Number(a?.reportStartTime || 0));
  return out;
}

function formatLootWhen(ts) {
  const dt = new Date(Number(ts || 0));
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function playerRowKey(p) {
  if (!plb) return rosterMatchKey(p?.name);
  return rosterMatchKey(plb.eventsRosterCharacterLabel(p));
}

function totalDeathsForPlayer(player, deathMap) {
  const seen = new Set();
  let total = 0;
  const add = (name) => {
    const k = rosterMatchKey(name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    total += deathMap.get(k) || 0;
  };
  for (const w of Array.isArray(player?.wclCharacters) ? player.wclCharacters : []) add(w);
  add(player?.name);
  add(player?.characterName);
  add(player?.rioProfileLookupName);
  return total;
}

function normalizeLeaderboardRaidRank(label) {
  const raw = String(label || "").trim();
  const compact = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "puglead" || compact === "guildlead") return "Puglead";
  if (compact === "raidlead") return "Raidlead";
  if (compact === "heallead") return "Heallead";
  if (compact === "dpslead") return "Dpslead";
  if (compact === "core") return "Core";
  if (compact === "veteran") return "Veteran";
  if (compact === "grunt") return "Grunt";
  if (compact === "peon") return "Peon";
  return raw;
}

function displayLeaderboardRaidRank(label) {
  const normalized = normalizeLeaderboardRaidRank(label);
  if (normalized === "Puglead") return "PUG Lead";
  if (normalized === "Raidlead") return "Raid Lead";
  if (normalized === "Heallead") return "Heal Lead";
  if (normalized === "Dpslead") return "DPS Lead";
  return normalized;
}

function raidRankSortIndex(label) {
  const normalized = normalizeLeaderboardRaidRank(label);
  const i = RAID_RANK_SORT_ORDER.indexOf(normalized);
  return i === -1 ? 999 : i;
}

function roleSortIndex(roleBucket, ROLE_ORDER) {
  const r = String(roleBucket || "");
  const i = ROLE_ORDER.indexOf(r);
  return i === -1 ? 999 : i;
}

function defaultDirForKey(key) {
  if (key === "name" || key === "roleName" || key === "raidRank") return "asc";
  return "desc";
}

function compareRows(a, b, key, dir, ROLE_ORDER) {
  const sign = dir === "asc" ? 1 : -1;
  let cmp = 0;
  if (key === "name") {
    cmp = String(a._sortName || "").localeCompare(String(b._sortName || ""));
  } else if (key === "roleName") {
    cmp =
      roleSortIndex(a._roleBucket, ROLE_ORDER) - roleSortIndex(b._roleBucket, ROLE_ORDER) ||
      String(a._sortName || "").localeCompare(String(b._sortName || ""));
  } else if (key === "raidRank") {
    cmp =
      raidRankSortIndex(a._raidRank) - raidRankSortIndex(b._raidRank) ||
      String(a._sortName || "").localeCompare(String(b._sortName || ""));
  } else if (key === "attendanceRate") {
    cmp =
      Number(a.attendanceRate || 0) - Number(b.attendanceRate || 0) ||
      Number(a.raidsAttended || 0) - Number(b.raidsAttended || 0);
  } else if (key === "pastRhEvents") {
    cmp =
      Number(a._pastRhEvents || 0) - Number(b._pastRhEvents || 0) ||
      String(a._sortName || "").localeCompare(String(b._sortName || ""));
  } else if (key === "deaths") {
    cmp = Number(a._deaths || 0) - Number(b._deaths || 0);
  } else if (key === "peakParse") {
    const pa = Number(a._peakParse);
    const pb = Number(b._peakParse);
    const va = Number.isFinite(pa) ? pa : -1;
    const vb = Number.isFinite(pb) ? pb : -1;
    cmp = va - vb;
  }
  if (cmp !== 0) return sign * cmp;
  return String(a._sortName || "").localeCompare(String(b._sortName || ""));
}

function sortRowsInPlace(rows, key, dir, ROLE_ORDER) {
  rows.sort((a, b) => compareRows(a, b, key, dir, ROLE_ORDER));
}

function fmtPct(n) {
  const x = Number(n);
  return Number.isFinite(x) ? `${x.toFixed(0)}%` : "—";
}

function fmtParse(n) {
  const x = Number(n);
  return Number.isFinite(x) && x >= 0 ? `${x.toFixed(1)}` : "—";
}

/** Warcraft Logs–style tier suffix for CSS (classes use !important so row text colour cannot override). */
function peakParseWclTierClass(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= 100) return "leaderboard-peak-parse--wcl100";
  if (n >= 99) return "leaderboard-peak-parse--wcl99";
  if (n >= 95) return "leaderboard-peak-parse--wcl95";
  if (n >= 75) return "leaderboard-peak-parse--wcl75";
  if (n >= 50) return "leaderboard-peak-parse--wcl50";
  if (n >= 25) return "leaderboard-peak-parse--wcl25";
  return "leaderboard-peak-parse--wcl0";
}

function peakParseCellHtml(p) {
  const escapeHtml = plb.escapeHtml;
  const ps = plb.rosterParseForDisplay(p, p);
  const v = ps.value != null && Number.isFinite(Number(ps.value)) ? Number(ps.value) : null;
  const txt = fmtParse(v);
  let title =
    "Peak parse — Warcraft Logs ranked percentile for your role in the tracked raid window (DPS / tank / heal bracket).";
  if (plb.rosterParseSourceTooltipFragment && ps.parseSource) {
    title += plb.rosterParseSourceTooltipFragment(ps.parseSource);
  }
  if (v == null) {
    return `<span class="leaderboard-peak-parse leaderboard-peak-parse--empty" title="${escapeHtml(title)}">${escapeHtml(txt)}</span>`;
  }
  const tier = peakParseWclTierClass(v);
  if (!tier) {
    return `<strong class="leaderboard-peak-parse" title="${escapeHtml(title)}">${escapeHtml(txt)}</strong>`;
  }
  return `<strong class="leaderboard-peak-parse ${tier}" title="${escapeHtml(title)}">${escapeHtml(txt)}</strong>`;
}

/** Single-word display for pill (e.g. PUG Lead → PUGLEAD, Raid lead → RAIDLEAD). */
function raidRankPillDisplay(label) {
  const displayLabel = displayLeaderboardRaidRank(label);
  return displayLabel
    .replace(/\s+/g, "")
    .toUpperCase();
}

function raidRankPillHtml(raidRank) {
  if (!plb) {
    return `<span class="leaderboard-raid-rank-pill">${String(raidRank || "—")}</span>`;
  }
  const escapeHtml = plb.escapeHtml;
  const raw = String(raidRank || "").trim();
  const displayRaw = displayLeaderboardRaidRank(raw);
  if (!raw) {
    return `<span class="leaderboard-raid-rank-pill leaderboard-raid-rank-pill--empty">—</span>`;
  }
  const display = raidRankPillDisplay(displayRaw);
  return `<span class="leaderboard-raid-rank-pill" title="Raid rank: ${escapeHtml(displayRaw)}">${escapeHtml(display)}</span>`;
}

function guildRankDescriptionFromCatalog(slug) {
  const id = String(slug || "").trim();
  if (!id) return "";
  const categories = leaderboardBadgeCatalogFull.length ? leaderboardBadgeCatalogFull : [];
  const guildCat = categories.find((cat) => cat.id === "guild-rank");
  const badge = (guildCat?.badges || []).find((b) => b.id === id);
  return String(badge?.description || "").trim();
}

function leaderboardRoleUnderNameHtml(p) {
  if (!plb) return "";
  const escapeHtml = plb.escapeHtml;
  const role = plb.effectiveGuildRole ? plb.effectiveGuildRole(p) : null;
  const raw = String(role?.label || p._raidRank || "").trim();
  if (!raw) return "";
  const label = role?.displayLabel || displayLeaderboardRaidRank(raw);
  const description = guildRankDescriptionFromCatalog(role?.slug);
  const descHtml = description
    ? `<span class="leaderboard-player-role-desc">${escapeHtml(description)}</span>`
    : "";
  return `<div class="leaderboard-player-role-block">
    <span class="leaderboard-player-role">${escapeHtml(label)}</span>
    ${descHtml}
  </div>`;
}

function attendancePercentTooltip(player, recentRaidCap, consideredRaids) {
  const cap = Number(recentRaidCap) || 6;
  const win = Number(consideredRaids) || 0;
  const att = Number(player?.raidsAttended || 0);
  return `Attendance % uses the last ${cap} raids the admin curated in Event Management — the same set that drives the Events count and the Peon/Grunt/Veteran rank pill. You attended ${att} of ${win} raid(s) in that window.`;
}

function fallbackSpecKeyFromClassAndRole(player) {
  const cls = String(plb?.effectiveRosterClassSlug?.(player) || "").toLowerCase();
  const role = String(player?.roleName || "").toLowerCase();
  const hasExplicitSpecSignal = Boolean(
    String(player?.specName || "").trim() ||
      String(player?.raiderIoSpecName || "").trim() ||
      String(player?.wclSpecName || "").trim() ||
      String(player?.wclSpecIconUrl || "").trim() ||
      String(player?.specIconUrl || "").trim()
  );
  if (!cls) return "";
  if (role.includes("tank")) {
    if (cls === "warrior") return "warrior_protection";
    if (cls === "paladin") return "paladin_protection";
    if (cls === "druid") return "druid_feralcombat";
  }
  if (role.includes("heal")) {
    if (cls === "priest") return "priest_holy";
    if (cls === "paladin") return "paladin_holy";
    if (cls === "shaman") return "shaman_restoration";
    if (cls === "druid") return "druid_restoration";
  }
  if (role.includes("melee")) {
    if (cls === "rogue") return "rogue_combat";
    if (cls === "warrior") return "warrior_fury";
    if (cls === "paladin") return "paladin_retribution";
    if (cls === "shaman") return "shaman_enhancement";
    if (cls === "druid") return "druid_feralcombat";
  }
  if (role.includes("ranged")) {
    if (cls === "mage") return "mage_fire";
    if (cls === "warlock") return "warlock_destruction";
    if (cls === "hunter") return "hunter_beastmastery";
    if (cls === "priest") return hasExplicitSpecSignal ? "priest_shadow" : "";
    if (cls === "shaman") return hasExplicitSpecSignal ? "shaman_elemental" : "";
    if (cls === "druid") return hasExplicitSpecSignal ? "druid_balance" : "";
  }
  return "";
}

function specPortraitPriorityChain(player) {
  const key =
    (typeof plb?.resolvedSpecIconKey === "function" ? plb.resolvedSpecIconKey(player) : "") ||
    fallbackSpecKeyFromClassAndRole(player);
  const pref =
    key && typeof plb?.specIconZamimgUrlForKey === "function" ? String(plb.specIconZamimgUrlForKey(key, player) || "") : "";
  const chain = typeof plb?.specBadgePortraitChain === "function" ? plb.specBadgePortraitChain(player) : plb.rosterPortraitChain(player);
  if (!pref) return chain;
  return [pref, ...chain.filter((u) => String(u || "").trim() !== pref)];
}

function raiderKpisInlineHtml(p, recentCap, considered) {
  const escapeHtml = plb.escapeHtml;
  const att = fmtPct(p.attendanceRate);
  const attTip = escapeHtml(attendancePercentTooltip(p, recentCap, considered));
  const events = Number(p._pastRhEvents || 0).toLocaleString();
  const deaths = Number(p._deaths || 0).toLocaleString();
  const peakCell = peakParseCellHtml(p);
  return `
    <div class="leaderboard-kpi-inline">
      <span class="leaderboard-kpi-inline-item" title="${attTip}"><b>Attendance:</b> ${escapeHtml(att)}</span>
      <span class="leaderboard-kpi-inline-item" title="Distinct WCL guild raid reports this player appeared in (admin Event Management selection only). Drives the raid milestone badges and the Peon/Grunt/Veteran rank pill — both numbers count the same raids."><b>Events:</b> ${escapeHtml(events)}</span>
      <span class="leaderboard-kpi-inline-item"><b>Deaths:</b> ${escapeHtml(deaths)}</span>
      <span class="leaderboard-kpi-inline-item"><b>Peak parse:</b> ${peakCell}</span>
    </div>`;
}

function raiderCellHtml(p, recentCap, considered) {
  const escapeHtml = plb.escapeHtml;
  const chain = plb.rosterPortraitChain(p);
  const portraitSrc = escapeHtml(chain[0] || "");
  const portraitFb = chain.slice(1).map((u) => escapeHtml(u)).join("|");
  const displayName = plb.eventsRosterCharacterLabel(p);
  const className = plb.mergedClassDisplayLabel(p);
  const specLabel = plb.displaySpecNameForRoster(String(p.specName || "").trim());
  const color = plb.wowClassColor(className);
  const priestGlow =
    plb.effectiveRosterClassSlug(p) === "priest"
      ? "text-shadow:0 0 6px rgba(0,0,0,.85),0 1px 2px rgba(0,0,0,.9);"
      : "";
  const portraitAlt = specLabel ? `${displayName} · ${className} · ${specLabel}` : `${displayName} · ${className}`;
  const metaBits = [specLabel, className].map((x) => String(x || "").trim()).filter(Boolean);
  const roleBlock = leaderboardRoleUnderNameHtml(p);
  return `
    <div class="leaderboard-player-row">
      <div class="leaderboard-portrait-stack">
        <img
          class="raider-champion-img leaderboard-spec-img"
          src="${portraitSrc}"
          alt="${escapeHtml(portraitAlt)}"
          width="92"
          height="92"
          loading="lazy"
          decoding="async"
          data-champ-fallbacks="${portraitFb}"
          onerror="(function(el){var raw=el.getAttribute('data-champ-fallbacks');if(!raw){el.onerror=null;return;}var parts=raw.split('|').filter(Boolean);var i=Number(el.dataset.champI||0);if(i<parts.length){el.dataset.champI=String(i+1);el.src=parts[i];}else{el.onerror=null;}})(this)"
        />
      </div>
      <div class="leaderboard-player-cell">
        <div class="leaderboard-player-main">
          <div class="leaderboard-player-name-line">
            <span class="leaderboard-player-name" style="color:${escapeHtml(color)};${priestGlow}">${escapeHtml(displayName)}</span>
          </div>
          ${roleBlock}
          ${
            metaBits.length
              ? `<span class="leaderboard-player-meta">${escapeHtml(metaBits.join(" · "))}</span>`
              : ""
          }
        </div>
        ${raiderKpisInlineHtml(p, recentCap, considered)}
      </div>
    </div>`;
}

function renderLeaderboardTable() {
  if (!leaderboardTbody || !plb) return;
  const ROLE_ORDER = plb.ROLE_ORDER;
  const escapeHtml = plb.escapeHtml;
  sortRowsInPlace(leaderboardRows, sortState.key, sortState.dir, ROLE_ORDER);

  const recentCap = leaderboardRows[0]?._recentRaidCap ?? 6;
  const considered = leaderboardRows[0]?._consideredRaids ?? 0;

  leaderboardTbody.innerHTML = leaderboardRows
    .map((p, idx) => {
      const baseKey = playerRowKey(p);
      const rowKey = baseKey || `__row_${idx}`;
      const keyAttr = escapeHtml(rowKey);
      const isOpen = expandedPlayerKey && expandedPlayerKey === rowKey;
      const playerCell = raiderCellHtml(p, recentCap, considered);
      const badgeCells = leaderboardBadgeCellsHtml(p, isOpen);
      const rowLabel = plb.eventsRosterCharacterLabel ? plb.eventsRosterCharacterLabel(p) : String(p?.name || "Raider");
      const panelId = `lb-badges-${idx}`;

      return `
        <tr
          class="leaderboard-row-leader"
          data-lb-key="${keyAttr}"
          role="button"
          tabindex="0"
          aria-expanded="${isOpen ? "true" : "false"}"
          aria-controls="${panelId}"
          aria-label="${escapeHtml(`${rowLabel} — expand badge collection`)}"
        >
          <td class="leaderboard-td-player">${playerCell}</td>
          <td class="leaderboard-td-badges leaderboard-td-badges--role">${badgeCells.role}</td>
          <td class="leaderboard-td-badges leaderboard-td-badges--dynamic">${badgeCells.dynamic}</td>
          <td class="leaderboard-td-badges leaderboard-td-badges--achievements">${badgeCells.achievements}</td>
        </tr>
        <tr class="leaderboard-row-badges" data-lb-key="${keyAttr}" data-lb-badges-wrap="1" ${isOpen ? "" : "hidden"}>
          <td colspan="4" class="leaderboard-td-badges-panel">
            <div id="${panelId}" role="region" aria-label="Badge collection">${leaderboardBadgePanelHtml(p)}</div>
          </td>
        </tr>`;
    })
    .join("");

  const ui = window.plbBadgeCatalogUi;
  if (ui) {
    leaderboardTbody.querySelectorAll(".leaderboard-badge-panel").forEach((panel) => ui.wirePhaseTabs(panel));
  }
  document.querySelectorAll("[data-leaderboard-sort]").forEach((btn) => {
    const k = String(btn.getAttribute("data-leaderboard-sort") || "");
    const active = k === sortState.key;
    btn.classList.toggle("leaderboard-sort--active", active);
    btn.classList.toggle("leaderboard-sort-chip--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    if (active) {
      btn.setAttribute("aria-sort", sortState.dir === "asc" ? "ascending" : "descending");
    } else {
      btn.removeAttribute("aria-sort");
    }
    const caret = btn.querySelector(".leaderboard-sort-dir");
    if (caret) {
      caret.textContent = active ? (sortState.dir === "asc" ? " ↑" : " ↓") : "";
    }
  });

  wireLeaderboardRowBadgeTooltips();
}

let lbRowBadgeTooltipEl = null;
let lbBadgeTooltipWireAbort = null;

function ensureLbRowBadgeTooltipHost() {
  if (lbRowBadgeTooltipEl) return lbRowBadgeTooltipEl;
  lbRowBadgeTooltipEl = document.createElement("div");
  lbRowBadgeTooltipEl.id = "leaderboardRowBadgeTooltip";
  lbRowBadgeTooltipEl.className = "leaderboard-row-badge-tooltip-host";
  lbRowBadgeTooltipEl.hidden = true;
  document.body.appendChild(lbRowBadgeTooltipEl);
  return lbRowBadgeTooltipEl;
}

function hideLbRowBadgeTooltip() {
  if (!lbRowBadgeTooltipEl) return;
  lbRowBadgeTooltipEl.hidden = true;
  lbRowBadgeTooltipEl.innerHTML = "";
  lbRowBadgeTooltipEl.removeAttribute("data-lb-tip-anchor");
}

function positionLbRowBadgeTooltip(anchor, host) {
  const rect = anchor.getBoundingClientRect();
  const tipRect = host.getBoundingClientRect();
  const pad = 10;
  let top = rect.top - tipRect.height - pad;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  if (top < 8) top = rect.bottom + pad;
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
  host.style.top = `${Math.round(top)}px`;
  host.style.left = `${Math.round(left)}px`;
}

function findLbRowBadgeTooltipSource(anchor) {
  if (!anchor) return null;
  if (anchor.classList.contains("achievement-badge-combo-wrap")) {
    return anchor.querySelector(".achievement-badge-combo > .achievement-tooltip");
  }
  if (anchor.classList.contains("achievement-badge-combo")) {
    return anchor.querySelector(":scope > .achievement-tooltip");
  }
  return anchor.querySelector(":scope > .achievement-tooltip") || anchor.querySelector(".achievement-tooltip");
}

function showLbRowBadgeTooltip(anchor) {
  const source = findLbRowBadgeTooltipSource(anchor);
  if (!source) return;
  const host = ensureLbRowBadgeTooltipHost();
  host.innerHTML = source.innerHTML;
  host.hidden = false;
  host.style.visibility = "hidden";
  positionLbRowBadgeTooltip(anchor, host);
  host.style.visibility = "visible";
  host.dataset.lbTipAnchor = "1";
}

function wireLeaderboardRowBadgeTooltips() {
  if (!leaderboardTbody) return;
  lbBadgeTooltipWireAbort?.abort();
  lbBadgeTooltipWireAbort = new AbortController();
  const { signal } = lbBadgeTooltipWireAbort;
  const selector =
    ".leaderboard-badge-category-icons .achievement-badge-container, " +
    ".leaderboard-badge-category-icons .guild-role-token, " +
    ".leaderboard-badge-category-icons .achievement-badge-combo, " +
    ".leaderboard-badge-category-icons .achievement-badge-combo-wrap";

  leaderboardTbody.querySelectorAll(selector).forEach((badge) => {
    if (!badge.hasAttribute("tabindex")) badge.setAttribute("tabindex", "0");
    badge.addEventListener("mouseenter", () => showLbRowBadgeTooltip(badge), { signal });
    badge.addEventListener("mouseleave", hideLbRowBadgeTooltip, { signal });
    badge.addEventListener("focus", () => showLbRowBadgeTooltip(badge), { signal });
    badge.addEventListener("blur", hideLbRowBadgeTooltip, { signal });
  });

  leaderboardTbody.querySelectorAll(".leaderboard-badge-category-icons, .leaderboard-badge-strip-achievements").forEach((scroller) => {
    scroller.addEventListener("scroll", hideLbRowBadgeTooltip, { passive: true, signal });
  });

  document.querySelector(".leaderboard-table-scroll")?.addEventListener("scroll", hideLbRowBadgeTooltip, {
    passive: true,
    signal,
  });
}

function toggleLeaderboardRowByKey(key) {
  if (!key) return;
  expandedPlayerKey = expandedPlayerKey === key ? null : key;
  if (!leaderboardTbody) return;
  leaderboardTbody.querySelectorAll("tr.leaderboard-row-leader").forEach((tr) => {
    const k = tr.getAttribute("data-lb-key");
    const open = k && expandedPlayerKey === k;
    tr.setAttribute("aria-expanded", open ? "true" : "false");
    tr.classList.toggle("leaderboard-row-leader--open", open);
    const chevron = tr.querySelector(".leaderboard-badge-chevron");
    if (chevron) chevron.textContent = open ? "▾" : "▸";
  });
  leaderboardTbody.querySelectorAll("tr.leaderboard-row-badges").forEach((tr) => {
    const k = tr.getAttribute("data-lb-key");
    const open = k && expandedPlayerKey === k;
    tr.hidden = !open;
  });
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(String(value || ""));
  }
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function wireLeaderboardRowExpand() {
  if (!leaderboardTbody) return;
  leaderboardTbody.addEventListener("click", (ev) => {
    if (ev.target.closest("a, button")) return;
    if (
      ev.target.closest(
        ".leaderboard-badge-category-icons .achievement-badge-container, .leaderboard-badge-category-icons .guild-role-token"
      )
    ) {
      return;
    }
    const tr = ev.target.closest("tr.leaderboard-row-leader");
    if (!tr) return;
    const key = tr.getAttribute("data-lb-key");
    if (key) toggleLeaderboardRowByKey(key);
  });
  leaderboardTbody.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const tr = ev.target.closest("tr.leaderboard-row-leader");
    if (!tr || tr !== document.activeElement) return;
    ev.preventDefault();
    const key = tr.getAttribute("data-lb-key");
    if (key) toggleLeaderboardRowByKey(key);
  });
}

function wireSortHeaders() {
  const clickHandler = (ev) => {
    const btn = ev.target.closest("[data-leaderboard-sort]");
    if (!btn) return;
    const key = String(btn.getAttribute("data-leaderboard-sort") || "");
    if (!key) return;
    if (key === sortState.key) {
      sortState = { key, dir: sortState.dir === "asc" ? "desc" : "asc" };
    } else {
      sortState = { key, dir: defaultDirForKey(key) };
    }
    renderLeaderboardTable();
  };
  leaderboardTable?.addEventListener("click", clickHandler);
  leaderboardSortBar?.addEventListener("click", clickHandler);
}

/**
 * Single-call leaderboard build: hits the SQLite-backed
 * `/api/leaderboard` bundle endpoint and synthesises the same row shape
 * the renderer used to receive from the active-roster / death-leaderboard
 * fan-out. Badge catalog loads once per session from `/api/badge-tooltips`;
 * per-player `earnedBadgeIds` ships in the bundle for expand panels.
 *
 * @param {number} gid
 * @param {{ skipCache?: boolean }} [opts] when true, bypass `plbSessionApiCache`
 *        for the bundle fetch (post-cache-render refresh path).
 */
async function fetchAndBuildLeaderboardRows(gid, opts = {}) {
  const skipCache = !!opts.skipCache;
  const forceFresh = skipCache;
  const bundleUrl = forceFresh
    ? `/api/leaderboard?guildId=${encodeURIComponent(gid)}&snapshot_refresh=1&nocache=1`
    : `/api/leaderboard?guildId=${encodeURIComponent(gid)}`;
  const bundle = await lbApiGetJson(bundleUrl, { credentials: "include", skipCache });
  const players = Array.isArray(bundle?.players) ? bundle.players : [];
  const consideredRaids = Number(bundle?.consideredRaids || 0);
  const recentRaidCap = Number(bundle?.attendanceScope?.recentRaidCap || 6);

  // Resolve uploaded profile pictures so portraits render the avatar
  // override rather than the class crest. Best-effort — failures are silent.
  if (typeof plb?.prefetchRosterProfilePictures === "function") {
    try {
      await plb.prefetchRosterProfilePictures(players);
    } catch {
      /* leaderboard still renders with class crests */
    }
  }

  const rows = players.map((p) => {
    const ps = plb.rosterParseForDisplay(p, p);
    const deaths = Number(
      p._deaths != null && Number.isFinite(Number(p._deaths))
        ? p._deaths
        : p.deaths != null && Number.isFinite(Number(p.deaths))
          ? p.deaths
          : 0
    );
    return {
      ...p,
      _deaths: deaths,
      _consideredRaids: consideredRaids,
      _recentRaidCap: recentRaidCap,
      _peakParse: ps.value != null && Number.isFinite(Number(ps.value)) ? Number(ps.value) : null,
      _raidRank: plb.effectiveGuildRole ? plb.effectiveGuildRole(p).label : plb.primaryGuildRankLabel(p),
      _roleBucket: plb.rosterBucketRoleName(p.roleName),
      _pastRhEvents: Number(
        p.wclEventCount != null && Number.isFinite(Number(p.wclEventCount))
          ? p.wclEventCount
          : p.rhPastEventCount || 0
      ),
      _sortName: plb.eventsRosterCharacterLabel(p).toLowerCase(),
      earnedBadgeIds: Array.isArray(p.earnedBadgeIds) ? p.earnedBadgeIds : [],
      recentBadgeIds: Array.isArray(p.recentBadgeIds) ? p.recentBadgeIds : [],
    };
  });

  return { rows };
}

async function refreshLeaderboardFromNetwork(gid) {
  try {
    // skipCache: this is the *post-cache-render* refresh — bypass
    // plbSessionApiCache so we hit the origin and get fresh bundle rows.
    // Without skipCache, the cache layer just replays the same stale body
    // we already rendered, defeating the refresh.
    const { rows } = await fetchAndBuildLeaderboardRows(gid, { skipCache: true });
    leaderboardRows = rows;
    writeLeaderboardSessionCache(gid, leaderboardRows);
    if (!leaderboardRows.length) {
      leaderboardTbody.innerHTML = `<tr><td colspan="4" class="subtle">No players in the active roster yet.</td></tr>`;
      return;
    }
    renderLeaderboardTable();
  } catch {
    /* Keep showing session cache if refresh fails */
  }
}

async function loadGuildLeaderboard() {
  if (!plb || !leaderboardTbody) return;
  expandedPlayerKey = null;

  const gid = plb.EVENTS_WCL_GUILD_ID;

  try {
    /* Spec icon map + legacy WCL attendance are no longer in the critical
       path — the bundle endpoint already carries class/spec from
       `user_characters` and the badge name-sets are pre-resolved
       server-side. We still kick them off in the background so any UI
       chrome that depends on them (e.g. event-page badges) gets warmed,
       and re-render after they resolve in case any tooltip text changes. */
    const prep = Promise.all([
      plb.loadTbcSpecIconMap(),
      typeof plb.loadWclAttendanceForEvents === "function"
        ? plb.loadWclAttendanceForEvents().catch(() => null)
        : Promise.resolve(null),
    ]);

    await ensureBadgeCatalogLoaded();

    const cached = readLeaderboardSessionCache(gid);
    if (cached) {
      leaderboardRows = cached.rows;
      if (!leaderboardRows.length) {
        leaderboardTbody.innerHTML = `<tr><td colspan="4" class="subtle">No players in the active roster yet.</td></tr>`;
      } else {
        renderLeaderboardTable();
        // Lazily fetch profile pictures for the cached rows; re-render once
        // any avatars come back so the class crests get replaced in place.
        if (typeof plb?.prefetchRosterProfilePictures === "function") {
          plb
            .prefetchRosterProfilePictures(leaderboardRows)
            .then((res) => {
              if (res?.updatedCount > 0) renderLeaderboardTable();
            })
            .catch(() => {});
        }
      }
      void refreshLeaderboardFromNetwork(gid);
      /* Re-render after legacy badge name-sets resolve so anything we
         can't yet pre-resolve server-side picks up the latest data. */
      void prep
        .then(() => renderLeaderboardTable())
        .catch(() => {
          /* spec icons / legacy badges are best-effort */
        });
      return;
    }

    leaderboardTbody.innerHTML = `<tr><td colspan="4" class="subtle">Loading roster…</td></tr>`;

    /* Cold path: render the bundle as soon as it lands; do not block on
       `prep`. The bundle already contains every field the table needs
       for first paint, including pre-resolved achievement flags. */
    const { rows } = await fetchAndBuildLeaderboardRows(gid, { skipCache: true });
    leaderboardRows = rows;

    if (!leaderboardRows.length) {
      leaderboardTbody.innerHTML = `<tr><td colspan="4" class="subtle">No players in the active roster yet.</td></tr>`;
      return;
    }

    writeLeaderboardSessionCache(gid, leaderboardRows);
    renderLeaderboardTable();

    /* Resolve spec icons + legacy badge name-sets in the background and
       re-render once they land. Failures are best-effort. */
    void prep
      .then(() => renderLeaderboardTable())
      .catch(() => {});
  } catch (e) {
    leaderboardTbody.innerHTML = `<tr><td colspan="4" class="subtle">${plb.escapeHtml(
      e?.message || "Failed to load leaderboard."
    )}</td></tr>`;
  }
}

plb.initBackgroundStars();
wireSortHeaders();
wireLeaderboardRowExpand();
loadGuildLeaderboard();
