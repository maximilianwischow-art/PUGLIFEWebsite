function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let gargulEntriesState = [];
let allRaidsState = [];
let selectedReportCodesState = new Set();
let joinNeedsState = [];
let roleAlertsEventsState = [];
let roleAlertsSavedTargetsByEventId = new Map();
let roleAlertsAnalysisState = null;
let roleAlertsLastSendResult = null;
let roleAlertsSelectedUserIds = new Set();
let roleAlertsAnalyzeSeq = 0;
let roleAlertsRaidComposerBaseline = null;
let roleAlertsRaidComposerDraft = null;
/** @type {Map<string, { id: string, rhGroupId: string, groupNumber: number, slotNumber: number }>} */
let roleAlertsCompSlotTemplateIndex = null;
let roleAlertsComposerDropHighlightEl = null;
/** @type {Map<string, object|null>} */
let roleAlertsGearSummaryByKey = new Map();
/** @type {Set<string>} signup ids with composer card expanded */
let roleAlertsComposerExpandedIds = new Set();
let roleAlertsComposerExpandClickTimer = null;
const ROLE_ALERTS_COMPOSER_VIEW_STORAGE = "plb-role-alerts-composer-view";
let roleAlertsComposerViewModeState = (() => {
  try {
    return sessionStorage.getItem(ROLE_ALERTS_COMPOSER_VIEW_STORAGE) === "detailed" ? "detailed" : "executive";
  } catch {
    return "executive";
  }
})();
/** Active roster players for Detailed view cards (guild-wide, not per event). */
let roleAlertsComposerRosterPlayers = null;
let roleAlertsComposerRosterLoadPromise = null;

function roleAlertsComposerClearDropHighlight() {
  if (roleAlertsComposerDropHighlightEl) {
    roleAlertsComposerDropHighlightEl.classList.remove("is-composer-drop-over");
    roleAlertsComposerDropHighlightEl = null;
  }
}

function roleAlertsComposerSetCardExpanded(card, expanded) {
  const id = String(card?.getAttribute?.("data-signup-id") || "").trim();
  if (!id) return;
  if (expanded) roleAlertsComposerExpandedIds.add(id);
  else roleAlertsComposerExpandedIds.delete(id);
  card.classList.toggle("is-composer-expanded", expanded);
  card.setAttribute("aria-expanded", expanded ? "true" : "false");
  const panel = card.querySelector(".role-alert-composer-expanded");
  if (panel) panel.hidden = !expanded;
  const hint = card.querySelector(".role-alert-composer-expand-hint");
  if (hint) hint.textContent = expanded ? "▾" : "▸";
}
const ROLE_ALERTS_COMPOSER_DRAG_MIME = "application/x-role-alerts-composer";
/** rhNameKey → { kara, gruulMag, sscTk } from WCL Fresh zoneRankings cache. */
let roleAlertsWclPhaseAvgsByKey = {};
let roleAlertsWclPhaseAvgsUpdatedAt = 0;
let roleAlertsDebuffAssignmentsState = null;
let roleAlertsDebuffAssignmentsFetchSeq = 0;
let roleAlertsCandidateSortState = { key: "displayName", dir: "asc" };
let roleAlertsCandidateFilterState = {
  displayName: "",
  recentClass: "",
  recentSpec: "",
  raidRole: "",
  matchedSpecs: "",
  subscribed: "",
  dmSent: "",
};
let badgeTooltipsRowsState = [];

const ROLE_ALERT_ROLES = ["Tanks", "Healers", "Melee", "Ranged"];
const ROLE_ALERT_DEFAULT_TARGETS = { Tanks: 3, Healers: 5, Melee: 8, Ranged: 9 };
const BADGE_RARITIES = ["common", "rare", "epic", "legendary"];
const ADMIN_TBC_SPEC_ICONS_JSON_VER = "20260511b";
const ADMIN_ZAM_ICON_LARGE = "https://wow.zamimg.com/images/wow/icons/large";
const ADMIN_WOW_CLASS_COLORS = {
  Warrior: "#C79C6E",
  Paladin: "#F58CBA",
  Hunter: "#ABD473",
  Rogue: "#FFF569",
  Priest: "#FFFFFF",
  Shaman: "#0070DD",
  Mage: "#69CCF0",
  Warlock: "#9482C9",
  Druid: "#FF7D0A",
};
const ADMIN_WOW_CLASS_COLORS_BY_SLUG = {
  warrior: ADMIN_WOW_CLASS_COLORS.Warrior,
  paladin: ADMIN_WOW_CLASS_COLORS.Paladin,
  hunter: ADMIN_WOW_CLASS_COLORS.Hunter,
  rogue: ADMIN_WOW_CLASS_COLORS.Rogue,
  priest: ADMIN_WOW_CLASS_COLORS.Priest,
  shaman: ADMIN_WOW_CLASS_COLORS.Shaman,
  mage: ADMIN_WOW_CLASS_COLORS.Mage,
  warlock: ADMIN_WOW_CLASS_COLORS.Warlock,
  druid: ADMIN_WOW_CLASS_COLORS.Druid,
};
const ADMIN_SPEC_ICON_TEXTURE_FALLBACK = {
  warrior_arms: "ability_warrior_savageblow",
  warrior_fury: "spell_nature_bloodlust",
  warrior_protection: "ability_warrior_defensivestance",
  paladin_holy: "spell_holy_holybolt",
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

/** Same guild as Leaderboard (/) / Events attendance (`VOTING_GUILD_ID` / `public/app.js`). */
const ADMIN_WCL_GUILD_ID = 817080;

/** Must match `RH_WCL_GUILD_ROLES` in `lib/rh-wcl-guess.mjs` / server sanitize. */
const RH_WCL_GUILD_ROLES = ["Peon", "Grunt", "Veteran", "Core", "Puglead", "Raidlead", "Dpslead", "Heallead"];
const RH_WCL_ASSIGNABLE_GUILD_ROLES = ["Peon", "Puglead", "Raidlead", "Heallead", "Dpslead", "Core"];

function normalizeGuildRoleValue(role) {
  const s = String(role || "").trim();
  if (s === "Guildlead") return "Puglead";
  const compact = s.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "puglead" || compact === "guildlead") return "Puglead";
  if (compact === "raidlead") return "Raidlead";
  if (compact === "dpslead") return "Dpslead";
  if (compact === "heallead") return "Heallead";
  return RH_WCL_GUILD_ROLES.includes(s) ? s : "Peon";
}

function displayGuildRoleOptionLabel(role) {
  if (role === "Peon") return "Attendance based";
  if (role === "Puglead") return "PUG Lead";
  if (role === "Raidlead") return "Raid Lead";
  if (role === "Dpslead") return "DPS Lead";
  if (role === "Heallead") return "Heal Lead";
  return role;
}

function rhWclGuildRoleSelectHtml(current) {
  const normalized = normalizeGuildRoleValue(current);
  const sel = ["Grunt", "Veteran"].includes(normalized) ? "Peon" : normalized;
  return `<select class="admin-input admin-rh-role-select" data-rh-wcl-k="guildRole" aria-label="Guild role (manual roles override attendance; Attendance based resolves to Veteran, Grunt, or Peon from WCL attendance)">${RH_WCL_ASSIGNABLE_GUILD_ROLES.map(
    (r) => `<option value="${esc(r)}"${r === sel ? " selected" : ""}>${esc(displayGuildRoleOptionLabel(r))}</option>`
  ).join("")}</select>`;
}

const ADMIN_GROUPS = [
  {
    id: "people",
    label: "People",
    tools: ["identity", "hof-notes", "raider-blacklist", "badge-tooltips", "character-kpis"],
  },
  { id: "roster", label: "Roster & Loot", tools: ["wcl-events", "gargul-import", "loot-corrections"] },
  { id: "content", label: "Content", tools: ["p2-materials", "p2-demand", "join-needs"] },
  { id: "comms", label: "Comms", tools: ["role-alerts", "custom-dm", "discord-role-sync", "discord-news-queue", "discord-news"] },
  { id: "data-ops", label: "Data & Ops", tools: ["sync-center", "wcl-phase-avgs", "analytics"] },
];

const ADMIN_PANEL_IDS = ADMIN_GROUPS.flatMap((g) => g.tools);

/** Hashes that used to point to a now-merged panel; redirected on hashchange + initial load. */
const ADMIN_PANEL_HASH_ALIASES = {
  "data-sync": "sync-center",
  "rh-wcl": "identity",
  database: "identity",
};

const SYNC_CENTER_TAB_IDS = ["workers", "snapshot", "readiness", "backup"];
const SYNC_CENTER_DEFAULT_TAB = "workers";

function adminGroupForToolId(toolId) {
  return ADMIN_GROUPS.find((g) => g.tools.includes(toolId)) || null;
}

let customDmCandidatesState = [];
let customDmSelectedUserIds = new Set();
let customDmFilterState = { displayName: "", guildRole: "", recentClass: "", recentSpec: "", subscribed: "" };
let customDmRoleTargets = new Set(["Tanks", "Healers", "Melee", "Ranged"]);
let discordRoleSyncState = null;
let discordNewsStatusState = null;
let discordNewsRolesState = [];
let discordNewsSelectedRoleIds = new Set();
let discordNewsQueueState = [];
let raiderBlacklistEntriesState = [];
let raiderBlacklistFilterState = "all";
let raiderBlacklistSelectedPlayer = null;
let raiderBlacklistSearchTimer = null;
const DISCORD_NEWS_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DISCORD_NEWS_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function parseAdminHash() {
  const raw = (location.hash || "").replace(/^#/, "").trim();
  if (!raw) return { panelId: null, subTab: null };
  const stripped = raw.startsWith("admin-") ? raw.slice(6) : raw;
  const [panelRaw, subRaw] = stripped.split(":");
  const aliased = ADMIN_PANEL_HASH_ALIASES[panelRaw] || panelRaw;
  const panelId = ADMIN_PANEL_IDS.includes(aliased) ? aliased : null;
  if (!panelId) return { panelId: null, subTab: null };
  let subTab = null;
  if (panelId === "sync-center") {
    subTab = SYNC_CENTER_TAB_IDS.includes(subRaw) ? subRaw : null;
    if (!subTab && panelRaw === "data-sync") subTab = "snapshot";
  }
  return { panelId, subTab };
}

function showAdminPanel(panelId, opts = {}) {
  const replaceHash = opts.replaceHash !== false;
  if (!panelId || !ADMIN_PANEL_IDS.includes(panelId)) return;
  if (panelId !== "identity") setIdentityAccountsTableMaximized(false);
  document.querySelectorAll("[data-admin-panel]").forEach((el) => {
    const id = el.getAttribute("data-admin-panel");
    el.classList.toggle("is-admin-panel-active", id === panelId);
  });
  if (panelId === "analytics") scheduleAnalyticsChartsResize();
  document.querySelectorAll("[data-admin-nav]").forEach((btn) => {
    const id = btn.getAttribute("data-admin-nav");
    const on = id === panelId;
    btn.classList.toggle("is-admin-submenu-active", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  const group = adminGroupForToolId(panelId);
  document.querySelectorAll("[data-admin-group]").forEach((el) => {
    const id = el.getAttribute("data-admin-group");
    el.classList.toggle("is-admin-group-active", !!group && id === group.id);
  });
  const currentLabelHost = document.querySelector("[data-admin-sidebar-current]");
  if (currentLabelHost) {
    const activeBtn = document.querySelector(`[data-admin-nav="${panelId}"]`);
    currentLabelHost.textContent = activeBtn ? activeBtn.textContent.trim() : "Admin sections";
  }
  closeAdminSidebarDrawer();
  if (panelId === "sync-center") showSyncCenterSubTab(opts.subTab || SYNC_CENTER_DEFAULT_TAB, { replaceHash });
  if (panelId === "discord-role-sync" && !discordRoleSyncState) loadDiscordRoleSyncPreview().catch(() => {});
  if (replaceHash) {
    const sub = panelId === "sync-center" && opts.subTab ? `:${opts.subTab}` : "";
    const next = `#admin-${panelId}${sub}`;
    if (location.hash !== next) history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
  }
  try {
    sessionStorage.setItem("adminPanel", panelId);
  } catch (_) {
    /* ignore */
  }
}

function showSyncCenterSubTab(subTabId, opts = {}) {
  const id = SYNC_CENTER_TAB_IDS.includes(subTabId) ? subTabId : SYNC_CENTER_DEFAULT_TAB;
  document.querySelectorAll("[data-sync-tab-panel]").forEach((el) => {
    const on = el.getAttribute("data-sync-tab-panel") === id;
    if (on) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  });
  document.querySelectorAll("[data-sync-tab]").forEach((btn) => {
    const on = btn.getAttribute("data-sync-tab") === id;
    btn.classList.toggle("is-admin-submenu-active", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  if (opts.replaceHash !== false) {
    const next = `#admin-sync-center:${id}`;
    if (location.hash !== next) history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
  }
}

function initialAdminPanelInfo() {
  const fromHash = parseAdminHash();
  if (fromHash.panelId) return fromHash;
  try {
    const s = sessionStorage.getItem("adminPanel");
    if (s && ADMIN_PANEL_IDS.includes(s)) return { panelId: s, subTab: null };
  } catch (_) {
    /* ignore */
  }
  return { panelId: "identity", subTab: null };
}

function closeAdminSidebarDrawer() {
  const toggle = document.querySelector(".admin-sidebar-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
  const sidebar = document.querySelector(".admin-sidebar");
  if (sidebar) sidebar.classList.remove("is-admin-sidebar-open");
}

function initAdminSidebarDrawer() {
  const toggle = document.querySelector(".admin-sidebar-toggle");
  const sidebar = document.querySelector(".admin-sidebar");
  if (!toggle || !sidebar) return;
  toggle.addEventListener("click", () => {
    const open = sidebar.classList.toggle("is-admin-sidebar-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function initAdminSubmenu() {
  const initial = initialAdminPanelInfo();
  showAdminPanel(initial.panelId, { replaceHash: false, subTab: initial.subTab });

  document.querySelectorAll("[data-admin-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-admin-nav");
      if (id && ADMIN_PANEL_IDS.includes(id)) showAdminPanel(id);
    });
  });

  document.querySelectorAll("[data-sync-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-sync-tab");
      if (id) showSyncCenterSubTab(id);
    });
  });

  window.addEventListener("hashchange", () => {
    const info = parseAdminHash();
    if (info.panelId) showAdminPanel(info.panelId, { replaceHash: false, subTab: info.subTab });
  });

  initAdminSidebarDrawer();
}

initAdminSubmenu();

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtTs(sec) {
  const ms = num(sec) > 1e12 ? num(sec) : num(sec) * 1000;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? "-" : dt.toLocaleString();
}

/** Shows Raid Helper event ids + WCL report codes used for the last N raids (same defaults as heuristic). */
function renderRhWclRaidSources(raidHelperEvents, wclReports) {
  const host = document.getElementById("rhWclRaidSources");
  if (!host) return;
  const rh = Array.isArray(raidHelperEvents) ? raidHelperEvents : [];
  const wcl = Array.isArray(wclReports) ? wclReports : [];
  if (!rh.length && !wcl.length) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  host.hidden = false;
  let html = "";
  if (rh.length) {
    html += `<p class="admin-rh-wcl-sources"><strong>Raid Helper events</strong> (signups): ${rh
      .map((e) => `<code>${esc(String(e.id || ""))}</code> · ${esc(fmtTs(e.startTime))}`)
      .join(" · ")}</p>`;
  }
  if (wcl.length) {
    html += `<p class="admin-rh-wcl-sources"><strong>Warcraft Logs reports</strong> (character names): ${wcl
      .map(
        (r) =>
          `<a href="https://www.warcraftlogs.com/reports/${esc(String(r.reportCode || ""))}" target="_blank" rel="noopener noreferrer"><code>${esc(String(r.reportCode || ""))}</code></a> · ${esc(fmtTs(r.startTime))}`
      )
      .join(" · ")}</p>`;
  }
  host.innerHTML = html;
}

/** Warcraft Logs names that could not be matched to any Raid Helper signup (after heuristic + orphan pass). */
function renderRhWclUnmatched(stats) {
  const host = document.getElementById("rhWclUnmatchedHost");
  if (!host) return;
  if (!stats || typeof stats !== "object") {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  const n = Number(stats.unmatchedWclCount || 0);
  const sample = Array.isArray(stats.unmatchedWclSample) ? stats.unmatchedWclSample : [];
  if (!Number.isFinite(n) || n <= 0) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  const minSc = stats.minScore;
  const orphanSc = stats.orphanMinScore;
  const thresh =
    typeof minSc === "number" && typeof orphanSc === "number"
      ? `main ≥${Math.round(minSc)}%, best-effort ≥${Math.round(orphanSc)}%`
      : "heuristic thresholds";
  const extra = n > sample.length ? ` · ${n - sample.length} more not shown` : "";
  host.hidden = false;
  host.innerHTML = `
    <div class="admin-rh-unmatched-inner">
      <div class="admin-rh-unmatched-title">Unassigned log names (${n})</div>
      <p class="admin-rh-unmatched-help subtle">
        Seen in recent tracked raids but not linked to any signup in column 1 (${thresh}). Add each name to the correct row’s <strong>WCL characters</strong> column, or adjust <code>RH_WCL_ORPHAN_MIN_SCORE</code> / merge min score and run again.${extra}
      </p>
      <div class="admin-rh-unmatched-chips">
        ${
          sample.length
            ? sample.map((name) => `<span class="admin-rh-unmatched-chip">${esc(String(name || ""))}</span>`).join("")
            : `<span class="subtle">Open browser console or re-run merge if names don’t appear.</span>`
        }
      </div>
    </div>
  `;
}

async function getJson(url, opts) {
  const res = await fetch(url, { credentials: "include", ...(opts || {}) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${res.status})`);
  return payload;
}

function status(msg) {
  const el = document.getElementById("adminStatus");
  if (el) el.textContent = msg;
}

function setButtonFeedback(btn, text, tone = "info") {
  if (!btn) return;
  btn.setAttribute("data-feedback-tone", tone);
  btn.setAttribute("data-feedback-active", "1");
  btn.textContent = text;
}

function resetButtonFeedback(btn, defaultText) {
  if (!btn) return;
  btn.removeAttribute("data-feedback-tone");
  btn.removeAttribute("data-feedback-active");
  btn.textContent = defaultText;
}

async function runWithButtonFeedback(btn, labels, run) {
  if (!btn) return run();
  const {
    idle = btn.textContent || "Run",
    loading = "Working...",
    success = "Done",
    failure = "Failed",
  } = labels || {};
  btn.disabled = true;
  setButtonFeedback(btn, loading, "loading");
  try {
    const out = await run();
    setButtonFeedback(btn, success, "success");
    return out;
  } catch (error) {
    setButtonFeedback(btn, failure, "error");
    throw error;
  } finally {
    window.setTimeout(() => {
      btn.disabled = false;
      resetButtonFeedback(btn, idle);
    }, 1200);
  }
}

function raidLabel(raid) {
  const title = String(raid?.reportTitle || raid?.reportCode || "Raid");
  const dt = fmtTs(raid?.reportStartTime);
  return `${title} (${dt})`;
}

function raidWeekday(raid) {
  const ms = num(raid?.reportStartTime);
  if (!ms) return "-";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { weekday: "long" });
}

function mergeRaidIntoAllRaidsState(raid) {
  const code = String(raid?.reportCode || "").trim();
  if (!code) return false;
  const idx = allRaidsState.findIndex((r) => String(r.reportCode) === code);
  if (idx >= 0) {
    allRaidsState[idx] = { ...allRaidsState[idx], ...raid };
  } else {
    allRaidsState.push(raid);
    allRaidsState.sort((a, b) => Number(b.reportStartTime || 0) - Number(a.reportStartTime || 0));
  }
  return true;
}

function renderEventSelection() {
  const host = document.getElementById("eventSelectionList");
  if (!host) return;
  if (!allRaidsState.length) {
    host.innerHTML = `<p class="subtle">No raid events available.</p>`;
    return;
  }
  host.innerHTML = `
    <div class="admin-actions admin-actions--tight">
      <button type="button" class="event-signup-btn event-signup-btn--softres" id="selectAllEventsBtn">Select all</button>
      <button type="button" class="event-signup-btn event-signup-btn--softres" id="clearAllEventsBtn">Clear all</button>
    </div>
    <div class="admin-table-wrap role-alert-candidates-wrap">
      <table class="admin-table role-alert-candidates-table">
        <thead><tr><th>Show</th><th>Raid Event</th><th>Weekday</th><th>Uploaded By</th><th>Report Code</th></tr></thead>
        <tbody>
          ${allRaidsState
            .map(
              (raid) => `
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      data-event-report="${esc(raid.reportCode)}"
                      ${selectedReportCodesState.size === 0 || selectedReportCodesState.has(String(raid.reportCode)) ? "checked" : ""}
                    />
                  </td>
                  <td>${esc(raidLabel(raid))}</td>
                  <td>${esc(raidWeekday(raid))}</td>
                  <td>${esc(String(raid?.reportUploader || "-"))}</td>
                  <td><code>${esc(raid.reportCode)}</code></td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTargetReportSelect() {
  const select = document.getElementById("gargulTargetReport");
  if (!select) return;
  select.innerHTML = `
    <option value="">Auto map by date/time (default)</option>
    ${allRaidsState
      .map(
        (raid) =>
          `<option value="${esc(raid.reportCode)}">${esc(raidLabel(raid))} · ${esc(String(raid.reportCode || ""))}</option>`
      )
      .join("")}
  `;
}

function renderLootEditor(entries) {
  gargulEntriesState = Array.isArray(entries) ? entries : [];
  const host = document.getElementById("gargulEditor");
  if (!host) return;
  if (!gargulEntriesState.length) {
    host.innerHTML = `<p class="subtle">No imported Gargul entries yet.</p>`;
    return;
  }
  const byEvent = new Map();
  gargulEntriesState.forEach((row, i) => {
    const key = String(row?.reportCode || "unassigned");
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push({ row, i });
  });
  const eventBlocks = [...byEvent.entries()]
    .sort((a, b) => {
      const aMax = Math.max(...a[1].map((x) => num(x.row?.timestamp)));
      const bMax = Math.max(...b[1].map((x) => num(x.row?.timestamp)));
      return bMax - aMax;
    })
    .map(([reportCode, rows]) => {
      const heading = reportCode === "unassigned" ? "Unassigned Event" : reportCode;
      return `
        <article class="card admin-event-block" data-admin-loot-event="${esc(reportCode)}">
          <div class="admin-event-head">
            <div>
              <h4 class="admin-event-title">${esc(heading)}</h4>
              <p class="subtle">Entries: <span data-admin-match-count>${rows.length}</span> / ${rows.length}</p>
            </div>
            <button
              type="button"
              class="loot-expand-btn"
              data-admin-loot-toggle="${esc(reportCode)}"
              aria-expanded="false"
              title="Expand/collapse event entries"
            >+</button>
          </div>
          <div class="admin-event-toolbar" data-admin-loot-body="${esc(reportCode)}" hidden>
            <input
              class="admin-input"
              type="search"
              placeholder="Search item or player..."
              data-admin-loot-filter
              data-admin-loot-filter-for="${esc(reportCode)}"
            />
          </div>
          <div class="admin-table-wrap" data-admin-loot-body="${esc(reportCode)}" hidden>
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Item ID</th>
                  <th>Item Link / Name</th>
                  <th>Recipient</th>
                  <th>Roll Type</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    ({ row, i }) => `
                      <tr
                        data-loot-row="${i}"
                        data-admin-filter-item="${esc(String(row.itemLink || row.itemName || ""))}"
                        data-admin-filter-player="${esc(String(row.awardedTo || ""))}"
                      >
                        <td>
                          <input class="admin-input" data-k="timestamp" value="${esc(row.timestamp || "")}" />
                          <div class="subtle">${esc(fmtTs(row.timestamp))}</div>
                        </td>
                        <td><input class="admin-input" data-k="itemID" value="${esc(row.itemID || "")}" /></td>
                        <td><input class="admin-input" data-k="itemLink" value="${esc(row.itemLink || row.itemName || "")}" /></td>
                        <td><input class="admin-input" data-k="awardedTo" value="${esc(row.awardedTo || "")}" /></td>
                        <td><input class="admin-input" data-k="winningRollType" value="${esc(row.winningRollType || "")}" /></td>
                        <td><input type="checkbox" data-k="received" ${row.received === false ? "" : "checked"} /></td>
                        <input type="hidden" data-k="reportCode" value="${esc(row.reportCode || "")}" />
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");
  host.innerHTML = `<div class="admin-events-stack">${eventBlocks}</div>`;
  bindLootEditorInteractions();
}

function bindLootEditorInteractions() {
  const blocks = [...document.querySelectorAll("[data-admin-loot-event]")];
  blocks.forEach((block) => {
    const toggle = block.querySelector("[data-admin-loot-toggle]");
    const bodies = [...block.querySelectorAll("[data-admin-loot-body]")];
    if (toggle) {
      toggle.addEventListener("click", () => {
        const nextExpanded = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
        toggle.textContent = nextExpanded ? "-" : "+";
        bodies.forEach((el) => {
          el.hidden = !nextExpanded;
        });
      });
    }
    const input = block.querySelector("[data-admin-loot-filter]");
    if (input) {
      input.addEventListener("input", () => applyLootEditorFilter(block));
      applyLootEditorFilter(block);
    }
  });
}

function applyLootEditorFilter(block) {
  const query = String(block.querySelector("[data-admin-loot-filter]")?.value || "")
    .trim()
    .toLowerCase();
  const rows = [...block.querySelectorAll("[data-loot-row]")];
  let visibleCount = 0;
  rows.forEach((row) => {
    const item = String(row.getAttribute("data-admin-filter-item") || "").toLowerCase();
    const player = String(row.getAttribute("data-admin-filter-player") || "").toLowerCase();
    const visible = !query || item.includes(query) || player.includes(query);
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  const countEl = block.querySelector("[data-admin-match-count]");
  if (countEl) countEl.textContent = String(visibleCount);
}

function readLootEditorEntries() {
  const rows = [...document.querySelectorAll("[data-loot-row]")];
  return rows.map((row) => {
    const idx = Number(row.getAttribute("data-loot-row"));
    const base = gargulEntriesState[idx] && typeof gargulEntriesState[idx] === "object" ? gargulEntriesState[idx] : {};
    const pick = (k) => row.querySelector(`[data-k="${k}"]`);
    const checkbox = pick("received");
    return {
      ...base,
      timestamp: num(pick("timestamp")?.value),
      reportCode: String(pick("reportCode")?.value || "").trim(),
      itemID: num(pick("itemID")?.value),
      itemLink: String(pick("itemLink")?.value || ""),
      awardedTo: String(pick("awardedTo")?.value || ""),
      winningRollType: String(pick("winningRollType")?.value || ""),
      received: Boolean(checkbox?.checked),
    };
  });
}

/** Mirror of `isHighConfidenceSource` from `lib/rh-wcl-guess.mjs` — keep in sync. */
function rhWclSourceIsHighConfidence(kind, score) {
  const k = String(kind || "").trim();
  if (!k) return false;
  if (k.endsWith("_orphan")) return false;
  if (k === "manual" || k === "manual:proposal") return true;
  if (k === "exact" || k === "guess_prefix" || k === "guess_prefix_rev") return true;
  if (typeof score === "number" && Number.isFinite(score) && score >= 85) return true;
  return false;
}

/** Status chip for one Account Assignment row: Verified / Auto-matched / Needs review / Empty. */
function rhWclRowStatusChipHtml(row) {
  const names = Array.isArray(row?.wclCharacterNames) ? row.wclCharacterNames.filter(Boolean) : [];
  const src = Array.isArray(row?.wclSources) ? row.wclSources : [];
  const conf = Array.isArray(row?.wclGuessConfidence) ? row.wclGuessConfidence : [];
  if (row?.verifiedAt) {
    const t = new Date(row.verifiedAt);
    const tt = Number.isNaN(t.getTime()) ? row.verifiedAt : t.toLocaleDateString();
    return `<span class="admin-rh-status-chip admin-rh-status-verified" title="Verified ${esc(String(row.verifiedAt))}">Verified · ${esc(tt)}</span>`;
  }
  if (!names.length) {
    return `<span class="admin-rh-status-chip admin-rh-status-empty">No WCL char</span>`;
  }
  const allHigh = names.every((_, i) => rhWclSourceIsHighConfidence(src[i], conf[i]));
  if (allHigh) {
    return `<span class="admin-rh-status-chip admin-rh-status-auto" title="All matches high-confidence; click Verify to lock.">Auto-matched</span>`;
  }
  return `<span class="admin-rh-status-chip admin-rh-status-review" title="At least one heuristic guess on this row — review and verify.">Needs review</span>`;
}

function rhWclMatchChipsHtml(row) {
  const names = Array.isArray(row?.wclCharacterNames) ? row.wclCharacterNames : [];
  const src = Array.isArray(row?.wclSources) ? row.wclSources : [];
  const conf = Array.isArray(row?.wclGuessConfidence) ? row.wclGuessConfidence : [];
  if (!names.length) return `<span class="subtle">—</span>`;
  return names
    .map((n, i) => {
      const s = String(src[i] || "manual");
      const c = conf[i];
      const guess = s.startsWith("guess");
      const cls = guess ? "admin-rh-src-guess" : s === "exact" ? "admin-rh-src-exact" : "admin-rh-src-manual";
      let lab = "Manual";
      if (s === "exact") lab = "Exact match";
      else if (guess)
        lab = s.includes("_orphan")
          ? `Best-effort (${typeof c === "number" ? `${Math.round(c)}%` : "score"})`
          : `Heuristic (${typeof c === "number" ? `${Math.round(c)}%` : "score"})`;
      else if (s !== "manual") lab = s.replace(/^guess_/, "").replace(/_/g, " ");
      return `<span class="admin-rh-src-chip ${cls}" title="${esc(s)}"><strong>${esc(n)}</strong> · ${esc(lab)}</span>`;
    })
    .join("");
}

function rhWclNamesFromRawInput(raw) {
  return String(raw || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function rhWclMainPickerHtmlFromNames(names, mainCharacterName) {
  const list = Array.isArray(names) ? names : [];
  const main = String(mainCharacterName || "").trim().toLowerCase();
  if (!list.length) return `<span class="subtle">Set WCL character names first.</span>`;
  return list
    .map((name) => {
      const n = String(name || "").trim();
      if (!n) return "";
      const isMain = n.toLowerCase() === main;
      return `<button type="button" class="event-signup-btn admin-rh-main-chip ${
        isMain ? "admin-rh-main-chip--active" : "event-signup-btn--softres"
      }" data-rh-wcl-main-set="${esc(n)}" title="${
        isMain ? "This row main in Account Assignment" : "Mark as row main"
      }">${esc(n)}${isMain ? " · Main" : ""}</button>`;
    })
    .filter(Boolean)
    .join("");
}

function refreshRhWclMainPickerForRow(tr) {
  if (!tr) return;
  const wclInp = tr.querySelector('[data-rh-wcl-k="wcl"]');
  const mainInp = tr.querySelector('[data-rh-wcl-k="main"]');
  const picker = tr.querySelector("[data-rh-wcl-main-picker]");
  if (!wclInp || !mainInp || !picker) return;
  const names = rhWclNamesFromRawInput(wclInp.value);
  const mainRaw = String(mainInp.value || "").trim();
  const matchedMain = names.find((n) => n.toLowerCase() === mainRaw.toLowerCase()) || "";
  if (mainRaw && !matchedMain) mainInp.value = "";
  picker.innerHTML = rhWclMainPickerHtmlFromNames(names, matchedMain);
}

function updateRhWclLinksChrome(list) {
  const dataCount = list.filter((r) => String(r?.raidHelperName || "").trim()).length;
  const countEl = document.getElementById("rhWclRowCount");
  if (countEl) {
    countEl.textContent =
      dataCount === 0 ? "No saved identities" : `${dataCount} account${dataCount === 1 ? "" : "s"}`;
  }
  const hint = document.getElementById("rhWclEmptyHint");
  if (hint) {
    hint.hidden = dataCount > 0;
  }
}

function rhWclProposalKindLabel(kind, score) {
  const k = String(kind || "").trim();
  const sc = typeof score === "number" && Number.isFinite(score) ? `${Math.round(score)}%` : "—";
  if (k === "exact") return `Exact (${sc})`;
  if (k.endsWith("_orphan")) return `Best-effort (${sc})`;
  if (k.startsWith("guess_")) return `${k.replace(/^guess_/, "").replace(/_/g, " ")} (${sc})`;
  if (k === "manual" || k === "manual:proposal") return `Manual`;
  return `${k} (${sc})`;
}

function renderRhWclTodo(payload) {
  const host = document.getElementById("rhWclTodoHost");
  if (!host) return;
  const proposals = Array.isArray(payload?.proposals) ? payload.proposals : [];
  const missing = Array.isArray(payload?.missing?.raidHelperRowsWithoutWcl)
    ? payload.missing.raidHelperRowsWithoutWcl
    : [];
  const unassignedWcl = Array.isArray(payload?.unassignedWclNames)
    ? payload.unassignedWclNames.filter(Boolean)
    : [];
  const rejectedIcebox = Array.isArray(payload?.rejectedIcebox) ? payload.rejectedIcebox : [];
  const profileIngest = payload?.profileIngest || null;
  const profileProposals = Array.isArray(profileIngest?.proposals)
    ? profileIngest.proposals.filter((p) => String(p?.status || "pending") === "pending")
    : [];
  const generatedAt = payload?.generatedAt ? new Date(payload.generatedAt) : null;
  const lastEl = document.getElementById("rhWclLastSync");
  if (lastEl) {
    lastEl.textContent =
      generatedAt && !Number.isNaN(generatedAt.getTime())
        ? `Last sync: ${generatedAt.toLocaleString()}`
        : "Last sync: never";
  }

  const proposalsRows = proposals
    .map((p) => {
      const wcl = String(p?.wclCharacterName || "");
      const rh = String(p?.suggestedRaidHelperName || "");
      const sc = typeof p?.score === "number" ? Math.round(p.score) : null;
      return `<tr data-rh-wcl-proposal-row>
        <td><strong>${esc(wcl)}</strong></td>
        <td>${esc(rh)}</td>
        <td>${sc != null ? `${sc}%` : "—"}</td>
        <td>${esc(rhWclProposalKindLabel(p?.kind, p?.score))}</td>
        <td class="admin-rh-todo-actions">
          <button type="button" class="event-signup-btn" data-rh-wcl-proposal-accept data-wcl="${esc(wcl)}" data-rh="${esc(rh)}" title="Append this WCL name onto the suggested Raid Helper row">Accept</button>
          <button type="button" class="event-signup-btn event-signup-btn--softres" data-rh-wcl-proposal-accept-verify data-wcl="${esc(wcl)}" data-rh="${esc(rh)}" title="Accept and immediately verify the row">Accept &amp; verify</button>
          <button type="button" class="event-signup-btn admin-btn-danger" data-rh-wcl-proposal-reject data-wcl="${esc(wcl)}" title="Drop this proposal; remembered for 30 days so the next sync skips it">Reject</button>
        </td>
      </tr>`;
    })
    .join("");

  const profileProposalRows = profileProposals
    .map((p) => {
      const id = String(p?.id || "");
      const display = String(p?.discordDisplayName || p?.discordUsername || p?.discordUserId || "");
      const userId = String(p?.discordUserId || "");
      const chars = Array.isArray(p?.characters) ? p.characters : [];
      const charHtml = chars
        .map((char) => {
          const name = String(char?.name || "");
          const url = String(char?.url || "");
          const label = name;
          return url
            ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`
            : `<strong>${esc(label)}</strong>`;
        })
        .join(", ");
      const existingRows = Array.isArray(p?.existing?.linkedCharacterRows) ? p.existing.linkedCharacterRows : [];
      const existing = p?.existing?.linkedDiscordRow
        ? `Discord ID already has row: ${p.existing.linkedDiscordRow}`
        : existingRows.length
          ? `Character already found on: ${existingRows.join(", ")}`
          : "No existing identity found";
      const postedAt = Number(p?.postedAt || 0);
      const posted = postedAt ? new Date(postedAt).toLocaleString() : "unknown";
      const messageUrl = String(p?.messageUrl || "");
      return `<tr data-discord-profile-proposal-row>
        <td>
          <label class="subtle" title="Mark this profile proposal for bulk accept">
            <input type="checkbox" data-discord-profile-select value="${esc(id)}" />
          </label>
        </td>
        <td>
          <strong>${esc(display || userId)}</strong>
          <div class="subtle"><code>${esc(userId)}</code></div>
        </td>
        <td>${charHtml || "—"}</td>
        <td>
          <span class="subtle">${esc(existing)}</span>
          <div class="subtle">${messageUrl ? `<a href="${esc(messageUrl)}" target="_blank" rel="noopener">Discord post</a>` : "Discord post"} · ${esc(posted)}</div>
        </td>
        <td class="admin-rh-todo-actions">
          <button type="button" class="event-signup-btn" data-discord-profile-accept="${esc(id)}" title="Create or update the canonical identity">Accept</button>
          <button type="button" class="event-signup-btn admin-btn-danger" data-discord-profile-reject="${esc(id)}" title="Reject this Discord profile post proposal">Reject</button>
        </td>
      </tr>`;
    })
    .join("");

  const profileIngestLastScan =
    profileIngest?.lastScanAt && Number(profileIngest.lastScanAt)
      ? new Date(Number(profileIngest.lastScanAt)).toLocaleString()
      : "never";
  const profileIngestSummary = profileIngest?.ok === false
    ? `<p class="subtle" style="color:#c44">Could not load Discord profile scanner: ${esc(profileIngest.error || "")}</p>`
    : `<p class="subtle">Scans channel <code>${esc(profileIngest?.channelId || "")}</code>. Last scan: ${esc(profileIngestLastScan)}.${profileIngest?.lastError ? ` Last error: ${esc(profileIngest.lastError)}` : ""}</p>`;

  const unassignedWclChips = unassignedWcl
    .map((name) => {
      const n = String(name || "");
      return `<span class="admin-rh-todo-chip admin-rh-todo-chip--wcl" draggable="true" data-rh-wcl-drag-wcl="${esc(n)}" data-rh-wcl-drop-wcl="${esc(n)}" title="Drag onto a row or an RH chip to assign ${esc(n)}; or drop an RH chip onto this WCL name">
        <span class="admin-rh-todo-chip-label">${esc(n)}</span>
        <button type="button" class="event-signup-btn admin-btn-danger admin-rh-todo-chip-btn" data-rh-wcl-proposal-reject data-wcl="${esc(n)}" title="Hide this WCL name; remembered so the next sync skips it">Reject</button>
      </span>`;
    })
    .join("");

  const missingRhChips = missing
    .map((m) => {
      const rh = String(m?.raidHelperName || "");
      const role = String(m?.guildRole || "Peon");
      if (!rh) return "";
      return `<span class="admin-rh-todo-chip admin-rh-todo-chip--rh admin-rh-todo-chip--missing" draggable="true" data-rh-wcl-drag-rh="${esc(rh)}" data-rh-wcl-droptarget="missing-rh" data-rh-wcl-rh="${esc(rh)}" title="Drop a WCL character chip here to stage assignment onto saved row ${esc(rh)}, or drag this RH name onto a WCL chip">
        <span class="admin-rh-todo-chip-label">${esc(rh)}</span>
        <span class="subtle">${esc(role)}</span>
      </span>`;
    })
    .join("");
  const iceboxRows = rejectedIcebox
    .map((entry) => {
      const wcl = String(entry?.wclCharacterName || "");
      const untilMs = Number(entry?.until || 0);
      const untilTxt =
        Number.isFinite(untilMs) && untilMs > 0 ? new Date(untilMs).toLocaleString() : "unknown";
      return `<tr>
        <td><strong>${esc(wcl)}</strong></td>
        <td>${esc(untilTxt)}</td>
        <td class="admin-rh-todo-actions">
          <button type="button" class="event-signup-btn event-signup-btn--softres" data-rh-wcl-icebox-restore data-wcl="${esc(wcl)}" title="Restore this ignored suggestion so automation can propose it again">Restore</button>
        </td>
      </tr>`;
    })
    .join("");

  host.innerHTML = `
    <details class="admin-rh-todo-block" data-rh-wcl-todo-block="proposals" ${proposals.length ? "open" : ""}>
      <summary>Pending proposals (${proposals.length})</summary>
      ${
        proposals.length
          ? `<div class="admin-table-wrap">
              <table class="admin-table admin-rh-todo-table">
                <thead>
                  <tr>
                    <th>WCL log name</th>
                    <th>Suggested RH name</th>
                    <th>Score</th>
                    <th>Kind</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>${proposalsRows}</tbody>
              </table>
            </div>`
          : `<p class="subtle">No low-confidence guesses awaiting review.</p>`
      }
    </details>
    <details class="admin-rh-todo-block" data-rh-wcl-todo-block="discord-profiles" ${profileProposals.length ? "open" : ""}>
      <summary>Discord profile posts (${profileProposals.length})</summary>
      ${profileIngestSummary}
      <div class="admin-actions admin-actions--tight" style="margin:8px 0 12px">
        <button type="button" class="event-signup-btn event-signup-btn--softres" data-discord-profile-scan>
          Scan profile channel now
        </button>
        ${
          profileProposals.length
            ? `<button type="button" class="event-signup-btn event-signup-btn--softres" data-discord-profile-mark-all>
                Mark all
              </button>
              <button type="button" class="event-signup-btn event-signup-btn--softres" data-discord-profile-unmark-all>
                Unmark all
              </button>
              <button type="button" class="event-signup-btn" data-discord-profile-accept-marked>
                Accept marked
              </button>
              <button type="button" class="event-signup-btn" data-discord-profile-accept-all>
                Accept all
              </button>`
            : ""
        }
      </div>
      ${
        profileProposals.length
          ? `<div class="admin-table-wrap">
              <table class="admin-table admin-rh-todo-table">
                <thead>
                  <tr>
                    <th>Mark</th>
                    <th>Discord user</th>
                    <th>Classic Armory characters</th>
                    <th>Match info</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>${profileProposalRows}</tbody>
              </table>
            </div>`
          : `<p class="subtle">No pending Classic Armory profile posts awaiting review.</p>`
      }
    </details>
    <details class="admin-rh-todo-block" data-rh-wcl-todo-block="missing" ${missing.length ? "open" : ""}>
      <summary>Missing data (${missing.length})</summary>
      ${
        missing.length || unassignedWcl.length
          ? `<div class="admin-rh-todo-split">
              <section class="admin-rh-todo-split-col">
                <h4 class="admin-rh-todo-mini-title">Raid Helper rows without WCL</h4>
                ${
                  missing.length
                    ? `<p class="subtle">Drop a WCL chip directly onto one of these rows to stage assignment without scrolling.</p>
                       <div class="admin-rh-todo-chips" data-rh-wcl-chips="missing-rh">${missingRhChips}</div>`
                    : `<p class="subtle">Every saved Raid Helper row has at least one WCL character.</p>`
                }
              </section>
              <section class="admin-rh-todo-split-col">
                <h4 class="admin-rh-todo-mini-title">Unassigned WCL log characters</h4>
                ${
                  unassignedWcl.length
                    ? `<p class="subtle">Drag onto a missing RH row on the left or onto any saved row below.</p>
                       <div class="admin-rh-todo-chips" data-rh-wcl-chips="wcl">${unassignedWclChips}</div>`
                    : `<p class="subtle">No leftover log characters from the last sync.</p>`
                }
              </section>
            </div>`
          : `<p class="subtle">Every saved Raid Helper row has at least one WCL character, and there are no unassigned WCL names.</p>`
      }
    </details>
    <details class="admin-rh-todo-block" data-rh-wcl-todo-block="icebox">
      <summary>Ignored suggestions (${rejectedIcebox.length})</summary>
      ${
        rejectedIcebox.length
          ? `<p class="subtle">Rejected character names are ignored temporarily. Restore to allow suggestions again.</p>
             <div class="admin-table-wrap">
               <table class="admin-table admin-rh-todo-table">
                 <thead><tr><th>WCL character</th><th>Ignored until</th><th>Actions</th></tr></thead>
                 <tbody>${iceboxRows}</tbody>
               </table>
             </div>`
          : `<p class="subtle">No ignored suggestions.</p>`
      }
    </details>
  `;
}

async function loadRhWclTodo() {
  if (identityReviewDetailsLoadPromise) return identityReviewDetailsLoadPromise;
  identityReviewDetailsLoadPromise = (async () => {
  const host = document.getElementById("rhWclTodoHost");
  if (host && !host.dataset.rhWclTodoLoaded) host.innerHTML = `<p class="subtle">Loading review details…</p>`;
  try {
    const [todoResult, profileResult] = await Promise.allSettled([
      getJson("/api/admin/rh-wcl-links/proposals"),
      getJson("/api/admin/discord-profile-ingest"),
    ]);
    if (todoResult.status === "rejected") throw todoResult.reason;
    const payload = todoResult.value || {};
    payload.profileIngest =
      profileResult.status === "fulfilled"
        ? profileResult.value
        : { ok: false, error: profileResult.reason?.message || "Discord profile scanner unavailable" };
    renderRhWclTodo(payload);
    if (host) host.dataset.rhWclTodoLoaded = "1";
  } catch (error) {
    if (host) host.innerHTML = `<p class="subtle">Failed to load review details: ${esc(error?.message || "")}</p>`;
  }
  })().finally(() => {
    identityReviewDetailsLoadPromise = null;
  });
  return identityReviewDetailsLoadPromise;
}

function renderRhWclLinksTable(rows) {
  const host = document.getElementById("rhWclLinksTableHost");
  if (!host) return;
  const list =
    Array.isArray(rows) && rows.length ? rows : [{ raidHelperName: "", wclCharacterNames: [], guildRole: "Peon" }];
  updateRhWclLinksChrome(list);
  host.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
            <tr>
            <th title="Stable Discord user id (snowflake). Auto-populated from Raid Helper signups when possible — overrides RH-name matching when set.">Discord ID</th>
            <th>Raid Helper name</th>
            <th>Guild role</th>
            <th>WCL characters</th>
            <th>Match source</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map((row, idx) => {
              const metaObj = {
                wclSources: row.wclSources || [],
                wclGuessConfidence: row.wclGuessConfidence || [],
              };
              const metaAttr =
                metaObj.wclSources.length || metaObj.wclGuessConfidence.length
                  ? ` data-rh-wcl-meta="${encodeURIComponent(JSON.stringify(metaObj))}"`
                  : "";
              const storedRh = String(row.raidHelperName ?? "");
              const discordId = String(row.discordUserId || "");
              const idSource = String(row.discordUserIdSource || "").trim();
              const idChip = discordId
                ? `<span class="admin-rh-src-chip ${idSource === "rh-scan" ? "admin-rh-src-guess" : "admin-rh-src-manual"}" title="${esc(idSource || "manual")}">${idSource === "rh-scan" ? "Auto (RH scan)" : "Manual"}</span>`
                : `<span class="subtle">unset</span>`;
              const wclNames = Array.isArray(row.wclCharacterNames) ? row.wclCharacterNames : [];
              const mainCharacterName = String(row.mainCharacterName || "").trim();
              return `
            <tr data-rh-wcl-row="${idx}" data-rh-wcl-stored-name="${esc(storedRh)}" data-rh-wcl-stored-id="${esc(discordId)}" data-rh-wcl-stored-verified-at="${esc(String(row.verifiedAt || ""))}"${metaAttr}>
              <td class="admin-rh-discord-cell">
                <input
                  class="admin-input"
                  data-rh-wcl-k="discordId"
                  value="${esc(discordId)}"
                  placeholder="17–20 digit Discord ID"
                  inputmode="numeric"
                  pattern="\\d{17,20}"
                  autocomplete="off"
                />
                <div class="admin-rh-discord-meta">${idChip}</div>
              </td>
              <td><input class="admin-input" data-rh-wcl-k="rh" value="${esc(row.raidHelperName || "")}" placeholder="As on signup" /></td>
              <td class="admin-rh-role-cell">${rhWclGuildRoleSelectHtml(row.guildRole)}</td>
              <td class="admin-rh-wcl-cell">
                <input class="admin-input" data-rh-wcl-k="wcl" value="${esc(
                  wclNames.join(", ")
                )}" placeholder="Comma-separated, or use Add alt below" />
                <input type="hidden" data-rh-wcl-k="main" value="${esc(mainCharacterName)}" />
                <div class="admin-rh-add-alt">
                  <input
                    class="admin-input"
                    type="text"
                    data-rh-wcl-alt-inp
                    placeholder="WCL log name…"
                    autocomplete="off"
                    aria-label="Add Warcraft Logs alt name"
                  />
                  <button type="button" class="event-signup-btn event-signup-btn--softres" data-rh-wcl-add-alt title="Append this log name and save row (if Raid Helper name is set)">
                    Add alt
                  </button>
                </div>
                <div class="admin-rh-main-picker-note subtle">Main in this mapping (profile main-character can override):</div>
                <div class="admin-rh-main-picker" data-rh-wcl-main-picker>${rhWclMainPickerHtmlFromNames(
                  wclNames,
                  mainCharacterName
                )}</div>
              </td>
              <td class="admin-rh-src-cell">
                <div class="admin-rh-status-line">${rhWclRowStatusChipHtml(row)}</div>
                <div class="admin-rh-match-chips">${rhWclMatchChipsHtml(row)}</div>
              </td>
              <td class="admin-rh-actions-cell">
                <button type="button" class="event-signup-btn" data-rh-wcl-save title="Save this row to the identity database">Save row</button>
                ${
                  row.verifiedAt
                    ? `<button type="button" class="event-signup-btn event-signup-btn--softres" data-rh-wcl-unverify="${esc(storedRh)}" title="Clear verified flag — heuristic merges may edit this row again">Unverify</button>`
                    : `<button type="button" class="event-signup-btn event-signup-btn--softres" data-rh-wcl-verify="${esc(storedRh)}" title="Lock this row from background heuristic edits">Verify</button>`
                }
                <button type="button" class="event-signup-btn event-signup-btn--softres" data-rh-wcl-remove="${idx}">Remove</button>
              </td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  host.querySelectorAll('[data-rh-wcl-k="rh"], [data-rh-wcl-k="wcl"], [data-rh-wcl-k="discordId"]').forEach((inp) => {
    inp.addEventListener("input", () => {
      const tr = inp.closest("tr");
      if (inp.getAttribute("data-rh-wcl-k") === "wcl") refreshRhWclMainPickerForRow(tr);
      tr?.setAttribute("data-rh-wcl-dirty", "1");
      const td = tr?.querySelector(".admin-rh-src-cell");
      if (td) td.innerHTML = `<span class="subtle">Edited — unsaved (use Save row or Save all)</span>`;
    });
  });
  host.querySelectorAll('[data-rh-wcl-k="guildRole"]').forEach((sel) => {
    sel.addEventListener("change", () => {
      const tr = sel.closest("tr");
      const td = tr?.querySelector(".admin-rh-src-cell");
      if (td && !tr?.getAttribute("data-rh-wcl-dirty")) {
        td.innerHTML = `<span class="subtle">Guild role changed — save row or Save all</span>`;
      }
    });
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const inp = event.target.closest("[data-rh-wcl-alt-inp]");
  if (!inp) return;
  event.preventDefault();
  const tr = inp.closest("tr");
  if (!tr) return;
  rhWclAppendAltForRow(tr).catch((err) => status(err?.message || "Add alt failed"));
});

// Drag-and-drop: WCL chip → saved row OR unassigned RH chip. Staged in
// memory only — Save row / Save all rows persists the assignment.
let rhWclActiveDrag = null;
let rhWclAutoScrollTimer = null;
let rhWclAutoScrollDeltaY = 0;

function stopRhWclAutoScroll() {
  if (rhWclAutoScrollTimer) {
    clearInterval(rhWclAutoScrollTimer);
    rhWclAutoScrollTimer = null;
  }
  rhWclAutoScrollDeltaY = 0;
}

function updateRhWclAutoScroll(clientY) {
  if (!Number.isFinite(clientY)) {
    stopRhWclAutoScroll();
    return;
  }
  const edge = 96;
  const maxSpeed = 24;
  let delta = 0;
  if (clientY < edge) {
    const ratio = Math.min(1, (edge - clientY) / edge);
    delta = -Math.max(4, Math.round(maxSpeed * ratio));
  } else if (clientY > window.innerHeight - edge) {
    const ratio = Math.min(1, (clientY - (window.innerHeight - edge)) / edge);
    delta = Math.max(4, Math.round(maxSpeed * ratio));
  }
  rhWclAutoScrollDeltaY = delta;
  if (!delta) {
    stopRhWclAutoScroll();
    return;
  }
  if (rhWclAutoScrollTimer) return;
  rhWclAutoScrollTimer = setInterval(() => {
    if (!rhWclAutoScrollDeltaY) return;
    window.scrollBy(0, rhWclAutoScrollDeltaY);
  }, 16);
}

document.addEventListener("dragstart", (event) => {
  const srcWcl = event.target.closest("[data-rh-wcl-drag-wcl]");
  const srcRh = event.target.closest("[data-rh-wcl-drag-rh]");
  if (!srcWcl && !srcRh) return;
  const dragType = srcWcl ? "wcl" : "rh";
  const src = srcWcl || srcRh;
  const value = String(src.getAttribute(dragType === "wcl" ? "data-rh-wcl-drag-wcl" : "data-rh-wcl-drag-rh") || "").trim();
  if (!value) return;
  const rhDropKind = dragType === "rh" ? String(src.getAttribute("data-rh-wcl-droptarget") || "rh-name").trim() : "";
  if (event.dataTransfer) {
    try {
      event.dataTransfer.setData("text/plain", value);
      event.dataTransfer.setData("application/x-rh-wcl-drag-type", dragType);
      if (dragType === "rh") event.dataTransfer.setData("application/x-rh-wcl-rh-kind", rhDropKind);
    } catch {
      // Some browsers throw if dataTransfer is read-only; the closure binding below covers us.
    }
    event.dataTransfer.effectAllowed = "copy";
  }
  src.classList.add("is-rh-wcl-dragging");
  rhWclActiveDrag = { type: dragType, value, rhKind: rhDropKind };
});

document.addEventListener("dragend", (event) => {
  event.target.closest("[data-rh-wcl-drag-wcl], [data-rh-wcl-drag-rh]")?.classList.remove("is-rh-wcl-dragging");
  rhWclActiveDrag = null;
  stopRhWclAutoScroll();
  document
    .querySelectorAll(".is-rh-wcl-drop-hover")
    .forEach((el) => el.classList.remove("is-rh-wcl-drop-hover"));
});

document.addEventListener("dragover", (event) => {
  if (!rhWclActiveDrag) return;
  updateRhWclAutoScroll(event.clientY);
  const target =
    rhWclActiveDrag.type === "wcl"
      ? event.target.closest("[data-rh-wcl-row], [data-rh-wcl-droptarget]")
      : event.target.closest("[data-rh-wcl-drop-wcl]");
  if (!target) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  target.classList.add("is-rh-wcl-drop-hover");
});

document.addEventListener("dragleave", (event) => {
  const target = event.target.closest("[data-rh-wcl-row], [data-rh-wcl-droptarget]");
  if (!target) return;
  // Only clear when actually leaving the target — dragleave also fires when
  // entering child nodes, so we re-check whether the related target is still
  // inside the same drop zone.
  const related = event.relatedTarget;
  if (related && target.contains(related)) return;
  target.classList.remove("is-rh-wcl-drop-hover");
});

document.addEventListener("drop", (event) => {
  let dragType = "";
  let value = "";
  let rhKind = "";
  try {
    dragType = String(event.dataTransfer?.getData("application/x-rh-wcl-drag-type") || "").trim();
    rhKind = String(event.dataTransfer?.getData("application/x-rh-wcl-rh-kind") || "").trim();
    value = String(event.dataTransfer?.getData("text/plain") || "").trim();
  } catch {
    value = "";
  }
  if (!value && rhWclActiveDrag?.value) value = String(rhWclActiveDrag.value || "").trim();
  if (!dragType && rhWclActiveDrag?.type) dragType = String(rhWclActiveDrag.type || "").trim();
  if (!rhKind && rhWclActiveDrag?.rhKind) rhKind = String(rhWclActiveDrag.rhKind || "").trim();
  if (!value || !dragType) return;

  const row = event.target.closest("[data-rh-wcl-row]");
  const dropTarget = event.target.closest("[data-rh-wcl-droptarget]");
  const wclChipTarget = event.target.closest("[data-rh-wcl-drop-wcl]");
  if (!row && !dropTarget && !wclChipTarget) return;
  event.preventDefault();
  stopRhWclAutoScroll();
  document
    .querySelectorAll(".is-rh-wcl-drop-hover")
    .forEach((el) => el.classList.remove("is-rh-wcl-drop-hover"));

  if (dragType === "wcl") {
    const wcl = value;
    if (row) {
      stageWclOntoRow(row, wcl);
    } else if (dropTarget) {
      const rh = String(dropTarget.getAttribute("data-rh-wcl-rh") || "").trim();
      const kind = String(dropTarget.getAttribute("data-rh-wcl-droptarget") || "").trim();
      if (kind === "rh-name") {
        stageWclOntoUnassignedRh(rh, wcl);
      } else if (kind === "missing-rh") {
        stageWclOntoMissingRhRow(rh, wcl);
      }
    }
  } else if (dragType === "rh" && wclChipTarget) {
    const rh = value;
    const wcl = String(wclChipTarget.getAttribute("data-rh-wcl-drop-wcl") || "").trim();
    const kind = rhKind || "rh-name";
    if (wcl) {
      if (kind === "missing-rh") stageWclOntoMissingRhRow(rh, wcl);
      else stageWclOntoUnassignedRh(rh, wcl);
    }
  }
  rhWclActiveDrag = null;
});

/** Append a WCL alt to the row’s comma list; saves immediately when Raid Helper name is set. */
async function rhWclAppendAltForRow(tr) {
  const rhInp = tr.querySelector('[data-rh-wcl-k="rh"]');
  const wclInp = tr.querySelector('[data-rh-wcl-k="wcl"]');
  const altInp = tr.querySelector("[data-rh-wcl-alt-inp]");
  const alt = String(altInp?.value ?? "").trim();
  if (!alt) {
    status("Type the Warcraft Logs character name to add.");
    return;
  }
  const existing = String(wclInp?.value || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lower = new Set(existing.map((n) => n.toLowerCase()));
  if (lower.has(alt.toLowerCase())) {
    status(`“${alt}” is already in the list.`);
    altInp.value = "";
    return;
  }
  existing.push(alt);
  wclInp.value = existing.join(", ");
  altInp.value = "";
  tr.setAttribute("data-rh-wcl-dirty", "1");
  const tdSrc = tr.querySelector(".admin-rh-src-cell");
  if (tdSrc) tdSrc.innerHTML = `<span class="subtle">Edited — unsaved (use Save row or Save all)</span>`;

  const rh = String(rhInp?.value || "").trim();
  if (!rh) {
    status(`Added “${alt}” to the list. Enter a Raid Helper name, then Save row.`);
    return;
  }

  const row = readRhWclLinkRowFromTr(tr);
  const stored = tr?.getAttribute("data-rh-wcl-stored-name");
  const payload = { ...row };
  if (stored !== null && String(stored).trim() !== "") payload.previousRaidHelperName = stored;
  const payloadOut = await getJson("/api/admin/rh-wcl-links/row", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  renderRhWclLinksTable(Array.isArray(payloadOut.links) ? payloadOut.links : []);
  status(`Added alt “${alt}” and saved “${rh}”.`);
}

/** Parse one table row into the API payload shape (or null if both columns empty). */
function readRhWclLinkRowFromTr(tr) {
  if (!tr) return null;
  const rh = String(tr.querySelector('[data-rh-wcl-k="rh"]')?.value || "").trim();
  const wclRaw = String(tr.querySelector('[data-rh-wcl-k="wcl"]')?.value || "").trim();
  const discordIdRaw = String(tr.querySelector('[data-rh-wcl-k="discordId"]')?.value || "").trim();
  if (!rh && !wclRaw && !discordIdRaw) return null;
  const wclCharacterNames = rhWclNamesFromRawInput(wclRaw);

  const dirty = tr.getAttribute("data-rh-wcl-dirty") === "1";
  let wclSources = [];
  let wclGuessConfidence = [];

  if (!dirty && wclCharacterNames.length) {
    try {
      const rawMeta = tr.getAttribute("data-rh-wcl-meta");
      if (rawMeta) {
        const meta = JSON.parse(decodeURIComponent(rawMeta));
        const srcArr = Array.isArray(meta.wclSources) ? meta.wclSources : [];
        const confArr = Array.isArray(meta.wclGuessConfidence) ? meta.wclGuessConfidence : [];
        if (srcArr.length === wclCharacterNames.length) {
          wclSources = srcArr.map((x) => String(x || "manual"));
          wclGuessConfidence = wclCharacterNames.map((_, i) => {
            const c = confArr[i];
            return typeof c === "number" && Number.isFinite(c) ? Math.round(c) : null;
          });
        }
      }
    } catch {
      // ignore bad meta
    }
  }

  if ((!wclSources.length || dirty) && wclCharacterNames.length) {
    wclSources = wclCharacterNames.map(() => "manual");
    wclGuessConfidence = wclCharacterNames.map(() => null);
  }

  const roleRaw = String(tr.querySelector('[data-rh-wcl-k="guildRole"]')?.value || "").trim();
  const guildRole = normalizeGuildRoleValue(roleRaw);

  const row = { raidHelperName: rh, wclCharacterNames, guildRole };
  const mainRaw = String(tr.querySelector('[data-rh-wcl-k="main"]')?.value || "").trim();
  if (mainRaw) {
    const chosen = wclCharacterNames.find((n) => n.toLowerCase() === mainRaw.toLowerCase());
    if (chosen) row.mainCharacterName = chosen;
  }
  if (/^\d{17,20}$/.test(discordIdRaw)) {
    row.discordUserId = discordIdRaw;
    // Source is "manual" whenever the operator's value differs from the
    // stored auto-populated id; otherwise we preserve the stored provenance
    // so an "Auto (RH scan)" chip isn't lost on a no-op save.
    const stored = String(tr.getAttribute("data-rh-wcl-stored-id") || "").trim();
    row.discordUserIdSource = stored && stored === discordIdRaw ? "rh-scan" : "manual";
  }
  if (wclSources.length === wclCharacterNames.length && wclCharacterNames.length > 0) {
    row.wclSources = wclSources;
    if (wclGuessConfidence.some((x) => typeof x === "number")) row.wclGuessConfidence = wclGuessConfidence;
  }
  const storedVerifiedAt = String(tr.getAttribute("data-rh-wcl-stored-verified-at") || "").trim();
  if (storedVerifiedAt) row.verifiedAt = storedVerifiedAt;
  return row;
}

function readRhWclLinksFromTable() {
  return [...document.querySelectorAll("[data-rh-wcl-row]")]
    .map((tr) => readRhWclLinkRowFromTr(tr))
    .filter(Boolean);
}

/**
 * Append a WCL character name to the comma-separated list on a saved row
 * without persisting. Sets `data-rh-wcl-dirty="1"` so the existing
 * Save row / Save all rows handlers pick it up. Removes the chip from the
 * to-do panel for instant feedback (server still has it until the next sync,
 * but the admin sees the assignment land immediately).
 */
function stageWclOntoRow(tr, wclName) {
  if (!tr) return false;
  const wcl = String(wclName || "").trim();
  if (!wcl) return false;
  const wclInp = tr.querySelector('[data-rh-wcl-k="wcl"]');
  if (!wclInp) return false;
  const existing = String(wclInp.value || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lower = new Set(existing.map((n) => n.toLowerCase()));
  if (lower.has(wcl.toLowerCase())) {
    status(`“${wcl}” is already on that row.`);
    return false;
  }
  existing.push(wcl);
  wclInp.value = existing.join(", ");
  refreshRhWclMainPickerForRow(tr);
  tr.setAttribute("data-rh-wcl-dirty", "1");
  const tdSrc = tr.querySelector(".admin-rh-src-cell");
  if (tdSrc) tdSrc.innerHTML = `<span class="subtle">Edited — unsaved (use Save row or Save all)</span>`;
  removeRhWclTodoChipByWcl(wcl);
  const rhInp = tr.querySelector('[data-rh-wcl-k="rh"]');
  const rhValue = String(rhInp?.value || "").trim();
  status(`Staged “${wcl}” → ${rhValue || "(unnamed row)"}; click Save row or Save all rows to persist.`);
  return true;
}

/**
 * Stage a WCL→RH assignment for an unassigned Raid Helper signup name. Reads
 * the current table, appends a new row pre-populated with the RH name and the
 * dropped WCL character, re-renders, then sets the dirty flag on that new
 * row. Removes both chips from the to-do panel.
 */
function stageWclOntoUnassignedRh(rhName, wclName) {
  const rh = String(rhName || "").trim();
  const wcl = String(wclName || "").trim();
  if (!rh || !wcl) return false;
  const links = readRhWclLinksFromTable();
  const targetKey = rh.toLowerCase();
  const already = links.some((r) => String(r?.raidHelperName || "").trim().toLowerCase() === targetKey);
  if (already) {
    const existingTr = [...document.querySelectorAll("[data-rh-wcl-row]")].find((tr) => {
      const v = String(tr.querySelector('[data-rh-wcl-k="rh"]')?.value || "").trim().toLowerCase();
      return v === targetKey;
    });
    if (existingTr) {
      const ok = stageWclOntoRow(existingTr, wcl);
      if (ok) removeRhWclTodoChipByRh(rh);
      return ok;
    }
  }
  links.push({ raidHelperName: rh, wclCharacterNames: [wcl], guildRole: "Peon" });
  renderRhWclLinksTable(links);
  const newTr = [...document.querySelectorAll("[data-rh-wcl-row]")].find((tr) => {
    const v = String(tr.querySelector('[data-rh-wcl-k="rh"]')?.value || "").trim().toLowerCase();
    return v === targetKey;
  });
  if (newTr) {
    newTr.setAttribute("data-rh-wcl-dirty", "1");
    const tdSrc = newTr.querySelector(".admin-rh-src-cell");
    if (tdSrc) tdSrc.innerHTML = `<span class="subtle">Edited — unsaved (use Save row or Save all)</span>`;
  }
  removeRhWclTodoChipByWcl(wcl);
  removeRhWclTodoChipByRh(rh);
  status(`Staged new row “${rh}” ← “${wcl}”; click Save row or Save all rows to persist.`);
  return true;
}

/** Stage WCL character onto an already-saved RH row surfaced in Missing data. */
function stageWclOntoMissingRhRow(rhName, wclName) {
  const rh = String(rhName || "").trim();
  const wcl = String(wclName || "").trim();
  if (!rh || !wcl) return false;
  const targetKey = rh.toLowerCase();
  const existingTr = [...document.querySelectorAll("[data-rh-wcl-row]")].find((tr) => {
    const v = String(tr.querySelector('[data-rh-wcl-k="rh"]')?.value || "").trim().toLowerCase();
    return v === targetKey;
  });
  if (!existingTr) {
    status(`Could not find saved row for “${rh}”. Click Refresh now and try again.`);
    return false;
  }
  const ok = stageWclOntoRow(existingTr, wcl);
  if (ok) removeRhWclTodoMissingRhChip(rh);
  return ok;
}

function removeRhWclTodoChipByWcl(wclName) {
  const v = String(wclName || "").trim();
  if (!v) return;
  document
    .querySelectorAll(`[data-rh-wcl-drag-wcl]`)
    .forEach((el) => {
      if (String(el.getAttribute("data-rh-wcl-drag-wcl") || "").trim() === v) el.remove();
    });
}

function removeRhWclTodoChipByRh(rhName) {
  const v = String(rhName || "").trim();
  if (!v) return;
  document
    .querySelectorAll(`[data-rh-wcl-droptarget="rh-name"]`)
    .forEach((el) => {
      if (String(el.getAttribute("data-rh-wcl-rh") || "").trim() === v) el.remove();
    });
}

function removeRhWclTodoMissingRhChip(rhName) {
  const v = String(rhName || "").trim();
  if (!v) return;
  document.querySelectorAll(`[data-rh-wcl-droptarget="missing-rh"]`).forEach((el) => {
    if (String(el.getAttribute("data-rh-wcl-rh") || "").trim() === v) el.remove();
  });
}

let adminP2DemandEntries = [];
let adminP2DemandCheckedKeys = new Set();
const adminP2DemandItemMeta = new Map();
let adminP2DemandFilterBound = false;

function adminP2DemandCheckKey(userId, itemId) {
  return `${String(userId || "").trim()}:${Math.max(0, Math.floor(Number(itemId) || 0))}`;
}

function adminP2DemandRowNvTotal(row) {
  const items = Array.isArray(row?.items) ? row.items : [];
  return items.reduce((sum, it) => {
    const x = Number(it?.vortexNeeded);
    const n = Number.isFinite(x) ? Math.max(1, Math.min(20, Math.floor(x))) : 1;
    return sum + n;
  }, 0);
}

function adminP2DemandRowMatchesFilter(row, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    row.characterName,
    row.displayName,
    row.raidHelperName,
    ...(Array.isArray(row.items) ? row.items.flatMap((it) => [it.itemName, it.profession]) : []),
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return hay.includes(needle);
}

function adminP2DemandFmtUpdated(ts) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "—";
  try {
    return new Date(t).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

async function adminP2DemandFetchItemMeta(entries) {
  if (!window.WowItemTooltip) return;
  const ids = [];
  for (const row of entries || []) {
    for (const it of row.items || []) {
      const id = Math.max(0, Math.floor(Number(it.itemID || 0)));
      if (id > 0 && !adminP2DemandItemMeta.has(id)) ids.push(id);
    }
  }
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80);
    const metaPayload = await getJson(`/api/wow-classic/items?ids=${encodeURIComponent(chunk.join(","))}`);
    for (const row of metaPayload?.items || []) {
      const id = Math.max(0, Math.floor(Number(row?.itemId || 0)));
      if (id > 0) adminP2DemandItemMeta.set(id, row);
    }
  }
}

function adminP2DemandRaiderCellHtml(row) {
  const discordName = String(row.displayName || "").trim();
  const linkedCharacter = String(row.characterName || "").trim();
  const hasLink = Boolean(linkedCharacter) && linkedCharacter.toLowerCase() !== discordName.toLowerCase();
  const display = linkedCharacter || discordName || "Unknown";
  const hint =
    !hasLink && discordName
      ? `<span class="p2-demand-raider-sub" title="Add an Account Assignment row to show the WoW character.">unassigned</span>`
      : "";
  return `<div class="p2-demand-raider-name">${esc(display)}${hint}</div>`;
}

function adminP2DemandItemCellHtml(itemId, itemName) {
  const id = Math.max(0, Math.floor(Number(itemId || 0)));
  const meta = adminP2DemandItemMeta.get(id);
  const tip = window.WowItemTooltip?.tooltipText ? window.WowItemTooltip.tooltipText(meta) : String(itemName || "");
  const iconRaw = String(meta?.icon || "").trim();
  const icon = iconRaw
    ? `<img class="p2-demand-item-icon" src="${esc(iconRaw)}" alt="" width="28" height="28" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : `<span class="p2-demand-item-icon"></span>`;
  return `<div class="loot-item-name p2-demand-item" data-loot-item-id="${id}" title="${esc(tip)}">${icon}<span class="p2-demand-item-name">${esc(itemName)}</span></div>`;
}

function adminP2DemandCheckCellHtml(userId, itemId, checked) {
  return `<label class="p2-demand-admin-check" title="Mark fulfilled">
    <input type="checkbox" class="p2-demand-admin-check-input" data-p2-demand-check="1" data-user-id="${esc(userId)}" data-item-id="${esc(String(itemId))}"${checked ? " checked" : ""} />
    <span class="visually-hidden">Done</span>
  </label>`;
}

function adminP2DemandRowsHtmlForRaider(row) {
  const items = Array.isArray(row.items) && row.items.length ? row.items : [];
  const userId = String(row.userId || "");
  const totalNv = adminP2DemandRowNvTotal(row);
  const updatedIso = row.updatedAt ? new Date(Number(row.updatedAt)).toISOString() : "";
  const updatedLabel = adminP2DemandFmtUpdated(row.updatedAt);
  const timeMarkup = updatedIso
    ? `<time datetime="${esc(updatedIso)}">${esc(updatedLabel)}</time>`
    : esc(updatedLabel);
  const raiderCell = adminP2DemandRaiderCellHtml(row);

  if (!items.length) {
    return `
      <tr>
        <td class="cell-check"></td>
        <td class="cell-raider">${raiderCell}</td>
        <td colspan="2"><span class="subtle">No items selected.</span></td>
        <td class="cell-num">0</td>
        <td class="cell-time">${timeMarkup}</td>
      </tr>
    `;
  }

  const span = items.length;
  return items
    .map((it, idx) => {
      const itemId = Math.max(0, Math.floor(Number(it.itemID || 0)));
      const checked = adminP2DemandCheckedKeys.has(adminP2DemandCheckKey(userId, itemId));
      const trCls = [idx === items.length - 1 ? "is-group-end" : "", checked ? "is-demand-checked" : ""]
        .filter(Boolean)
        .join(" ");
      const isFirst = idx === 0;
      const cells = [];
      cells.push(`<td class="cell-check">${adminP2DemandCheckCellHtml(userId, itemId, checked)}</td>`);
      if (isFirst) {
        cells.push(`<td class="cell-raider"${span > 1 ? ` rowspan="${span}"` : ""}>${raiderCell}</td>`);
      }
      cells.push(`<td class="cell-item">${adminP2DemandItemCellHtml(itemId, it.itemName)}</td>`);
      cells.push(`<td class="cell-prof">${it.profession ? esc(it.profession) : "—"}</td>`);
      if (isFirst) {
        cells.push(`<td class="cell-num"${span > 1 ? ` rowspan="${span}"` : ""}>${totalNv}</td>`);
        cells.push(`<td class="cell-time"${span > 1 ? ` rowspan="${span}"` : ""}>${timeMarkup}</td>`);
      }
      return `<tr class="${trCls}">${cells.join("")}</tr>`;
    })
    .join("");
}

function refreshAdminP2DemandTable() {
  const host = document.getElementById("adminP2DemandTableHost");
  const meta = document.getElementById("adminP2DemandMeta");
  if (!host) return;

  const all = adminP2DemandEntries;
  const q = document.getElementById("adminP2DemandSearch")?.value || "";
  const rows = all
    .filter((r) => adminP2DemandRowMatchesFilter(r, q))
    .sort((a, b) => adminP2DemandRowNvTotal(b) - adminP2DemandRowNvTotal(a));

  if (!all.length) {
    host.innerHTML = `<p class="subtle p2-demand-empty">No submissions yet.</p>`;
    if (meta) meta.textContent = "Total guild need: 0 Nether Vortex";
    return;
  }

  if (!rows.length) {
    host.innerHTML = `<p class="subtle p2-demand-empty">No raiders match your filter.</p>`;
    if (meta) meta.textContent = `No matches (of ${all.length} raiders).`;
    return;
  }

  const grandTotal = rows.reduce((sum, row) => sum + adminP2DemandRowNvTotal(row), 0);
  let checkedNv = 0;
  for (const row of rows) {
    const uid = String(row.userId || "");
    for (const it of row.items || []) {
      const key = adminP2DemandCheckKey(uid, it.itemID);
      if (adminP2DemandCheckedKeys.has(key)) {
        const x = Number(it.vortexNeeded);
        checkedNv += Number.isFinite(x) ? Math.max(1, Math.min(20, Math.floor(x))) : 1;
      }
    }
  }
  if (meta) {
    meta.textContent = `Total guild need: ${grandTotal} NV · Done: ${checkedNv} · Open: ${Math.max(0, grandTotal - checkedNv)}${
      rows.length !== all.length ? ` · showing ${rows.length} of ${all.length} raiders` : ""
    }`;
  }

  host.innerHTML = `
    <table class="p2-demand-table admin-p2-demand-table" aria-label="P2 demand by raider">
      <colgroup>
        <col class="col-check" />
        <col class="col-raider" />
        <col class="col-item" />
        <col class="col-prof" />
        <col class="col-num" />
        <col class="col-time" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" class="cell-check">Done</th>
          <th scope="col">Raider</th>
          <th scope="col">Item</th>
          <th scope="col">Profession</th>
          <th scope="col" class="is-num">NV</th>
          <th scope="col" class="col-time-th">Updated</th>
        </tr>
      </thead>
      <tbody>${rows.map((row) => adminP2DemandRowsHtmlForRaider(row)).join("")}</tbody>
      <tfoot>
        <tr>
          <td colspan="4">${rows.length} ${rows.length === 1 ? "raider" : "raiders"}</td>
          <td class="cell-num">${grandTotal}</td>
          <td class="cell-time"></td>
        </tr>
      </tfoot>
    </table>
  `;

  if (window.WowItemTooltip?.bindLootTooltipHandlers) {
    window.WowItemTooltip.bindLootTooltipHandlers(host, (id) => adminP2DemandItemMeta.get(Number(id)));
  }
}

function ensureAdminP2DemandFilterListeners() {
  if (adminP2DemandFilterBound) return;
  adminP2DemandFilterBound = true;
  let debounceTimer = null;
  document.getElementById("adminP2DemandSearch")?.addEventListener("input", () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => refreshAdminP2DemandTable(), 140);
  });
  document.getElementById("adminP2DemandReloadBtn")?.addEventListener("click", () => {
    loadAdminP2DemandPanel().catch((error) => status(error?.message || "P2 demand reload failed"));
  });
}

async function loadAdminP2DemandPanel() {
  const host = document.getElementById("adminP2DemandTableHost");
  if (!host) return;
  host.textContent = "Loading demand…";
  const payload = await getJson("/api/admin/p2-demand");
  adminP2DemandEntries = Array.isArray(payload?.entries) ? payload.entries : [];
  adminP2DemandCheckedKeys = new Set(
    Array.isArray(payload?.checkedKeys) ? payload.checkedKeys.map((k) => String(k || "").trim()).filter(Boolean) : []
  );
  try {
    await adminP2DemandFetchItemMeta(adminP2DemandEntries);
  } catch {
    /* icons optional */
  }
  ensureAdminP2DemandFilterListeners();
  refreshAdminP2DemandTable();
}

function renderP2Table(materials) {
  const host = document.getElementById("adminP2Table");
  if (!host) return;
  host.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Material</th><th>Required</th><th>Current</th><th>Update</th></tr></thead>
        <tbody>
          ${materials
            .map(
              (m) => `
                <tr>
                  <td>${esc(m.name)}</td>
                  <td>${num(m.required)}</td>
                  <td><input class="admin-input" id="p2-${esc(m.id)}" value="${num(m.current)}" /></td>
                  <td><button class="event-signup-btn" data-p2-id="${esc(m.id)}">Save</button></td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderJoinNeedsTable(rows) {
  joinNeedsState = Array.isArray(rows) ? rows : [];
  const host = document.getElementById("adminJoinNeedsTable");
  if (!host) return;
  host.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Class</th><th>Spec focus</th><th>Priority</th><th>Remove</th></tr></thead>
        <tbody>
          ${joinNeedsState
            .map(
              (row, idx) => `
                <tr data-join-need-row="${idx}">
                  <td><input class="admin-input" data-join-need-k="className" value="${esc(row.className || "")}" placeholder="Shaman" /></td>
                  <td><input class="admin-input" data-join-need-k="specFocus" value="${esc(row.specFocus || "")}" placeholder="Enhancement" /></td>
                  <td>
                    <select class="admin-input" data-join-need-k="priority">
                      <option value="high"${String(row.priority || "").toLowerCase() === "high" ? " selected" : ""}>High</option>
                      <option value="medium"${String(row.priority || "").toLowerCase() === "medium" ? " selected" : ""}>Medium</option>
                      <option value="open"${String(row.priority || "").toLowerCase() === "open" ? " selected" : ""}>Open</option>
                    </select>
                  </td>
                  <td><button type="button" class="event-signup-btn event-signup-btn--softres" data-join-need-remove="${idx}">Remove</button></td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function readJoinNeedsFromTable() {
  return [...document.querySelectorAll("[data-join-need-row]")]
    .map((tr) => {
      const pick = (k) => tr.querySelector(`[data-join-need-k="${k}"]`);
      return {
        className: String(pick("className")?.value || "").trim(),
        specFocus: String(pick("specFocus")?.value || "").trim(),
        priority: String(pick("priority")?.value || "open").trim().toLowerCase(),
      };
    })
    .filter((row) => row.className && row.specFocus);
}

function roleAlertsSelectedEventId() {
  return String(document.getElementById("roleAlertsEventSelect")?.value || "").trim();
}

/** Extract Raid Helper snowflake event id from plan URL, event URL, or raw digits. */
function extractRaidHelperEventIdFromPaste(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^\d{10,}$/.test(s)) return s;
  try {
    const u = new URL(s, "https://raid-helper.xyz");
    const path = u.pathname || "";
    const m =
      path.match(/\/(?:raidplan|events)\/(\d+)/i) ||
      path.match(/\/(\d{10,})(?:\/|$)/);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  const loose = s.match(/(\d{10,})/);
  return loose ? loose[1] : "";
}

/** Ensure dropdown has an option for this id (e.g. pasted past event), then select it. */
function roleAlertsEnsureEventOptionInSelect(eventId, label) {
  const select = document.getElementById("roleAlertsEventSelect");
  if (!select || !eventId) return;
  const id = String(eventId).trim();
  const exists = [...select.options].some((o) => String(o.value) === id);
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label || `Event ${id} (from link)`;
    select.appendChild(opt);
  }
  select.value = id;
}

function renderRoleAlertsEventSelect(events) {
  roleAlertsEventsState = Array.isArray(events) ? events : [];
  roleAlertsSavedTargetsByEventId = new Map(
    roleAlertsEventsState
      .map((event) => {
        const id = String(event?.id || "").trim();
        const targets = event?.roleTargets && typeof event.roleTargets === "object" ? event.roleTargets : null;
        return id ? [id, targets] : null;
      })
      .filter(Boolean)
  );
  const select = document.getElementById("roleAlertsEventSelect");
  if (!select) return;
  const prev = String(select.value || "").trim();
  select.innerHTML = `
    <option value="">Select event...</option>
    ${roleAlertsEventsState
      .map((event) => {
        const id = String(event?.id || "").trim();
        if (!id) return "";
        const label = `${String(event?.title || "Raid event")} · ${fmtTs(event?.startTime)}`;
        return `<option value="${esc(id)}">${esc(label)}</option>`;
      })
      .join("")}
  `;
  if (prev && roleAlertsEventsState.some((e) => String(e?.id || "") === prev)) {
    select.value = prev;
  }
}

function roleAlertsCaptureHostUiState() {
  const host = document.getElementById("roleAlertsHost");
  if (!host) return null;
  return {
    scrollY: window.scrollY,
    hostScrollTop: host.scrollTop,
    openDetailsSummaries: [...host.querySelectorAll("details[open]")]
      .map((el) => String(el.querySelector("summary")?.textContent || "").trim())
      .filter(Boolean),
    expandedSignupIds: [...roleAlertsComposerExpandedIds],
  };
}

function roleAlertsRestoreHostUiState(state) {
  if (!state) return;
  const host = document.getElementById("roleAlertsHost");
  const apply = () => {
    window.scrollTo(0, Number(state.scrollY || 0));
    if (host) host.scrollTop = Number(state.hostScrollTop || 0);
    if (host && Array.isArray(state.openDetailsSummaries)) {
      for (const summaryText of state.openDetailsSummaries) {
        const match = [...host.querySelectorAll("details")].find(
          (el) => String(el.querySelector("summary")?.textContent || "").trim() === summaryText
        );
        if (match) match.open = true;
      }
    }
    roleAlertsComposerExpandedIds = new Set(
      Array.isArray(state.expandedSignupIds) ? state.expandedSignupIds.map(String) : []
    );
    roleAlertsComposerApplyViewModeExpansions();
    if (host) {
      host.querySelectorAll("[data-role-alert-composer-expand]").forEach((card) => {
        const sid = String(card.getAttribute("data-signup-id") || "").trim();
        if (sid && roleAlertsComposerExpandedIds.has(sid)) {
          roleAlertsComposerSetCardExpanded(card, true);
        }
      });
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
}

async function runRoleAlertsAnalyzeFromSelect(options = {}) {
  const silent = Boolean(options?.silent);
  const eventId = roleAlertsSelectedEventId();
  const host = document.getElementById("roleAlertsHost");
  if (!eventId) {
    roleAlertsAnalyzeSeq += 1;
    roleAlertsSelectedUserIds = new Set();
    renderRoleAlertsAnalysis(null);
    return;
  }
  const seq = (roleAlertsAnalyzeSeq += 1);
  const uiState = silent ? roleAlertsCaptureHostUiState() : null;
  if (!silent && host) host.innerHTML = `<p class="subtle">Loading roster…</p>`;
  if (!silent) roleAlertsSelectedUserIds = new Set();
  try {
    const payload = await getJson("/api/admin/role-alerts/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        overrides: roleAlertsReadOverrides(),
        desiredByRole: roleAlertsReadDesiredByRole(),
        manualRoleSpecNeeds: roleAlertsReadManualRoleSpecNeeds(),
      }),
    });
    if (seq !== roleAlertsAnalyzeSeq) return;
    roleAlertsLastSendResult = null;
    renderRoleAlertsAnalysis(payload, {
      preserveComposerDraft: Boolean(options?.preserveComposerDraft),
    });
    if (silent) roleAlertsRestoreHostUiState(uiState);
    else status("Role-alert analysis updated.");
  } catch (error) {
    if (seq !== roleAlertsAnalyzeSeq) return;
    roleAlertsAnalysisState = null;
    if (host) {
      host.innerHTML = `<p class="subtle">Could not load roster: ${esc(error?.message || "Unknown error")}</p>`;
    }
    status(error?.message || "Failed to analyze selected event");
  }
}

function roleAlertsReadOverrides() {
  const out = {};
  document.querySelectorAll("[data-role-alert-signup-id]").forEach((el) => {
    const id = String(el.getAttribute("data-role-alert-signup-id") || "").trim();
    const val = String(el.value || "").trim();
    if (!id || (val !== "real" && val !== "blocker")) return;
    out[id] = val;
  });
  return out;
}

function roleAlertsReadDesiredByRole() {
  const saved = roleAlertsSavedTargetsByEventId.get(roleAlertsSelectedEventId()) || {};
  const pick = (id, role) => {
    const n = Number(document.getElementById(id)?.value);
    const fallback = Number(saved?.[role] ?? ROLE_ALERT_DEFAULT_TARGETS[role] ?? 0);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : Math.max(0, Math.floor(fallback || 0));
  };
  return {
    Tanks: pick("roleAlertsNeedTanks", "Tanks"),
    Healers: pick("roleAlertsNeedHealers", "Healers"),
    Melee: pick("roleAlertsNeedMelee", "Melee"),
    Ranged: pick("roleAlertsNeedRanged", "Ranged"),
  };
}

function roleAlertsReadTargetUserIds() {
  const validIds = new Set(
    (Array.isArray(roleAlertsAnalysisState?.candidateTargets) ? roleAlertsAnalysisState.candidateTargets : [])
      .map((row) => String(row?.userId || "").trim())
      .filter(Boolean)
  );
  return [...roleAlertsSelectedUserIds].filter((id) => validIds.has(id));
}

function roleAlertsReadManualRoleSpecNeeds() {
  const out = { Tanks: [], Healers: [], Melee: [], Ranged: [] };
  document.querySelectorAll("[data-role-alert-manual-role]").forEach((row) => {
    const role = String(row.getAttribute("data-role-alert-manual-role") || "");
    if (!ROLE_ALERT_ROLES.includes(role)) return;
    const spec = String(row.querySelector("[data-role-alert-manual-spec]")?.value || "").trim();
    const count = Math.max(0, Math.floor(Number(row.querySelector("[data-role-alert-manual-count]")?.value || 0)));
    if (!spec || count <= 0) return;
    out[role].push({ spec, count });
  });
  return out;
}

function roleAlertsDesiredTotalFromInputs() {
  return ROLE_ALERT_ROLES.reduce((sum, role) => {
    const input = document.getElementById(`roleAlertsNeed${role}`);
    const n = Number(input?.value || 0);
    return sum + (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  }, 0);
}

function roleAlertsUpdateDesiredTotal() {
  const el = document.getElementById("roleAlertsDesiredTotal");
  if (el) el.textContent = String(roleAlertsDesiredTotalFromInputs());
}

function roleAlertsCompositionRowsHtml(analysis) {
  const desired = analysis?.desiredByRole || {};
  const current = analysis?.currentByRole || {};
  const missing = analysis?.missingByRole || {};
  const reachable = analysis?.reachableByRole || {};
  const blockerSpecNeedsByRole = analysis?.blockerSpecNeedsByRole || {};
  const desiredTotal = ROLE_ALERT_ROLES.reduce((sum, role) => sum + Math.max(0, Math.floor(Number(desired[role] || 0))), 0);
  const rows = ROLE_ALERT_ROLES
    .map((role) => {
      const need = Number(desired[role] || 0);
      const cur = Number(current[role] || 0);
      const miss = Number(missing[role] || 0);
      const reach = Number(reachable[role] || 0);
      const specNeedMap = blockerSpecNeedsByRole[role] && typeof blockerSpecNeedsByRole[role] === "object" ? blockerSpecNeedsByRole[role] : {};
      const specNeedText = Object.entries(specNeedMap)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([spec, n]) => `${spec} x${Number(n || 0)}`)
        .join(" · ");
      return `<tr>
        <td>${esc(role)}</td>
        <td><input id="roleAlertsNeed${esc(role)}" class="admin-input" type="number" min="0" value="${need}" /></td>
        <td>${cur}</td>
        <td><strong>${miss}</strong></td>
        <td>${reach}</td>
        <td>${esc(specNeedText || "-")}</td>
      </tr>`;
    })
    .join("");
  return `
    <p class="subtle">Subscribed users (marked in candidate list): ${Number(analysis?.subscribedTotal || 0)}</p>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Role</th><th>Desired</th><th>Current (real)</th><th>Missing</th><th>Reachable past raiders</th><th>Spec blockers</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td><strong>Total</strong></td>
            <td><strong id="roleAlertsDesiredTotal">${desiredTotal}</strong> <span class="subtle">/ 25</span></td>
            <td colspan="4" class="subtle">Desired raid size check</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function roleAlertsBlockerRowsHtml(analysis) {
  const blockerRows = Array.isArray(analysis?.blockerRows) ? analysis.blockerRows : [];
  const realRows = Array.isArray(analysis?.realRows) ? analysis.realRows : [];
  const allRows = [
    ...blockerRows.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""))),
    ...realRows.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""))),
  ];
  if (!allRows.length) return `<p class="subtle">No primary signups found for this event.</p>`;
  return `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Name</th><th>Role</th><th>Class</th><th>Spec</th><th>Classification</th></tr></thead>
        <tbody>
          ${allRows
            .map((row) => {
              const signupId = Number(row?.signupId || 0);
              const cls = row?.isBlocker ? "blocker" : "real";
              return `<tr>
                <td>${esc(row?.name || "-")}</td>
                <td>${esc(row?.roleName || "-")}</td>
                <td>${esc(row?.className || "-")}</td>
                <td>${esc(row?.specName || "-")}</td>
                <td>
                  <select class="admin-input" data-role-alert-signup-id="${signupId}">
                    <option value="real"${cls === "real" ? " selected" : ""}>Real</option>
                    <option value="blocker"${cls === "blocker" ? " selected" : ""}>Blocker</option>
                  </select>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function roleAlertsManualSpecNeedsHtml(analysis) {
  const src = analysis?.manualRoleSpecNeeds && typeof analysis.manualRoleSpecNeeds === "object" ? analysis.manualRoleSpecNeeds : {};
  const sections = ROLE_ALERT_ROLES.map((role) => {
    const rows = Array.isArray(src[role]) ? src[role] : [];
    const body = rows.length
      ? rows
          .map(
            (row, idx) => `<div class="admin-actions admin-actions--tight" data-role-alert-manual-role="${esc(role)}">
              <input class="admin-input" data-role-alert-manual-spec value="${esc(row?.spec || "")}" placeholder="Spec name" />
              <input class="admin-input" data-role-alert-manual-count type="number" min="0" value="${Number(row?.count || 0)}" />
              <button type="button" class="event-signup-btn event-signup-btn--softres" data-role-alert-manual-remove="${esc(role)}:${idx}">Remove</button>
            </div>`
          )
          .join("")
      : `<p class="subtle">No manual specs yet.</p>`;
    return `<div class="admin-grid-note">
      <p class="subtle"><strong>${esc(role)}</strong></p>
      ${body}
      <button type="button" class="event-signup-btn event-signup-btn--softres" data-role-alert-manual-add="${esc(role)}">Add spec</button>
    </div>`;
  }).join("");
  return `<h4 class="subtle" style="margin: 12px 0 6px">Manual spec blocker needs</h4>${sections}`;
}

/** Warcraft Logs–style parse pill (same breakpoints as voting / leaderboard). */
function roleAlertPeakParseTierClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "leaderboard-peak-parse--empty";
  if (n >= 100) return "leaderboard-peak-parse--wcl100";
  if (n >= 99) return "leaderboard-peak-parse--wcl99";
  if (n >= 95) return "leaderboard-peak-parse--wcl95";
  if (n >= 75) return "leaderboard-peak-parse--wcl75";
  if (n >= 50) return "leaderboard-peak-parse--wcl50";
  if (n >= 25) return "leaderboard-peak-parse--wcl25";
  return "leaderboard-peak-parse--wcl0";
}

/** Min/max parse % and GS across comp slots plus optional signup rows (composer heatmap). */
function collectRoleAlertComposerHeatmapStats(compBoardGroups, extraSlotLikeRows) {
  let gsMin = Infinity;
  let gsMax = -Infinity;
  let peakMin = Infinity;
  let peakMax = -Infinity;
  let gsCount = 0;
  let peakCount = 0;
  const bump = (slot) => {
    const gs = Number(slot?.gearScore);
    if (Number.isFinite(gs) && gs > 0) {
      gsMin = Math.min(gsMin, gs);
      gsMax = Math.max(gsMax, gs);
      gsCount += 1;
    }
    const pk = Number(slot?.peakParse);
    if (Number.isFinite(pk) && pk >= 0) {
      peakMin = Math.min(peakMin, pk);
      peakMax = Math.max(peakMax, pk);
      peakCount += 1;
    }
  };
  for (const group of compBoardGroups || []) {
    for (const slot of Array.isArray(group?.slots) ? group.slots : []) {
      bump(slot);
    }
  }
  for (const row of Array.isArray(extraSlotLikeRows) ? extraSlotLikeRows : []) {
    bump(row);
  }
  return {
    gsMin: gsCount ? gsMin : NaN,
    gsMax: gsCount ? gsMax : NaN,
    peakMin: peakCount ? peakMin : NaN,
    peakMax: peakCount ? peakMax : NaN,
  };
}

/** Min/max parse % and GS across all comp-board slots (shown roster). */
function collectRoleAlertCompBoardHeatmapStats(groups) {
  let gsMin = Infinity;
  let gsMax = -Infinity;
  let peakMin = Infinity;
  let peakMax = -Infinity;
  let gsCount = 0;
  let peakCount = 0;
  for (const group of groups || []) {
    for (const slot of Array.isArray(group?.slots) ? group.slots : []) {
      const gs = Number(slot?.gearScore);
      if (Number.isFinite(gs) && gs > 0) {
        gsMin = Math.min(gsMin, gs);
        gsMax = Math.max(gsMax, gs);
        gsCount += 1;
      }
      const pk = Number(slot?.peakParse);
      if (Number.isFinite(pk) && pk >= 0) {
        peakMin = Math.min(peakMin, pk);
        peakMax = Math.max(peakMax, pk);
        peakCount += 1;
      }
    }
  }
  return {
    gsMin: gsCount ? gsMin : NaN,
    gsMax: gsCount ? gsMax : NaN,
    peakMin: peakCount ? peakMin : NaN,
    peakMax: peakCount ? peakMax : NaN,
  };
}

/** Map a value into 0–100 using roster min/max; flat roster → 50 (mid band). */
function rosterRelativeHeatmapPct(value, minV, maxV) {
  const v = Number(value);
  if (!Number.isFinite(v)) return NaN;
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return NaN;
  if (maxV <= minV) return 50;
  return Math.max(0, Math.min(100, ((v - minV) / (maxV - minV)) * 100));
}

function roleAlertsWclEventsFootnoteHtml(analysis) {
  const m = analysis?.wclEventsMeta;
  if (!m?.available) {
    return `<span class="subtle">WCL event totals: not available (enable raid appearance materialisation and sync reports).</span>`;
  }
  if (m.scope === "curated" && Number(m.curatedReportCount || 0) > 0) {
    return `<span class="subtle">WCL event totals: <strong>${esc(String(m.curatedReportCount))}</strong> curated report(s) from Event Management (same scope as roster leaderboard “Events”).</span>`;
  }
  return `<span class="subtle">WCL event totals: all <strong>${esc(
    String(m.materialisedReportCount ?? 0)
  )}</strong> materialised guild reports (no Event Management filter).</span>`;
}

function roleAlertEmoteIconUrl(id) {
  return id && /^\d+$/.test(String(id))
    ? `https://cdn.discordapp.com/emojis/${encodeURIComponent(String(id))}.webp?size=32&quality=lossless`
    : "";
}

/**
 * Shared comp-slot / composer card face (parse, GS, Ev) for Role Alerts UI.
 * @param {object} surface
 * @param {string} surface.outerClass - full class list for the root (includes layout modifiers)
 * @param {string} [surface.rootAttrs] - extra HTML attributes for the root element
 * @param {boolean} [surface.compactLayout] - raid composer: calmer typography, aligned stats row, no Ev/GS prefix noise
 * @param {boolean} [surface.forceExpanded] - Detailed view: show gear/phase/tags on every card
 */
function roleAlertSlotSurfaceHtml(slot, heatStats, wclMeta, wclEventsTitleBase, surface) {
  const outerClass = String(surface?.outerClass || "role-alert-slot").trim();
  const rootAttrs = String(surface?.rootAttrs || "").trim();
  const compact = Boolean(surface?.compactLayout);
  const classColor = String(slot?.color || "").trim();
  const leftBorder = /^#[0-9a-f]{6}$/i.test(classColor)
    ? ` style="border-left: 3px solid ${esc(classColor)}"`
    : "";
  const specIcon = roleAlertEmoteIconUrl(slot?.specEmoteId);
  const classIcon = roleAlertEmoteIconUrl(slot?.classEmoteId);
  const peakN = Number(slot?.peakParse);
  const peakTxt = Number.isFinite(peakN) && peakN >= 0 ? peakN.toFixed(1) : "—";
  const peakHasRosterRange = Number.isFinite(heatStats.peakMin) && Number.isFinite(heatStats.peakMax);
  const peakVirt = peakHasRosterRange ? rosterRelativeHeatmapPct(peakN, heatStats.peakMin, heatStats.peakMax) : NaN;
  const peakTier = peakHasRosterRange
    ? roleAlertPeakParseTierClass(Number.isFinite(peakVirt) ? peakVirt : NaN)
    : roleAlertPeakParseTierClass(Number.isFinite(peakN) ? peakN : NaN);
  const bracket = String(slot?.peakParseBracket || "").trim();
  const src = String(slot?.peakParseSource || "").trim();
  const star =
    src === "guild_recent"
      ? `<span class="role-alert-slot-peak-star" title="Parse from another recent guild log (not limited to Event Management).">*</span>`
      : "";
  const peakTitleBase = Number.isFinite(peakN)
    ? `${src === "guild_recent" ? "Parse from wider guild report window. " : ""}Best single-boss percentile for this slot's role (${bracket || "DPS / tank / heal"}) in recent Warcraft Logs reports for this guild: ${peakN.toFixed(1)}. Does not include logs from other guilds.`
    : "No rank in recent guild Warcraft Logs for this name (or not linked in Account Assignment). Parses only cover logs uploaded to your guild — other guilds’ public logs are not queried.";
  const peakRelNote = peakHasRosterRange
    ? " Color on this board is scaled to the min/max parse of everyone shown on this comp."
    : "";
  const peakTitle = peakTitleBase + peakRelNote;
  const rhTitle = `${String(slot?.className || "-")} · ${String(slot?.specName || "-")} · ${slot?.isBlocker ? "Blocker" : "Raider"}`;
  const disp = String(slot?.displayCharacterName || slot?.name || "").trim() || "-";
  const rhLabel = String(slot?.name || "").trim();
  const nameTitle = esc(rhLabel && disp && rhLabel !== disp ? `${disp} (Raid Helper: ${rhLabel})` : disp);
  const rhSub =
    rhLabel && disp && rhLabel !== disp ? `<span class="role-alert-slot-rh-name">${esc(rhLabel)}</span>` : "";
  const gsN = Number(slot?.gearScore);
  const gsTxt = Number.isFinite(gsN) && gsN > 0 ? String(Math.round(gsN)) : "—";
  const armoryUrl = String(slot?.classicArmoryCharacterUrl || "").trim();
  const gsHasRosterRange = Number.isFinite(heatStats.gsMin) && Number.isFinite(heatStats.gsMax);
  const gsVirt =
    Number.isFinite(gsN) && gsN > 0
      ? gsHasRosterRange
        ? rosterRelativeHeatmapPct(gsN, heatStats.gsMin, heatStats.gsMax)
        : gearScoreToRosterHeatmapPct(gsN)
      : NaN;
  const gsTierClass = roleAlertPeakParseTierClass(gsVirt);
  const gsTitle =
    Number.isFinite(gsN) && gsN > 0
      ? gsHasRosterRange
        ? "Classic Armory GearScore. Color on this board is scaled to min/max GS of everyone shown on this comp (not the WCL parse number)."
        : "Classic Armory GearScore. Colors use fixed GS bands (no spread on this board). Not the WCL parse number."
      : "Classic Armory GearScore. The WCL parse is the colored number to the left. Fill GS via character-specs sync or refresh after API loads.";
  const gsLabel = compact ? "" : "GS ";
  const gsInner = `<span class="role-alert-slot-gs-pill leaderboard-peak-parse ${gsTierClass}" title="${esc(gsTitle)}">${gsLabel}${esc(gsTxt)}</span>`;
  const gsBlock = armoryUrl
    ? `<a class="role-alert-slot-gs" href="${esc(armoryUrl)}" target="_blank" rel="noopener noreferrer">${gsInner}</a>`
    : gsInner;
  const wclEvRaw = slot?.wclEventCount;
  const wclEvUnresNote =
    " Could not map this slot to a roster user (Discord id on signup, Account Assignment, Raid Helper name key, or WoW character name).";
  const wclEvTitle = wclMeta?.available && wclEvRaw == null ? wclEventsTitleBase + wclEvUnresNote : wclEventsTitleBase;
  const wclEvTxt = !wclMeta?.available ? "—" : wclEvRaw == null ? "—" : String(Math.max(0, Math.floor(Number(wclEvRaw))));
  const wclEventsSpan = compact
    ? `<span class="role-alert-slot-stat role-alert-slot-stat--ev role-alert-slot-wcl-events role-alert-slot-wcl-events--compact" title="${esc(wclEvTitle)}">${esc(wclEvTxt)}</span>`
    : `<span class="role-alert-slot-wcl-events subtle" title="${esc(wclEvTitle)}">Ev ${esc(wclEvTxt)}</span>`;
  const raiderCardMod = roleAlertsRaiderCardModifier(slot);
  const raiderCardBadge = roleAlertsRaiderCardBadgeHtml(slot);
  const attrStr = rootAttrs ? ` ${rootAttrs}` : "";
  const layoutClass = compact
    ? `${outerClass} role-alert-slot--layout role-alert-slot--compact${raiderCardMod ? ` ${raiderCardMod}` : ""}`
    : `${outerClass} role-alert-slot--layout${raiderCardMod ? ` ${raiderCardMod}` : ""}`;
  const primaryIconsClass = compact ? "role-alert-slot-icons role-alert-slot-icons--compact" : "role-alert-slot-icons";
  const iconDimAttr = compact ? ' width="16" height="16"' : "";

  const primaryRow = `<div class="role-alert-slot-row role-alert-slot-row--primary" title="${esc(rhTitle)}">
                  ${
                    specIcon || classIcon
                      ? `<span class="${primaryIconsClass}">
                        ${specIcon ? `<img class="role-alert-slot-icon"${iconDimAttr} src="${esc(specIcon)}" alt="" loading="lazy" decoding="async" />` : ""}
                        ${classIcon ? `<img class="role-alert-slot-icon"${iconDimAttr} src="${esc(classIcon)}" alt="" loading="lazy" decoding="async" />` : ""}
                      </span>`
                      : ""
                  }
                  <span class="role-alert-slot-name-stack" title="${nameTitle}">
                    <span class="role-alert-slot-name">${esc(disp)}</span>${rhSub}${raiderCardBadge}
                  </span>
                </div>`;

  if (compact) {
    const classLine = String(slot?.className || "").trim() || "—";
    const classLabel = roleAlertWowClassLabelFromSlot(slot) || adminIdentityClassDisplay(classLine) || classLine;
    const specLine = String(slot?.specName || "").trim() || "—";
    const roleLine = String(slot?.roleName || "").trim();
    const phaseAvgs =
      surface?.phaseAvgs !== undefined ? surface.phaseAvgs : roleAlertsResolvePhaseAvgs(slot);
    const showPhaseRow = Boolean(surface?.showPhaseAvgs);
    const wowClassSlug = adminIdentitySlug(roleAlertWowClassLabelFromSlot(slot) || classLine);
    const resolvedClassColor =
      roleAlertResolveClassColor(slot) || (wowClassSlug ? ADMIN_WOW_CLASS_COLORS_BY_SLUG[wowClassSlug] || "" : "");
    const {
      classExtra: classColorClass,
      styleExtra: classColorStyle,
      barHtml: classColorBar,
      nameStyle: nameColorStyle,
    } = roleAlertComposerCardColorAttrs(resolvedClassColor, wowClassSlug);
    const iconBlock =
      specIcon || classIcon
        ? `<span class="role-alert-composer-class-mark">
            ${classIcon ? `<img class="role-alert-composer-icon role-alert-composer-icon--class" width="18" height="18" src="${esc(classIcon)}" alt="" loading="lazy" decoding="async" />` : ""}
            ${specIcon ? `<img class="role-alert-composer-icon role-alert-composer-icon--spec" width="18" height="18" src="${esc(specIcon)}" alt="" loading="lazy" decoding="async" />` : ""}
          </span>`
        : `<span class="role-alert-composer-class-mark role-alert-composer-class-mark--empty" aria-hidden="true"></span>`;
    const rhAlias =
      rhLabel && disp && rhLabel !== disp
        ? `<span class="role-alert-composer-rh-alias">${esc(rhLabel)}</span>`
        : `<span class="role-alert-composer-rh-alias" aria-hidden="true"></span>`;
    const parseVal = `<span class="role-alert-slot-peak-line">${star}<span class="role-alert-slot-peak leaderboard-peak-parse ${peakTier}" title="${esc(peakTitle)}">${esc(peakTxt)}</span></span>`;
    const composerSignupId = String(slot?._occupantSignupId || slot?.signupId || "").trim();
    const forceExpanded = Boolean(surface?.forceExpanded);
    const isComposerExpanded =
      forceExpanded || (composerSignupId && roleAlertsComposerExpandedIds.has(composerSignupId));
    const blockerMod = slot?.isBlocker ? " role-alert-slot--blocker-card" : "";
    const expandedClass = isComposerExpanded ? " is-composer-expanded" : "";
    const expandedHiddenAttr = isComposerExpanded ? "" : " hidden";
    const expandHint = isComposerExpanded ? "▾" : "▸";
    const expandAttrs = composerSignupId
      ? ` data-role-alert-composer-expand="1" data-signup-id="${esc(composerSignupId)}" aria-expanded="${isComposerExpanded ? "true" : "false"}"`
      : "";
    const infoPanel = `<section class="role-alert-composer-info-panel" aria-label="Character stats">
      <div class="role-alert-composer-info-grid">
        ${roleAlertComposerInfoCellHtml("Parse", parseVal, peakTitle)}
        ${roleAlertComposerInfoCellHtml("Events", esc(wclEvTxt), wclEvTitle)}
        ${roleAlertComposerInfoCellHtml("GS", gsBlock, gsTitle)}
      </div>
      <div class="role-alert-composer-expanded"${expandedHiddenAttr}>
        <div class="role-alert-composer-tag-row">
          <span class="role-alert-composer-tag role-alert-composer-tag--class">${esc(classLabel)}</span>
          <span class="role-alert-composer-tag ${roleAlertComposerRoleTagClass(roleLine)}">${esc(roleAlertComposerShortRole(roleLine))}</span>
          <span class="role-alert-composer-tag role-alert-composer-tag--spec">${esc(specLine)}</span>
        </div>
        ${rhAlias}
        <div class="role-alert-composer-gear-row">
          <span class="role-alert-composer-info-heading">Gear</span>
          ${roleAlertsGearSummaryLineHtml(slot)}
        </div>
        ${
          showPhaseRow
            ? `<div class="role-alert-composer-phase-block">
                <span class="role-alert-composer-info-heading">Phase avg</span>
                ${roleAlertSlotPhaseAvgsHtml(phaseAvgs, { composerPanel: true })}
              </div>`
            : ""
        }
      </div>
    </section>`;
    return `<div class="${layoutClass} role-alert-slot--composer-card${blockerMod}${expandedClass}${classColorClass}${raiderCardMod ? ` ${raiderCardMod}` : ""}"${classColorStyle}${expandAttrs}${attrStr}>
      ${classColorBar || ""}
      <header class="role-alert-composer-card-head" title="${esc(rhTitle)}">
        <div class="role-alert-composer-card-identity">
          ${iconBlock}
          <span class="role-alert-composer-name-block" title="${nameTitle}">
            <span class="role-alert-composer-name"${nameColorStyle || ""}>${esc(disp)}</span>
            ${raiderCardBadge}
          </span>
          <span class="role-alert-composer-expand-hint" aria-hidden="true">${expandHint}</span>
        </div>
      </header>
      ${infoPanel}
    </div>`;
  }

  return `<div class="${layoutClass}"${leftBorder}${attrStr}>
                ${primaryRow}
                <div class="role-alert-slot-row role-alert-slot-row--meta">
                  <span class="role-alert-slot-meta">${esc(slot?.specName || slot?.className || "")}</span>
                  <span class="role-alert-slot-peak-line">
                    ${star}
                    <span class="role-alert-slot-peak leaderboard-peak-parse ${peakTier}" title="${esc(peakTitle)}">${esc(peakTxt)}</span>
                  </span>
                  ${wclEventsSpan}
                  <span class="role-alert-slot-gear-line">${gsBlock}</span>
                  <span class="role-alert-slot-gear-audit">${roleAlertsGearSummaryLineHtml(slot)}</span>
                </div>
              </div>`;
}

function roleAlertsCompBoardHtml(analysis) {
  const board = analysis?.compBoard;
  if (!board || typeof board !== "object") {
    return `<p class="subtle">Comp board not available from Raid-Helper for this event.</p>`;
  }
  roleAlertsPadCompBoardSlots(board);
  const roleCounts = board.roleCounts || {};
  const chips = ROLE_ALERT_ROLES.map(
    (role) => `<span class="role-alert-chip"><strong>${esc(role)}</strong> ${Number(roleCounts[role] || 0)}</span>`
  ).join("");
  const groups = Array.isArray(board.groups) ? board.groups : [];
  const heatStats = collectRoleAlertCompBoardHeatmapStats(groups);
  const wclMeta = analysis?.wclEventsMeta;
  const wclEventsTitleAvail =
    wclMeta?.scope === "curated" && Number(wclMeta?.curatedReportCount || 0) > 0
      ? `Distinct Warcraft Logs guild reports this character appeared in, limited to the ${Number(
          wclMeta.curatedReportCount
        )} report(s) selected in Event Management (matches roster “Events”).`
      : `Distinct Warcraft Logs guild reports this character appeared in among all ${Number(
          wclMeta?.materialisedReportCount || 0
        )} materialised guild reports.`;
  const wclEventsTitleBase = wclMeta?.available
    ? wclEventsTitleAvail
    : "WCL event totals require raid appearance materialisation and synced guild reports.";
  const groupHtml = groups
    .map((group) => {
      const slots = Array.isArray(group?.slots) ? group.slots : [];
      const rows = slots.length
        ? slots
            .map((slot) => {
              if (roleAlertSlotIsEmpty(slot)) {
                return `<div class="role-alert-slot role-alert-slot--comp-empty" title="Empty slot">Empty</div>`;
              }
              const cls = slot?.isBlocker
                ? "role-alert-slot role-alert-slot--blocker"
                : slot?.isKnownSignup
                  ? "role-alert-slot role-alert-slot--known"
                  : "role-alert-slot";
              return roleAlertSlotSurfaceHtml(slot, heatStats, wclMeta, wclEventsTitleBase, { outerClass: cls });
            })
            .join("")
        : `<div class="subtle">No slots</div>`;
      return `<div class="role-alert-group">
        <div class="role-alert-group-title">Group ${Number(group?.groupNumber || 0)}</div>
        <div class="role-alert-group-slots">${rows}</div>
      </div>`;
    })
    .join("");
  return `
    <h4 class="subtle" style="margin: 12px 0 6px">Comp board preview (${esc(board.title || "Raid-Helper")})</h4>
    <p class="subtle" style="margin: 0 0 8px">
      Peaks are from your guild’s recent Warcraft Logs (boss percentiles). Official Event Management reports are preferred;
      <span class="role-alert-slot-peak-star" style="display:inline">*</span> means a higher parse came from another recent guild log outside that selection.
      Other guilds’ public logs are not queried — a dash means we have no matching rank in your guild logs.
      Names show the WCL-linked in-game character when known (Account Assignment); the Raid Helper comp label appears in small italics under the name when it differs.
      Parse and GearScore colors on this board use <strong>roster-relative</strong> heatmaps (min→max among everyone shown); if there is no spread, fixed bands apply for GS.
      <strong>Ev</strong> is distinct guild WCL reports that character has appeared in (same scope as roster “Events”).
    </p>
    <p class="subtle" style="margin: 0 0 8px">${roleAlertsWclEventsFootnoteHtml(analysis)}</p>
    <div class="role-alert-chips">${chips}</div>
    <div class="role-alert-groups">${groupHtml}</div>
  `;
}

function roleAlertsAllSignupsHtml(analysis) {
  const rows = Array.isArray(analysis?.allSignups) ? analysis.allSignups : [];
  const wclMeta = analysis?.wclEventsMeta;
  const STATUS_BUCKET_ORDER = ["primary", "bench", "tentative", "late", "absence"];
  const statusBucketRank = (st) => {
    const key = String(st || "unknown").toLowerCase();
    const i = STATUS_BUCKET_ORDER.indexOf(key);
    if (i >= 0) return i;
    return 100;
  };
  const wclSignupCell = (row) => {
    if (!wclMeta?.available) {
      return `<td class="subtle" title="WCL event totals are not available for this server.">—</td>`;
    }
    const n = row?.wclEventCount;
    if (n == null) {
      return `<td class="subtle" title="Could not map this signup to a roster user (Discord id, Account Assignment, or character name).">—</td>`;
    }
    return `<td>${esc(String(Math.max(0, Math.floor(Number(n)))))}</td>`;
  };
  const signupNameWithWclPrefix = (row) => {
    const name = String(row?.name || "-").trim() || "-";
    const cardBadge = roleAlertsRaiderCardBadgeHtml(row);
    const nameHtml = !wclMeta?.available || row?.wclEventCount == null
      ? esc(name)
      : (() => {
          const n = Math.max(0, Math.floor(Number(row.wclEventCount)));
          return `<span class="role-alert-signup-wcl-prefix" title="Distinct WCL guild reports (see note above)">${esc(
            String(n)
          )}</span> ${esc(name)}`;
        })();
    return `${cardBadge}${cardBadge ? " " : ""}${nameHtml}`;
  };
  if (!rows.length) {
    return `<details class="role-alert-all-signups">
      <summary>All signups by status (0)</summary>
      <p class="subtle">No signup rows on this event payload.</p>
    </details>`;
  }
  const byStatus = new Map();
  for (const row of rows) {
    const st = String(row?.status || "unknown");
    if (!byStatus.has(st)) byStatus.set(st, []);
    byStatus.get(st).push(row);
  }
  const statusOrder = [...byStatus.keys()].sort((a, b) => {
    const da = statusBucketRank(a) - statusBucketRank(b);
    if (da !== 0) return da;
    return a.localeCompare(b);
  });
  const columnHtml = statusOrder
    .map((st) => {
      const list = byStatus.get(st);
      const sorted = [...list].sort((a, b) =>
        String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" })
      );
      const items = sorted
        .map((row) => {
          const sub = [row?.roleName, row?.specName || row?.className]
            .map((x) => String(x || "").trim())
            .filter(Boolean)
            .join(" · ");
          const comp = row?.onComp ? " · on comp" : "";
          const blk = row?.isBlocker ? " · blocker" : "";
          const title = esc(`${sub}${comp}${blk}`.trim() || "Details");
          return `<li class="role-alert-signup-pool-item" title="${title}">
            <span class="role-alert-signup-pool-name">${signupNameWithWclPrefix(row)}</span>
          </li>`;
        })
        .join("");
      return `<div class="role-alert-signup-pool-col">
        <div class="role-alert-signup-pool-col-title">${esc(st)} <span class="subtle">(${list.length})</span></div>
        <ul class="role-alert-signup-pool-list">${items}</ul>
      </div>`;
    })
    .join("");
  const parts = [];
  for (const st of statusOrder) {
    const list = byStatus.get(st);
    const body = list
      .map(
        (row) => `<tr>
          <td>${signupNameWithWclPrefix(row)}</td>
          <td>${esc(String(row?.roleName || "-"))}</td>
          <td>${esc([row?.specName, row?.className].map((x) => String(x || "").trim()).filter(Boolean).join(" · ") || "-")}</td>
          ${wclSignupCell(row)}
          <td>${row?.onComp ? "Yes" : "—"}</td>
          <td>${row?.isBlocker ? "Blocker" : "—"}</td>
          <td class="subtle">${esc(String(row?.userId || "—"))}</td>
        </tr>`
      )
      .join("");
    parts.push(`
      <h5 class="subtle" style="margin:14px 0 6px">${esc(st)} <span class="subtle">(${list.length})</span></h5>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Name</th><th>Role</th><th>Spec / class</th><th>WCL events</th><th>On comp</th><th>Primary note</th><th>Discord user id</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`);
  }
  return `
    <details class="role-alert-all-signups" open>
      <summary>All signups by status (${rows.length})</summary>
      <p class="subtle" style="margin:0 0 6px">${roleAlertsWclEventsFootnoteHtml(analysis)}</p>
      <p class="subtle" style="margin:0 0 8px">Raid Helper–style columns by signup status. Leading numbers are WCL event totals when resolved (same scope as roster “Events”). <strong>On comp</strong> matches signup name to a filled comp slot when a comp was loaded.</p>
      <div class="role-alert-signup-pool">${columnHtml}</div>
      <details class="role-alert-all-signups-table" style="margin-top:10px">
        <summary class="subtle">Full table (sortable columns)</summary>
        <p class="subtle" style="margin:8px 0 10px">DM candidates below use a separate in-guild activity filter.</p>
        ${parts.join("")}
      </details>
    </details>
  `;
}

function roleAlertsDeepCloneJson(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function roleAlertsNormNameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Mirror of server `normalizeRaidHelperDisplayKey` / DB `character_name_key`. */
function roleAlertsRhNameKey(name) {
  let s = String(name || "")
    .trim()
    .replace(/\u00a0/g, " ");
  const slash = s.indexOf("/");
  if (slash > 0) s = s.slice(0, slash).trim();
  return s
    .replace(/\s*[-–—]\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-\s]*$/u, "")
    .toLowerCase();
}

function roleAlertsResolvePhaseAvgs(slot) {
  if (slot?.phaseAvgs && typeof slot.phaseAvgs === "object") return slot.phaseAvgs;
  const map = roleAlertsWclPhaseAvgsByKey || {};
  const names = [slot?.wclPhaseAvgCharacterName, slot?.displayCharacterName, slot?.name];
  for (const n of names) {
    const k = roleAlertsRhNameKey(n);
    if (k && map[k]) return map[k];
  }
  return null;
}

function roleAlertPhaseAvgCellHtml(label, value) {
  const n = Number(value);
  const txt = Number.isFinite(n) && n > 0 ? n.toFixed(1) : "—";
  const tier = Number.isFinite(n) && n > 0 ? roleAlertPeakParseTierClass(n) : "leaderboard-peak-parse--empty";
  const phaseTitle = { K: "Karazhan", G: "Gruul/Mag", S: "SSC/TK" }[label] || label;
  return `<span class="role-alert-slot-phase" title="${esc(phaseTitle)} Best Perf. Avg">
    <span class="role-alert-slot-phase-label">${esc(label)}</span>
    <span class="leaderboard-peak-parse role-alert-slot-phase-val ${tier}">${esc(txt)}</span>
  </span>`;
}

function roleAlertSlotPhaseAvgsHtml(phaseAvgs, { composerPanel = false } = {}) {
  const title =
    "Warcraft Logs Fresh account-wide Best Perf. Avg per phase (from WCL Phase Averages cache). Run Refresh there if stale.";
  const gridClass = composerPanel
    ? "role-alert-composer-phase-grid"
    : "role-alert-slot-phase-avgs";
  const cell = (label, value) =>
    composerPanel
      ? roleAlertComposerPhaseCellHtml(label, value)
      : roleAlertPhaseAvgCellHtml(label, value);
  return `<div class="${gridClass}" aria-label="WCL phase Best Perf. Avg" title="${esc(title)}">
    ${cell("K", phaseAvgs?.kara)}
    ${cell("G", phaseAvgs?.gruulMag)}
    ${cell("S", phaseAvgs?.sscTk)}
  </div>`;
}

/** Raid Helper may send `#rrggbb`, `rrggbb`, or a decimal RGB int. */
function roleAlertNormalizeClassColor(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const n = Math.floor(raw) >>> 0;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  }
  let s = String(raw).trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return roleAlertNormalizeClassColor(Number(s));
  if (/^0x[0-9a-f]{6}$/i.test(s)) s = `#${s.slice(2)}`;
  else if (/^[0-9a-f]{6}$/i.test(s)) s = `#${s}`;
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : "";
}

const ADMIN_SPEC_HINT_CLASS = {
  arms: "Warrior",
  fury: "Warrior",
  holy: "Paladin",
  retribution: "Paladin",
  beastmastery: "Hunter",
  marksmanship: "Hunter",
  survival: "Hunter",
  assassination: "Rogue",
  combat: "Rogue",
  subtlety: "Rogue",
  discipline: "Priest",
  shadow: "Priest",
  elemental: "Shaman",
  enhancement: "Shaman",
  restoration: "Shaman",
  arcane: "Mage",
  fire: "Mage",
  frost: "Mage",
  affliction: "Warlock",
  demonology: "Warlock",
  destruction: "Warlock",
  balance: "Druid",
  feral: "Druid",
  guardian: "Druid",
  bear: "Druid",
};

function roleAlertKnownWowClassLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const skip = new Set(["bench", "tentative", "absence", "late", ""]);
  const slug = adminIdentitySlug(s);
  if (skip.has(slug)) return "";
  const specOnly = new Set([
    "protection",
    "prot",
    "holy",
    "retribution",
    "arms",
    "fury",
    "elemental",
    "enhancement",
    "restoration",
    "discipline",
    "shadow",
    "balance",
    "feral",
  ]);
  if (specOnly.has(slug)) return "";
  const label = adminIdentityClassDisplay(s);
  return ADMIN_WOW_CLASS_COLORS[label] ? label : "";
}

function roleAlertSlotLooksLikePaladin(slot) {
  const fields = [
    slot?.className,
    slot?.raidHelperPatchClassName,
    slot?.specName,
    slot?.roleName,
  ];
  for (const f of fields) {
    if (roleAlertKnownWowClassLabel(f) === "Paladin") return true;
  }
  const blob = fields.map((v) => String(v || "").trim()).join(" ").toLowerCase();
  if (/\bpaladin\b/.test(blob) || /\bpala\b/.test(blob)) return true;
  const classSlug = adminIdentitySlug(slot?.className || "");
  const specSlug = adminIdentitySlug(slot?.specName || "");
  if (
    (classSlug === "protection" || classSlug === "prot" || specSlug === "protection" || specSlug === "prot") &&
    !/\bwarrior\b|\bwar\b/.test(blob)
  ) {
    return true;
  }
  return false;
}

function roleAlertSlotLooksLikeWarrior(slot) {
  const fields = [slot?.className, slot?.raidHelperPatchClassName, slot?.specName, slot?.roleName];
  for (const f of fields) {
    if (roleAlertKnownWowClassLabel(f) === "Warrior") return true;
  }
  const blob = fields.map((v) => String(v || "").trim()).join(" ").toLowerCase();
  return /\bwarrior\b/.test(blob) || /\bwar\b/.test(blob);
}

function roleAlertSpecHintClassLabel(specSlug, slot) {
  if (!specSlug) return "";
  if (specSlug === "protection" || specSlug === "prot") {
    if (roleAlertSlotLooksLikePaladin(slot)) return "Paladin";
    if (roleAlertSlotLooksLikeWarrior(slot)) return "Warrior";
    return "";
  }
  const hinted = ADMIN_SPEC_HINT_CLASS[specSlug];
  return hinted && ADMIN_WOW_CLASS_COLORS[hinted] ? hinted : "";
}

function roleAlertWowClassLabelFromSlot(slot) {
  const classRaw = String(slot?.className || slot?.raidHelperPatchClassName || "").trim();
  const specRaw = String(slot?.specName || "").trim();
  const skip = new Set(["bench", "tentative", "absence", "late", ""]);

  const fromClass = roleAlertKnownWowClassLabel(classRaw);
  if (fromClass) return fromClass;

  const fromSpecClass = roleAlertKnownWowClassLabel(specRaw);
  if (fromSpecClass) return fromSpecClass;

  const classSlug = adminIdentitySlug(classRaw);
  if (classSlug && !skip.has(classSlug)) {
    const display = adminIdentityClassDisplay(classRaw);
    if (ADMIN_WOW_CLASS_COLORS[display]) return display;
  }

  const specSlug = adminIdentitySlug(specRaw);
  const hinted = roleAlertSpecHintClassLabel(specSlug, slot);
  if (hinted) return hinted;

  if (roleAlertSlotLooksLikePaladin(slot)) return "Paladin";
  if (roleAlertSlotLooksLikeWarrior(slot)) return "Warrior";

  return "";
}

function roleAlertReadableClassAccent(hex) {
  const h = String(hex || "").trim().toLowerCase();
  if (h === "#ffffff" || h === "#fff") return "#b8c5d6";
  return String(hex || "").trim();
}

function roleAlertHexToRgb(hex) {
  const h = String(hex || "")
    .trim()
    .replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function roleAlertResolveClassColor(slot) {
  const label = roleAlertWowClassLabelFromSlot(slot);
  if (label && ADMIN_WOW_CLASS_COLORS[label]) return ADMIN_WOW_CLASS_COLORS[label];
  return roleAlertNormalizeClassColor(slot?.color);
}

function roleAlertComposerCardColorAttrs(classColor, wowClassSlug = "") {
  let accent = roleAlertReadableClassAccent(classColor);
  if (!accent && wowClassSlug) accent = roleAlertReadableClassAccent(ADMIN_WOW_CLASS_COLORS_BY_SLUG[wowClassSlug] || "");
  if (!accent) return { classExtra: "", styleExtra: "", barHtml: "", nameStyle: "" };
  const rgb = roleAlertHexToRgb(accent);
  const safe = esc(accent);
  const slugAttr = wowClassSlug ? ` data-wow-class="${esc(wowClassSlug)}"` : "";
  const styleBits = [`--composer-class-accent: ${safe}`];
  if (rgb) {
    const { r, g, b } = rgb;
    styleBits.push(
      `background: linear-gradient(152deg, rgba(${r},${g},${b},0.34) 0%, rgba(${r},${g},${b},0.16) 44%, rgb(10, 9, 18) 100%)`,
      `border-color: rgba(${r},${g},${b},0.62)`,
      `box-shadow: 0 0 0 1px rgba(${r},${g},${b},0.26), 0 4px 14px rgba(${r},${g},${b},0.2)`
    );
  }
  const barGlow = rgb ? ` box-shadow: 0 0 16px rgba(${rgb.r},${rgb.g},${rgb.b},0.5)` : "";
  const nameStyle = ` style="color: ${safe}; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8)"`;
  return {
    classExtra: " role-alert-slot--has-class-color",
    styleExtra: ` style="${styleBits.join("; ")}"${slugAttr}`,
    barHtml: `<div class="role-alert-composer-class-bar" style="background-color: ${safe};${barGlow}" aria-hidden="true"></div>`,
    nameStyle,
  };
}

function roleAlertSlotIsEmpty(slot) {
  if (!slot || slot.isBlocker) return false;
  if (slot.isEmpty === true) return true;
  return !String(slot?.name || "").trim();
}

function roleAlertComposerEmptySlotHtml(slot, group, attrStr = "") {
  const dropAttr = roleAlertsComposerSlotDropAttrs(slot, group);
  const sn = Number(slot?.slotNumber || 0);
  const slotHint = sn > 0 ? `Slot ${sn}` : "Empty slot";
  return `<div class="role-alert-slot role-alert-slot--composer-empty role-alert-composer-slot"${dropAttr}${attrStr} title="${esc(slotHint)} — drop a player here">
      <div class="role-alert-composer-empty-inner">
        <span class="role-alert-composer-empty-icon" aria-hidden="true">+</span>
        <span class="role-alert-composer-empty-label">Drop here</span>
        ${sn > 0 ? `<span class="role-alert-composer-empty-hint">Slot ${esc(String(sn))}</span>` : ""}
      </div>
    </div>`;
}

function roleAlertsBuildCompSlotTemplateIndex(compBoard) {
  /** @type {Map<string, { id: string, rhGroupId: string, groupNumber: number, slotNumber: number }>} */
  const index = new Map();
  if (!compBoard?.groups) return index;
  const slotCount = Math.max(1, Math.floor(Number(compBoard.slotCount || 5)));
  for (const group of compBoard.groups) {
    const gn = Math.max(1, Math.floor(Number(group.groupNumber || 0)));
    const defaultGid = String(group.rhGroupId || group.groupId || gn).trim() || String(gn);
    for (const slot of group.slots || []) {
      const sn = Math.max(1, Math.floor(Number(slot.slotNumber || 0)));
      if (!sn) continue;
      const key = `${gn}:${sn}`;
      const prev = index.get(key);
      const id = String(slot.id || prev?.id || sn).trim() || String(sn);
      const rhGroupId = String(slot.rhGroupId || prev?.rhGroupId || defaultGid).trim() || String(gn);
      index.set(key, { id, rhGroupId, groupNumber: gn, slotNumber: sn });
    }
    for (let sn = 1; sn <= slotCount; sn += 1) {
      const key = `${gn}:${sn}`;
      if (index.has(key)) continue;
      index.set(key, {
        id: String(sn),
        rhGroupId: defaultGid,
        groupNumber: gn,
        slotNumber: sn,
      });
    }
  }
  return index;
}

function roleAlertsMergeCompSlotRhTemplate(index, rhTemplate) {
  if (!index || !Array.isArray(rhTemplate)) return index;
  for (const row of rhTemplate) {
    const gn = Math.max(1, Math.floor(Number(row?.groupNumber || 0)));
    const sn = Math.max(1, Math.floor(Number(row?.slotNumber || 0)));
    if (!sn) continue;
    const key = `${gn}:${sn}`;
    const prev = index.get(key);
    const id = String(row?.id || prev?.id || "").trim();
    const rhGroupId = String(row?.rhGroupId || prev?.rhGroupId || "").trim();
    index.set(key, { id, rhGroupId, groupNumber: gn, slotNumber: sn });
  }
  return index;
}

function roleAlertsResolveCompSlotRhIds(slot, group, templateIndex) {
  const gn = Math.max(1, Math.floor(Number(group?.groupNumber || slot?.groupNumber || 1)));
  const sn = Math.max(1, Math.floor(Number(slot?.slotNumber || 0)));
  const tpl = templateIndex?.get(`${gn}:${sn}`);
  let slotId = String(slot?.id || tpl?.id || "").trim();
  let groupId = String(slot?.rhGroupId || tpl?.rhGroupId || group?.rhGroupId || "").trim();
  if (!groupId && gn > 0) groupId = String(gn);
  if (!slotId && sn > 0) slotId = String(sn);
  return { slotId, groupId, groupNumber: gn, slotNumber: sn };
}

function roleAlertsPadCompBoardSlots(compBoard, templateIndex = roleAlertsCompSlotTemplateIndex) {
  if (!compBoard?.groups) return;
  const slotCount = Math.max(1, Math.floor(Number(compBoard.slotCount || 5)));
  for (const group of compBoard.groups) {
    const gn = Number(group.groupNumber || 0);
    const byNum = new Map();
    for (const slot of group.slots || []) {
      const sn = Math.max(1, Math.min(slotCount, Math.floor(Number(slot.slotNumber || 0)) || byNum.size + 1));
      slot.slotNumber = sn;
      slot.isEmpty = roleAlertSlotIsEmpty(slot);
      byNum.set(sn, slot);
    }
    const defaultGid = String(group.rhGroupId || byNum.get(1)?.rhGroupId || "").trim();
    const padded = [];
    for (let sn = 1; sn <= slotCount; sn += 1) {
      let slot = byNum.get(sn);
      const tpl = templateIndex?.get(`${Math.max(1, gn)}:${sn}`);
      if (!slot) {
        slot = {
          id: String(tpl?.id || "").trim(),
          rhGroupId: String(tpl?.rhGroupId || defaultGid).trim(),
          slotNumber: sn,
          name: "",
          roleName: "Melee",
          className: "",
          specName: "",
          isBlocker: false,
          isKnownSignup: false,
          isEmpty: true,
          color: "",
          isConfirmed: "",
          classEmoteId: "",
          specEmoteId: "",
        };
      }
      if (!String(slot.id || "").trim() && tpl?.id) slot.id = String(tpl.id);
      if (!slot.rhGroupId) slot.rhGroupId = String(tpl?.rhGroupId || defaultGid);
      padded.push(slot);
    }
    group.slots = padded;
  }
}

function roleAlertComposerRoleTagClass(roleName) {
  const r = String(roleName || "").trim();
  if (r === "Tanks") return "role-alert-composer-tag--tank";
  if (r === "Healers") return "role-alert-composer-tag--heal";
  if (r === "Melee") return "role-alert-composer-tag--melee";
  if (r === "Ranged") return "role-alert-composer-tag--ranged";
  return "role-alert-composer-tag--role";
}

function roleAlertComposerShortRole(roleName) {
  const r = String(roleName || "").trim();
  if (r === "Tanks") return "Tank";
  if (r === "Healers") return "Heal";
  if (r === "Melee") return "Melee";
  if (r === "Ranged") return "Ranged";
  return r || "—";
}

function roleAlertComposerPhaseCellHtml(label, value) {
  const n = Number(value);
  const txt = Number.isFinite(n) && n > 0 ? n.toFixed(1) : "—";
  const tier = Number.isFinite(n) && n > 0 ? roleAlertPeakParseTierClass(n) : "leaderboard-peak-parse--empty";
  const phaseTitle = { K: "Karazhan", G: "Gruul/Mag", S: "SSC/TK" }[label] || label;
  return `<div class="role-alert-composer-phase-cell" title="${esc(phaseTitle)} Best Perf. Avg">
    <span class="role-alert-composer-phase-label">${esc(label)}</span>
    <span class="leaderboard-peak-parse role-alert-composer-phase-val ${tier}">${esc(txt)}</span>
  </div>`;
}

function roleAlertComposerInfoCellHtml(label, valueHtml, title = "") {
  return `<div class="role-alert-composer-info-cell"${title ? ` title="${esc(title)}"` : ""}>
    <span class="role-alert-composer-info-label">${esc(label)}</span>
    <span class="role-alert-composer-info-value">${valueHtml}</span>
  </div>`;
}

function roleAlertsCollectGearSummaryNames(analysis) {
  const names = new Set();
  const add = (value) => {
    const s = String(value || "").trim();
    if (s) names.add(s);
  };
  for (const row of Array.isArray(analysis?.allSignups) ? analysis.allSignups : []) {
    add(row?.characterName);
    add(row?.wowCharacterName);
    add(row?.displayName);
    add(row?.name);
    add(row?.rhSignupName);
    add(row?.armoryCharacterName);
  }
  for (const g of analysis?.compBoard?.groups || []) {
    for (const slot of g?.slots || []) {
      add(slot?.characterName);
      add(slot?.wowCharacterName);
      add(slot?.displayName);
      add(slot?.name);
      add(slot?.rhSignupName);
    }
  }
  return [...names];
}

function roleAlertsGearSummaryForSlot(slot) {
  const keys = [
    slot?.characterName,
    slot?.wowCharacterName,
    slot?.displayName,
    slot?.name,
    slot?.rhSignupName,
    slot?.armoryCharacterName,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
  for (const key of keys) {
    if (roleAlertsGearSummaryByKey.has(key)) return roleAlertsGearSummaryByKey.get(key);
  }
  return null;
}

function roleAlertsGearSummaryLineHtml(slot) {
  const summary = roleAlertsGearSummaryForSlot(slot);
  const display = window.plbGearAuditDisplay;
  if (display?.buildGearAuditSummaryHtml) {
    return display.buildGearAuditSummaryHtml(summary, esc);
  }
  return `<span class="gear-audit-compact gear-audit-compact--empty">—</span>`;
}

async function roleAlertsLoadGearSummaries(analysis) {
  const names = roleAlertsCollectGearSummaryNames(analysis);
  if (!names.length) {
    roleAlertsGearSummaryByKey = new Map();
    return;
  }
  try {
    const res = await fetch("/api/classic-armory/gear-summaries", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ names, warmMissing: true, maxWarm: 25 }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${res.status}`);
    const next = new Map();
    const summaries =
      payload?.summaries && typeof payload.summaries === "object" ? payload.summaries : {};
    for (const [key, row] of Object.entries(summaries)) {
      next.set(String(key || "").trim().toLowerCase(), row && typeof row === "object" ? row : null);
    }
    roleAlertsGearSummaryByKey = next;
  } catch (err) {
    console.warn("[role-alerts] gear summaries failed:", err?.message || err);
    roleAlertsGearSummaryByKey = new Map();
  }
}

function roleAlertsSyncRaidComposerDraftFromAnalysis(analysis, { preserveDraft = false } = {}) {
  if (!analysis?.compBoard || !analysis.compUsed) {
    roleAlertsRaidComposerBaseline = null;
    roleAlertsRaidComposerDraft = null;
    roleAlertsCompSlotTemplateIndex = null;
    return;
  }
  const eid = String(analysis?.event?.id || "").trim();
  if (!eid) {
    roleAlertsRaidComposerBaseline = null;
    roleAlertsRaidComposerDraft = null;
    return;
  }
  if (
    preserveDraft &&
    roleAlertsRaidComposerDraft &&
    String(roleAlertsRaidComposerDraft.eventId || "") === eid
  ) {
    return;
  }
  const compId = String(analysis.compBoard.id || eid).trim();
  roleAlertsRaidComposerBaseline = {
    eventId: eid,
    compId,
    compBoard: roleAlertsDeepCloneJson(analysis.compBoard),
    allSignups: roleAlertsDeepCloneJson(Array.isArray(analysis.allSignups) ? analysis.allSignups : []),
  };
  roleAlertsRaidComposerDraft = {
    eventId: eid,
    compId,
    compBoard: roleAlertsDeepCloneJson(analysis.compBoard),
    allSignups: roleAlertsDeepCloneJson(Array.isArray(analysis.allSignups) ? analysis.allSignups : []),
  };
  roleAlertsCompSlotTemplateIndex = roleAlertsMergeCompSlotRhTemplate(
    roleAlertsBuildCompSlotTemplateIndex(analysis.compBoard),
    analysis.compSlotRhTemplate
  );
  roleAlertsPadCompBoardSlots(roleAlertsRaidComposerBaseline.compBoard, roleAlertsCompSlotTemplateIndex);
  roleAlertsPadCompBoardSlots(roleAlertsRaidComposerDraft.compBoard, roleAlertsCompSlotTemplateIndex);
  roleAlertsCompSlotTemplateIndex = roleAlertsMergeCompSlotRhTemplate(
    roleAlertsBuildCompSlotTemplateIndex(roleAlertsRaidComposerBaseline.compBoard),
    analysis.compSlotRhTemplate
  );
  roleAlertsRelinkComposerOccupants(roleAlertsRaidComposerDraft);
  roleAlertsRecomputeComposerOnComp(roleAlertsRaidComposerDraft);
}

function roleAlertsRaidComposerDirtyJson() {
  const b = roleAlertsRaidComposerBaseline;
  const d = roleAlertsRaidComposerDraft;
  if (!b || !d) return false;
  return (
    JSON.stringify({ cb: b.compBoard, su: b.allSignups }) !==
    JSON.stringify({ cb: d.compBoard, su: d.allSignups })
  );
}

function roleAlertsFindSignupRow(draft, signupId) {
  const id = String(signupId || "").trim();
  return (draft?.allSignups || []).find((r) => String(r?.signupId || "") === id) || null;
}

function roleAlertsRelinkComposerOccupants(draft) {
  if (!draft?.compBoard?.groups) return;
  const byKey = new Map();
  for (const row of draft.allSignups || []) {
    const sid = Number(row?.signupId || 0);
    if (!sid) continue;
    const k = roleAlertsNormNameKey(row.name);
    if (k) byKey.set(k, sid);
  }
  /** @type {Map<number, string>} signupId → slot.id (one roster seat per signup) */
  const signupToSlotId = new Map();
  for (const g of draft.compBoard.groups) {
    for (const slot of g.slots || []) {
      const sid = Number(slot._occupantSignupId || 0);
      if (!sid) continue;
      const slotId = String(slot.id || "");
      if (!signupToSlotId.has(sid)) signupToSlotId.set(sid, slotId);
      else roleAlertsReleaseCompSlot(slot);
    }
  }
  for (const g of draft.compBoard.groups) {
    for (const slot of g.slots || []) {
      if (Number(slot._occupantSignupId || 0)) continue;
      const n = String(slot?.name || "").trim();
      if (!n) {
        slot._occupantSignupId = null;
        continue;
      }
      const sid = Number(byKey.get(roleAlertsNormNameKey(n)) || 0) || null;
      if (!sid) {
        slot._occupantSignupId = null;
        continue;
      }
      if (signupToSlotId.has(sid)) {
        roleAlertsReleaseCompSlot(slot);
        continue;
      }
      slot._occupantSignupId = sid;
      signupToSlotId.set(sid, String(slot.id || ""));
    }
  }
}

function roleAlertsCompSlotGroupMatches(group, groupId) {
  const gid = String(groupId || "").trim();
  if (!gid) return true;
  const gnum = String(group.groupNumber ?? "");
  const sg = String(group.rhGroupId || group.groupNumber || "");
  return sg === gid || gnum === gid;
}

function roleAlertsCompSlotIsKeepTarget(slot, group, keepSlotId, keepGroupId, keepSlotNumber) {
  if (!roleAlertsCompSlotGroupMatches(group, keepGroupId)) return false;
  const kid = String(keepSlotId || "").trim();
  const sn = Math.max(0, Math.floor(Number(keepSlotNumber || 0)));
  if (kid && String(slot.id || "") === kid) return true;
  if (sn > 0 && Number(slot.slotNumber || 0) === sn) return true;
  return false;
}

function roleAlertsComposerSlotDropAttrs(slot, group) {
  const gid = esc(String(slot.rhGroupId || group?.groupNumber || "1"));
  const sid = esc(String(slot.id || ""));
  const sn = Math.max(0, Math.floor(Number(slot.slotNumber || 0)));
  return ` data-role-alert-composer-drop="1" data-slot-id="${sid}" data-rh-group-id="${gid}" data-rh-slot-number="${sn}"`;
}

function roleAlertsFindBaselineSlot(slot, baselineBoard) {
  if (!slot || !baselineBoard?.groups) return null;
  const sid = String(slot.id || "").trim();
  const sn = Math.max(0, Math.floor(Number(slot.slotNumber || 0)));
  for (const g of baselineBoard.groups) {
    for (const s of g.slots || []) {
      if (sid && String(s.id || "") === sid) return s;
      if (
        sn > 0 &&
        Number(s.slotNumber || 0) === sn &&
        roleAlertsCompSlotGroupMatches(g, slot.rhGroupId || g.groupNumber)
      ) {
        return s;
      }
    }
  }
  return null;
}

/** Clear a comp slot; restore Raid Helper blocker placeholder when the baseline slot was a blocker. */
function roleAlertsReleaseCompSlot(slot) {
  if (!slot) return;
  const baselineBoard = roleAlertsRaidComposerBaseline?.compBoard;
  const bs = roleAlertsFindBaselineSlot(slot, baselineBoard);
  if (bs?.isBlocker) {
    roleAlertsClearSlotFromBaseline(slot, baselineBoard);
    return;
  }
  roleAlertsEmptyCompSlot(slot);
}

/** Ensure a signup appears on at most one comp slot (clears all other seats). */
function roleAlertsRemoveSignupFromAllCompSlots(
  draft,
  signupId,
  keepSlotId = "",
  keepGroupId = "",
  keepSlotNumber = 0
) {
  const sid = Number(signupId || 0);
  if (!sid || !draft?.compBoard?.groups) return;
  const row = roleAlertsFindSignupRow(draft, sid);
  const nameKey = row ? roleAlertsNormNameKey(row.name) : "";
  for (const g of draft.compBoard.groups) {
    for (const slot of g.slots || []) {
      if (roleAlertsCompSlotIsKeepTarget(slot, g, keepSlotId, keepGroupId, keepSlotNumber)) continue;
      const occ = Number(slot._occupantSignupId || 0);
      const nameMatch = nameKey && roleAlertsNormNameKey(slot.name) === nameKey;
      if (occ === sid || (nameMatch && !roleAlertSlotIsEmpty(slot))) {
        roleAlertsReleaseCompSlot(slot);
      }
    }
  }
}

function roleAlertsRecomputeComposerOnComp(draft) {
  if (!draft?.allSignups) return;
  const keys = new Set();
  for (const g of draft.compBoard.groups || []) {
    for (const s of g.slots || []) {
      const n = String(s.name || "").trim();
      if (n) keys.add(roleAlertsNormNameKey(n));
    }
  }
  for (const row of draft.allSignups) {
    const n = String(row.name || "").trim();
    row.onComp = Boolean(n && keys.has(roleAlertsNormNameKey(n)));
  }
}

function roleAlertsComposerPoolBuckets(draft) {
  const bench = [];
  const absent = [];
  const signedUpNotAssigned = [];
  const other = [];
  for (const row of draft.allSignups || []) {
    const pk = String(row.poolKind || "raiders");
    if (pk === "tentative") {
      if (!row.onComp) other.push(row);
    } else if (pk === "bench") bench.push(row);
    else if (pk === "absent") {
      if (!row.onComp) absent.push(row);
      else other.push(row);
    } else if (pk === "raiders" && String(row.status || "").toLowerCase() === "primary" && !row.onComp) {
      signedUpNotAssigned.push(row);
    } else other.push(row);
  }
  return { bench, absent, raiders: signedUpNotAssigned, other };
}

function roleAlertsComposerWclTitleBase(analysis) {
  const wclMeta = analysis?.wclEventsMeta;
  if (!wclMeta) return "";
  return wclMeta?.scope === "curated" && Number(wclMeta?.curatedReportCount || 0) > 0
    ? `Distinct Warcraft Logs guild reports this character appeared in, limited to the ${Number(
        wclMeta.curatedReportCount
      )} report(s) selected in Event Management (matches roster “Events”).`
    : `Distinct Warcraft Logs guild reports this character appeared in among all ${Number(
        wclMeta?.materialisedReportCount || 0
      )} materialised guild reports.`;
}

function roleAlertsSignupRowAsSlotLike(row) {
  return {
    ...row,
    isBlocker: Boolean(row?.isBlocker),
    isKnownSignup: true,
  };
}

function roleAlertsCopyRowOntoSlot(slot, row) {
  if (!slot || !row) return;
  slot.name = String(row.name || "").trim();
  slot.roleName = String(row.roleName || "").trim();
  slot.className = String(row.raidHelperPatchClassName || row.className || "").trim();
  slot.specName = String(row.specName || "").trim();
  if (row.color != null && String(row.color).trim() !== "") slot.color = row.color;
  else {
    const resolved = roleAlertResolveClassColor(row);
    if (resolved) slot.color = resolved;
  }
  slot.displayCharacterName = String(row.displayCharacterName || row.name || "").trim();
  slot.classEmoteId = String(row.classEmoteId || "").trim();
  slot.specEmoteId = String(row.specEmoteId || "").trim();
  slot.peakParse = row.peakParse;
  slot.peakParseBracket = row.peakParseBracket;
  slot.peakParseSource = row.peakParseSource;
  slot.gearScore = row.gearScore;
  slot.classicArmoryCharacterUrl = row.classicArmoryCharacterUrl;
  slot.wclEventCount = row.wclEventCount;
  slot.raiderCard = row.raiderCard && typeof row.raiderCard === "object" ? { ...row.raiderCard } : null;
  slot._occupantSignupId = Number(row.signupId || 0) || null;
  slot.isKnownSignup = true;
  slot.isEmpty = false;
  slot.isBlocker = false;
  if (!String(slot.id || "").trim() && roleAlertsCompSlotTemplateIndex) {
    const gn = Math.max(1, Math.floor(Number(slot.groupNumber || 0)));
    const sn = Math.max(1, Math.floor(Number(slot.slotNumber || 0)));
    const tpl = roleAlertsCompSlotTemplateIndex.get(`${gn}:${sn}`);
    if (tpl?.id) slot.id = String(tpl.id);
    if (!slot.rhGroupId && tpl?.rhGroupId) slot.rhGroupId = String(tpl.rhGroupId);
  }
}

function roleAlertsClearSlotFromBaseline(slot, baselineBoard) {
  if (!slot) return;
  let bs = null;
  for (const g of baselineBoard?.groups || []) {
    for (const s of g.slots || []) {
      if (String(s.id || "") === String(slot.id || "")) {
        bs = s;
        break;
      }
    }
    if (bs) break;
  }
  if (bs) {
    slot.name = String(bs.name || "").trim();
    slot.roleName = String(bs.roleName || "").trim();
    slot.className = String(bs.className || "").trim();
    slot.specName = String(bs.specName || "").trim();
    slot.color = bs.color;
    slot.displayCharacterName = String(bs.displayCharacterName || bs.name || "").trim();
    slot.classEmoteId = String(bs.classEmoteId || "").trim();
    slot.specEmoteId = String(bs.specEmoteId || "").trim();
    slot.peakParse = bs.peakParse;
    slot.peakParseBracket = bs.peakParseBracket;
    slot.peakParseSource = bs.peakParseSource;
    slot.gearScore = bs.gearScore;
    slot.classicArmoryCharacterUrl = bs.classicArmoryCharacterUrl;
    slot.wclEventCount = bs.wclEventCount;
    slot.raiderCard = bs.raiderCard && typeof bs.raiderCard === "object" ? { ...bs.raiderCard } : null;
    slot.isBlocker = Boolean(bs.isBlocker);
    slot.isKnownSignup = Boolean(bs.isKnownSignup);
    slot.isEmpty = Boolean(bs.isEmpty);
    if (!slot.isBlocker && !String(slot.name || "").trim()) slot.isEmpty = true;
  } else {
    slot.name = "";
    slot.className = "";
    slot.specName = "";
    slot.roleName = slot.roleName || "Melee";
    slot.displayCharacterName = "";
    slot.classEmoteId = "";
    slot.specEmoteId = "";
    slot.peakParse = undefined;
    slot.peakParseBracket = undefined;
    slot.peakParseSource = undefined;
    slot.gearScore = undefined;
    slot.classicArmoryCharacterUrl = "";
    slot.wclEventCount = null;
    slot.raiderCard = null;
  }
  slot._occupantSignupId = null;
  slot.isEmpty = true;
}

/** Clear a comp slot so the player no longer appears on the raid roster grid. */
function roleAlertsEmptyCompSlot(slot) {
  if (!slot) return;
  slot.name = "";
  slot.className = "";
  slot.specName = "";
  slot.roleName = slot.roleName || "Melee";
  slot.displayCharacterName = "";
  slot.classEmoteId = "";
  slot.specEmoteId = "";
  slot.peakParse = undefined;
  slot.peakParseBracket = undefined;
  slot.peakParseSource = undefined;
  slot.gearScore = undefined;
  slot.classicArmoryCharacterUrl = "";
  slot.wclEventCount = null;
  slot._occupantSignupId = null;
  slot.isKnownSignup = false;
  slot.isBlocker = false;
  slot.isEmpty = true;
}

function roleAlertsRemoveSignupFromRosterGrid(draft, signupId) {
  roleAlertsRemoveSignupFromAllCompSlots(draft, signupId);
}

function roleAlertsSetSignupPoolExclusion(row, rhClassLabel) {
  const label = String(rhClassLabel || "").trim();
  row.rhSignupClassRaw = label;
  if (label === "Bench") row.poolKind = "bench";
  else if (label === "Tentative") row.poolKind = "tentative";
  else if (label === "Absence" || label === "Late") row.poolKind = "absent";
  else {
    row.poolKind = "raiders";
  }
  row.className = label ? englishWowClassDisplayFromRaidHelperClient(label) : String(row.raidHelperPatchClassName || row.className || "").trim();
}

/** Client-side mirror of server `englishWowClassDisplayFromRaidHelper` tokens we need for Bench/Tentative labels. */
function englishWowClassDisplayFromRaidHelperClient(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low === "bench" || low === "tentative" || low === "absence" || low === "late") {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  return s;
}

function roleAlertsRestoreSignupToPrimaryRoster(row) {
  const playable = String(row.raidHelperPatchClassName || "").trim();
  row.rhSignupClassRaw = playable;
  row.status = "primary";
  row.poolKind = "raiders";
  row.className = playable || String(row.className || "").trim();
}

function roleAlertsComposerSlotOccupied(slot) {
  if (!slot || roleAlertSlotIsEmpty(slot)) return false;
  return Boolean(String(slot?.displayCharacterName || slot?.name || "").trim());
}

function roleAlertsComposerSlotHasCharacter(slot) {
  return roleAlertsComposerSlotOccupied(slot) && !slot?.isBlocker;
}

function roleAlertsSetComposerViewMode(mode) {
  const next = mode === "detailed" ? "detailed" : "executive";
  roleAlertsComposerViewModeState = next;
  if (next === "executive") roleAlertsComposerExpandedIds.clear();
  try {
    sessionStorage.setItem(ROLE_ALERTS_COMPOSER_VIEW_STORAGE, next);
  } catch {
    /* ignore */
  }
  void roleAlertsRefreshRaidComposerDom();
}

/** Expand or collapse every executive composer card (Detailed = all open). */
function roleAlertsComposerApplyViewModeExpansions() {
  const root = document.getElementById("roleAlertsRaidComposerRoot");
  if (!root) return;
  const openAll = roleAlertsComposerViewModeState === "detailed";
  root.querySelectorAll("[data-role-alert-composer-expand]").forEach((card) => {
    roleAlertsComposerSetCardExpanded(card, openAll);
  });
}

function roleAlertsFindRosterPlayerForSlot(slot, rosterPlayers) {
  const names = [
    String(slot?.displayCharacterName || "").trim(),
    String(slot?.name || "").trim(),
  ].filter(Boolean);
  if (!names.length || !Array.isArray(rosterPlayers)) return null;
  const keys = new Set(names.map((n) => roleAlertsRhNameKey(n)).filter(Boolean));
  for (const p of rosterPlayers) {
    const candidates = [
      String(p?.characterName || "").trim(),
      String(p?.name || "").trim(),
      String(p?.rioProfileLookupName || "").trim(),
      ...(Array.isArray(p?.wclCharacters) ? p.wclCharacters : []).map((v) => String(v || "").trim()),
    ].filter(Boolean);
    for (const c of candidates) {
      const k = roleAlertsRhNameKey(c);
      if (k && keys.has(k)) return p;
    }
  }
  return null;
}

function roleAlertsSlotToRosterPlayer(slot, rosterPlayers) {
  const base = roleAlertsFindRosterPlayerForSlot(slot, rosterPlayers);
  const disp = String(slot?.displayCharacterName || slot?.name || "").trim();
  const gs = Number(slot?.gearScore);
  const phaseAvgs = roleAlertsResolvePhaseAvgs(slot);
  const wclPhaseAvgCharacterName = String(slot?.wclPhaseAvgCharacterName || "").trim();
  const resolvedClassLabel =
    roleAlertWowClassLabelFromSlot(slot) ||
    roleAlertKnownWowClassLabel(slot?.className) ||
    String(slot?.className || base?.className || "").trim();
  const patch = {
    characterName: disp || String(base?.characterName || "").trim(),
    name: String(slot?.name || "").trim() || String(base?.name || "").trim() || disp,
    className: resolvedClassLabel,
    specName: String(slot?.specName || base?.specName || "").trim(),
    roleName: String(slot?.roleName || base?.roleName || "").trim(),
    gearScore: Number.isFinite(gs) && gs > 0 ? gs : base?.gearScore,
    wclEventCount: slot?.wclEventCount != null ? slot.wclEventCount : base?.wclEventCount,
    phaseAvgs: phaseAvgs || base?.phaseAvgs,
    wclPhaseAvgCharacterName: wclPhaseAvgCharacterName || base?.wclPhaseAvgCharacterName || "",
    classEmoteId: slot?.classEmoteId || base?.classEmoteId,
    specEmoteId: slot?.specEmoteId || base?.specEmoteId,
    color: slot?.color || base?.color,
  };
  return base ? { ...base, ...patch } : patch;
}

async function roleAlertsEnsureComposerRosterPlayers() {
  if (Array.isArray(roleAlertsComposerRosterPlayers)) return roleAlertsComposerRosterPlayers;
  if (roleAlertsComposerRosterLoadPromise) return roleAlertsComposerRosterLoadPromise;
  const plb = window.plbEventsRoster;
  if (!plb) {
    roleAlertsComposerRosterPlayers = [];
    return roleAlertsComposerRosterPlayers;
  }
  roleAlertsComposerRosterLoadPromise = (async () => {
    try {
      await Promise.all([plb.loadTbcSpecIconMap(), plb.loadWclAttendanceForEvents()]);
      const gid = plb.EVENTS_WCL_GUILD_ID;
      const res = await fetch(`/api/wcl/guild/${gid}/active-roster?limit=40&top=250`, {
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      const players = Array.isArray(payload.players) ? payload.players : [];
      for (const p of players) {
        const avgs = roleAlertsResolvePhaseAvgs({
          displayCharacterName: p.characterName,
          name: p.name,
        });
        if (avgs) p.phaseAvgs = avgs;
      }
      await plb.loadRosterGearSummaries?.(players, { warmMissing: true });
      roleAlertsComposerRosterPlayers = players;
      return players;
    } catch {
      roleAlertsComposerRosterPlayers = [];
      return [];
    } finally {
      roleAlertsComposerRosterLoadPromise = null;
    }
  })();
  return roleAlertsComposerRosterLoadPromise;
}

function roleAlertsComposerWowClassSlug(slot, player) {
  const label = roleAlertWowClassLabelFromSlot(slot);
  if (label && ADMIN_WOW_CLASS_COLORS[label]) return adminIdentitySlug(label);
  const cn = String(slot?.className || player?.className || "").trim();
  if (!cn) return "";
  const display = adminIdentityClassDisplay(cn) || cn;
  const slug = adminIdentitySlug(display);
  return slug && ADMIN_WOW_CLASS_COLORS_BY_SLUG[slug] ? slug : "";
}

function roleAlertsComposerClassAccent(slot, player, wowClassSlug) {
  const fromResolve = roleAlertResolveClassColor(slot);
  const fromSlot = roleAlertNormalizeClassColor(slot?.color);
  const fromSlug =
    wowClassSlug && ADMIN_WOW_CLASS_COLORS_BY_SLUG[wowClassSlug]
      ? ADMIN_WOW_CLASS_COLORS_BY_SLUG[wowClassSlug]
      : "";
  const plb = window.plbEventsRoster;
  let fromPlb = "";
  if (plb?.wowClassColor) {
    const label = roleAlertWowClassLabelFromSlot(slot) || String(slot?.className || player?.className || "").trim();
    const raw = plb.wowClassColor(label);
    if (raw && /^#[0-9a-f]{6}$/i.test(String(raw).trim())) fromPlb = raw;
  }
  return roleAlertReadableClassAccent(fromResolve || fromSlot || fromSlug || fromPlb);
}

function roleAlertsComposerDetailedCardHtml(slot, heatStats, wclMeta, wclTitleBase, surface) {
  const plb = window.plbEventsRoster;
  if (!plb?.rosterRaiderCard) {
    return roleAlertSlotSurfaceHtml(slot, heatStats, wclMeta, wclTitleBase, {
      ...surface,
      compactLayout: true,
      showPhaseAvgs: true,
    });
  }
  const roster = roleAlertsComposerRosterPlayers || [];
  const player = roleAlertsSlotToRosterPlayer(slot, roster);
  const wowClassSlug = roleAlertsComposerWowClassSlug(slot, player);
  const classAccent = roleAlertsComposerClassAccent(slot, player, wowClassSlug);
  const cardHtml = plb.rosterRaiderCard(player, roster, {
    kpiMode: "full",
    showGearSummary: false,
    showBadges: false,
    composerDetailed: true,
    nameOnTop: true,
    wowClassSlug,
    classAccentHex: classAccent,
    gsHeatMin: heatStats.gsMin,
    gsHeatMax: heatStats.gsMax,
  });
  const raiderCardMod = roleAlertsRaiderCardModifier(slot);
  const rootAttrs = String(surface?.rootAttrs || "").trim();
  const { barHtml: classColorBar } = roleAlertComposerCardColorAttrs(classAccent, wowClassSlug);
  const slugAttr = wowClassSlug ? ` data-wow-class="${esc(wowClassSlug)}"` : "";
  const accentVar = classAccent ? ` style="--composer-class-accent: ${esc(classAccent)}"` : "";
  const blockerMod = slot?.isBlocker ? " role-alert-composer-detailed-wrap--blocker" : "";
  const wrapClass = `role-alert-composer-detailed-wrap${blockerMod}${raiderCardMod ? ` ${raiderCardMod}` : ""}`;
  return `<div class="${wrapClass}" data-role-alert-composer-detailed="1"${slugAttr}${accentVar}${rootAttrs ? ` ${rootAttrs}` : ""}>${classColorBar}${cardHtml}</div>`;
}

function roleAlertsComposerCardFaceHtml(slot, heatStats, wclMeta, wclTitleBase, surface) {
  const occupied = roleAlertsComposerSlotOccupied(slot);
  const isDetailed = roleAlertsComposerViewModeState === "detailed";
  if (isDetailed && occupied && window.plbEventsRoster?.rosterRaiderCard) {
    return roleAlertsComposerDetailedCardHtml(slot, heatStats, wclMeta, wclTitleBase, surface);
  }
  return roleAlertSlotSurfaceHtml(slot, heatStats, wclMeta, wclTitleBase, {
    ...surface,
    compactLayout: true,
    showPhaseAvgs: !slot?.isBlocker,
    forceExpanded: isDetailed && occupied,
  });
}

function roleAlertsRaidComposerSlotRowHtml(slot, group, heatStats, wclMeta, wclTitleBase) {
  if (roleAlertSlotIsEmpty(slot)) {
    return `<div class="role-alert-composer-slot-shell role-alert-composer-slot-shell--empty">${roleAlertComposerEmptySlotHtml(
      slot,
      group,
      ` data-role-alert-composer-slot-wrap="1"`
    )}</div>`;
  }
  const cls = slot?.isBlocker
    ? "role-alert-slot role-alert-slot--blocker role-alert-slot--blocker-replaceable role-alert-composer-slot"
    : slot?.isKnownSignup
      ? "role-alert-slot role-alert-slot--known role-alert-composer-slot"
      : "role-alert-slot role-alert-composer-slot";
  const gid = esc(String(slot.rhGroupId || group.groupNumber || "1"));
  const sid = esc(String(slot.id || ""));
  const sn = Math.max(0, Math.floor(Number(slot.slotNumber || 0)));
  const occ = Number(slot._occupantSignupId || 0);
  const dragAttr =
    occ && !slot?.isBlocker
      ? ` draggable="true" data-role-alert-composer-drag="1" data-role-alert-composer-source="slot" data-signup-id="${esc(
          String(occ)
        )}" data-slot-id="${sid}" data-rh-group-id="${gid}" data-rh-slot-number="${sn}"`
      : "";
  const dropAttr = roleAlertsComposerSlotDropAttrs(slot, group);
  const blockerHint = slot?.isBlocker
    ? ` title="${esc("Drop a player here to replace this placeholder (e.g. " + String(slot.name || "blocker") + ")")}"`
    : "";
  const dblAttr =
    occ && !slot?.isBlocker
      ? ` data-role-alert-composer-dbl="1" data-signup-id="${esc(String(occ))}" title="Double-click to remove from roster"`
      : "";
  const face = roleAlertsComposerCardFaceHtml(slot, heatStats, wclMeta, wclTitleBase, {
    outerClass: cls,
    rootAttrs: `data-role-alert-composer-slot-wrap="1"${dropAttr}${dragAttr}${dblAttr}${blockerHint}`,
  });
  return `<div class="role-alert-composer-slot-shell">${face}</div>`;
}

function roleAlertsRaidComposerRosterGridHtml(draft, analysis, heatStats, wclMeta, wclTitleBase) {
  const board = draft.compBoard;
  roleAlertsPadCompBoardSlots(board);
  const roleCounts = board.roleCounts || {};
  const chips = ROLE_ALERT_ROLES.map(
    (role) => `<span class="role-alert-chip"><strong>${esc(role)}</strong> ${Number(roleCounts[role] || 0)}</span>`
  ).join("");
  const groups = Array.isArray(board.groups) ? board.groups : [];
  const groupHtml = groups
    .map((group) => {
      const slots = Array.isArray(group?.slots) ? group.slots : [];
      const rows = slots.length
        ? slots.map((slot) => roleAlertsRaidComposerSlotRowHtml(slot, group, heatStats, wclMeta, wclTitleBase)).join("")
        : `<div class="subtle">No slots</div>`;
      return `<div class="role-alert-group">
        <div class="role-alert-group-title">Group ${Number(group?.groupNumber || 0)}</div>
        <div class="role-alert-group-slots">${rows}</div>
      </div>`;
    })
    .join("");
  return `
    <div class="role-alert-composer-roster">
      <p class="subtle" style="margin:0 0 6px">${roleAlertsWclEventsFootnoteHtml(analysis)}</p>
      <div class="role-alert-chips">${chips}</div>
      <div class="role-alert-groups">${groupHtml}</div>
    </div>`;
}

function roleAlertsRaidComposerPoolStripHtml(title, poolKey, rows, analysis, heatStats, wclMeta, wclTitleBase) {
  const cards = (rows || [])
    .map((row) => {
      const sid = esc(String(row.signupId || ""));
      const slotLike = roleAlertsSignupRowAsSlotLike(row);
      const face = roleAlertsComposerCardFaceHtml(slotLike, heatStats, wclMeta, wclTitleBase, {
        outerClass: "role-alert-slot role-alert-slot--known role-alert-composer-pool-card",
        rootAttrs: `draggable="true" data-role-alert-composer-drag="1" data-role-alert-composer-dbl="1" data-role-alert-composer-source="pool" data-signup-id="${sid}" data-pool="${esc(
          poolKey
        )}" title="Double-click to add to first open roster slot"`,
      });
      return `<div class="role-alert-composer-pool-card-wrap">${face}</div>`;
    })
    .join("");
  return `<div class="role-alert-composer-pool">
    <div class="role-alert-composer-pool-title">${esc(title)} <span class="subtle">(${rows.length})</span></div>
    <div class="role-alert-composer-pool-cards" data-role-alert-composer-drop="1" data-pool="${esc(poolKey)}">${
      cards || `<span class="subtle">Drop here</span>`
    }</div>
  </div>`;
}

function roleAlertsRaidComposerPoolsAndRosterInnerHtml(analysis) {
  const d = roleAlertsRaidComposerDraft;
  if (!d || !analysis) return "";
  const buckets = roleAlertsComposerPoolBuckets(d);
  const poolExtras = [...buckets.bench, ...buckets.absent, ...buckets.raiders, ...buckets.other];
  const heatStats = collectRoleAlertComposerHeatmapStats(d.compBoard.groups, poolExtras);
  const wclMeta = analysis.wclEventsMeta;
  const wclTitleBase = roleAlertsComposerWclTitleBase(analysis);
  const roster = roleAlertsRaidComposerRosterGridHtml(d, analysis, heatStats, wclMeta, wclTitleBase);
  const bench = roleAlertsRaidComposerPoolStripHtml("Bench", "bench", buckets.bench, analysis, heatStats, wclMeta, wclTitleBase);
  const signedUp = roleAlertsRaidComposerPoolStripHtml(
    "Signed up, not assigned",
    "signedUp",
    buckets.raiders,
    analysis,
    heatStats,
    wclMeta,
    wclTitleBase
  );
  const absence = roleAlertsRaidComposerPoolStripHtml(
    "Absence · not on roster",
    "absent",
    buckets.absent,
    analysis,
    heatStats,
    wclMeta,
    wclTitleBase
  );
  const other =
    buckets.other.length > 0
      ? roleAlertsRaidComposerPoolStripHtml("Other statuses", "other", buckets.other, analysis, heatStats, wclMeta, wclTitleBase)
      : "";
  return `
    ${roster}
    <div class="role-alert-composer-pools">
      ${bench}${signedUp}${absence}${other}
    </div>`;
}

function roleAlertsDebuffAssignmentsCategoryLabel(cat) {
  const map = { armor: "Armor reduction", spell: "Spell damage", attack: "Attack speed / AP" };
  return map[String(cat || "").trim()] || String(cat || "Other");
}

function roleAlertsRenderDebuffAssignmentsHtml(payload) {
  if (!payload || !payload.assignments) {
    return `<p class="subtle role-alert-debuff-assign-empty">Analyze a raid with a comp board to see debuff responsibilities.</p>`;
  }
  const gaps = Array.isArray(payload.gaps) ? payload.gaps : [];
  const rows = Array.isArray(payload.assignments) ? payload.assignments : [];
  const byCat = new Map();
  for (const row of rows) {
    const cat = String(row.category || "other");
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(row);
  }
  const catOrder = ["armor", "spell", "attack"];
  const sections = [];
  for (const cat of catOrder) {
    const list = byCat.get(cat);
    if (!list?.length) continue;
    const body = list
      .map((row) => {
        const primary = row.primary;
        const backups = Array.isArray(row.backups) ? row.backups : [];
        const who = primary
          ? `<strong>${esc(primary.label)}</strong>${primary.groupTag ? ` <span class="role-alert-debuff-assign-grp">${esc(primary.groupTag)}</span>` : ""}<span class="subtle"> · ${esc(primary.meta)}</span>`
          : `<span class="role-alert-debuff-assign-missing">No match on roster</span>`;
        const backupTxt =
          backups.length > 0
            ? `<div class="role-alert-debuff-assign-backups subtle">Backup: ${backups
                .map(
                  (b) =>
                    `${esc(b.label)}${b.groupTag ? ` (${esc(b.groupTag)})` : ""} · ${esc(b.meta)}`
                )
                .join(" · ")}</div>`
            : "";
        const orNote = row.orGroupLabel
          ? `<span class="role-alert-debuff-assign-or subtle"> · ${esc(row.orGroupLabel)}</span>`
          : row.orNote
            ? `<span class="role-alert-debuff-assign-or subtle"> · ${esc(row.orNote)}</span>`
            : "";
        const roleNote = row.roleNote
          ? `<div class="role-alert-debuff-assign-note subtle">${esc(row.roleNote)}</div>`
          : "";
        return `<tr>
          <td>${esc(row.name)}${orNote}</td>
          <td class="subtle">${esc(row.appliedBy || "—")}</td>
          <td>${who}${backupTxt}${roleNote}</td>
        </tr>`;
      })
      .join("");
    sections.push(`<section class="role-alert-debuff-assign-cat">
      <h5 class="role-alert-debuff-assign-cat-title">${esc(roleAlertsDebuffAssignmentsCategoryLabel(cat))}</h5>
      <div class="admin-table-wrap">
        <table class="admin-table role-alert-debuff-assign-table">
          <thead><tr><th>Debuff</th><th>Class</th><th>Responsible raider</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`);
  }
  const gapHtml =
    gaps.length > 0
      ? `<p class="subtle role-alert-debuff-assign-gaps"><strong>${gaps.length}</strong> debuff(s) have no suitable raider on this comp — assign a bench alt or adjust the comp.</p>`
      : "";
  return `<p class="subtle" style="margin:0 0 10px">
    Suggested uptime owners from the current <strong>Raid Helper comp</strong> (${Number(payload.raiderCount) || 0} raiders).
    Either/or groups pick one primary (e.g. Expose over Sunder when a Combat Rogue is present).
  </p>${gapHtml}${sections.join("")}`;
}

function roleAlertsDebuffAssignmentsSectionHtml() {
  const inner = roleAlertsRenderDebuffAssignmentsHtml(roleAlertsDebuffAssignmentsState);
  return `<details class="role-alert-debuff-assign-panel card" open>
    <summary class="role-alert-debuff-assign-summary">Boss debuff uptime — roster responsibilities</summary>
    <div id="roleAlertsDebuffAssignmentsHost" class="role-alert-debuff-assign-host">${inner}</div>
  </details>`;
}

async function roleAlertsRefreshDebuffAssignmentsFromDraft() {
  const host = document.getElementById("roleAlertsDebuffAssignmentsHost");
  const draft = roleAlertsRaidComposerDraft;
  if (!host || !draft?.compBoard?.groups) {
    roleAlertsDebuffAssignmentsState = null;
    return;
  }
  const seq = ++roleAlertsDebuffAssignmentsFetchSeq;
  host.innerHTML = `<p class="subtle">Updating debuff assignments…</p>`;
  try {
    const res = await fetch("/api/admin/role-alerts/debuff-assignments", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compBoard: draft.compBoard }),
    });
    const payload = await res.json().catch(() => ({}));
    if (seq !== roleAlertsDebuffAssignmentsFetchSeq) return;
    if (!res.ok || !payload?.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    roleAlertsDebuffAssignmentsState = payload.debuffAssignments;
    host.innerHTML = roleAlertsRenderDebuffAssignmentsHtml(roleAlertsDebuffAssignmentsState);
  } catch (err) {
    if (seq !== roleAlertsDebuffAssignmentsFetchSeq) return;
    host.innerHTML = `<p class="subtle">Debuff assignments unavailable: ${esc(err?.message || err)}</p>`;
  }
}

function roleAlertsRaidComposerSectionHtml(analysis) {
  if (!analysis?.compUsed || !analysis?.compBoard) {
    return `${roleAlertsCompBoardHtml(analysis)}${roleAlertsAllSignupsHtml(analysis)}`;
  }
  if (!roleAlertsRaidComposerDraft) {
    return `<p class="subtle">Composer unavailable.</p>${roleAlertsAllSignupsHtml(analysis)}`;
  }
  const dirty = roleAlertsRaidComposerDirtyJson();
  const inner = roleAlertsRaidComposerPoolsAndRosterInnerHtml(analysis);
  const viewMode = roleAlertsComposerViewModeState;
  const execActive = viewMode === "executive" ? " is-active" : "";
  const detailActive = viewMode === "detailed" ? " is-active" : "";
  const viewClass =
    viewMode === "detailed" ? " role-alert-raid-composer--detailed" : " role-alert-raid-composer--executive";
  return `
    <div class="role-alert-raid-composer${viewClass}" id="roleAlertsRaidComposerRoot">
      <div class="role-alert-composer-toolbar">
        <h4 class="subtle" style="margin:0">Raid roster composer</h4>
        <div class="role-alert-composer-toolbar-actions">
          <div class="role-alert-composer-view-toggle" role="group" aria-label="Roster card view">
            <button type="button" class="event-signup-btn event-signup-btn--softres role-alert-composer-view-btn${execActive}" data-composer-view="executive" title="Compact cards with Parse, Events, and GS">Executive</button>
            <button type="button" class="event-signup-btn event-signup-btn--softres role-alert-composer-view-btn${detailActive}" data-composer-view="detailed" title="Full raid roster character cards with attendance, parse, gear, and badges">Detailed</button>
          </div>
          <button type="button" class="event-signup-btn" id="roleAlertsRaidComposerWriteBtn" ${dirty ? "" : "disabled"}>Write back to Raid Helper</button>
          <button type="button" class="event-signup-btn event-signup-btn--softres" id="roleAlertsRaidComposerResetBtn">Reset draft</button>
          <span id="roleAlertsRaidComposerDirtyBadge" class="subtle">${dirty ? "Unsaved changes" : ""}</span>
        </div>
      </div>
      <p class="subtle" style="margin:4px 0 8px">
        Drag cards between the comp grid and pools. Changes stay in this browser until you write them to Raid Helper (requires <code>RAID_HELPER_API_KEY</code> on the server).${!Number(roleAlertsWclPhaseAvgsUpdatedAt) ? ' <span class="role-alert-composer-wcl-phase-hint">WCL phase averages not cached — refresh in Data &amp; Ops → WCL Phase Averages.</span>' : ""}
      </p>
      <p class="subtle role-alert-raider-card-legend" style="margin:0 0 8px">
        ${raiderBlacklistCardPillHtml("yellow")} warning · ${raiderBlacklistCardPillHtml("black")} out (from People → Raider Blacklist). Hover a pill for the reason.
      </p>
      <div id="roleAlertsRaidComposerInner">${inner}</div>
    </div>
    <details class="role-alert-all-signups" style="margin-top:12px">
      <summary>Legacy signup tables</summary>
      ${roleAlertsAllSignupsHtml(analysis)}
    </details>`;
}

function roleAlertsComposerAfterDomRefresh(container) {
  const root = document.getElementById("roleAlertsRaidComposerRoot");
  if (root) {
    root.classList.toggle("role-alert-raid-composer--detailed", roleAlertsComposerViewModeState === "detailed");
    root.classList.toggle("role-alert-raid-composer--executive", roleAlertsComposerViewModeState === "executive");
  }
  document.querySelectorAll("[data-composer-view]").forEach((btn) => {
    const mode = String(btn.getAttribute("data-composer-view") || "");
    btn.classList.toggle("is-active", mode === roleAlertsComposerViewModeState);
    btn.setAttribute("aria-pressed", mode === roleAlertsComposerViewModeState ? "true" : "false");
  });
  const plb = window.plbEventsRoster;
  if (roleAlertsComposerViewModeState === "detailed" && container && plb) {
    const players = roleAlertsComposerRosterPlayers || [];
    void plb.prefetchRosterProfilePictures?.(players);
    window.WowItemTooltip?.bindLootTooltipHandlers?.(container, () => null);
  }
}

async function roleAlertsRefreshRaidComposerDom() {
  const inner = document.getElementById("roleAlertsRaidComposerInner");
  const root = document.getElementById("roleAlertsRaidComposerRoot");
  if (!inner || !roleAlertsAnalysisState || !roleAlertsRaidComposerDraft) return;
  if (roleAlertsComposerViewModeState === "detailed") {
    inner.innerHTML = `<p class="subtle" style="margin:12px 0">Loading detailed cards…</p>`;
    await roleAlertsEnsureComposerRosterPlayers();
  }
  inner.innerHTML = roleAlertsRaidComposerPoolsAndRosterInnerHtml(roleAlertsAnalysisState);
  if (root) {
    root.classList.toggle("role-alert-raid-composer--detailed", roleAlertsComposerViewModeState === "detailed");
    root.classList.toggle("role-alert-raid-composer--executive", roleAlertsComposerViewModeState === "executive");
  }
  roleAlertsComposerAfterDomRefresh(inner);
  roleAlertsComposerApplyViewModeExpansions();
  void roleAlertsRefreshDebuffAssignmentsFromDraft();
  const writeBtn = document.getElementById("roleAlertsRaidComposerWriteBtn");
  const badge = document.getElementById("roleAlertsRaidComposerDirtyBadge");
  const dirty = roleAlertsRaidComposerDirtyJson();
  if (writeBtn) writeBtn.disabled = !dirty;
  if (badge) badge.textContent = dirty ? "Unsaved changes" : "";
}

function roleAlertsResetRaidComposerDraft() {
  const b = roleAlertsRaidComposerBaseline;
  if (!b) return;
  roleAlertsRaidComposerDraft = {
    eventId: b.eventId,
    compId: b.compId,
    compBoard: roleAlertsDeepCloneJson(b.compBoard),
    allSignups: roleAlertsDeepCloneJson(b.allSignups),
  };
  roleAlertsRelinkComposerOccupants(roleAlertsRaidComposerDraft);
  roleAlertsRecomputeComposerOnComp(roleAlertsRaidComposerDraft);
  roleAlertsRefreshRaidComposerDom();
}

function roleAlertsFindSlotByIds(draft, groupId, slotId, slotNumber = 0) {
  if (!draft?.compBoard?.groups) return null;
  const sid = String(slotId || "").trim();
  const sn = Math.max(0, Math.floor(Number(slotNumber || 0)));
  if (sid) {
    for (const g of draft.compBoard.groups) {
      if (!roleAlertsCompSlotGroupMatches(g, groupId)) continue;
      for (const slot of g.slots || []) {
        if (String(slot.id || "") === sid) return { group: g, slot };
      }
    }
  }
  if (sn > 0) {
    for (const g of draft.compBoard.groups) {
      if (!roleAlertsCompSlotGroupMatches(g, groupId)) continue;
      for (const slot of g.slots || []) {
        if (Number(slot.slotNumber || 0) === sn) return { group: g, slot };
      }
    }
  }
  return null;
}

function roleAlertsFindSlotBySignupId(draft, signupId) {
  const id = Number(signupId || 0);
  if (!id) return null;
  for (const g of draft.compBoard.groups || []) {
    for (const slot of g.slots || []) {
      if (Number(slot._occupantSignupId || 0) === id) return { group: g, slot };
    }
  }
  return null;
}

function roleAlertsRaidHelperClassForSignupPatch(row) {
  const raw = String(row.rhSignupClassRaw || "").trim();
  if (raw === "Bench" || raw === "Tentative" || raw === "Absence" || raw === "Late") return raw;
  return String(row.raidHelperPatchClassName || row.className || "").trim();
}

function roleAlertsBuildApplyRaidHelperDraftPayload() {
  const b = roleAlertsRaidComposerBaseline;
  const d = roleAlertsRaidComposerDraft;
  if (!b || !d) return null;
  const eventId = d.eventId;
  const compId = d.compId;
  const signupPatches = [];
  const basSignupById = new Map((b.allSignups || []).map((r) => [String(r.signupId), r]));
  for (const row of d.allSignups || []) {
    const id = String(row.signupId || "");
    const bas = basSignupById.get(id);
    if (!bas || !id) continue;
    const changed =
      String(row.rhSignupClassRaw || "") !== String(bas.rhSignupClassRaw || "") ||
      String(row.status || "") !== String(bas.status || "");
    if (!changed) continue;
    const body = {
      userId: String(row.userId || "").trim(),
      name: String(row.name || "").trim(),
      specName: String(row.specName || "").trim(),
      roleName: String(row.roleName || "").trim(),
      status: String(row.status || "primary"),
      className: roleAlertsRaidHelperClassForSignupPatch(row),
    };
    signupPatches.push({ signupId: id, body });
  }
  const slotPatches = [];
  const templateIndex =
    roleAlertsCompSlotTemplateIndex || roleAlertsBuildCompSlotTemplateIndex(b.compBoard);
  const basSlotById = new Map();
  const basSlotByPos = new Map();
  for (const g of b.compBoard.groups || []) {
    for (const s of g.slots || []) {
      const pos = roleAlertsResolveCompSlotRhIds(s, g, templateIndex);
      if (String(s.id || "")) basSlotById.set(String(s.id), { group: g, slot: s });
      basSlotByPos.set(`${pos.groupNumber}:${pos.slotNumber}`, { group: g, slot: s });
    }
  }
  for (const g of d.compBoard.groups || []) {
    for (const slot of g.slots || []) {
      const resolved = roleAlertsResolveCompSlotRhIds(slot, g, templateIndex);
      const bsWrap =
        (resolved.slotId && basSlotById.get(resolved.slotId)) ||
        basSlotByPos.get(`${resolved.groupNumber}:${resolved.slotNumber}`);
      if (!bsWrap) continue;
      const bs = bsWrap.slot;
      const draftClass = String(slot.className || "").trim();
      const baseClass = String(bs.className || "").trim();
      const changed =
        String(slot.name || "") !== String(bs.name || "") ||
        draftClass !== baseClass ||
        String(slot.specName || "") !== String(bs.specName || "") ||
        String(slot.roleName || "") !== String(bs.roleName || "");
      if (!changed) continue;
      const occ = Number(slot._occupantSignupId || 0);
      const occRow = occ ? roleAlertsFindSignupRow(d, occ) : null;
      const body = {
        name: String(slot.name || "").trim(),
        className: draftClass,
        specName: String(slot.specName || "").trim(),
        roleName: String(slot.roleName || "").trim(),
        groupNumber: resolved.groupNumber,
        slotNumber: resolved.slotNumber,
      };
      if (occRow?.classEmoteId) body.classEmoteId = String(occRow.classEmoteId);
      if (occRow?.specEmoteId) body.specEmoteId = String(occRow.specEmoteId);
      slotPatches.push({
        groupId: resolved.groupId || undefined,
        slotId: resolved.slotId || undefined,
        body,
      });
    }
  }
  return { eventId, compId, signupPatches, slotPatches };
}

async function roleAlertsApplyRaidHelperDraft(btn) {
  const payload = roleAlertsBuildApplyRaidHelperDraftPayload();
  if (!payload || (!payload.signupPatches.length && !payload.slotPatches.length)) {
    status("No Raid Helper changes to apply.");
    return;
  }
  const b = btn || document.getElementById("roleAlertsRaidComposerWriteBtn");
  try {
    if (b) {
      b.disabled = true;
      setButtonFeedback(b, "Writing…", "loading");
    }
    const res = await fetch("/api/admin/role-alerts/apply-raid-helper-draft", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: payload.eventId,
        compId: payload.compId,
        signupPatches: payload.signupPatches,
        slotPatches: payload.slotPatches,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (b) {
      resetButtonFeedback(b, "Write back to Raid Helper");
      b.disabled = false;
    }
    if (!body.ok) {
      const parts = (Array.isArray(body.errors) ? body.errors : [])
        .map((e) => `${e.step || "?"}: ${e.error || "?"}`)
        .join(" · ");
      const ap = body.applied || {};
      const appliedN = Number(ap.slotPatches || 0) + Number(ap.signupPatches || 0);
      if (body.partial && appliedN > 0) {
        status(
          `Raid Helper partially updated (${Number(ap.slotPatches || 0)} slot(s), ${Number(ap.signupPatches || 0)} signup(s)). ${parts || ""}`
        );
        await runRoleAlertsAnalyzeFromSelect({ silent: true });
        return;
      }
      status(parts || body.error || `Raid Helper apply failed (${res.status})`);
      return;
    }
    const ap = body.applied || {};
    status(
      `Raid Helper updated (${Number(ap.slotPatches || 0)} roster slot(s), ${Number(ap.signupPatches || 0)} signup(s)); syncing…`
    );
    await runRoleAlertsAnalyzeFromSelect({ silent: true });
  } catch (error) {
    if (b) {
      resetButtonFeedback(b, "Write back to Raid Helper");
      b.disabled = false;
    }
    status(error?.message || "Raid Helper writeback failed");
  }
}

function roleAlertsFindFirstEmptyCompSlot(draft) {
  for (const g of draft?.compBoard?.groups || []) {
    for (const slot of g.slots || []) {
      if (!slot?.isBlocker && roleAlertSlotIsEmpty(slot)) return { group: g, slot };
    }
  }
  return null;
}

function roleAlertsComposerRemoveSignupFromRoster(draft, signupId) {
  const sid = Number(signupId || 0);
  if (!sid || !draft) return false;
  roleAlertsRemoveSignupFromAllCompSlots(draft, sid);
  const row = roleAlertsFindSignupRow(draft, sid);
  if (row) roleAlertsRestoreSignupToPrimaryRoster(row);
  roleAlertsRelinkComposerOccupants(draft);
  roleAlertsRecomputeComposerOnComp(draft);
  return true;
}

function roleAlertsComposerPlaceSignupOnRoster(draft, signupId) {
  const sid = Number(signupId || 0);
  if (!sid || !draft) return false;
  if (roleAlertsFindSlotBySignupId(draft, sid)) return false;
  const empty = roleAlertsFindFirstEmptyCompSlot(draft);
  if (!empty?.slot) return false;
  const row = roleAlertsFindSignupRow(draft, sid);
  if (!row) return false;
  const slotId = String(empty.slot.id || "").trim();
  const groupId = String(empty.slot.rhGroupId || empty.group?.groupNumber || "1").trim();
  const slotNumber = Number(empty.slot.slotNumber || 0);
  const poolKey = row.poolKind === "bench" ? "bench" : "signedUp";
  roleAlertsComposerHandleDropOnSlot(
    draft,
    { signupId: sid, from: { type: "pool", pool: poolKey } },
    groupId,
    slotId,
    slotNumber
  );
  return true;
}

function roleAlertsComposerToggleSignupOnRoster(draft, signupId) {
  const sid = Number(signupId || 0);
  if (!sid) return false;
  if (roleAlertsFindSlotBySignupId(draft, sid)) return roleAlertsComposerRemoveSignupFromRoster(draft, sid);
  return roleAlertsComposerPlaceSignupOnRoster(draft, sid);
}

function roleAlertsComposerHandleDropOnSlot(draft, payload, groupId, slotId, slotNumber = 0) {
  const hit = roleAlertsFindSlotByIds(draft, groupId, slotId, slotNumber);
  if (!hit) return;
  const row = roleAlertsFindSignupRow(draft, payload.signupId);
  if (!row) return;
  const srcFrom = payload.from || {};
  const targetSlotId = String(hit.slot.id || "").trim();
  const targetGroupId = String(hit.slot.rhGroupId || hit.group?.groupNumber || groupId || "").trim();
  const targetSlotNumber = Number(hit.slot.slotNumber || 0);
  if (
    srcFrom.type === "slot" &&
    roleAlertsCompSlotIsKeepTarget(hit.slot, hit.group, srcFrom.slotId, srcFrom.groupId, srcFrom.slotNumber)
  ) {
    return;
  }
  const prevOcc = Number(hit.slot._occupantSignupId || 0);
  roleAlertsRemoveSignupFromAllCompSlots(
    draft,
    row.signupId,
    targetSlotId,
    targetGroupId,
    targetSlotNumber
  );
  if (srcFrom.type === "slot" && srcFrom.groupId) {
    const srcHit = roleAlertsFindSlotByIds(
      draft,
      srcFrom.groupId,
      srcFrom.slotId,
      srcFrom.slotNumber
    );
    if (
      srcHit &&
      !roleAlertsCompSlotIsKeepTarget(srcHit.slot, srcHit.group, targetSlotId, targetGroupId, targetSlotNumber)
    ) {
      roleAlertsReleaseCompSlot(srcHit.slot);
    }
  }
  if (prevOcc && prevOcc !== Number(row.signupId)) {
    const prevRow = roleAlertsFindSignupRow(draft, prevOcc);
    if (prevRow) roleAlertsSetSignupPoolExclusion(prevRow, "Bench");
  }
  roleAlertsCopyRowOntoSlot(hit.slot, row);
  roleAlertsRestoreSignupToPrimaryRoster(row);
  roleAlertsRelinkComposerOccupants(draft);
  roleAlertsRecomputeComposerOnComp(draft);
}

function roleAlertsComposerHandleDropOnPool(draft, payload, poolKey) {
  const row = roleAlertsFindSignupRow(draft, payload.signupId);
  if (!row) return;
  const srcFrom = payload.from || {};
  const leaveRoster = poolKey === "bench" || poolKey === "absent";
  roleAlertsRemoveSignupFromAllCompSlots(draft, row.signupId);
  if (srcFrom.type === "slot" && srcFrom.groupId) {
    const srcHit = roleAlertsFindSlotByIds(
      draft,
      srcFrom.groupId,
      srcFrom.slotId,
      srcFrom.slotNumber
    );
    if (srcHit) roleAlertsReleaseCompSlot(srcHit.slot);
  }
  if (poolKey === "bench") roleAlertsSetSignupPoolExclusion(row, "Bench");
  else if (poolKey === "absent") roleAlertsSetSignupPoolExclusion(row, "Absence");
  else if (poolKey === "signedUp" || poolKey === "raiders") roleAlertsRestoreSignupToPrimaryRoster(row);
  if (leaveRoster) roleAlertsRemoveSignupFromRosterGrid(draft, row.signupId);
  roleAlertsRelinkComposerOccupants(draft);
  roleAlertsRecomputeComposerOnComp(draft);
}

document.addEventListener("click", (event) => {
  const writeBtn = event.target.closest("#roleAlertsRaidComposerWriteBtn");
  if (writeBtn) {
    event.preventDefault();
    void roleAlertsApplyRaidHelperDraft(writeBtn);
    return;
  }
  const resetBtn = event.target.closest("#roleAlertsRaidComposerResetBtn");
  if (resetBtn) {
    roleAlertsResetRaidComposerDraft();
    return;
  }
});

document.addEventListener("dragstart", (event) => {
  const el = event.target.closest("[data-role-alert-composer-drag]");
  if (!el || !event.target.closest("#roleAlertsRaidComposerRoot")) return;
  const signupId = String(el.getAttribute("data-signup-id") || "").trim();
  if (!signupId) return;
  const source = String(el.getAttribute("data-role-alert-composer-source") || "").trim();
  const from =
    source === "slot"
      ? {
          type: "slot",
          groupId: String(el.getAttribute("data-rh-group-id") || "").trim(),
          slotId: String(el.getAttribute("data-slot-id") || "").trim(),
          slotNumber: Number(el.getAttribute("data-rh-slot-number") || 0),
        }
      : { type: "pool", pool: String(el.getAttribute("data-pool") || "").trim() };
  const payload = { signupId: Number(signupId), from };
  const raw = JSON.stringify(payload);
  try {
    event.dataTransfer.setData(ROLE_ALERTS_COMPOSER_DRAG_MIME, raw);
    event.dataTransfer.setData("text/plain", raw);
    event.dataTransfer.effectAllowed = "move";
  } catch {
    /* ignore */
  }
});

document.addEventListener("dragover", (event) => {
  const drop = event.target.closest("[data-role-alert-composer-drop]");
  if (!drop || !event.target.closest("#roleAlertsRaidComposerRoot")) return;
  event.preventDefault();
  if (roleAlertsComposerDropHighlightEl !== drop) {
    roleAlertsComposerClearDropHighlight();
    drop.classList.add("is-composer-drop-over");
    roleAlertsComposerDropHighlightEl = drop;
  }
  try {
    event.dataTransfer.dropEffect = "move";
  } catch {
    /* ignore */
  }
});

document.addEventListener("drop", (event) => {
  const drop = event.target.closest("[data-role-alert-composer-drop]");
  if (!drop || !event.target.closest("#roleAlertsRaidComposerRoot")) return;
  event.preventDefault();
  roleAlertsComposerClearDropHighlight();
  let raw = event.dataTransfer.getData(ROLE_ALERTS_COMPOSER_DRAG_MIME);
  if (!raw) raw = event.dataTransfer.getData("text/plain");
  if (!raw || !roleAlertsRaidComposerDraft) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (!payload?.signupId) return;
  const draft = roleAlertsRaidComposerDraft;
  if (drop.hasAttribute("data-role-alert-composer-drop") && drop.hasAttribute("data-rh-group-id")) {
    const slotId = String(drop.getAttribute("data-slot-id") || "").trim();
    const groupId = String(drop.getAttribute("data-rh-group-id") || "").trim();
    const slotNumber = Number(drop.getAttribute("data-rh-slot-number") || 0);
    roleAlertsComposerHandleDropOnSlot(draft, payload, groupId, slotId, slotNumber);
  } else if (drop.hasAttribute("data-pool")) {
    const poolKey = String(drop.getAttribute("data-pool") || "").trim();
    roleAlertsComposerHandleDropOnPool(draft, payload, poolKey);
  }
  roleAlertsRefreshRaidComposerDom();
});

document.addEventListener("dragend", () => {
  roleAlertsComposerClearDropHighlight();
});

document.addEventListener("click", (event) => {
  const root = event.target.closest("#roleAlertsRaidComposerRoot");
  if (!root) return;
  const viewBtn = event.target.closest("[data-composer-view]");
  if (viewBtn && root.contains(viewBtn)) {
    event.preventDefault();
    roleAlertsSetComposerViewMode(viewBtn.getAttribute("data-composer-view"));
    return;
  }
  if (roleAlertsComposerViewModeState === "detailed") return;
  const card = event.target.closest("[data-role-alert-composer-expand]");
  if (!card || !root.contains(card)) return;
  if (event.target.closest("a")) return;
  clearTimeout(roleAlertsComposerExpandClickTimer);
  roleAlertsComposerExpandClickTimer = setTimeout(() => {
    roleAlertsComposerSetCardExpanded(card, !card.classList.contains("is-composer-expanded"));
  }, 220);
});

document.addEventListener("dblclick", (event) => {
  clearTimeout(roleAlertsComposerExpandClickTimer);
  if (!event.target.closest("#roleAlertsRaidComposerRoot")) return;
  const el = event.target.closest("[data-role-alert-composer-dbl]");
  if (!el) return;
  const signupId = Number(el.getAttribute("data-signup-id") || 0);
  if (!signupId || !roleAlertsRaidComposerDraft) return;
  event.preventDefault();
  if (roleAlertsComposerToggleSignupOnRoster(roleAlertsRaidComposerDraft, signupId)) {
    roleAlertsRefreshRaidComposerDom();
  }
});

function roleAlertsLfmNeedsText(analysis) {
  const blockerRows = Array.isArray(analysis?.blockerRows) ? analysis.blockerRows : [];
  const bySpecClass = new Map();
  for (const row of blockerRows) {
    const spec = String(row?.specName || "").trim();
    const cls = String(row?.className || "").trim();
    if (!spec) continue;
    const label = cls && !spec.toLowerCase().includes(cls.toLowerCase()) ? `${spec} ${cls}` : spec;
    bySpecClass.set(label, Number(bySpecClass.get(label) || 0) + 1);
  }
  if (bySpecClass.size) {
    const entries = [...bySpecClass.entries()]
      .map(([label, count]) => ({ label, count: Math.max(1, Math.floor(Number(count || 1))) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const maxNeeds = 3;
    const shown = entries.slice(0, maxNeeds);
    const hidden = Math.max(0, entries.length - shown.length);
    const text = shown.map((e) => (e.count > 1 ? `${e.label} x${e.count}` : e.label)).join(" & ");
    return hidden > 0 ? `${text} +${hidden} more` : text;
  }

  const byRole =
    analysis?.blockerSpecNeedsByRole && typeof analysis.blockerSpecNeedsByRole === "object"
      ? analysis.blockerSpecNeedsByRole
      : {};
  const parts = [];
  for (const role of ROLE_ALERT_ROLES) {
    const specMap = byRole?.[role] && typeof byRole[role] === "object" ? byRole[role] : {};
    for (const [spec, n] of Object.entries(specMap)) {
      const count = Math.max(0, Math.floor(Number(n || 0)));
      if (!spec || count <= 0) continue;
      parts.push(count > 1 ? `${spec} x${count}` : spec);
    }
  }
  if (parts.length) return parts.join(" & ");
  const missing = analysis?.missingByRole && typeof analysis.missingByRole === "object" ? analysis.missingByRole : {};
  const roleParts = ROLE_ALERT_ROLES.filter((r) => Number(missing[r] || 0) > 0).map((r) => `${Number(missing[r] || 0)} ${r}`);
  return roleParts.length ? roleParts.join(" & ") : "Raiders";
}

function roleAlertsLfmMessageText(analysis) {
  const eventTitle = String(analysis?.event?.title || "Raid Event").trim();
  const startSec = Number(analysis?.event?.startTime || 0);
  const dt = startSec > 0 ? new Date(startSec * 1000) : null;
  const hh = dt && !Number.isNaN(dt.getTime()) ? String(dt.getHours()).padStart(2, "0") : "--";
  const dd = dt && !Number.isNaN(dt.getTime()) ? String(dt.getDate()).padStart(2, "0") : "--";
  const mm = dt && !Number.isNaN(dt.getTime()) ? String(dt.getMonth() + 1).padStart(2, "0") : "--";
  const needsText = roleAlertsLfmNeedsText(analysis);
  return `<PUG Life Balance> ${eventTitle} - ${hh}PM ${dd}.${mm}. - LFM ${needsText}, 2SR, No HR <https://discord.gg/QgBNZEtHa>`;
}

function roleAlertsLfmMessageHtml(analysis) {
  const msg = roleAlertsLfmMessageText(analysis);
  return `
    <h4 class="subtle" style="margin: 12px 0 6px">Thunderstrike LFM message</h4>
    <textarea id="roleAlertsLfmMessage" class="admin-textarea admin-textarea--lfm" rows="2">${esc(msg)}</textarea>
    <div class="admin-actions admin-actions--tight">
      <button type="button" class="event-signup-btn event-signup-btn--softres" id="roleAlertsCopyLfmBtn">Copy message</button>
    </div>
  `;
}

function roleAlertsCandidatesHtml(analysis) {
  const rowsRaw = Array.isArray(analysis?.candidateTargets) ? analysis.candidateTargets : [];
  if (!rowsRaw.length) {
    return `<h4 class="subtle" style="margin: 12px 0 6px">Matching past raiders</h4><p class="subtle">No matching past raiders found for current required roles/specs.</p>`;
  }
  const normalized = rowsRaw.map((row) => {
    const raidRole = String(row?.guildRole || "Peon");
    return {
      ...row,
      raidRole,
      subscribedLabel: row?.subscribed ? "Yes" : "No",
      dmSentLabel: row?.dmSentForEvent ? "Yes" : "No",
    };
  });
  const filterText = (value, needle) => String(value || "").toLowerCase().includes(String(needle || "").toLowerCase());
  const f = roleAlertsCandidateFilterState || {};
  const filtered = normalized.filter((row) => {
    if (f.displayName && !filterText(row.displayName || row.userId, f.displayName)) return false;
    if (f.recentClass && !filterText(row.recentClass || "-", f.recentClass)) return false;
    if (f.recentSpec && !filterText(row.recentSpec || "-", f.recentSpec)) return false;
    if (f.raidRole && !filterText(row.raidRole || "-", f.raidRole)) return false;
    if (f.matchedSpecs && !filterText((row?.matchedSpecs || []).join(", "), f.matchedSpecs)) return false;
    if (f.subscribed && String(row.subscribedLabel || "").toLowerCase() !== String(f.subscribed || "").toLowerCase()) return false;
    if (f.dmSent && String(row.dmSentLabel || "").toLowerCase() !== String(f.dmSent || "").toLowerCase()) return false;
    return true;
  });
  const sortKey = String(roleAlertsCandidateSortState?.key || "displayName");
  const sortDir = roleAlertsCandidateSortState?.dir === "desc" ? -1 : 1;
  const candidateWclSortVal = (row) => {
    if (!analysis?.wclEventsMeta?.available) return sortDir === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const v = row?.wclEventCount;
    if (v == null) return sortDir === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    return Number(v);
  };
  const sorted = [...filtered].sort((a, b) => {
    const aSelected = roleAlertsSelectedUserIds.has(String(a?.userId || "").trim()) ? 1 : 0;
    const bSelected = roleAlertsSelectedUserIds.has(String(b?.userId || "").trim()) ? 1 : 0;
    if (aSelected !== bSelected) return bSelected - aSelected;
    const av =
      sortKey === "pastRaids"
        ? Number(a?.raidsSeen || 0)
        : sortKey === "wclEvents"
          ? candidateWclSortVal(a)
          : String(
              sortKey === "subscribed"
                ? a?.subscribedLabel || ""
                : sortKey === "dmSent"
                  ? a?.dmSentLabel || ""
                  : sortKey === "matchedSpecs"
                    ? (a?.matchedSpecs || []).join(", ")
                    : a?.[sortKey] || ""
            ).toLowerCase();
    const bv =
      sortKey === "pastRaids"
        ? Number(b?.raidsSeen || 0)
        : sortKey === "wclEvents"
          ? candidateWclSortVal(b)
          : String(
              sortKey === "subscribed"
                ? b?.subscribedLabel || ""
                : sortKey === "dmSent"
                  ? b?.dmSentLabel || ""
                  : sortKey === "matchedSpecs"
                    ? (b?.matchedSpecs || []).join(", ")
                    : b?.[sortKey] || ""
            ).toLowerCase();
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return String(a?.displayName || "").localeCompare(String(b?.displayName || "")) * sortDir;
  });
  const sortIndicator = (key) =>
    roleAlertsCandidateSortState?.key === key ? (roleAlertsCandidateSortState?.dir === "desc" ? " ▼" : " ▲") : "";
  const table = sorted
    .map((row) => {
      const uid = String(row?.userId || "");
      const checked = roleAlertsSelectedUserIds.has(uid) ? " checked" : "";
      return `<tr>
        <td><input type="checkbox" data-role-alert-target-user-id="${esc(uid)}"${checked} /></td>
        <td>${roleAlertsRaiderCardBadgeHtml(row) || `<span class="subtle">—</span>`} ${esc(row?.displayName || uid)}</td>
        <td>${esc(String(row?.recentClass || "-"))}</td>
        <td>${esc(String(row?.recentSpec || "-"))}</td>
        <td>${esc(String(row?.raidRole || "-"))}</td>
        <td>${esc((row?.matchedSpecs || []).join(", ") || "-")}</td>
        <td>${esc(row?.subscribedLabel || "No")}</td>
        <td>${esc(row?.dmSentLabel || "No")}</td>
        <td>${
          !analysis?.wclEventsMeta?.available
            ? `<span class="subtle" title="WCL event totals are not available for this server.">—</span>`
            : row?.wclEventCount == null
              ? `<span class="subtle" title="No roster identity for this Discord user.">—</span>`
              : esc(String(Math.max(0, Math.floor(Number(row.wclEventCount)))))
        }</td>
        <td>${Number(row?.raidsSeen || 0)}</td>
      </tr>`;
    })
    .join("");
  return `
    <h4 class="subtle" style="margin: 12px 0 6px">Matching past raiders</h4>
    <p class="subtle">Candidates are filtered to users still in Discord server. "Subscribed" is shown as a marker only. ${roleAlertsWclEventsFootnoteHtml(
      analysis
    )}</p>
    <p class="subtle">Shown: ${filtered.length} / ${rowsRaw.length}</p>
    <div class="admin-actions admin-actions--tight">
      <button type="button" class="event-signup-btn event-signup-btn--softres" id="roleAlertsMarkAllBtn">Mark all</button>
      <button type="button" class="event-signup-btn event-signup-btn--softres" id="roleAlertsDeselectAllBtn">Deselect all</button>
      <button type="button" class="event-signup-btn" data-role-alert-send>Send DM to selected raiders</button>
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>DM</th>
            <th><button type="button" class="admin-table-sort-btn" data-role-alert-sort="displayName">Raider${sortIndicator("displayName")}</button></th>
            <th><button type="button" class="admin-table-sort-btn" data-role-alert-sort="recentClass">Class${sortIndicator("recentClass")}</button></th>
            <th><button type="button" class="admin-table-sort-btn" data-role-alert-sort="recentSpec">Spec${sortIndicator("recentSpec")}</button></th>
            <th><button type="button" class="admin-table-sort-btn" data-role-alert-sort="raidRole">Raid Role${sortIndicator("raidRole")}</button></th>
            <th><button type="button" class="admin-table-sort-btn" data-role-alert-sort="matchedSpecs">Matched specs${sortIndicator("matchedSpecs")}</button></th>
            <th><button type="button" class="admin-table-sort-btn" data-role-alert-sort="subscribed">Subscribed${sortIndicator("subscribed")}</button></th>
            <th><button type="button" class="admin-table-sort-btn" data-role-alert-sort="dmSent">DM sent${sortIndicator("dmSent")}</button></th>
            <th><button type="button" class="admin-table-sort-btn" data-role-alert-sort="wclEvents">WCL events${sortIndicator(
              "wclEvents"
            )}</button></th>
            <th><button type="button" class="admin-table-sort-btn" data-role-alert-sort="pastRaids">Past raids${sortIndicator("pastRaids")}</button></th>
          </tr>
          <tr>
            <th></th>
            <th><input class="admin-input" data-role-alert-filter="displayName" value="${esc(f.displayName || "")}" placeholder="Filter raider" /></th>
            <th><input class="admin-input" data-role-alert-filter="recentClass" value="${esc(f.recentClass || "")}" placeholder="Filter class" /></th>
            <th><input class="admin-input" data-role-alert-filter="recentSpec" value="${esc(f.recentSpec || "")}" placeholder="Filter spec" /></th>
            <th><input class="admin-input" data-role-alert-filter="raidRole" value="${esc(f.raidRole || "")}" placeholder="Filter role" /></th>
            <th><input class="admin-input" data-role-alert-filter="matchedSpecs" value="${esc(f.matchedSpecs || "")}" placeholder="Filter matched spec" /></th>
            <th>
              <select class="admin-input" data-role-alert-filter="subscribed">
                <option value=""${!f.subscribed ? " selected" : ""}>All</option>
                <option value="yes"${String(f.subscribed || "").toLowerCase() === "yes" ? " selected" : ""}>Yes</option>
                <option value="no"${String(f.subscribed || "").toLowerCase() === "no" ? " selected" : ""}>No</option>
              </select>
            </th>
            <th>
              <select class="admin-input" data-role-alert-filter="dmSent">
                <option value=""${!f.dmSent ? " selected" : ""}>All</option>
                <option value="yes"${String(f.dmSent || "").toLowerCase() === "yes" ? " selected" : ""}>Yes</option>
                <option value="no"${String(f.dmSent || "").toLowerCase() === "no" ? " selected" : ""}>No</option>
              </select>
            </th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>${table}</tbody>
      </table>
    </div>
  `;
}

function roleAlertsDisplayNameForUserId(userId) {
  const uid = String(userId || "").trim();
  const row = (Array.isArray(roleAlertsAnalysisState?.candidateTargets) ? roleAlertsAnalysisState.candidateTargets : []).find(
    (candidate) => String(candidate?.userId || "").trim() === uid
  );
  return String(row?.displayName || uid || "-");
}

function roleAlertsDmSendResultHtml() {
  const result = roleAlertsLastSendResult;
  if (!result || typeof result !== "object") return "";
  const delivered = Array.isArray(result.delivered) ? result.delivered : [];
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const rowHtml = (row, statusLabel) => {
    const name = String(row?.displayName || roleAlertsDisplayNameForUserId(row?.userId));
    const matchedRoles = Array.isArray(row?.matchedRoles) ? row.matchedRoles.join(", ") : "";
    return `<tr>
      <td>${esc(statusLabel)}</td>
      <td>${esc(name)}</td>
      <td>${esc(matchedRoles || "-")}</td>
      <td>${esc(row?.reason || "-")}</td>
    </tr>`;
  };
  const deliveredRows = delivered.map((row) => rowHtml(row, "Delivered")).join("");
  const skippedRows = skipped.map((row) => rowHtml(row, "Skipped")).join("");
  const emptyRows =
    deliveredRows || skippedRows
      ? ""
      : `<tr><td colspan="4" class="subtle">No send results returned.</td></tr>`;
  return `
    <h4 class="subtle" style="margin: 12px 0 6px">DM send results</h4>
    <p class="subtle">Delivered: ${Number(result.deliveredCount || delivered.length || 0)} · Skipped: ${Number(
      result.skippedCount || skipped.length || 0
    )}</p>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Status</th><th>Raider</th><th>Matched roles</th><th>Reason</th></tr></thead>
        <tbody>${deliveredRows}${skippedRows}${emptyRows}</tbody>
      </table>
    </div>
  `;
}

function renderRoleAlertsAnalysis(analysis, options = {}) {
  roleAlertsAnalysisState = analysis && typeof analysis === "object" ? analysis : null;
  roleAlertsWclPhaseAvgsByKey =
    roleAlertsAnalysisState?.wclPhaseAvgs?.byRhKey && typeof roleAlertsAnalysisState.wclPhaseAvgs.byRhKey === "object"
      ? roleAlertsAnalysisState.wclPhaseAvgs.byRhKey
      : {};
  roleAlertsWclPhaseAvgsUpdatedAt = Number(roleAlertsAnalysisState?.wclPhaseAvgs?.updatedAt || 0);
  roleAlertsDebuffAssignmentsState = roleAlertsAnalysisState?.debuffAssignments || null;
  if (!roleAlertsAnalysisState) {
    roleAlertsRaidComposerBaseline = null;
    roleAlertsRaidComposerDraft = null;
    roleAlertsWclPhaseAvgsByKey = {};
    roleAlertsWclPhaseAvgsUpdatedAt = 0;
    roleAlertsDebuffAssignmentsState = null;
  } else {
    const candidateIds = new Set(
      (Array.isArray(roleAlertsAnalysisState.candidateTargets) ? roleAlertsAnalysisState.candidateTargets : [])
        .map((row) => String(row?.userId || "").trim())
        .filter(Boolean)
    );
    if (roleAlertsSelectedUserIds.size) {
      roleAlertsSelectedUserIds = new Set([...roleAlertsSelectedUserIds].filter((id) => candidateIds.has(id)));
    } else {
      roleAlertsSelectedUserIds = new Set();
    }
    roleAlertsSyncRaidComposerDraftFromAnalysis(roleAlertsAnalysisState, {
      preserveDraft: Boolean(options.preserveComposerDraft),
    });
  }
  const host = document.getElementById("roleAlertsHost");
  if (!host) return;
  if (!roleAlertsAnalysisState) {
    host.innerHTML = "Choose a raid event above to load the roster.";
    return;
  }
  host.innerHTML = `
    <p class="subtle">
      <strong>${esc(roleAlertsAnalysisState?.event?.title || "Event")}</strong> · ${esc(
        fmtTs(roleAlertsAnalysisState?.event?.startTime)
      )} · Signups: ${Number(roleAlertsAnalysisState?.signups?.total || 0)} total / ${Number(
        roleAlertsAnalysisState?.signups?.primary || 0
      )} primary / ${Number(roleAlertsAnalysisState?.signups?.blockers || 0)} blockers
    </p>
    ${roleAlertsRaidComposerSectionHtml(roleAlertsAnalysisState)}
    ${analysis?.compUsed && analysis?.compBoard ? roleAlertsDebuffAssignmentsSectionHtml() : ""}
    ${roleAlertsCompositionRowsHtml(roleAlertsAnalysisState)}
    ${roleAlertsLfmMessageHtml(roleAlertsAnalysisState)}
    ${roleAlertsCandidatesHtml(roleAlertsAnalysisState)}
    ${roleAlertsDmSendResultHtml()}
  `;
  void roleAlertsRefreshRaidComposerDom();
  void roleAlertsRefreshDebuffAssignmentsFromDraft();
  void roleAlertsLoadGearSummaries(roleAlertsAnalysisState).then(() => {
    if (roleAlertsAnalysisState === analysis) roleAlertsRefreshRaidComposerDom();
  });
}

function customDmReadTargetRoles() {
  return ROLE_ALERT_ROLES.filter((role) => customDmRoleTargets.has(role));
}

function customDmFilteredRows() {
  const rows = Array.isArray(customDmCandidatesState) ? customDmCandidatesState : [];
  const f = customDmFilterState || {};
  const has = (v, q) => String(v || "").toLowerCase().includes(String(q || "").toLowerCase());
  return rows.filter((row) => {
    if (f.displayName && !has(row.displayName || row.userId, f.displayName)) return false;
    if (f.guildRole && !has(row.guildRole || "-", f.guildRole)) return false;
    if (f.recentClass && !has(row.recentClass || "-", f.recentClass)) return false;
    if (f.recentSpec && !has(row.recentSpec || "-", f.recentSpec)) return false;
    if (f.subscribed) {
      const sub = row.subscribed ? "yes" : "no";
      if (sub !== String(f.subscribed || "").toLowerCase()) return false;
    }
    return true;
  });
}

function renderCustomDmPanel() {
  const host = document.getElementById("customDmHost");
  if (!host) return;
  const rows = customDmFilteredRows();
  const all = Array.isArray(customDmCandidatesState) ? customDmCandidatesState : [];
  const rolesHtml = ROLE_ALERT_ROLES.map((role) => {
    const checked = customDmRoleTargets.has(role) ? " checked" : "";
    return `<label class="subtle" style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" data-custom-dm-role="${esc(
      role
    )}"${checked} /> ${esc(role)}</label>`;
  }).join(" ");
  const body = rows
    .map((row) => {
      const uid = String(row?.userId || "");
      const checked = customDmSelectedUserIds.has(uid) ? " checked" : "";
      const guildMembership = row?.inGuildConfirmed ? "Yes" : "Unknown";
      return `<tr>
        <td><input type="checkbox" data-custom-dm-user-id="${esc(uid)}"${checked} /></td>
        <td>${esc(row?.displayName || uid)}</td>
        <td>${esc(row?.recentClass || "-")}</td>
        <td>${esc(row?.recentSpec || "-")}</td>
        <td>${esc(row?.guildRole || "Peon")}</td>
        <td>${row?.subscribed ? "Yes" : "No"}</td>
        <td>${esc(guildMembership)}</td>
        <td>${Number(row?.raidsSeen || 0)}</td>
      </tr>`;
    })
    .join("");
  host.innerHTML = `
    <p class="subtle">Candidates are pulled from recent participants + subscribers. "In guild" = verified now; unknown users are re-checked at send time.</p>
    <p class="subtle">Shown: ${rows.length} / ${all.length}</p>
    <div class="admin-actions admin-actions--tight" style="margin-bottom:8px">${rolesHtml}</div>
    <div class="admin-actions admin-actions--tight">
      <button type="button" class="event-signup-btn event-signup-btn--softres" id="customDmReloadBtn">Reload players</button>
      <button type="button" class="event-signup-btn event-signup-btn--softres" id="customDmMarkAllBtn">Mark all shown</button>
      <button type="button" class="event-signup-btn event-signup-btn--softres" id="customDmDeselectAllBtn">Deselect all</button>
      <label class="subtle" style="display:inline-flex;align-items:center;gap:6px;margin-left:8px">
        <input type="checkbox" id="customDmSubscribedOnly" />
        Subscribed only
      </label>
      <button type="button" class="event-signup-btn" id="customDmSendBtn">Send custom DM</button>
    </div>
    <div class="admin-table-wrap role-alert-candidates-wrap">
      <table class="admin-table role-alert-candidates-table custom-dm-candidates-table">
        <thead>
          <tr>
            <th>DM</th><th>Raider</th><th>Class</th><th>Spec</th><th>Guild role</th><th>Subscribed</th><th>In guild</th><th>Past raids</th>
          </tr>
          <tr>
            <th></th>
            <th><input class="admin-input" data-custom-dm-filter="displayName" value="${esc(
              customDmFilterState.displayName || ""
            )}" placeholder="Filter raider" /></th>
            <th><input class="admin-input" data-custom-dm-filter="recentClass" value="${esc(
              customDmFilterState.recentClass || ""
            )}" placeholder="Filter class" /></th>
            <th><input class="admin-input" data-custom-dm-filter="recentSpec" value="${esc(
              customDmFilterState.recentSpec || ""
            )}" placeholder="Filter spec" /></th>
            <th><input class="admin-input" data-custom-dm-filter="guildRole" value="${esc(
              customDmFilterState.guildRole || ""
            )}" placeholder="Filter guild role" /></th>
            <th>
              <select class="admin-input" data-custom-dm-filter="subscribed">
                <option value=""${!customDmFilterState.subscribed ? " selected" : ""}>All</option>
                <option value="yes"${String(customDmFilterState.subscribed || "") === "yes" ? " selected" : ""}>Yes</option>
                <option value="no"${String(customDmFilterState.subscribed || "") === "no" ? " selected" : ""}>No</option>
              </select>
            </th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

async function loadCustomDmCandidates() {
  const payload = await getJson("/api/admin/custom-dm/candidates");
  customDmCandidatesState = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const valid = new Set(customDmCandidatesState.map((r) => String(r?.userId || "").trim()).filter(Boolean));
  customDmSelectedUserIds = new Set([...customDmSelectedUserIds].filter((id) => valid.has(id)));
  renderCustomDmPanel();
}

function roleSyncStatusLabel(status) {
  if (status === "will-add") return "Will add";
  if (status === "already") return "Already set";
  if (status === "missing") return "Missing role";
  if (status === "not-in-guild") return "Not in guild";
  if (status === "unassignable") return "Move bot role higher";
  if (status === "managed") return "Managed role";
  return status || "-";
}

function renderDiscordRoleSync(payload) {
  const host = document.getElementById("discordRoleSyncHost");
  if (!host) return;
  discordRoleSyncState = payload || null;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle" style="color:#c44">Failed to load role sync preview: ${esc(payload?.error || "")}</p>`;
    return;
  }
  const summary = payload.summary || {};
  const setupWarnings = Array.isArray(payload.setupWarnings) ? payload.setupWarnings : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const roleRows = (Array.isArray(payload.targetRoles) ? payload.targetRoles : [])
    .map((target) => {
      const role = target?.role || {};
      const status = !target?.exists ? "Missing" : role.assignable ? "Assignable" : "Blocked";
      const tone = status === "Assignable" ? "color:#5b8a4a" : "color:#c44";
      return `<tr>
        <td><strong>${esc(target?.name || "")}</strong></td>
        <td style="${tone}">${esc(status)}</td>
        <td>${role.position != null ? esc(String(role.position)) : "—"}</td>
      </tr>`;
    })
    .join("");
  const playerRows = rows
    .filter(
      (row) =>
        (Array.isArray(row.rolesToAdd) && row.rolesToAdd.length) ||
        (Array.isArray(row.rolesToRemove) && row.rolesToRemove.length) ||
        row.nicknameToSet
    )
    .slice(0, 250)
    .map((row) => {
      const desired = (Array.isArray(row.desiredRoles) ? row.desiredRoles : [])
        .map((role) => `${role.name}: ${roleSyncStatusLabel(role.status)}`)
        .join(", ");
      const attendanceAdd = row.attendanceRoleToAdd?.name || "";
      const attendanceRemove = (row.attendanceRolesToRemove || []).map((role) => role.name).join(", ");
      const combatAdd = row.combatRoleToAdd?.name || "";
      const currentCombat = (row.currentCombatRoleNames || []).join(", ");
      const nickname = row.nicknameToSet
        ? `${row.currentNick || "-"} -> ${row.nicknameToSet}`
        : row.desiredNick
        ? "Already set"
        : "-";
      const warnings = Array.isArray(row.warnings) && row.warnings.length ? row.warnings.join(", ") : "";
      return `<tr>
        <td>
          <strong>${esc(row.displayName || row.userId)}</strong>
          <div class="subtle"><code>${esc(row.userId || "")}</code></div>
        </td>
        <td>${esc(row.recentClass || "-")}</td>
        <td>${esc(row.recentSpec || "-")}</td>
        <td>${esc(row.rankRoleName || "-")}</td>
        <td>${esc(attendanceAdd || "-")}</td>
        <td>${esc(attendanceRemove || "-")}</td>
        <td>${esc(combatAdd || (currentCombat ? `Already has ${currentCombat}` : "-"))}</td>
        <td>${esc(nickname)}</td>
        <td class="subtle">${esc(warnings || desired || "-")}</td>
      </tr>`;
    })
    .join("");
  host.innerHTML = `
    <p class="subtle">
      Mode: <strong>Attendance override, combat add-if-empty</strong> · Candidates:
      <strong>${esc(String(summary.candidates || 0))}</strong> · Users with changes:
      <strong>${esc(String(summary.usersWithChanges || 0))}</strong> · Attendance add/remove:
      <strong>${esc(String(summary.attendanceRolesToAdd || 0))}</strong>/<strong>${esc(String(summary.attendanceRolesToRemove || 0))}</strong> · Combat adds:
      <strong>${esc(String(summary.combatRolesToAdd || 0))}</strong> · Nicknames:
      <strong>${esc(String(summary.nicknamesToSet || 0))}</strong>
    </p>
    ${
      setupWarnings.length
        ? `<div class="admin-grid-note" style="border-color:#c44">
            <p class="subtle" style="color:#c44;margin-top:0"><strong>Setup needed before full sync:</strong></p>
            <ul class="subtle">${setupWarnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>
          </div>`
        : `<p class="subtle" style="color:#5b8a4a"><strong>Role setup looks assignable.</strong></p>`
    }
    <details class="admin-rh-todo-block" open>
      <summary>Discord role mapping</summary>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Role</th><th>Status</th><th>Position</th></tr></thead>
          <tbody>${roleRows || `<tr><td colspan="3" class="subtle">No target roles found.</td></tr>`}</tbody>
        </table>
      </div>
    </details>
    <details class="admin-rh-todo-block" ${Number(summary.usersWithChanges || 0) ? "open" : ""}>
      <summary>Players needing Discord role changes (${esc(String(summary.usersWithChanges || 0))})</summary>
      ${
        playerRows
          ? `<div class="admin-table-wrap role-alert-candidates-wrap">
              <table class="admin-table role-alert-candidates-table">
                <thead><tr><th>Player</th><th>Class</th><th>Spec</th><th>Website rank</th><th>Attendance add</th><th>Attendance remove</th><th>Combat add</th><th>Server name</th><th>Details</th></tr></thead>
                <tbody>${playerRows}</tbody>
              </table>
            </div>`
          : `<p class="subtle">No Discord role changes in the current preview.</p>`
      }
    </details>
  `;
}

async function loadDiscordRoleSyncPreview() {
  const host = document.getElementById("discordRoleSyncHost");
  if (host && !discordRoleSyncState) host.innerHTML = `<p class="subtle">Loading role sync preview...</p>`;
  try {
    const payload = await getJson("/api/admin/discord-role-sync/preview");
    renderDiscordRoleSync(payload);
  } catch (error) {
    renderDiscordRoleSync({ ok: false, error: error?.message || "Failed to load preview" });
  }
}

function renderDiscordNewsStatus(payload = discordNewsStatusState) {
  const host = document.getElementById("discordNewsStatus");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Discord news status unavailable.</p>`;
    return;
  }
  const configured = Boolean(payload.configured);
  const valid = Boolean(payload.valid);
  const recent = Array.isArray(payload.recent) ? payload.recent.slice(0, 5) : [];
  const statusText = !configured
    ? "Missing DISCORD_NEWS_WEBHOOK_URL"
    : valid
      ? "Webhook configured"
      : "Webhook URL is invalid";
  const recentHtml = recent.length
    ? `<ul class="subtle">${recent
        .map((row) => {
          const when = Number(row?.sentAt || 0) ? new Date(Number(row.sentAt)).toLocaleString() : "";
          return `<li>${esc(row?.title || row?.key || "Notification")} ${when ? `· ${esc(when)}` : ""}</li>`;
        })
        .join("")}</ul>`
    : `<p class="subtle">No news notifications recorded yet.</p>`;
  host.innerHTML = `
    <p class="subtle"><strong>${esc(statusText)}</strong>${payload.host ? ` · ${esc(payload.host)}` : ""}${
      Number(payload.queued || 0) ? ` · ${Number(payload.queued || 0)} queued` : ""
    }</p>
    ${recentHtml}
  `;
}

async function loadDiscordNewsStatus() {
  const payload = await getJson("/api/admin/discord-news/status");
  discordNewsStatusState = payload;
  renderDiscordNewsStatus(payload);
}

function renderDiscordNewsRoles(payload = {}) {
  const host = document.getElementById("discordNewsRolesHost");
  if (!host) return;
  if (!payload.ok) {
    host.innerHTML = `<p class="subtle"><strong>Role pings unavailable.</strong> ${esc(
      payload.error || "Configure DISCORD_BOT_TOKEN and DISCORD_GUILD_ID/RAID_HELPER_SERVER_ID to fetch roles."
    )}</p>`;
    return;
  }
  const roles = Array.isArray(payload.roles) ? payload.roles : discordNewsRolesState;
  discordNewsRolesState = roles;
  const validIds = new Set(roles.map((role) => String(role?.id || "")).filter(Boolean));
  discordNewsSelectedRoleIds = new Set([...discordNewsSelectedRoleIds].filter((id) => validIds.has(id)));
  const mentionable = roles.filter((role) => role?.mentionable);
  const disabled = roles.filter((role) => !role?.mentionable);
  const roleHtml = (role) => {
    const id = String(role?.id || "");
    const checked = discordNewsSelectedRoleIds.has(id) ? " checked" : "";
    const disabledAttr = role?.mentionable ? "" : " disabled";
    const color = Number(role?.color || 0);
    const swatch = color > 0 ? `#${color.toString(16).padStart(6, "0")}` : "rgba(255,255,255,0.35)";
    return `<label class="subtle" style="display:inline-flex;align-items:center;gap:6px;margin:0 10px 8px 0">
      <input type="checkbox" data-discord-news-role-id="${esc(id)}"${checked}${disabledAttr} />
      <span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;background:${esc(swatch)};display:inline-block"></span>
      ${esc(role?.name || id)}
      ${role?.mentionable ? "" : " (not mentionable)"}
    </label>`;
  };
  host.innerHTML = `
    <p class="subtle"><strong>Role pings</strong> · Selected roles will be mentioned and pinged in the Discord message.</p>
    <div>${mentionable.map(roleHtml).join("") || `<span class="subtle">No mentionable roles found.</span>`}</div>
    ${disabled.length ? `<details class="admin-details subtle"><summary>Non-mentionable roles</summary><div>${disabled.map(roleHtml).join("")}</div></details>` : ""}
  `;
}

async function loadDiscordNewsRoles() {
  try {
    const payload = await getJson("/api/admin/discord-news/roles");
    renderDiscordNewsRoles(payload);
  } catch (error) {
    renderDiscordNewsRoles({ ok: false, error: error?.message || "Failed to load Discord roles" });
  }
}

function discordNewsRoleCheckboxesHtml(selectedIds = [], attrName = "data-discord-news-queue-role-id") {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id || "").trim()).filter(Boolean));
  const roles = Array.isArray(discordNewsRolesState) ? discordNewsRolesState : [];
  const mentionable = roles.filter((role) => role?.mentionable);
  if (!mentionable.length) return `<p class="subtle">No mentionable Discord roles loaded.</p>`;
  return mentionable
    .map((role) => {
      const id = String(role?.id || "");
      const checked = selected.has(id) ? " checked" : "";
      return `<label class="subtle" style="display:inline-flex;align-items:center;gap:6px;margin:0 10px 8px 0">
        <input type="checkbox" ${attrName}="${esc(id)}"${checked} />
        ${esc(role?.name || id)}
      </label>`;
    })
    .join("");
}

function renderDiscordNewsQueue(payload = {}) {
  const host = document.getElementById("discordNewsQueueHost");
  if (!host) return;
  const rows = Array.isArray(payload.queue) ? payload.queue : discordNewsQueueState;
  discordNewsQueueState = rows;
  const pending = rows.filter((row) => row?.status === "pending");
  const history = rows.filter((row) => row?.status !== "pending").slice(0, 12);
  const draftHtml = (row) => {
    const id = String(row?.id || "");
    const roleIds = Array.isArray(row?.roleMentions) ? row.roleMentions : [];
    const createdAt = Number(row?.createdAt || 0) ? new Date(Number(row.createdAt)).toLocaleString() : "";
    const fields = Array.isArray(row?.fields) ? row.fields : [];
    const fieldsHtml = fields.length
      ? `<details class="admin-details subtle" open><summary>Discord embed fields preview</summary><dl>${fields
          .map(
            (field) => `<dt><strong>${esc(field?.name || "")}</strong></dt><dd>${esc(field?.value || "").replace(/\n/g, "<br>")}</dd>`
          )
          .join("")}</dl></details>`
      : "";
    return `<article class="admin-grid-note" data-discord-news-draft-id="${esc(id)}" style="margin:0 0 12px 0">
      <p class="subtle"><strong>${esc(row?.kind || "news")}</strong>${createdAt ? ` · queued ${esc(createdAt)}` : ""}</p>
      <label class="subtle">Title</label>
      <input class="admin-input" data-discord-news-queue-title value="${esc(row?.title || "")}" maxlength="256" />
      <label class="subtle">Message</label>
      <textarea class="admin-textarea" data-discord-news-queue-description rows="5" maxlength="4000">${esc(
        row?.description || ""
      )}</textarea>
      <label class="subtle">Optional link</label>
      <input class="admin-input" data-discord-news-queue-url value="${esc(row?.url || "")}" />
      <label class="subtle">Optional image URL</label>
      <input class="admin-input" data-discord-news-queue-image-url value="${esc(row?.imageUrl || "")}" />
      ${fieldsHtml}
      <div class="admin-grid-note" style="margin-top:8px">${discordNewsRoleCheckboxesHtml(roleIds)}</div>
      <div class="admin-actions admin-actions--tight">
        <button type="button" class="event-signup-btn" data-discord-news-queue-send="${esc(id)}">Send to Discord</button>
        <button type="button" class="event-signup-btn event-signup-btn--softres" data-discord-news-queue-discard="${esc(
          id
        )}">Discard</button>
      </div>
    </article>`;
  };
  const historyHtml = history.length
    ? `<details class="admin-details subtle"><summary>Recent sent/discarded drafts</summary><ul>${history
        .map((row) => {
          const when = Number(row?.sentAt || row?.discardedAt || row?.updatedAt || 0)
            ? new Date(Number(row.sentAt || row.discardedAt || row.updatedAt)).toLocaleString()
            : "";
          return `<li><strong>${esc(row?.status || "")}</strong> · ${esc(row?.title || row?.key || "Draft")}${
            when ? ` · ${esc(when)}` : ""
          }</li>`;
        })
        .join("")}</ul></details>`
    : "";
  host.innerHTML = `
    <p class="subtle"><strong>${pending.length}</strong> pending draft${pending.length === 1 ? "" : "s"}.</p>
    ${pending.length ? pending.map(draftHtml).join("") : `<p class="subtle">No queued news drafts waiting for review.</p>`}
    ${historyHtml}
  `;
}

async function loadDiscordNewsQueue() {
  const payload = await getJson("/api/admin/discord-news/queue");
  renderDiscordNewsQueue(payload);
}

function readDiscordNewsQueueDraftPayload(card) {
  if (!card) return {};
  const roleIds = [...card.querySelectorAll("[data-discord-news-queue-role-id]")]
    .filter((el) => el.checked)
    .map((el) => String(el.getAttribute("data-discord-news-queue-role-id") || "").trim())
    .filter(Boolean);
  return {
    title: String(card.querySelector("[data-discord-news-queue-title]")?.value || "").trim(),
    description: String(card.querySelector("[data-discord-news-queue-description]")?.value || "").trim(),
    url: String(card.querySelector("[data-discord-news-queue-url]")?.value || "").trim(),
    imageUrl: String(card.querySelector("[data-discord-news-queue-image-url]")?.value || "").trim(),
    roleIds,
  };
}

function renderPublicSnapshotStatus(payload) {
  const host = document.getElementById("publicSnapshotStatus");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Snapshot status unavailable.</p>`;
    return;
  }
  const entries = Number(payload.entries || 0);
  const updatedAt = Number(payload.updatedAt || 0);
  const updatedText = updatedAt ? new Date(updatedAt).toLocaleString() : "Never";
  host.innerHTML = `
    <p><strong>Last sync:</strong> ${esc(updatedText)}</p>
    <p><strong>Cached endpoint variants:</strong> ${esc(String(entries))}</p>
  `;
}

function fmtWhen(ms) {
  const n = Number(ms || 0);
  if (!n) return "-";
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

const CONVERSION_TILE_LABELS = {
  discord_click: "Discord",
  subscribe_click: "Subscribe click",
  subscribe_success: "Subscribe success",
  event_signup_click: "Event signup",
};
const CONVERSION_CATEGORIES = Object.keys(CONVERSION_TILE_LABELS);

const ANALYTICS_CHART_MOUNT_IDS = [
  "adminAnalyticsChartDaily",
  "adminAnalyticsChartConversionsDaily",
  "adminAnalyticsChartFunnel",
  "adminAnalyticsChartCtaDonut",
  "adminAnalyticsChartDiscordMembers",
  "adminAnalyticsChartTopPages",
  "adminAnalyticsChartReferrers",
];

const analyticsChartInstances = new Map();

function analyticsChartsPanelVisible() {
  const panel = document.getElementById("admin-panel-analytics");
  return !!(panel && panel.classList.contains("is-admin-panel-active"));
}

/** ApexCharts reads layout at render time; hidden panels (`display: none`) yield broken axes until resize. */
function resizeAllAnalyticsCharts() {
  if (!analyticsChartsPanelVisible()) return;
  for (const chart of analyticsChartInstances.values()) {
    try {
      if (chart && typeof chart.resize === "function") chart.resize();
    } catch {
      /* ignore */
    }
  }
}

function scheduleAnalyticsChartsResize() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resizeAllAnalyticsCharts();
    });
  });
}

function adminAnalyticsCssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function analyticsDayMs(day) {
  const ms = Date.parse(`${String(day || "").slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function analyticsDateSeries(rows, key) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const ms = analyticsDayMs(row?.day);
    return { x: ms ?? index, y: Number(row?.[key] || 0) };
  });
}

function analyticsDiscordDaySeries(daily, key) {
  return (Array.isArray(daily) ? daily : []).map((row, index) => {
    const ms = analyticsDayMs(row?.day);
    const raw = row?.[key];
    const num = Number(raw);
    const y = raw == null || !Number.isFinite(num) ? null : num;
    return { x: ms ?? index, y };
  });
}

function destroyAnalyticsChartByMountId(mountId) {
  const chart = analyticsChartInstances.get(mountId);
  if (!chart) return;
  try {
    chart.destroy();
  } catch {
    /* ignore */
  }
  analyticsChartInstances.delete(mountId);
}

function mountAnalyticsChart(mountId, options) {
  const Apex = typeof ApexCharts !== "undefined" ? ApexCharts : globalThis.ApexCharts;
  const el = document.getElementById(mountId);
  if (!el || !Apex) return null;
  destroyAnalyticsChartByMountId(mountId);
  el.innerHTML = "";
  const chart = new Apex(el, options);
  chart.render();
  analyticsChartInstances.set(mountId, chart);
  return chart;
}

function adminAnalyticsClearMountMessage(mountId, html) {
  destroyAnalyticsChartByMountId(mountId);
  const el = document.getElementById(mountId);
  if (el) el.innerHTML = html;
}

function clearAdminAnalyticsDiscordMembersLegend() {
  const leg = document.getElementById("adminAnalyticsDiscordLegend");
  if (!leg) return;
  leg.hidden = true;
  leg.innerHTML = "";
}

function adminAnalyticsDiscordMembersClearMount(html) {
  clearAdminAnalyticsDiscordMembersLegend();
  adminAnalyticsClearMountMessage("adminAnalyticsChartDiscordMembers", html);
}

function analyticsFmtPctDelta(cur, prev) {
  const p = Number(prev);
  const c = Number(cur);
  if (!Number.isFinite(c)) return "—";
  if (!Number.isFinite(p) || p === 0) return c > 0 ? "new" : "—";
  const ch = ((c - p) / p) * 100;
  const sign = ch >= 0 ? "+" : "";
  return `${sign}${ch.toFixed(1)}% vs prior`;
}

function analyticsFmtSubscribeRate(ppJoin, succ) {
  const j = Number(ppJoin);
  const s = Number(succ);
  if (!Number.isFinite(j) || j <= 0) return "—";
  if (!Number.isFinite(s)) return "—";
  return `${((s / j) * 100).toFixed(1)}%`;
}

function analyticsSubscribeRateDeltaPP(curJoin, curSucc, prevJoin, prevSucc) {
  const cj = Number(curJoin);
  const cs = Number(curSucc);
  const pj = Number(prevJoin);
  const ps = Number(prevSucc);
  if (!Number.isFinite(cj) || cj <= 0) return "—";
  if (!Number.isFinite(pj) || pj <= 0) return "—";
  const cur = (cs / cj) * 100;
  const prv = (ps / pj) * 100;
  const d = cur - prv;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(1)} pp vs prior`;
}

function renderAnalyticsDashboard(payload) {
  const errEl = document.getElementById("adminAnalyticsDashError");
  const kpisRoot = document.getElementById("adminAnalyticsKpis");

  const setKpi = (key, valueHtml, deltaHtml) => {
    const card = kpisRoot?.querySelector(`[data-admin-dash-kpi="${key}"]`);
    if (!card) return;
    const v = card.querySelector(".admin-dash-kpi-value");
    const d = card.querySelector(".admin-dash-kpi-delta");
    if (v) v.innerHTML = valueHtml;
    if (d) d.textContent = deltaHtml;
  };

  if (!payload || payload.ok === false) {
    if (errEl) {
      errEl.hidden = false;
      errEl.innerHTML = `<p class="subtle">Analytics unavailable.</p>`;
    }
    for (const id of ANALYTICS_CHART_MOUNT_IDS) {
      destroyAnalyticsChartByMountId(id);
      const node = document.getElementById(id);
      if (node) node.innerHTML = "";
    }
    clearAdminAnalyticsDiscordMembersLegend();
    setKpi("pageviews", "—", "vs prior period");
    setKpi("sessions", "—", "vs prior period");
    setKpi("avgday", "—", "vs prior period");
    setKpi("subscriberate", "—", "success ÷ join visits · vs prior");
    setKpi("discordmembers", "—", "Discord approximate counts");
    return;
  }

  if (errEl) {
    errEl.hidden = true;
    errEl.innerHTML = "";
  }

  const days = Math.max(1, Math.min(365, Number(payload.days) || 30));
  const pv = Number(payload.pageviews || 0);
  const us = Number(payload.uniqueSessions || 0);
  const prev = payload.previous || {};
  const prevPv = Number(prev.pageviews || 0);
  const prevUs = Number(prev.uniqueSessions || 0);
  const avg = pv / days;
  const prevAvg = prevPv / days;

  const jf = payload.joinFunnel || {};
  const joinPv = Number(jf.joinPageviews || 0);
  const subSucc = Number(jf.subscribeSuccess || 0);
  const prevJoin = Number(prev.joinPageviews || 0);
  const prevSubSucc = Number(prev.conversions?.subscribe_success || 0);

  setKpi("pageviews", esc(String(pv)), analyticsFmtPctDelta(pv, prevPv));
  setKpi("sessions", esc(String(us)), analyticsFmtPctDelta(us, prevUs));
  setKpi("avgday", esc(avg.toFixed(1)), analyticsFmtPctDelta(avg, prevAvg));
  setKpi(
    "subscriberate",
    esc(analyticsFmtSubscribeRate(joinPv, subSucc)),
    analyticsSubscribeRateDeltaPP(joinPv, subSucc, prevJoin, prevSubSucc)
  );

  const dm = payload.discordMembers || {};
  const dCur = dm.current;
  const dOn = dm.online;
  const dAt = Number(dm.sampledAt || 0);
  const dNote = String(dm.note || "").trim();
  if (Number.isFinite(dCur) && dCur >= 0) {
    const onlineBit =
      Number.isFinite(dOn) && dOn >= 0 ? `${esc(String(dOn))} approx. online · ` : "";
    setKpi(
      "discordmembers",
      esc(String(dCur)),
      `${onlineBit}sampled ${dAt ? esc(fmtWhen(dAt)) : "—"} (UTC)`
    );
  } else if (dNote) {
    setKpi("discordmembers", "—", esc(dNote.slice(0, 220)));
  } else {
    setKpi(
      "discordmembers",
      "—",
      "No samples in store yet; counts update on reload (throttled, ~6h)."
    );
  }

  const fore = adminAnalyticsCssVar("--text", "#eceaf3");
  const muted = adminAnalyticsCssVar("--text-muted", "#b9afc8");
  const gridColor = adminAnalyticsCssVar("--border", "rgba(255,255,255,0.08)");

  const chartFont = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
  const baseChart = {
    chart: {
      fontFamily: chartFont,
      foreColor: muted,
      background: "transparent",
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: true },
    },
    theme: { mode: "dark" },
    grid: { borderColor: gridColor, strokeDashArray: 4 },
    legend: { show: false, fontFamily: chartFont, labels: { colors: fore } },
    dataLabels: { enabled: false },
  };

  const daily = Array.isArray(payload.daily) ? payload.daily : [];
  const dayLabels = daily.map((r) => String(r.day || ""));

  mountAnalyticsChart("adminAnalyticsChartDaily", {
    ...baseChart,
    chart: { ...baseChart.chart, type: "line", height: 280 },
    colors: ["#9aacff", "#6fd9a8"],
    stroke: { curve: "smooth", width: [2, 2] },
    series: [
      { name: "Pageviews", data: analyticsDateSeries(daily, "views") },
      { name: "Unique sessions", data: analyticsDateSeries(daily, "uniqueSessions") },
    ],
    xaxis: {
      type: "datetime",
      tickAmount: Math.min(7, Math.max(2, dayLabels.length)),
      labels: {
        datetimeUTC: true,
        format: "MM-dd",
        rotate: 0,
        hideOverlappingLabels: true,
        maxHeight: 32,
      },
    },
    yaxis: { labels: { style: { colors: muted } } },
    tooltip: { theme: "dark", shared: true, intersect: false },
  });

  const convDaily = Array.isArray(payload.conversionsDaily) ? payload.conversionsDaily : [];
  const convDayLabels = convDaily.map((r) => String(r.day || ""));
  mountAnalyticsChart("adminAnalyticsChartConversionsDaily", {
    ...baseChart,
    chart: { ...baseChart.chart, type: "bar", stacked: true, height: 280 },
    plotOptions: { bar: { columnWidth: "52%", borderRadius: 2 } },
    colors: ["#8b7bc8", "#d96fb8", "#5eb87a", "#e2b060"],
    series: CONVERSION_CATEGORIES.map((cat) => ({
      name: CONVERSION_TILE_LABELS[cat],
      data: analyticsDateSeries(convDaily, cat),
    })),
    xaxis: {
      type: "datetime",
      tickAmount: Math.min(7, Math.max(2, convDayLabels.length)),
      labels: {
        datetimeUTC: true,
        format: "MM-dd",
        rotate: 0,
        hideOverlappingLabels: true,
        maxHeight: 32,
      },
    },
    yaxis: { labels: { style: { colors: muted } } },
    tooltip: { theme: "dark", shared: true, intersect: false },
  });

  const funnelVisits = Number(jf.joinPageviews || 0);
  const funnelClicks = Number(jf.subscribeClicks || 0);
  const funnelOk = Number(jf.subscribeSuccess || 0);
  mountAnalyticsChart("adminAnalyticsChartFunnel", {
    ...baseChart,
    chart: { ...baseChart.chart, type: "bar", height: 260 },
    plotOptions: { bar: { borderRadius: 4, columnWidth: "42%", distributed: true } },
    colors: ["#7eb8ff", "#c497ff", "#56d4a5"],
    series: [{ name: "Count", data: [funnelVisits, funnelClicks, funnelOk] }],
    xaxis: {
      categories: ["Join visits", "Subscribe clicks", "Successes"],
      labels: { style: { colors: muted } },
    },
    yaxis: { labels: { style: { colors: muted } } },
    tooltip: { theme: "dark" },
  });

  const ctaRows = Array.isArray(payload.conversionsByLabel?.subscribe_click)
    ? payload.conversionsByLabel.subscribe_click
    : [];
  if (!ctaRows.length) {
    adminAnalyticsClearMountMessage(
      "adminAnalyticsChartCtaDonut",
      `<p class="subtle">No subscribe_click labels in this range.</p>`
    );
  } else {
    mountAnalyticsChart("adminAnalyticsChartCtaDonut", {
      ...baseChart,
      chart: { ...baseChart.chart, type: "donut", height: 280 },
      labels: ctaRows.map((r) => String(r.label || "(none)")),
      series: ctaRows.map((r) => Number(r.count || 0)),
      legend: { ...baseChart.legend, show: false },
      plotOptions: {
        pie: {
          donut: {
            labels: {
              show: true,
              name: { color: fore },
              value: { color: fore },
              total: {
                show: true,
                label: "Clicks",
                color: muted,
                formatter: () =>
                  String(ctaRows.reduce((acc, r) => acc + Number(r.count || 0), 0)),
              },
            },
          },
        },
      },
      tooltip: { theme: "dark" },
    });
  }

  const discordDaily = Array.isArray(dm.daily) ? dm.daily : [];
  const discordDayLabels = discordDaily.map((r) => String(r.day || ""));
  const discordMemberSeries = analyticsDiscordDaySeries(discordDaily, "members");
  const discordHasMembers = discordMemberSeries.some((pt) => pt.y != null);
  const discordOnlineSeries = analyticsDiscordDaySeries(discordDaily, "online");
  const discordHasOnline = discordOnlineSeries.some((pt) => pt.y != null);
  if (!discordHasMembers) {
    adminAnalyticsDiscordMembersClearMount(
      `<p class="subtle">No member samples in this date range yet. Samples are taken when you open this panel (throttled, about every 6 hours).</p>`
    );
  } else {
    const discordSeries = [{ name: "Members (approx.)", data: discordMemberSeries }];
    if (discordHasOnline) {
      discordSeries.push({ name: "Online (approx.)", data: discordOnlineSeries });
    }
    clearAdminAnalyticsDiscordMembersLegend();
    mountAnalyticsChart("adminAnalyticsChartDiscordMembers", {
      ...baseChart,
      chart: { ...baseChart.chart, type: "line", height: 280 },
      colors: discordHasOnline ? ["#b79cff", "#5fd4c8"] : ["#b79cff"],
      stroke: { curve: "smooth", width: discordHasOnline ? [2, 2] : [2] },
      series: discordSeries,
      legend: { ...baseChart.legend, show: false },
      xaxis: {
        type: "datetime",
        tickAmount: Math.min(7, Math.max(2, discordDayLabels.length)),
        labels: {
          datetimeUTC: true,
          format: "MM-dd",
          rotate: 0,
          hideOverlappingLabels: true,
          maxHeight: 32,
        },
      },
      yaxis: { labels: { style: { colors: muted } } },
      tooltip: { theme: "dark", shared: true, intersect: false },
    });
    if (discordHasOnline) {
      const leg = document.getElementById("adminAnalyticsDiscordLegend");
      if (leg) {
        leg.hidden = false;
        leg.innerHTML = `<span><span class="admin-dash-chart-legend-dot" style="background:#b79cff"></span>Members (approx.)</span><span><span class="admin-dash-chart-legend-dot" style="background:#5fd4c8"></span>Online (approx.)</span>`;
      }
    }
  }

  const topPages = Array.isArray(payload.topPages) ? payload.topPages.slice(0, 12) : [];
  if (!topPages.length) {
    adminAnalyticsClearMountMessage("adminAnalyticsChartTopPages", `<p class="subtle">No pageview data yet.</p>`);
  } else {
    const paths = topPages.map((r) => {
      const p = String(r.path || "/");
      return p.length > 48 ? `${p.slice(0, 22)}…${p.slice(-20)}` : p;
    });
    const views = topPages.map((r) => Number(r.views || 0));
    mountAnalyticsChart("adminAnalyticsChartTopPages", {
      ...baseChart,
      chart: { ...baseChart.chart, type: "bar", height: Math.max(220, topPages.length * 28) },
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "72%" } },
      colors: ["#9aacff"],
      series: [{ name: "Views", data: views }],
      xaxis: {
        categories: paths,
        labels: { style: { colors: muted } },
      },
      yaxis: { labels: { style: { colors: muted } } },
      tooltip: { theme: "dark" },
    });
  }

  const refs = Array.isArray(payload.topReferrers) ? payload.topReferrers.slice(0, 12) : [];
  if (!refs.length) {
    adminAnalyticsClearMountMessage(
      "adminAnalyticsChartReferrers",
      `<p class="subtle">No external referrers in this range.</p>`
    );
  } else {
    mountAnalyticsChart("adminAnalyticsChartReferrers", {
      ...baseChart,
      chart: { ...baseChart.chart, type: "bar", height: Math.max(220, refs.length * 28) },
      plotOptions: { bar: { horizontal: true, borderRadius: 3, barHeight: "72%" } },
      colors: ["#e2b060"],
      series: [{ name: "Pageviews", data: refs.map((r) => Number(r.count || 0)) }],
      xaxis: {
        categories: refs.map((r) => String(r.host || "")),
        labels: { style: { colors: muted } },
      },
      yaxis: { labels: { style: { colors: muted } } },
      tooltip: { theme: "dark" },
    });
  }

  scheduleAnalyticsChartsResize();
}

function updateAnalyticsRangeButtons() {
  const input = document.getElementById("adminAnalyticsDays");
  const days = Math.max(1, Math.min(365, Number(input?.value || 30) || 30));
  const panel = document.getElementById("admin-panel-analytics");
  if (!panel) return;
  panel.querySelectorAll("[data-admin-analytics-range]").forEach((btn) => {
    const v = Number(btn.getAttribute("data-admin-analytics-range"));
    btn.classList.toggle("admin-dash-range-btn--active", Number.isFinite(v) && v === days);
  });
}

function renderSubscribers(payload) {
  const summary = document.getElementById("adminSubscribersSummary");
  const table = document.getElementById("adminSubscribersTable");
  if (!summary || !table) return;
  if (!payload || payload.ok === false) {
    summary.innerHTML = `<p class="subtle">Subscribers unavailable.</p>`;
    table.innerHTML = "";
    return;
  }
  summary.innerHTML = `<p><strong>Total records:</strong> ${Number(payload.total || 0)} · <strong>Subscribed:</strong> ${Number(payload.subscribed || 0)}</p>`;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) {
    table.innerHTML = `<p class="subtle">No subscribers found.</p>`;
    return;
  }
  table.innerHTML = `
    <div class="admin-table-wrap role-alert-candidates-wrap">
      <table class="admin-table role-alert-candidates-table">
        <thead><tr><th>User</th><th>User ID</th><th>Subscribed</th><th>Subscribed at</th><th>Updated at</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
            <td>${esc(String(row.globalName || row.username || "-"))}</td>
            <td><code>${esc(String(row.userId || "-"))}</code></td>
            <td>${row.subscribed ? "Yes" : "No"}</td>
            <td>${esc(fmtWhen(row.subscribedAt))}</td>
            <td>${esc(fmtWhen(row.updatedAt))}</td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function raiderBlacklistCardPillHtml(card) {
  const c = String(card || "").toLowerCase();
  if (c === "black") {
    return `<span class="raider-card-pill raider-card-pill--black" title="Black Card (out)">Black</span>`;
  }
  return `<span class="raider-card-pill raider-card-pill--yellow" title="Yellow Card (warning)">Yellow</span>`;
}

function roleAlertsRaiderCardModifier(slot) {
  const card = String(slot?.raiderCard?.card || "").toLowerCase();
  if (card === "black") return "role-alert-slot--raider-card-black";
  if (card === "yellow") return "role-alert-slot--raider-card-yellow";
  return "";
}

function roleAlertsRaiderCardBadgeHtml(slot) {
  const rc = slot?.raiderCard;
  if (!rc?.card) return "";
  const reason = String(rc.reason || "").trim();
  const label = rc.card === "black" ? "Black Card (out)" : "Yellow Card (warning)";
  const title = reason ? `${label}: ${reason}` : label;
  return `<span class="role-alert-raider-card-badge" title="${esc(title)}">${raiderBlacklistCardPillHtml(rc.card)}</span>`;
}

function raiderBlacklistContextHtml(entry) {
  const label = String(entry?.contextLabel || "").trim();
  const at = Number(entry?.contextAt || 0);
  if (!label && !at) return `<span class="subtle">—</span>`;
  const datePart = at ? fmtWhen(at) : "";
  return esc([label, datePart].filter(Boolean).join(" · "));
}

function raiderBlacklistFilteredEntries() {
  const rows = Array.isArray(raiderBlacklistEntriesState) ? raiderBlacklistEntriesState : [];
  const f = String(raiderBlacklistFilterState || "all").toLowerCase();
  if (f === "yellow" || f === "black") return rows.filter((row) => String(row?.card || "").toLowerCase() === f);
  return rows;
}

function raiderBlacklistUpdateSelectedPlayerLabel() {
  const el = document.getElementById("raiderBlacklistSelectedPlayer");
  if (!el) return;
  const manual = Boolean(document.getElementById("raiderBlacklistManualName")?.checked);
  const p = raiderBlacklistSelectedPlayer;
  if (manual) {
    const name = String(document.getElementById("raiderBlacklistPlayerSearch")?.value || "").trim();
    el.textContent = name ? `Manual: ${name}` : "Enter a player name above.";
    return;
  }
  if (!p) {
    el.textContent = "No player selected — search and pick an identity, or use manual name.";
    return;
  }
  el.textContent = `Selected: ${p.displayName || p.id}${p.discordUserId ? ` (Discord ${p.discordUserId})` : ""}`;
}

function renderRaiderBlacklistTable(payload) {
  const host = document.getElementById("adminRaiderBlacklistTable");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Raider blacklist unavailable.")}</p>`;
    return;
  }
  raiderBlacklistEntriesState = Array.isArray(payload.entries) ? payload.entries : [];
  const rows = raiderBlacklistFilteredEntries();
  if (!rows.length) {
    host.innerHTML = `<p class="subtle">No cards on the blacklist yet.</p>`;
    return;
  }
  host.innerHTML = `
    <div class="admin-table-wrap role-alert-candidates-wrap">
      <table class="admin-table role-alert-candidates-table admin-raider-blacklist-table">
        <thead>
          <tr>
            <th>Card</th>
            <th>Player</th>
            <th>Reason</th>
            <th>Context</th>
            <th>Added</th>
            <th>By</th>
            <th>Save</th>
            <th>Remove</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const id = esc(String(row.id || ""));
              const card = String(row.card || "yellow").toLowerCase();
              const contextDate =
                row.contextAt && Number.isFinite(Number(row.contextAt))
                  ? new Date(Number(row.contextAt)).toISOString().slice(0, 10)
                  : "";
              return `<tr data-raider-blacklist-row="${id}">
                <td>
                  <div style="margin-bottom:6px">${raiderBlacklistCardPillHtml(card)}</div>
                  <select class="admin-input" data-raider-blacklist-k="card" aria-label="Card type">
                    <option value="yellow"${card === "yellow" ? " selected" : ""}>Yellow</option>
                    <option value="black"${card === "black" ? " selected" : ""}>Black</option>
                  </select>
                </td>
                <td>${esc(String(row.displayName || "-"))}</td>
                <td>
                  <textarea class="admin-input" data-raider-blacklist-k="reason" rows="2" maxlength="500">${esc(
                    String(row.reason || "")
                  )}</textarea>
                </td>
                <td>
                  <input class="admin-input" data-raider-blacklist-k="contextLabel" value="${esc(
                    String(row.contextLabel || "")
                  )}" placeholder="Raid name" maxlength="160" />
                  <input class="admin-input" data-raider-blacklist-k="contextDate" type="date" value="${esc(contextDate)}" style="margin-top:6px" />
                </td>
                <td class="subtle">${esc(fmtWhen(row.createdAt))}</td>
                <td class="subtle">${esc(String(row.createdBy || "-"))}</td>
                <td><button type="button" class="event-signup-btn" data-raider-blacklist-save="${id}">Save</button></td>
                <td><button type="button" class="event-signup-btn event-signup-btn--softres" data-raider-blacklist-remove="${id}">Remove</button></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="subtle">Showing ${rows.length} / ${raiderBlacklistEntriesState.length} entries.</p>
  `;
}

async function loadRaiderBlacklistPanel() {
  const filterEl = document.getElementById("raiderBlacklistFilter");
  if (filterEl) raiderBlacklistFilterState = String(filterEl.value || "all");
  const payload = await getJson("/api/admin/raider-blacklist");
  renderRaiderBlacklistTable(payload);
}

function raiderBlacklistReadAddForm() {
  const manual = Boolean(document.getElementById("raiderBlacklistManualName")?.checked);
  const reason = String(document.getElementById("raiderBlacklistReason")?.value || "").trim();
  const card = String(document.getElementById("raiderBlacklistCardType")?.value || "yellow").trim().toLowerCase();
  const contextLabel = String(document.getElementById("raiderBlacklistContextLabel")?.value || "").trim();
  const dateRaw = String(document.getElementById("raiderBlacklistContextDate")?.value || "").trim();
  let contextAt = 0;
  if (dateRaw) {
    const dt = new Date(`${dateRaw}T12:00:00`);
    if (!Number.isNaN(dt.getTime())) contextAt = dt.getTime();
  }
  if (manual) {
    const displayName = String(document.getElementById("raiderBlacklistPlayerSearch")?.value || "").trim();
    return { manual: true, displayName, card, reason, contextLabel, contextAt };
  }
  const p = raiderBlacklistSelectedPlayer;
  return {
    manual: false,
    userId: p?.id != null ? Number(p.id) : null,
    discordUserId: String(p?.discordUserId || "").trim(),
    displayName: String(p?.displayName || "").trim(),
    card,
    reason,
    contextLabel,
    contextAt,
  };
}

function raiderBlacklistClearAddForm() {
  const reason = document.getElementById("raiderBlacklistReason");
  const ctx = document.getElementById("raiderBlacklistContextLabel");
  const date = document.getElementById("raiderBlacklistContextDate");
  if (reason) reason.value = "";
  if (ctx) ctx.value = "";
  if (date) date.value = "";
  raiderBlacklistSelectedPlayer = null;
  raiderBlacklistUpdateSelectedPlayerLabel();
  const results = document.getElementById("raiderBlacklistSearchResults");
  if (results) {
    results.hidden = true;
    results.innerHTML = "";
  }
}

async function raiderBlacklistSearchIdentities(query) {
  const q = String(query || "").trim();
  const host = document.getElementById("raiderBlacklistSearchResults");
  if (!host) return;
  if (q.length < 2) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  try {
    const payload = await getJson(`/api/admin/identity/accounts?q=${encodeURIComponent(q)}`);
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts.slice(0, 12) : [];
    if (!accounts.length) {
      host.hidden = false;
      host.innerHTML = `<p class="subtle">No identities match.</p>`;
      return;
    }
    host.hidden = false;
    host.innerHTML = accounts
      .map(
        (acc) =>
          `<button type="button" class="admin-raider-blacklist-pick" data-raider-blacklist-pick="${esc(
            String(acc.id)
          )}" data-display-name="${esc(String(acc.displayName || ""))}" data-discord-id="${esc(
            String(acc.discordUserId || "")
          )}">${esc(String(acc.displayName || acc.id))} · ${esc(String(acc.guildRole || "Peon"))}</button>`
      )
      .join("");
  } catch {
    host.hidden = false;
    host.innerHTML = `<p class="subtle">Identity search failed.</p>`;
  }
}

function renderHofNotesTable(payload) {
  const host = document.getElementById("adminHofNotesTable");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Hall of Fame quotes unavailable.</p>`;
    return;
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) {
    host.innerHTML = `<p class="subtle">No Hall of Fame winners found yet.</p>`;
    return;
  }
  host.innerHTML = `
    <div class="admin-table-wrap role-alert-candidates-wrap">
      <table class="admin-table role-alert-candidates-table">
        <thead>
          <tr><th>Winner</th><th>Raid</th><th>Date</th><th>Quote</th><th>Updated</th><th>Save</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr data-hof-note-row="${esc(String(row.winnerRaidKey || ""))}"
                data-hof-note-round-key="${esc(String(row.roundKey || ""))}"
                data-hof-note-raid-code="${esc(String(row.raidCode || ""))}"
                data-hof-note-winner-name="${esc(String(row.winnerName || ""))}">
                <td>${esc(String(row.winnerName || "-"))}</td>
                <td>${esc(String(row.raidName || row.raidCode || "-"))}</td>
                <td>${esc(fmtWhen(row.raidStartTime))}</td>
                <td>
                  <textarea
                    class="admin-input"
                    data-hof-note-quote
                    rows="2"
                    maxlength="320"
                    placeholder="Type quote..."
                  >${esc(String(row.quote || ""))}</textarea>
                </td>
                <td class="subtle">${esc(row.updatedAt ? `${fmtWhen(row.updatedAt)}${row.updatedBy ? ` · ${row.updatedBy}` : ""}` : "-")}</td>
                <td>
                  <button type="button" class="event-signup-btn" data-hof-note-save="${esc(String(row.winnerRaidKey || ""))}">Save</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderBadgeTooltipsTable(payload) {
  const host = document.getElementById("adminBadgeTooltipsTable");
  if (!host) return;
  if (!payload || payload.ok === false) {
    badgeTooltipsRowsState = [];
    host.innerHTML = `<p class="subtle">Badge management unavailable.</p>`;
    return;
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  badgeTooltipsRowsState = rows.map((row) => ({
    badgeId: String(row.badgeId || ""),
    categoryLabel: String(row.categoryLabel || ""),
    name: String(row.name || ""),
    icon: String(row.icon || ""),
    rarity: String(row.rarity || ""),
    defaultRarity: String(row.defaultRarity || row.rarity || ""),
    description: String(row.description || ""),
    defaultDescription: String(row.defaultDescription || ""),
    hasOverride: Boolean(row.hasOverride),
    updatedAt: Number(row.updatedAt || 0),
    updatedBy: String(row.updatedBy || ""),
  }));
  if (!badgeTooltipsRowsState.length) {
    host.innerHTML = `<p class="subtle">No badges found in the catalog.</p>`;
    return;
  }
  host.innerHTML = `
    <div class="admin-table-wrap role-alert-candidates-wrap">
      <table class="admin-table role-alert-candidates-table admin-badge-tooltips-table">
        <thead>
          <tr><th>Category</th><th>Badge</th><th>Rarity</th><th>Tooltip description</th><th>Updated</th><th>Reset</th></tr>
        </thead>
        <tbody>
          ${badgeTooltipsRowsState
            .map(
              (row) => `<tr data-badge-tooltip-row="${esc(row.badgeId)}">
                <td>${esc(row.categoryLabel || "-")}</td>
                <td>
                  <div class="admin-badge-tooltip-badge">
                    ${row.icon ? `<img src="${esc(row.icon)}" alt="" loading="lazy" decoding="async" />` : ""}
                    <div>
                      <strong>${esc(row.name || row.badgeId)}</strong>
                      <div class="subtle">${esc(row.badgeId)}</div>
                    </div>
                  </div>
                </td>
                <td>
                  ${badgeRaritySelectHtml(row.rarity)}
                  <div class="subtle admin-badge-tooltip-default">Default: ${esc(row.defaultRarity || "-")}</div>
                </td>
                <td>
                  <textarea
                    class="admin-input"
                    data-badge-tooltip-description
                    rows="3"
                    maxlength="600"
                    placeholder="${esc(row.defaultDescription || "Tooltip description")}"
                  >${esc(row.description || "")}</textarea>
                  <div class="subtle admin-badge-tooltip-default">Default: ${esc(row.defaultDescription || "-")}</div>
                </td>
                <td class="subtle">${esc(row.hasOverride && row.updatedAt ? `${fmtWhen(row.updatedAt)}${row.updatedBy ? ` · ${row.updatedBy}` : ""}` : "default")}</td>
                <td>
                  <button type="button" class="event-signup-btn event-signup-btn--softres" data-badge-tooltip-reset="${esc(row.badgeId)}">Reset to defaults</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function badgeRaritySelectHtml(current) {
  const selected = BADGE_RARITIES.includes(String(current || "").trim()) ? String(current).trim() : "epic";
  return `<select class="admin-input admin-badge-rarity-select" data-badge-tooltip-rarity aria-label="Badge rarity">${BADGE_RARITIES.map(
    (rarity) => `<option value="${esc(rarity)}"${rarity === selected ? " selected" : ""}>${esc(rarity)}</option>`
  ).join("")}</select>`;
}

async function loadBadgeTooltipsPanel() {
  const payload = await getJson("/api/admin/badge-tooltips");
  renderBadgeTooltipsTable(payload);
}

function readBadgeTooltipsFromTable() {
  const rows = [];
  document.querySelectorAll("[data-badge-tooltip-row]").forEach((tr) => {
    const badgeId = String(tr.getAttribute("data-badge-tooltip-row") || "").trim();
    if (!badgeId) return;
    const description = String(tr.querySelector("[data-badge-tooltip-description]")?.value || "").trim();
    const rarity = String(tr.querySelector("[data-badge-tooltip-rarity]")?.value || "").trim();
    rows.push({ badgeId, description, rarity });
  });
  return rows;
}

async function loadAnalyticsPanel() {
  const daysInput = document.getElementById("adminAnalyticsDays");
  const days = Math.max(1, Math.min(365, Number(daysInput?.value || 30) || 30));
  if (daysInput) daysInput.value = String(days);
  const [analyticsPayload, subscribersPayload] = await Promise.all([
    getJson(`/api/admin/analytics/summary?days=${days}`),
    getJson("/api/admin/subscribers"),
  ]);
  renderAnalyticsDashboard(analyticsPayload);
  renderSubscribers(subscribersPayload);
  updateAnalyticsRangeButtons();
}

async function loadHofNotesPanel() {
  const payload = await getJson("/api/admin/hof-notes");
  renderHofNotesTable(payload);
}

async function loadPublicSnapshotStatus() {
  const payload = await getJson("/api/admin/public-snapshot/status");
  renderPublicSnapshotStatus(payload);
}

const wclPhaseAvgsSort = { key: "characterName", dir: "asc" };

let wclPhaseAvgsPollTimer = null;
let wclPhaseAvgsLastUpdatedAt = 0;
let wclPhaseAvgsCachedRenderKey = "";

/** Panels that should not block on the full secondary admin bundle (loot, analytics, DMs, …). */
const ADMIN_PANELS_DEFER_SECONDARY = new Set(["identity", "wcl-phase-avgs", "character-kpis"]);

let adminCharKpiState = null;
let adminCharKpiLoaded = false;
let adminCharKpiClassSlug = "";
let adminCharKpiSpecFilter = "all";
let adminCharKpiSearch = "";
let adminCharKpiListenersBound = false;

/** Current raid phase for Character KPIs sort (P2 = SSC & TK). */
const ADMIN_CHAR_KPI_CURRENT_PHASE = {
  phaseKey: "sscTk",
  label: "SSC/TK",
  sortLabel: "P2 SSC/TK WCL phase avg",
};

function adminCharKpiCurrentPhaseAvg(player) {
  const n = Number(player?.phaseAvgs?.[ADMIN_CHAR_KPI_CURRENT_PHASE.phaseKey]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fmtAdminCharKpiUpdated(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "never";
  return new Date(n).toLocaleString();
}

function adminCharKpiPlayersFiltered() {
  const players = Array.isArray(adminCharKpiState?.players) ? adminCharKpiState.players : [];
  const q = String(adminCharKpiSearch || "").trim().toLowerCase();
  const classSlug =
    adminCharKpiClassSlug ||
    adminCharKpiState?.filters?.classes?.[0]?.slug ||
    "";
  const spec = adminCharKpiSpecFilter;
  const filtered = players.filter((p) => {
    if (classSlug && String(p._filterClassSlug || "unknown") !== classSlug) return false;
    if (spec && spec !== "all" && String(p._filterSpec || "—") !== spec) return false;
    if (!q) return true;
    const hay = [p.characterName, p.name, p.className, p.specName, p.guildRole, p.raiderIoClassName]
      .map((v) => String(v || "").toLowerCase())
      .join(" ");
    return hay.includes(q);
  });
  return filtered.sort((a, b) => {
    const sa = adminCharKpiCurrentPhaseAvg(a);
    const sb = adminCharKpiCurrentPhaseAvg(b);
    if (sa == null && sb == null) {
      return String(a.characterName || "").localeCompare(String(b.characterName || ""), undefined, {
        sensitivity: "base",
      });
    }
    if (sa == null) return 1;
    if (sb == null) return -1;
    if (sb !== sa) return sb - sa;
    return String(a.characterName || "").localeCompare(String(b.characterName || ""), undefined, {
      sensitivity: "base",
    });
  });
}

function renderAdminCharKpiClassTabs() {
  const host = document.getElementById("adminCharKpiClassTabs");
  if (!host || !adminCharKpiState?.filters?.classes?.length) return;
  const classes = adminCharKpiState.filters.classes;
  const active = adminCharKpiClassSlug || classes[0]?.slug || "";
  host.innerHTML = classes
    .map((c) => {
      const on = c.slug === active;
      return `<button type="button" class="admin-char-kpi-class-tab${on ? " is-active" : ""}" role="tab" aria-selected="${on ? "true" : "false"}" data-char-kpi-class="${esc(c.slug)}">${esc(c.label)} <span class="admin-char-kpi-tab-count">${Number(c.count) || 0}</span></button>`;
    })
    .join("");
}

function renderAdminCharKpiSpecFilters() {
  const host = document.getElementById("adminCharKpiSpecFilters");
  if (!host || !adminCharKpiState?.filters?.specsByClass) return;
  const classSlug =
    adminCharKpiClassSlug || adminCharKpiState.filters.classes?.[0]?.slug || "";
  const specs = adminCharKpiState.filters.specsByClass[classSlug] || [];
  const active = adminCharKpiSpecFilter || "all";
  const chips = [
    `<button type="button" class="admin-char-kpi-spec-chip${active === "all" ? " is-active" : ""}" data-char-kpi-spec="all">All specs</button>`,
    ...specs.map((s) => {
      const on = active === s;
      return `<button type="button" class="admin-char-kpi-spec-chip${on ? " is-active" : ""}" data-char-kpi-spec="${esc(s)}">${esc(s)}</button>`;
    }),
  ];
  host.innerHTML = chips.join("");
}

function renderAdminCharKpiGrid() {
  const host = document.getElementById("adminCharKpiGrid");
  const meta = document.getElementById("adminCharKpiMeta");
  const plb = window.plbEventsRoster;
  if (!host) return;
  const filtered = adminCharKpiPlayersFiltered();
  if (meta && adminCharKpiState) {
    const st = adminCharKpiState;
    meta.textContent = `${st.totalCharacters} registered characters · sorted by ${ADMIN_CHAR_KPI_CURRENT_PHASE.sortLabel} (high → low, no data last) · ${st.withRosterMatch} with WCL roster KPIs · ${st.withPhaseAvgs} with phase avgs · cache ${fmtAdminCharKpiUpdated(st.phaseAvgsUpdatedAt)}. Alts on one Discord account may share attendance/parse.`;
  }
  if (!plb?.rosterRaiderCard) {
    host.innerHTML = `<p class="subtle">Roster UI failed to load (events-roster-ui.js).</p>`;
    return;
  }
  if (!filtered.length) {
    host.innerHTML = `<p class="subtle">No characters match the current filters.</p>`;
    return;
  }
  const all = adminCharKpiState.players;
  const classSlug =
    adminCharKpiClassSlug || adminCharKpiState.filters.classes?.[0]?.slug || "";
  const classPool = classSlug
    ? all.filter((p) => String(p._filterClassSlug || "unknown") === classSlug)
    : all;
  const gsHeat = plb.collectRosterGsHeatmapStats?.(classPool) || { gsMin: NaN, gsMax: NaN };
  const cardOpts = {
    kpiMode: "full",
    showGearSummary: false,
    showBadges: false,
    nameOnTop: true,
    gsHeatMin: gsHeat.gsMin,
    gsHeatMax: gsHeat.gsMax,
  };
  host.innerHTML = `<div class="raider-grid admin-char-kpi-grid">${filtered
    .map((p) => plb.rosterRaiderCard(p, all, cardOpts))
    .join("")}</div>`;
  void plb.prefetchRosterProfilePictures?.(filtered);
  window.WowItemTooltip?.bindLootTooltipHandlers?.(host, () => null);
}

function ensureAdminCharKpiListeners() {
  if (adminCharKpiListenersBound) return;
  adminCharKpiListenersBound = true;
  document.getElementById("adminCharKpiClassTabs")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-char-kpi-class]");
    if (!btn) return;
    adminCharKpiClassSlug = btn.getAttribute("data-char-kpi-class") || "";
    adminCharKpiSpecFilter = "all";
    renderAdminCharKpiClassTabs();
    renderAdminCharKpiSpecFilters();
    renderAdminCharKpiGrid();
  });
  document.getElementById("adminCharKpiSpecFilters")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-char-kpi-spec]");
    if (!btn) return;
    adminCharKpiSpecFilter = btn.getAttribute("data-char-kpi-spec") || "all";
    renderAdminCharKpiSpecFilters();
    renderAdminCharKpiGrid();
  });
  let searchTimer = null;
  document.getElementById("adminCharKpiSearch")?.addEventListener("input", (event) => {
    adminCharKpiSearch = String(event.target?.value || "");
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => renderAdminCharKpiGrid(), 140);
  });
  document.getElementById("adminCharKpiReloadBtn")?.addEventListener("click", () => {
    adminCharKpiLoaded = false;
    loadAdminCharacterKpiPanel().catch((error) => {
      status(error?.message || "Failed to reload character KPIs.");
    });
  });
  document.getElementById("adminCharKpiGoPhaseAvgsBtn")?.addEventListener("click", () => {
    showAdminPanel("wcl-phase-avgs");
  });
}

async function loadAdminCharacterKpiPanel(opts = {}) {
  const silent = Boolean(opts.silent);
  const meta = document.getElementById("adminCharKpiMeta");
  const host = document.getElementById("adminCharKpiGrid");
  const plb = window.plbEventsRoster;
  ensureAdminCharKpiListeners();
  if (!silent && meta) meta.textContent = "Loading characters…";
  if (!silent && host) host.innerHTML = "";
  try {
    if (plb) {
      await Promise.all([plb.loadTbcSpecIconMap(), plb.loadWclAttendanceForEvents()]);
    }
    const payload = await getJson("/api/admin/character-kpi-overview");
    adminCharKpiState = payload;
    adminCharKpiLoaded = true;
    if (!adminCharKpiClassSlug && payload.filters?.classes?.length) {
      adminCharKpiClassSlug = payload.filters.classes[0].slug;
    }
    renderAdminCharKpiClassTabs();
    renderAdminCharKpiSpecFilters();
    renderAdminCharKpiGrid();
  } catch (error) {
    if (!silent) {
      if (meta) meta.textContent = error?.message || "Failed to load character KPIs.";
      if (host) host.innerHTML = "";
    }
    throw error;
  }
}

function stopWclPhaseAvgsPoll() {
  if (wclPhaseAvgsPollTimer) {
    clearInterval(wclPhaseAvgsPollTimer);
    wclPhaseAvgsPollTimer = null;
  }
}

function startWclPhaseAvgsPoll() {
  stopWclPhaseAvgsPoll();
  wclPhaseAvgsPollTimer = setInterval(() => {
    if (!document.getElementById("admin-panel-wcl-phase-avgs")?.classList.contains("is-admin-panel-active")) {
      stopWclPhaseAvgsPoll();
      return;
    }
    loadWclPhaseAvgsPanel({ silent: true }).catch(() => {});
  }, 2000);
}

function wclPhaseAvgsTableRenderKey(payload) {
  const progress = payload?.meta?.progress || {};
  const refreshing = Boolean(payload?.meta?.refreshing);
  const doneBucket = refreshing ? Math.floor(Number(progress.done || 0) / 5) : "";
  return [
    payload?.updatedAt,
    payload?.characters?.length,
    refreshing,
    doneBucket,
    progress.total,
    wclPhaseAvgsSort.key,
    wclPhaseAvgsSort.dir,
  ].join("|");
}

function formatWclPhaseAvgCell(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return `<span class="subtle">—</span>`;
  }
  const tier = roleAlertPeakParseTierClass(n);
  return `<span class="leaderboard-peak-parse ${tier}" title="WCL Best Perf. Avg">${esc(n.toFixed(1))}</span>`;
}

function wclPhaseAvgsSortValue(row, key) {
  if (key === "characterName") return String(row?.characterName || "").toLowerCase();
  if (key === "realm") return String(row?.realm || "").toLowerCase();
  const n = Number(row?.[key]);
  return Number.isFinite(n) ? n : -1;
}

function renderWclPhaseAvgsTable(payload) {
  const host = document.getElementById("wclPhaseAvgsTableHost");
  if (!host) return;
  if (!payload?.ok) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Failed to load WCL phase averages.")}</p>`;
    return;
  }
  const rows = Array.isArray(payload.characters) ? [...payload.characters] : [];
  const key = wclPhaseAvgsSort.key;
  const dir = wclPhaseAvgsSort.dir === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    const da = wclPhaseAvgsSortValue(a, key);
    const db = wclPhaseAvgsSortValue(b, key);
    if (typeof da === "string" && typeof db === "string") {
      const c = da.localeCompare(db, undefined, { sensitivity: "base" });
      return c !== 0 ? c * dir : 0;
    }
    return (da - db) * dir || String(a.characterName).localeCompare(String(b.characterName), undefined, { sensitivity: "base" });
  });

  const sortBtn = (col, label) => {
    const active = wclPhaseAvgsSort.key === col;
    const arrow = active ? (wclPhaseAvgsSort.dir === "asc" ? " ▲" : " ▼") : "";
    return `<button type="button" class="admin-table-sort-btn" data-wcl-phase-sort="${esc(col)}">${esc(label)}${arrow}</button>`;
  };

  if (!rows.length) {
    host.innerHTML = `<p class="subtle">No characters in roster DB yet. Run a refresh after adding characters in Identity Management.</p>`;
    return;
  }

  const body = rows
    .map((row) => {
      const errTitle =
        Array.isArray(row.errors) && row.errors.length ? row.errors.join(" · ") : "";
      const rowAttr = errTitle
        ? ` class="admin-wcl-phase-row--warn" title="${esc(errTitle)}"`
        : "";
      const wclHref = row.wclUrl ? esc(row.wclUrl) : "#";
      return `<tr${rowAttr}>
        <td>${esc(row.characterName || "—")}</td>
        <td class="subtle">${esc(row.realm || "—")}</td>
        <td>${formatWclPhaseAvgCell(row.karaBestPerfAvg)}</td>
        <td>${formatWclPhaseAvgCell(row.gruulMagBestPerfAvg)}</td>
        <td>${formatWclPhaseAvgCell(row.sscTkBestPerfAvg)}</td>
        <td><a href="${wclHref}" target="_blank" rel="noopener noreferrer">WCL</a></td>
      </tr>`;
    })
    .join("");

  host.innerHTML = `<table class="admin-table admin-wcl-phase-table">
    <thead><tr>
      <th>${sortBtn("characterName", "Character")}</th>
      <th>${sortBtn("realm", "Realm")}</th>
      <th>${sortBtn("karaBestPerfAvg", "Kara")}</th>
      <th>${sortBtn("gruulMagBestPerfAvg", "Gruul/Mag")}</th>
      <th>${sortBtn("sscTkBestPerfAvg", "SSC/TK")}</th>
      <th>WCL</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function updateWclPhaseAvgsStatusLine(payload) {
  const el = document.getElementById("wclPhaseAvgsStatusLine");
  if (!el) return;
  const meta = payload?.meta || {};
  const progress = meta.progress || {};
  const updatedAt = Number(payload?.updatedAt || 0);
  const parts = [];
  if (progress.refreshing) {
    parts.push(
      `Refreshing… ${Number(progress.done || 0)} / ${Number(progress.total || 0)} character(s)`
    );
    if (progress.lastError) parts.push(`Last error: ${progress.lastError}`);
  } else if (updatedAt > 0) {
    parts.push(`Last updated ${new Date(updatedAt).toLocaleString()}`);
    parts.push(`${Number(meta.characterCount || 0)} character(s)`);
    if (Number(meta.errorCount || 0) > 0) {
      parts.push(`${Number(meta.errorCount)} with errors`);
    }
  } else {
    parts.push("No cached data yet — click Refresh all to fetch from Warcraft Logs Fresh.");
  }
  el.textContent = parts.join(" · ");
}

function adminLoginNextUrl() {
  const hash = String(location.hash || "").trim();
  return encodeURIComponent(`/admin.html${hash || "#admin-wcl-phase-avgs"}`);
}

function wclPhaseAvgsLoadErrorHtml(error) {
  const msg = String(error?.message || "");
  if (/login required/i.test(msg)) {
    const loginHref = `/auth/discord/login?next=${adminLoginNextUrl()}`;
    return `<p class="subtle">Your admin session expired (this often happens after restarting the API). <a href="${esc(
      loginHref
    )}">Log in with Discord</a> and reopen this section.</p>`;
  }
  if (/404/.test(msg)) {
    return `<p class="subtle">WCL Phase Averages API not found (404). Restart the API server (npm run dev or npm start) so it loads the latest server.js.</p>`;
  }
  return `<p class="subtle">${esc(msg || "Failed to load WCL phase averages.")}</p>`;
}

function wclPhaseAvgsLoadErrorMessage(error) {
  const msg = String(error?.message || "");
  if (/login required/i.test(msg)) {
    return "Session expired — log in with Discord again (common after restarting the API).";
  }
  if (/404/.test(msg)) {
    return "WCL Phase Averages API not found (404). Restart the API server (npm run dev or npm start) so it loads the latest server.js.";
  }
  return msg || "Failed to load WCL phase averages.";
}

async function loadWclPhaseAvgsPanel({ silent = false, forceRender = false } = {}) {
  let payload;
  try {
    payload = await getJson("/api/admin/wcl-phase-avgs");
  } catch (error) {
    const host = document.getElementById("wclPhaseAvgsTableHost");
    const line = document.getElementById("wclPhaseAvgsStatusLine");
    const message = wclPhaseAvgsLoadErrorMessage(error);
    if (host) host.innerHTML = wclPhaseAvgsLoadErrorHtml(error);
    if (line) line.textContent = message;
    if (!silent) status(message);
    throw error;
  }
  const renderKey = wclPhaseAvgsTableRenderKey(payload);
  if (forceRender || renderKey !== wclPhaseAvgsCachedRenderKey) {
    renderWclPhaseAvgsTable(payload);
    wclPhaseAvgsCachedRenderKey = renderKey;
  }
  updateWclPhaseAvgsStatusLine(payload);
  const refreshing = Boolean(payload?.meta?.refreshing);
  const refreshBtn = document.getElementById("wclPhaseAvgsRefreshBtn");
  if (refreshBtn) refreshBtn.disabled = refreshing;
  if (refreshing) {
    startWclPhaseAvgsPoll();
  } else {
    stopWclPhaseAvgsPoll();
    const updatedAt = Number(payload?.updatedAt || 0);
    if (updatedAt > wclPhaseAvgsLastUpdatedAt && !silent) {
      status("WCL phase averages updated.");
    }
    wclPhaseAvgsLastUpdatedAt = updatedAt;
  }
  return payload;
}


async function refreshWclPhaseAvgsAll(btn) {
  try {
    if (btn) setButtonFeedback(btn, "Starting…", "loading");
    const started = await getJson("/api/admin/wcl-phase-avgs/refresh", { method: "POST" });
    status(
      started?.alreadyRunning
        ? "Refresh already running."
        : started?.message || "WCL phase refresh started."
    );
    wclPhaseAvgsLastUpdatedAt = 0;
    wclPhaseAvgsCachedRenderKey = "";
    startWclPhaseAvgsPoll();
    await loadWclPhaseAvgsPanel({ silent: true, forceRender: true });
  } finally {
    if (btn) resetButtonFeedback(btn, "Refresh all");
  }
}

async function loadAdminSecondaryData() {
  const gargul = await getJson("/api/loot-history/gargul");
  // Live WCL guild reports for Event Management — materialised `/api/loot-history`
  // only knows reports already in `loot_awards` / `raid_appearances` after sync, so
  // new uploads would be missing from the checkbox list until `refresh=1`.
  const loot = await getJson("/api/loot-history?limit=40&refresh=1");
  const p2 = await getJson("/api/p2-preparation/materials");
  const joinNeeds = await getJson("/api/admin/join/current-needs");
  const roleAlertEvents = await getJson("/api/admin/role-alerts/events");
  allRaidsState = Array.isArray(loot?.allRaids) ? loot.allRaids : Array.isArray(loot?.raids) ? loot.raids : [];
  selectedReportCodesState = new Set(Array.isArray(gargul?.selectedReportCodes) ? gargul.selectedReportCodes : []);
  const entries = Array.isArray(gargul?.rows) ? gargul.rows : [];
  renderEventSelection();
  renderTargetReportSelect();
  renderLootEditor(entries);
  renderP2Table(Array.isArray(p2.materials) ? p2.materials : []);
  try {
    await loadAdminP2DemandPanel();
  } catch (error) {
    const host = document.getElementById("adminP2DemandTableHost");
    if (host) host.innerHTML = `<p class="subtle">${esc(error?.message || "Failed to load P2 demand.")}</p>`;
    status(`P2 demand load failed: ${error?.message || "Unknown error"}`);
  }
  renderJoinNeedsTable(Array.isArray(joinNeeds?.rows) ? joinNeeds.rows : []);
  try {
    await loadPublicSnapshotStatus();
  } catch (error) {
    renderPublicSnapshotStatus({ ok: false });
    status(`Snapshot status failed: ${error?.message || "Unknown error"}`);
  }
  try {
    await loadAnalyticsPanel();
  } catch (error) {
    renderAnalyticsDashboard({ ok: false });
    renderSubscribers({ ok: false });
    status(`Analytics load failed: ${error?.message || "Unknown error"}`);
  }
  try {
    await loadHofNotesPanel();
  } catch (error) {
    renderHofNotesTable({ ok: false });
    status(`Hall of Fame quotes load failed: ${error?.message || "Unknown error"}`);
  }
  try {
    await loadRaiderBlacklistPanel();
  } catch (error) {
    renderRaiderBlacklistTable({ ok: false });
    status(`Raider blacklist load failed: ${error?.message || "Unknown error"}`);
  }
  try {
    await loadBadgeTooltipsPanel();
  } catch (error) {
    renderBadgeTooltipsTable({ ok: false });
    status(`Badge tooltips load failed: ${error?.message || "Unknown error"}`);
  }
  renderRoleAlertsEventSelect(Array.isArray(roleAlertEvents?.events) ? roleAlertEvents.events : []);
  /** Do not clear an in-progress Role Alerts analysis every time secondary data reloads (race with deferred load or Gargul reload). */
  if (!roleAlertsSelectedEventId()) renderRoleAlertsAnalysis(null);
  try {
    await loadCustomDmCandidates();
  } catch (error) {
    const host = document.getElementById("customDmHost");
    if (host) host.innerHTML = `<p class="subtle">Failed to load DM candidates: ${esc(error?.message || "Unknown error")}</p>`;
  }
  try {
    await loadDiscordNewsStatus();
  } catch (error) {
    renderDiscordNewsStatus({ ok: false });
    status(`Discord news status failed: ${error?.message || "Unknown error"}`);
  }
  await loadDiscordNewsRoles();
  await loadDiscordNewsQueue().catch((error) => {
    renderDiscordNewsQueue({ queue: [] });
    status(`Discord news queue failed: ${error?.message || "Unknown error"}`);
  });
}

async function loadAdminData() {
  const me = await getJson("/api/auth/me");
  const rhHost = document.getElementById("rhWclLinksTableHost");
  if (!me.authenticated || !me.isAdmin) {
    status("Admin access required (HighBullet editor account).");
    if (rhHost) {
      rhHost.innerHTML = `<p class="subtle">Log in with an authorized admin account to edit identities.</p>`;
    }
    return;
  }
  status(`Logged in as ${me?.user?.globalName || me?.user?.username || "Admin"}`);

  const activePanel = document.querySelector(".admin-panel.is-admin-panel-active")?.getAttribute("data-admin-panel") || "identity";
  if (ADMIN_PANELS_DEFER_SECONDARY.has(activePanel)) {
    setTimeout(() => {
      loadAdminSecondaryData().catch((error) => {
        status(`Background admin data load failed: ${error?.message || "Unknown error"}`);
      });
    }, 0);
    if (activePanel === "identity") {
      await Promise.allSettled([loadIdentityAccounts({ silent: false }), loadIdentityJourney({ silent: false })]);
    }
    if (activePanel === "character-kpis" && !adminCharKpiLoaded) {
      await loadAdminCharacterKpiPanel({ silent: false });
    }
    return;
  }

  await loadAdminSecondaryData();
}

async function importJsonFromTextarea() {
  const textarea = document.getElementById("gargulJsonInput");
  const raw = String(textarea?.value || "").trim();
  if (!raw) throw new Error("Paste Gargul JSON first.");
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
  if (!Array.isArray(entries)) throw new Error("JSON must be an array or { entries: [...] }");
  const reportCode = String(document.getElementById("gargulTargetReport")?.value || "").trim();
  await getJson("/api/loot-history/gargul/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries, ...(reportCode ? { reportCode } : {}) }),
  });
}

document.getElementById("gargulImportBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("gargulImportBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Import JSON", loading: "Importing...", success: "Import complete", failure: "Import failed" },
      async () => {
        await importJsonFromTextarea();
        await loadAdminData();
      }
    );
    status("Gargul loot imported successfully.");
  } catch (error) {
    status(error?.message || "Import failed");
  }
});

document.getElementById("gargulReloadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("gargulReloadBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Reload Entries", loading: "Reloading...", success: "Reloaded", failure: "Reload failed" },
      async () => {
        await loadAdminData();
      }
    );
    status("Reloaded admin data.");
  } catch (error) {
    status(error?.message || "Reload failed");
  }
});

document.getElementById("gargulSaveBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("gargulSaveBtn");
  try {
    const entries = readLootEditorEntries();
    await runWithButtonFeedback(
      btn,
      { idle: "Save Corrections", loading: "Saving...", success: "Saved", failure: "Save failed" },
      async () => {
        await getJson("/api/loot-history/gargul/entries", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries }),
        });
      }
    );
    status(`Saved ${entries.length} loot entries.`);
  } catch (error) {
    status(error?.message || "Save failed");
  }
});

document.getElementById("eventImportBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("eventImportBtn");
  const input = document.getElementById("eventImportUrl");
  const url = String(input?.value || "").trim();
  if (!url) {
    status("Paste a Warcraft Logs report URL first.");
    input?.focus();
    return;
  }
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Add to list", loading: "Importing…", success: "Added", failure: "Import failed" },
      async () => {
        const res = await getJson("/api/loot-history/events/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (!res?.ok) throw new Error(res?.error || "Import failed");
        mergeRaidIntoAllRaidsState(res.report);
        if (Array.isArray(res.selectedReportCodes)) {
          selectedReportCodesState = new Set(
            res.selectedReportCodes.map((x) => String(x || "").trim()).filter(Boolean)
          );
        } else if (res.selectionAppended && res.report?.reportCode) {
          selectedReportCodesState.add(String(res.report.reportCode));
        }
        renderEventSelection();
        renderTargetReportSelect();
        if (input) input.value = "";
        const label = res.report?.reportTitle || res.report?.reportCode || "report";
        status(res.note || `Imported “${label}” (${res.raidAppearancesRowsWritten ?? 0} roster links).`);
      }
    );
  } catch (error) {
    status(error?.message || "Import failed");
  }
});

document.getElementById("eventImportUrl")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  document.getElementById("eventImportBtn")?.click();
});

document.getElementById("saveEventSelectionBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("saveEventSelectionBtn");
  try {
    const checked = [...document.querySelectorAll("[data-event-report]:checked")].map((el) =>
      String(el.getAttribute("data-event-report") || "").trim()
    );
    await runWithButtonFeedback(
      btn,
      { idle: "Save Event Selection", loading: "Saving...", success: "Events updated", failure: "Update failed" },
      async () => {
        await getJson("/api/loot-history/events/selection", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportCodes: checked }),
        });
      }
    );
    selectedReportCodesState = new Set(checked);
    status(`Saved event visibility (${checked.length} selected).`);
  } catch (error) {
    status(error?.message || "Failed to save event selection");
  }
});

document.addEventListener("click", (event) => {
  const selectAll = event.target.closest("#selectAllEventsBtn");
  if (selectAll) {
    document.querySelectorAll("[data-event-report]").forEach((el) => {
      el.checked = true;
    });
    status("Selected all events. Save to apply.");
    return;
  }
  const clearAll = event.target.closest("#clearAllEventsBtn");
  if (clearAll) {
    document.querySelectorAll("[data-event-report]").forEach((el) => {
      el.checked = false;
    });
    status("Cleared all events. Save to apply.");
  }
});

document.getElementById("rhWclAddRowBtn")?.addEventListener("click", () => {
  const links = readRhWclLinksFromTable();
  links.push({ raidHelperName: "", wclCharacterNames: [], guildRole: "Peon" });
  renderRhWclLinksTable(links);
});

document.getElementById("identityReloadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("identityReloadBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Reload identity view", loading: "Reloading…", success: "Reloaded", failure: "Reload failed" },
      async () => refreshIdentityManagement({ silent: false })
    );
    status("Identity view reloaded.");
  } catch (error) {
    status(error?.message || "Identity reload failed");
  }
});

document.getElementById("identityScanProfilesBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("identityScanProfilesBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Scan Discord profile posts", loading: "Scanning…", success: "Scanned", failure: "Scan failed" },
      async () => {
        await getJson("/api/admin/discord-profile-ingest/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 50 }),
        });
        await refreshIdentityManagement({ silent: true });
      }
    );
    status("Discord profile scan complete.");
  } catch (error) {
    status(error?.message || "Discord profile scan failed");
  }
});

document.getElementById("identityRunAutomationBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("identityRunAutomationBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Run identity automation", loading: "Running…", success: "Done", failure: "Failed" },
      async () => {
        await getJson("/api/admin/sync/account-assignment", { method: "POST" });
        await refreshIdentityManagement({ silent: true });
      }
    );
    status("Identity automation finished. Review any remaining backlog items.");
  } catch (error) {
    status(error?.message || "Identity automation failed");
  }
});

document.getElementById("rhWclRefreshBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("rhWclRefreshBtn");
  const dirty = document.querySelector("[data-rh-wcl-row][data-rh-wcl-dirty='1']");
  if (dirty) {
    const ok = window.confirm(
      "There are unsaved row edits (e.g. drag-and-drop assignments). Running automation will reload the table and discard them. Continue anyway?"
    );
    if (!ok) {
      status("Refresh cancelled — Save row / Save all rows first to keep your changes.");
      return;
    }
  }
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Refresh now", loading: "Syncing…", success: "Done", failure: "Failed" },
      async () => {
        const result = await getJson("/api/admin/sync/account-assignment", { method: "POST" });
        const refreshed = await getJson("/api/admin/rh-wcl-links");
        renderRhWclLinksTable(Array.isArray(refreshed?.links) ? refreshed.links : []);
        await loadRhWclTodo();
        await loadIdentityJourney({ silent: true });
        const summary = result?.summary || result?.result || {};
        const auto = summary.autoApplied ?? "?";
        const proposals = summary.proposals ?? "?";
        const verified = summary.verifiedSkipped ?? 0;
        status(
          `Identity automation finished: ${auto} account row(s) checked, ${proposals} suggestion(s) waiting, ${verified} verified row(s) protected.`
        );
      }
    );
  } catch (error) {
    status(error?.message || "Refresh failed");
  }
});

document.getElementById("rhWclGuessBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("rhWclGuessBtn");
  try {
    await runWithButtonFeedback(
      btn,
      {
        idle: "Run heuristic merge",
        loading: "Matching names…",
        success: "Merged",
        failure: "Failed",
      },
      async () => {
        const payload = await getJson("/api/admin/rh-wcl-links/guess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guildId: ADMIN_WCL_GUILD_ID, minScore: 68 }),
        });
        renderRhWclLinksTable(Array.isArray(payload.links) ? payload.links : []);
        renderRhWclRaidSources(payload.recentRaidHelperEvents, payload.recentWarcraftLogsReports);
        renderRhWclUnmatched(payload.stats || {});
        const st = payload.stats || {};
        const rowCount = Array.isArray(payload.links) ? payload.links.length : 0;
        const src = st.raidHelperSource ? ` · RH names: ${st.raidHelperSource}` : "";
        const wclc = typeof st.wclNameCount === "number" ? ` · ${st.wclNameCount} log name(s)` : "";
        const rhN = typeof st.raidHelperSignupCount === "number" ? ` · ${st.raidHelperSignupCount} signup name(s)` : "";
        const orphanN =
          typeof st.orphanGuessPairs === "number" && st.orphanGuessPairs > 0
            ? ` · ${st.orphanGuessPairs} best-effort (below main threshold)`
            : "";
        const un =
          typeof st.unmatchedWclCount === "number" && st.unmatchedWclCount > 0
            ? ` · ${st.unmatchedWclCount} log name(s) still unmatched (assign manually)`
            : "";
        status(
          `Heuristic merge: ${rowCount} row(s), ${st.guessedPairs ?? 0} heuristic guess(es)${orphanN}; ${st.manualLockedWclCount ?? 0} manual WCL locked.${src}${wclc}${rhN}${un} Review before Save.`
        );
      }
    );
  } catch (error) {
    status(error?.message || "Heuristic merge failed");
  }
});

document.getElementById("rhWclLoadLogNamesBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("rhWclLoadLogNamesBtn");
  const ta = document.getElementById("rhWclRecentNamesText");
  try {
    await runWithButtonFeedback(
      btn,
      {
        idle: "Load names from recent logs",
        loading: "Querying Warcraft Logs…",
        success: "Loaded",
        failure: "Failed",
      },
      async () => {
        const payload = await getJson(
          `/api/admin/wcl-attendee-names?guildId=${ADMIN_WCL_GUILD_ID}&limit=40`
        );
        const names = Array.isArray(payload.characterNames) ? payload.characterNames : [];
        if (ta) ta.value = names.join(", ");
        renderRhWclRaidSources([], payload.recentWarcraftLogsReports);
        status(`Loaded ${payload.count ?? names.length} character names from recent raids.`);
      }
    );
  } catch (error) {
    status(error?.message || "Failed to load log names");
  }
});

document.getElementById("rhWclSaveLinksBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("rhWclSaveLinksBtn");
  const links = readRhWclLinksFromTable();
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Save all rows", loading: "Saving…", success: "Saved", failure: "Save failed" },
      async () => {
        await getJson("/api/admin/rh-wcl-links", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ links }),
        });
      }
    );
    try {
      const refreshed = await getJson("/api/admin/rh-wcl-links");
      renderRhWclLinksTable(Array.isArray(refreshed?.links) ? refreshed.links : links);
    } catch {
      renderRhWclLinksTable(links);
    }
    await loadIdentityJourney({ silent: true }).catch(() => {});
    status(`Saved ${links.length} identity row(s).`);
  } catch (error) {
    status(error?.message || "Save failed");
  }
});

document.getElementById("rhWclDeleteAllBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("rhWclDeleteAllBtn");
  const n = [...document.querySelectorAll("[data-rh-wcl-row]")].filter((tr) =>
    String(tr.querySelector('[data-rh-wcl-k="rh"]')?.value || "").trim()
  ).length;
  if (n === 0) {
    status("Nothing to delete — add a Raid Helper name or run heuristic merge first.");
    return;
  }
  const ok = window.confirm(
    `Delete all ${n} character mapping(s) on the server?\n\nThis clears rh-wcl-character-links.json. Events and attendance will fall back until you save new mappings.`
  );
  if (!ok) return;
  try {
    await runWithButtonFeedback(
      btn,
      {
        idle: "Delete all…",
        loading: "Deleting…",
        success: "Cleared",
        failure: "Delete failed",
      },
      async () => {
        await getJson("/api/admin/rh-wcl-links", { method: "DELETE" });
      }
    );
    renderRhWclLinksTable([]);
    renderRhWclRaidSources([], []);
    renderRhWclUnmatched(null);
    status("All character mappings removed from disk.");
  } catch (error) {
    status(error?.message || "Delete all failed");
  }
});

document.addEventListener("click", async (event) => {
  const mainSetBtn = event.target.closest("[data-rh-wcl-main-set]");
  if (mainSetBtn) {
    const tr = mainSetBtn.closest("tr");
    const mainInp = tr?.querySelector('[data-rh-wcl-k="main"]');
    const name = String(mainSetBtn.getAttribute("data-rh-wcl-main-set") || "").trim();
    if (!tr || !mainInp || !name) return;
    mainInp.value = name;
    refreshRhWclMainPickerForRow(tr);
    tr.setAttribute("data-rh-wcl-dirty", "1");
    const td = tr.querySelector(".admin-rh-src-cell");
    if (td) td.innerHTML = `<span class="subtle">Edited — unsaved (use Save row or Save all)</span>`;
    status(`Set “${name}” as row main character (profile main-character can override).`);
    return;
  }

  const addAltBtn = event.target.closest("[data-rh-wcl-add-alt]");
  if (addAltBtn) {
    const tr = addAltBtn.closest("tr");
    if (!tr) return;
    addAltBtn.disabled = true;
    try {
      await rhWclAppendAltForRow(tr);
    } catch (error) {
      status(error?.message || "Add alt failed");
    } finally {
      addAltBtn.disabled = false;
    }
    return;
  }

  const saveBtn = event.target.closest("[data-rh-wcl-save]");
  if (saveBtn) {
    const tr = saveBtn.closest("tr");
    const row = readRhWclLinkRowFromTr(tr);
    if (!row?.raidHelperName?.trim()) {
      status("Enter a Raid Helper name before saving this row.");
      return;
    }
    saveBtn.disabled = true;
    try {
      const stored = tr?.getAttribute("data-rh-wcl-stored-name");
      const payload = { ...row };
      if (stored !== null && String(stored).trim() !== "") {
        payload.previousRaidHelperName = stored;
      }
      const payloadOut = await getJson("/api/admin/rh-wcl-links/row", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      renderRhWclLinksTable(Array.isArray(payloadOut.links) ? payloadOut.links : []);
      await loadIdentityJourney({ silent: true }).catch(() => {});
      status(`Saved row “${row.raidHelperName}”.`);
    } catch (error) {
      status(error?.message || "Save row failed");
    } finally {
      saveBtn.disabled = false;
    }
    return;
  }

  const verifyBtn = event.target.closest("[data-rh-wcl-verify], [data-rh-wcl-unverify]");
  if (verifyBtn) {
    const unverify = verifyBtn.hasAttribute("data-rh-wcl-unverify");
    const rh = verifyBtn.getAttribute(unverify ? "data-rh-wcl-unverify" : "data-rh-wcl-verify");
    if (!rh) return;
    verifyBtn.disabled = true;
    try {
      const out = await getJson("/api/admin/rh-wcl-links/row/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raidHelperName: rh, unverify }),
      });
      renderRhWclLinksTable(Array.isArray(out?.links) ? out.links : []);
      status(unverify ? `Unverified “${rh}”.` : `Verified “${rh}”.`);
    } catch (error) {
      status(error?.message || (unverify ? "Unverify failed" : "Verify failed"));
    } finally {
      verifyBtn.disabled = false;
    }
    return;
  }

  const createRowBtn = event.target.closest("[data-rh-wcl-create-row]");
  if (createRowBtn) {
    const rh = String(createRowBtn.getAttribute("data-rh-wcl-create-row") || "").trim();
    if (!rh) return;
    const links = readRhWclLinksFromTable();
    const targetKey = rh.toLowerCase();
    const already = links.some((r) => String(r?.raidHelperName || "").trim().toLowerCase() === targetKey);
    if (!already) {
      links.push({ raidHelperName: rh, wclCharacterNames: [], guildRole: "Peon" });
      renderRhWclLinksTable(links);
      const newTr = [...document.querySelectorAll("[data-rh-wcl-row]")].find((tr) => {
        const v = String(tr.querySelector('[data-rh-wcl-k="rh"]')?.value || "").trim().toLowerCase();
        return v === targetKey;
      });
      if (newTr) {
        newTr.setAttribute("data-rh-wcl-dirty", "1");
        const tdSrc = newTr.querySelector(".admin-rh-src-cell");
        if (tdSrc) tdSrc.innerHTML = `<span class="subtle">Edited — unsaved (use Save row or Save all)</span>`;
      }
    }
    removeRhWclTodoChipByRh(rh);
    status(`Added empty row for “${rh}”; click Save row or Save all rows to persist.`);
    return;
  }

  const acceptBtn = event.target.closest("[data-rh-wcl-proposal-accept], [data-rh-wcl-proposal-accept-verify]");
  if (acceptBtn) {
    const verify = acceptBtn.hasAttribute("data-rh-wcl-proposal-accept-verify");
    const wcl = acceptBtn.getAttribute("data-wcl");
    const rh = acceptBtn.getAttribute("data-rh");
    if (!wcl || !rh) return;
    acceptBtn.disabled = true;
    try {
      const out = await getJson("/api/admin/rh-wcl-links/proposals/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wclCharacterName: wcl, raidHelperName: rh, verify }),
      });
      renderRhWclLinksTable(Array.isArray(out?.links) ? out.links : []);
      await loadRhWclTodo();
      await loadIdentityJourney({ silent: true });
      status(`Accepted “${wcl}” → ${rh}${verify ? " (verified)" : ""}.`);
    } catch (error) {
      status(error?.message || "Accept failed");
    } finally {
      acceptBtn.disabled = false;
    }
    return;
  }

  const rejectBtn = event.target.closest("[data-rh-wcl-proposal-reject]");
  if (rejectBtn) {
    const wcl = rejectBtn.getAttribute("data-wcl");
    if (!wcl) return;
    rejectBtn.disabled = true;
    try {
      await getJson("/api/admin/rh-wcl-links/proposals/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wclCharacterName: wcl }),
      });
      await loadRhWclTodo();
      await loadIdentityJourney({ silent: true });
      status(`Rejected “${wcl}”. Will not be re-suggested for 30 days.`);
    } catch (error) {
      status(error?.message || "Reject failed");
    } finally {
      rejectBtn.disabled = false;
    }
    return;
  }

  const restoreIceboxBtn = event.target.closest("[data-rh-wcl-icebox-restore]");
  if (restoreIceboxBtn) {
    const wcl = restoreIceboxBtn.getAttribute("data-wcl");
    if (!wcl) return;
    restoreIceboxBtn.disabled = true;
    try {
      await getJson("/api/admin/rh-wcl-links/proposals/unreject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wclCharacterName: wcl }),
      });
      await loadRhWclTodo();
      await loadIdentityJourney({ silent: true });
      status(`Restored “${wcl}”. Automation can suggest it again.`);
    } catch (error) {
      status(error?.message || "Restore failed");
    } finally {
      restoreIceboxBtn.disabled = false;
    }
    return;
  }

  const profileScanBtn = event.target.closest("[data-discord-profile-scan]");
  if (profileScanBtn) {
    profileScanBtn.disabled = true;
    try {
      const out = await getJson("/api/admin/discord-profile-ingest/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      await loadRhWclTodo();
      await loadIdentityJourney({ silent: true });
      const created = Number(out?.scan?.created || 0);
      status(`Discord profile scan complete. Created ${created} proposal${created === 1 ? "" : "s"}.`);
    } catch (error) {
      status(error?.message || "Discord profile scan failed");
    } finally {
      profileScanBtn.disabled = false;
    }
    return;
  }

  const profileMarkAllBtn = event.target.closest("[data-discord-profile-mark-all]");
  if (profileMarkAllBtn) {
    const block = profileMarkAllBtn.closest("[data-rh-wcl-todo-block='discord-profiles']") || document;
    block.querySelectorAll("[data-discord-profile-select]").forEach((checkbox) => {
      checkbox.checked = true;
    });
    status("Marked all visible Discord profile proposals.");
    return;
  }

  const profileUnmarkAllBtn = event.target.closest("[data-discord-profile-unmark-all]");
  if (profileUnmarkAllBtn) {
    const block = profileUnmarkAllBtn.closest("[data-rh-wcl-todo-block='discord-profiles']") || document;
    block.querySelectorAll("[data-discord-profile-select]").forEach((checkbox) => {
      checkbox.checked = false;
    });
    status("Unmarked all Discord profile proposals.");
    return;
  }

  const profileBulkAcceptBtn = event.target.closest("[data-discord-profile-accept-marked], [data-discord-profile-accept-all]");
  if (profileBulkAcceptBtn) {
    const block = profileBulkAcceptBtn.closest("[data-rh-wcl-todo-block='discord-profiles']") || document;
    const acceptAll = profileBulkAcceptBtn.hasAttribute("data-discord-profile-accept-all");
    const checkboxes = [...block.querySelectorAll("[data-discord-profile-select]")];
    const ids = checkboxes
      .filter((checkbox) => acceptAll || checkbox.checked)
      .map((checkbox) => String(checkbox.value || "").trim())
      .filter(Boolean);
    if (!ids.length) {
      status("Mark at least one Discord profile proposal first.");
      return;
    }
    profileBulkAcceptBtn.disabled = true;
    const previousText = profileBulkAcceptBtn.textContent;
    try {
      let accepted = 0;
      for (const id of ids) {
        profileBulkAcceptBtn.textContent = `Accepting ${accepted + 1}/${ids.length}...`;
        await getJson(`/api/admin/discord-profile-ingest/proposals/${encodeURIComponent(id)}/accept`, {
          method: "POST",
        });
        accepted += 1;
      }
      const linksPayload = await getJson("/api/admin/rh-wcl-links");
      renderRhWclLinksTable(Array.isArray(linksPayload?.links) ? linksPayload.links : []);
      await loadRhWclTodo();
      await loadIdentityJourney({ silent: true });
      status(`Accepted ${accepted} Discord profile proposal${accepted === 1 ? "" : "s"} into Identity Management.`);
    } catch (error) {
      status(error?.message || "Bulk accept Discord profile proposals failed");
      await loadRhWclTodo();
    } finally {
      profileBulkAcceptBtn.textContent = previousText;
      profileBulkAcceptBtn.disabled = false;
    }
    return;
  }

  const profileAcceptBtn = event.target.closest("[data-discord-profile-accept]");
  if (profileAcceptBtn) {
    const id = profileAcceptBtn.getAttribute("data-discord-profile-accept");
    if (!id) return;
    profileAcceptBtn.disabled = true;
    try {
      await getJson(`/api/admin/discord-profile-ingest/proposals/${encodeURIComponent(id)}/accept`, {
        method: "POST",
      });
      const linksPayload = await getJson("/api/admin/rh-wcl-links");
      renderRhWclLinksTable(Array.isArray(linksPayload?.links) ? linksPayload.links : []);
      await loadRhWclTodo();
      await loadIdentityJourney({ silent: true });
      status("Discord profile proposal accepted into Identity Management.");
    } catch (error) {
      status(error?.message || "Accept Discord profile proposal failed");
    } finally {
      profileAcceptBtn.disabled = false;
    }
    return;
  }

  const profileRejectBtn = event.target.closest("[data-discord-profile-reject]");
  if (profileRejectBtn) {
    const id = profileRejectBtn.getAttribute("data-discord-profile-reject");
    if (!id) return;
    profileRejectBtn.disabled = true;
    try {
      await getJson(`/api/admin/discord-profile-ingest/proposals/${encodeURIComponent(id)}/reject`, {
        method: "POST",
      });
      await loadRhWclTodo();
      await loadIdentityJourney({ silent: true });
      status("Discord profile proposal rejected.");
    } catch (error) {
      status(error?.message || "Reject Discord profile proposal failed");
    } finally {
      profileRejectBtn.disabled = false;
    }
    return;
  }

  const rm = event.target.closest("[data-rh-wcl-remove]");
  if (!rm) return;
  const idx = Number(rm.getAttribute("data-rh-wcl-remove"));
  const links = readRhWclLinksFromTable();
  if (!Number.isFinite(idx)) return;
  links.splice(idx, 1);
  renderRhWclLinksTable(links.length ? links : [{ raidHelperName: "", wclCharacterNames: [], guildRole: "Peon" }]);
});

document.getElementById("joinNeedsAddRowBtn")?.addEventListener("click", () => {
  const rows = readJoinNeedsFromTable();
  rows.push({ className: "", specFocus: "", priority: "open" });
  renderJoinNeedsTable(rows);
});

document.getElementById("joinNeedsSaveBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("joinNeedsSaveBtn");
  const rows = readJoinNeedsFromTable();
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Save Current Needs", loading: "Saving...", success: "Saved", failure: "Save failed" },
      async () => {
        const payload = await getJson("/api/admin/join/current-needs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });
        renderJoinNeedsTable(Array.isArray(payload?.rows) ? payload.rows : rows);
      }
    );
    status(`Saved ${rows.length} current need row(s).`);
  } catch (error) {
    status(error?.message || "Failed to save current needs");
  }
});

document.addEventListener("click", (event) => {
  const rm = event.target.closest("[data-join-need-remove]");
  if (!rm) return;
  const idx = Number(rm.getAttribute("data-join-need-remove"));
  if (!Number.isFinite(idx)) return;
  const rows = readJoinNeedsFromTable();
  rows.splice(idx, 1);
  renderJoinNeedsTable(rows);
});

document.getElementById("roleAlertsReloadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("roleAlertsReloadBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Reload events", loading: "Loading...", success: "Loaded", failure: "Failed" },
      async () => {
        const payload = await getJson("/api/admin/role-alerts/events");
        renderRoleAlertsEventSelect(Array.isArray(payload?.events) ? payload.events : []);
        if (roleAlertsSelectedEventId()) void runRoleAlertsAnalyzeFromSelect();
      }
    );
    status("Role-alert event list reloaded.");
  } catch (error) {
    status(error?.message || "Failed to reload role-alert events");
  }
});

document.getElementById("roleAlertsEventSelect")?.addEventListener("change", () => {
  void runRoleAlertsAnalyzeFromSelect();
});

document.getElementById("roleAlertsApplyRaidplanUrlBtn")?.addEventListener("click", () => {
  const input = document.getElementById("roleAlertsRaidplanUrlInput");
  const raw = input?.value ?? "";
  const eventId = extractRaidHelperEventIdFromPaste(raw);
  if (!eventId) {
    status("Paste a raid-helper.xyz raid plan / events link or a numeric event id.");
    return;
  }
  roleAlertsEnsureEventOptionInSelect(eventId, `Event ${eventId} (from link)`);
  void runRoleAlertsAnalyzeFromSelect();
  status(`Analyzing event ${eventId}…`);
});

document.getElementById("roleAlertsRaidplanUrlInput")?.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  document.getElementById("roleAlertsApplyRaidplanUrlBtn")?.click();
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!/^roleAlertsNeed(?:Tanks|Healers|Melee|Ranged)$/.test(String(target.id || ""))) return;
  roleAlertsUpdateDesiredTotal();
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.matches("[data-identity-alt-name]")) return;
  if (event.key !== "Enter") return;
  event.preventDefault();
  target.closest("[data-identity-alt-cell]")?.querySelector("[data-identity-alt-add]")?.click();
});

document.getElementById("roleAlertsSaveTargetsBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("roleAlertsSaveTargetsBtn");
  const eventId = roleAlertsSelectedEventId();
  if (!eventId) {
    status("Select a raid event first.");
    return;
  }
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Save role totals", loading: "Saving...", success: "Saved", failure: "Failed" },
      async () => {
        const payload = await getJson("/api/admin/role-alerts/role-targets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, desiredByRole: roleAlertsReadDesiredByRole() }),
        });
        const savedTargets = payload?.desiredByRole && typeof payload.desiredByRole === "object" ? payload.desiredByRole : {};
        roleAlertsSavedTargetsByEventId.set(eventId, savedTargets);
        if (roleAlertsAnalysisState && String(roleAlertsAnalysisState?.event?.id || "") === eventId) {
          const currentByRole = roleAlertsAnalysisState.currentByRole || {};
          roleAlertsAnalysisState.desiredByRole = savedTargets;
          roleAlertsAnalysisState.missingByRole = Object.fromEntries(
            ROLE_ALERT_ROLES.map((role) => [
              role,
              Math.max(0, Math.floor(Number(savedTargets?.[role] || 0)) - Math.floor(Number(currentByRole?.[role] || 0))),
            ])
          );
          renderRoleAlertsAnalysis(roleAlertsAnalysisState, { preserveComposerDraft: true });
        }
      }
    );
    status("Role totals saved for this event.");
  } catch (error) {
    status(error?.message || "Failed to save role totals");
  }
});

async function sendRoleAlertsDms(btn) {
  const actionBtn = btn || document.getElementById("roleAlertsSendBtn");
  const eventId = roleAlertsSelectedEventId();
  if (!eventId) {
    status("Select a raid event first.");
    return false;
  }
  const targetUserIds = roleAlertsReadTargetUserIds();
  if (!targetUserIds.length) {
    status("Select at least one raider in the matching list.");
    return false;
  }
  try {
    const payload = await runWithButtonFeedback(
      actionBtn,
      { idle: "Send DM to selected raiders", loading: "Sending...", success: "Sent", failure: "Failed" },
      async () =>
        getJson("/api/admin/role-alerts/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            overrides: roleAlertsReadOverrides(),
            desiredByRole: roleAlertsReadDesiredByRole(),
            manualRoleSpecNeeds: roleAlertsReadManualRoleSpecNeeds(),
            targetUserIds,
          }),
        })
    );
    roleAlertsLastSendResult = payload;
    if (roleAlertsAnalysisState) renderRoleAlertsAnalysis(roleAlertsAnalysisState);
    status(
      `Role alert sent. Delivered: ${Number(payload?.deliveredCount || 0)}, skipped: ${Number(
        payload?.skippedCount || 0
      )}.`
    );
    return true;
  } catch (error) {
    status(error?.message || "Failed to send role-alert DMs");
    return false;
  }
}

async function sendCustomDm(btn) {
  const message = String(document.getElementById("customDmMessageInput")?.value || "").trim();
  if (!message) {
    status("Enter a custom message first.");
    return false;
  }
  const targetRoles = customDmReadTargetRoles();
  let targetUserIds = [...customDmSelectedUserIds];
  if (!targetUserIds.length && targetRoles.length) {
    targetUserIds = customDmFilteredRows()
      .filter((row) => Array.isArray(row?.roles) && row.roles.some((r) => targetRoles.includes(String(r))))
      .map((row) => String(row?.userId || "").trim())
      .filter(Boolean);
  }
  if (!targetUserIds.length) {
    status("Select players and/or roles to target.");
    return false;
  }
  const subscribedOnly = Boolean(document.getElementById("customDmSubscribedOnly")?.checked);
  try {
    const payload = await runWithButtonFeedback(
      btn || document.getElementById("customDmSendBtn"),
      { idle: "Send custom DM", loading: "Sending...", success: "Sent", failure: "Failed" },
      async () =>
        getJson("/api/admin/custom-dm/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, targetRoles, targetUserIds, subscribedOnly }),
        })
    );
    status(`Custom DM sent. Delivered: ${Number(payload?.deliveredCount || 0)}, skipped: ${Number(payload?.skippedCount || 0)}.`);
    return true;
  } catch (error) {
    status(error?.message || "Failed to send custom DM");
    return false;
  }
}

async function discordNewsImageUploadPayload() {
  const input = document.getElementById("discordNewsImageFileInput");
  const file = input?.files?.[0] || null;
  if (!file) return null;
  if (!DISCORD_NEWS_IMAGE_MIMES.has(String(file.type || "").toLowerCase())) {
    throw new Error("Uploaded image must be PNG, JPEG, WebP, or GIF.");
  }
  if (file.size > DISCORD_NEWS_IMAGE_MAX_BYTES) {
    throw new Error("Uploaded image is too large (max 5 MB).");
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return {
    name: file.name || "news-image",
    mime: file.type || "application/octet-stream",
    base64: btoa(binary),
  };
}

async function sendDiscordNews(btn) {
  const title = String(document.getElementById("discordNewsTitleInput")?.value || "").trim();
  const message = String(document.getElementById("discordNewsMessageInput")?.value || "").trim();
  const url = String(document.getElementById("discordNewsUrlInput")?.value || "").trim();
  const imageUrl = String(document.getElementById("discordNewsImageUrlInput")?.value || "").trim();
  const roleIds = [...discordNewsSelectedRoleIds];
  if (!title || !message) {
    status("Enter a Discord news title and message first.");
    return false;
  }
  try {
    const imageUpload = await discordNewsImageUploadPayload();
    const payload = await runWithButtonFeedback(
      btn || document.getElementById("discordNewsSendBtn"),
      { idle: "Send news", loading: "Sending...", success: "Sent", failure: "Failed" },
      async () =>
        getJson("/api/admin/discord-news/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, message, url, imageUrl, imageUpload, roleIds }),
        })
    );
    status(`Discord news sent${payload?.messageId ? ` (${payload.messageId})` : ""}.`);
    document.getElementById("discordNewsTitleInput").value = "";
    document.getElementById("discordNewsMessageInput").value = "";
    document.getElementById("discordNewsImageFileInput").value = "";
    await loadDiscordNewsStatus().catch(() => {});
    return true;
  } catch (error) {
    status(error?.message || "Failed to send Discord news");
    return false;
  }
}

async function sendDiscordNewsTest(btn) {
  try {
    const payload = await runWithButtonFeedback(
      btn || document.getElementById("discordNewsTestBtn"),
      { idle: "Send test", loading: "Sending...", success: "Sent", failure: "Failed" },
      async () => getJson("/api/admin/discord-news/test", { method: "POST" })
    );
    status(`Discord news test sent${payload?.messageId ? ` (${payload.messageId})` : ""}.`);
    await loadDiscordNewsStatus().catch(() => {});
    return true;
  } catch (error) {
    status(error?.message || "Failed to send Discord news test");
    return false;
  }
}

document.addEventListener("click", (event) => {
  const addBtn = event.target.closest("[data-role-alert-manual-add]");
  if (addBtn) {
    const role = String(addBtn.getAttribute("data-role-alert-manual-add") || "");
    if (!ROLE_ALERT_ROLES.includes(role)) return;
    if (!roleAlertsAnalysisState || typeof roleAlertsAnalysisState !== "object") return;
    if (!roleAlertsAnalysisState.manualRoleSpecNeeds || typeof roleAlertsAnalysisState.manualRoleSpecNeeds !== "object") {
      roleAlertsAnalysisState.manualRoleSpecNeeds = { Tanks: [], Healers: [], Melee: [], Ranged: [] };
    }
    if (!Array.isArray(roleAlertsAnalysisState.manualRoleSpecNeeds[role])) roleAlertsAnalysisState.manualRoleSpecNeeds[role] = [];
    roleAlertsAnalysisState.manualRoleSpecNeeds[role].push({ spec: "", count: 1 });
    renderRoleAlertsAnalysis(roleAlertsAnalysisState, { preserveComposerDraft: true });
    return;
  }
  const rmBtn = event.target.closest("[data-role-alert-manual-remove]");
  if (!rmBtn) return;
  const raw = String(rmBtn.getAttribute("data-role-alert-manual-remove") || "");
  const sep = raw.indexOf(":");
  if (sep <= 0) return;
  const role = raw.slice(0, sep);
  const idx = Number(raw.slice(sep + 1));
  if (!ROLE_ALERT_ROLES.includes(role) || !Number.isFinite(idx)) return;
  if (!roleAlertsAnalysisState?.manualRoleSpecNeeds?.[role]) return;
  roleAlertsAnalysisState.manualRoleSpecNeeds[role].splice(idx, 1);
  renderRoleAlertsAnalysis(roleAlertsAnalysisState, { preserveComposerDraft: true });
});

document.addEventListener("click", (event) => {
  const copyLfmBtn = event.target.closest("#roleAlertsCopyLfmBtn");
  if (copyLfmBtn) {
    const box = document.getElementById("roleAlertsLfmMessage");
    const text = String(box?.value || "").trim();
    if (!text) {
      status("No LFM message to copy.");
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => status("LFM message copied to clipboard."))
      .catch(() => status("Copy failed. You can still select and copy manually."));
    return;
  }

  const customSendBtn = event.target.closest("#customDmSendBtn");
  if (customSendBtn) {
    sendCustomDm(customSendBtn);
    return;
  }
  const customReloadBtn = event.target.closest("#customDmReloadBtn");
  if (customReloadBtn) {
    runWithButtonFeedback(
      customReloadBtn,
      { idle: "Reload players", loading: "Loading...", success: "Loaded", failure: "Failed" },
      async () => loadCustomDmCandidates()
    ).catch((error) => status(error?.message || "Failed to reload DM candidates"));
    return;
  }
  const roleSyncPreviewBtn = event.target.closest("#discordRoleSyncPreviewBtn");
  if (roleSyncPreviewBtn) {
    runWithButtonFeedback(
      roleSyncPreviewBtn,
      { idle: "Reload preview", loading: "Loading...", success: "Loaded", failure: "Failed" },
      async () => loadDiscordRoleSyncPreview()
    ).catch((error) => status(error?.message || "Failed to load Discord role sync preview"));
    return;
  }
  const roleSyncRunBtn = event.target.closest("#discordRoleSyncRunBtn");
  if (roleSyncRunBtn) {
    runWithButtonFeedback(
      roleSyncRunBtn,
      { idle: "Sync Discord roles", loading: "Syncing...", success: "Synced", failure: "Failed" },
      async () => getJson("/api/admin/discord-role-sync/run", { method: "POST" })
    )
      .then(async (payload) => {
        status(
          `Discord sync complete: ${Number(payload?.attendanceAdded || 0)} attendance added, ${Number(payload?.attendanceRemoved || 0)} attendance removed, ${Number(payload?.combatAdded || 0)} combat added, ${Number(payload?.nicknamesSet || 0)} names updated, ${Number(payload?.failed || 0)} failed.`
        );
        await loadDiscordRoleSyncPreview();
      })
      .catch((error) => status(error?.message || "Discord role sync failed"));
    return;
  }
  const discordNewsSendBtn = event.target.closest("#discordNewsSendBtn");
  if (discordNewsSendBtn) {
    sendDiscordNews(discordNewsSendBtn);
    return;
  }
  const discordNewsQueueReloadBtn = event.target.closest("#discordNewsQueueReloadBtn");
  if (discordNewsQueueReloadBtn) {
    runWithButtonFeedback(
      discordNewsQueueReloadBtn,
      { idle: "Reload queue", loading: "Loading...", success: "Loaded", failure: "Failed" },
      async () => {
        await loadDiscordNewsRoles();
        await loadDiscordNewsQueue();
      }
    ).catch((error) => status(error?.message || "Failed to reload Discord news queue"));
    return;
  }
  const discordNewsQueueSendBtn = event.target.closest("[data-discord-news-queue-send]");
  if (discordNewsQueueSendBtn) {
    const id = String(discordNewsQueueSendBtn.getAttribute("data-discord-news-queue-send") || "").trim();
    const card = discordNewsQueueSendBtn.closest("[data-discord-news-draft-id]");
    const body = readDiscordNewsQueueDraftPayload(card);
    runWithButtonFeedback(
      discordNewsQueueSendBtn,
      { idle: "Send to Discord", loading: "Sending...", success: "Sent", failure: "Failed" },
      async () =>
        getJson(`/api/admin/discord-news/queue/${encodeURIComponent(id)}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
    )
      .then(async (payload) => {
        status(`Queued news sent${payload?.messageId ? ` (${payload.messageId})` : ""}.`);
        await loadDiscordNewsStatus().catch(() => {});
        await loadDiscordNewsQueue().catch(() => {});
      })
      .catch((error) => status(error?.message || "Failed to send queued news"));
    return;
  }
  const discordNewsQueueDiscardBtn = event.target.closest("[data-discord-news-queue-discard]");
  if (discordNewsQueueDiscardBtn) {
    const id = String(discordNewsQueueDiscardBtn.getAttribute("data-discord-news-queue-discard") || "").trim();
    runWithButtonFeedback(
      discordNewsQueueDiscardBtn,
      { idle: "Discard", loading: "Discarding...", success: "Discarded", failure: "Failed" },
      async () => getJson(`/api/admin/discord-news/queue/${encodeURIComponent(id)}/discard`, { method: "POST" })
    )
      .then(async () => {
        status("Queued news draft discarded.");
        await loadDiscordNewsStatus().catch(() => {});
        await loadDiscordNewsQueue().catch(() => {});
      })
      .catch((error) => status(error?.message || "Failed to discard queued news"));
    return;
  }
  const discordNewsTestBtn = event.target.closest("#discordNewsTestBtn");
  if (discordNewsTestBtn) {
    sendDiscordNewsTest(discordNewsTestBtn);
    return;
  }
  const discordNewsReloadBtn = event.target.closest("#discordNewsReloadBtn");
  if (discordNewsReloadBtn) {
    runWithButtonFeedback(
      discordNewsReloadBtn,
      { idle: "Reload status", loading: "Loading...", success: "Loaded", failure: "Failed" },
      async () => {
        await loadDiscordNewsStatus();
        await loadDiscordNewsRoles();
        await loadDiscordNewsQueue();
      }
    ).catch((error) => status(error?.message || "Failed to reload Discord news status"));
    return;
  }
  const discordNewsRoleCb = event.target.closest("[data-discord-news-role-id]");
  if (discordNewsRoleCb) {
    const id = String(discordNewsRoleCb.getAttribute("data-discord-news-role-id") || "").trim();
    if (id) {
      if (discordNewsRoleCb.checked) discordNewsSelectedRoleIds.add(id);
      else discordNewsSelectedRoleIds.delete(id);
    }
    return;
  }
  const customMarkAll = event.target.closest("#customDmMarkAllBtn");
  if (customMarkAll) {
    document.querySelectorAll("[data-custom-dm-user-id]").forEach((el) => {
      el.checked = true;
      const id = String(el.getAttribute("data-custom-dm-user-id") || "").trim();
      if (id) customDmSelectedUserIds.add(id);
    });
    return;
  }
  const customDeselectAll = event.target.closest("#customDmDeselectAllBtn");
  if (customDeselectAll) {
    document.querySelectorAll("[data-custom-dm-user-id]").forEach((el) => {
      el.checked = false;
    });
    customDmSelectedUserIds = new Set();
    return;
  }
  const customRoleCb = event.target.closest("[data-custom-dm-role]");
  if (customRoleCb) {
    const role = String(customRoleCb.getAttribute("data-custom-dm-role") || "").trim();
    if (ROLE_ALERT_ROLES.includes(role)) {
      if (customRoleCb.checked) customDmRoleTargets.add(role);
      else customDmRoleTargets.delete(role);
      renderCustomDmPanel();
    }
    return;
  }
  const customUserCb = event.target.closest("[data-custom-dm-user-id]");
  if (customUserCb) {
    const id = String(customUserCb.getAttribute("data-custom-dm-user-id") || "").trim();
    if (id) {
      if (customUserCb.checked) customDmSelectedUserIds.add(id);
      else customDmSelectedUserIds.delete(id);
    }
    return;
  }

  const sendBtn = event.target.closest("[data-role-alert-send], #roleAlertsSendBtn");
  if (sendBtn) {
    sendRoleAlertsDms(sendBtn);
    return;
  }
  const markAll = event.target.closest("#roleAlertsMarkAllBtn");
  if (markAll) {
    document.querySelectorAll("[data-role-alert-target-user-id]").forEach((el) => {
      el.checked = true;
      const id = String(el.getAttribute("data-role-alert-target-user-id") || "").trim();
      if (id) roleAlertsSelectedUserIds.add(id);
    });
    return;
  }
  const deselectAll = event.target.closest("#roleAlertsDeselectAllBtn");
  if (deselectAll) {
    document.querySelectorAll("[data-role-alert-target-user-id]").forEach((el) => {
      el.checked = false;
    });
    roleAlertsSelectedUserIds = new Set();
    return;
  }
  const cb = event.target.closest("[data-role-alert-target-user-id]");
  if (!cb) return;
  const id = String(cb.getAttribute("data-role-alert-target-user-id") || "").trim();
  if (!id) return;
  if (cb.checked) roleAlertsSelectedUserIds.add(id);
  else roleAlertsSelectedUserIds.delete(id);
});

document.addEventListener("click", (event) => {
  const sortBtn = event.target.closest("[data-role-alert-sort]");
  if (!sortBtn) return;
  const key = String(sortBtn.getAttribute("data-role-alert-sort") || "").trim();
  if (!key) return;
  if (roleAlertsCandidateSortState.key === key) {
    roleAlertsCandidateSortState = { key, dir: roleAlertsCandidateSortState.dir === "asc" ? "desc" : "asc" };
  } else {
    roleAlertsCandidateSortState = { key, dir: "asc" };
  }
  renderRoleAlertsAnalysis(roleAlertsAnalysisState, { preserveComposerDraft: true });
});

document.addEventListener("input", (event) => {
  const customFilterEl = event.target.closest("[data-custom-dm-filter]");
  if (customFilterEl) {
    const key = String(customFilterEl.getAttribute("data-custom-dm-filter") || "").trim();
    if (!key) return;
    const nextValue = String(customFilterEl.value || "");
    const selStart = Number(customFilterEl.selectionStart);
    const selEnd = Number(customFilterEl.selectionEnd);
    customDmFilterState = { ...customDmFilterState, [key]: nextValue };
    renderCustomDmPanel();
    const nextEl = document.querySelector(`[data-custom-dm-filter="${key}"]`);
    if (nextEl instanceof HTMLInputElement || nextEl instanceof HTMLSelectElement) {
      nextEl.focus();
      if (nextEl instanceof HTMLInputElement && Number.isFinite(selStart) && Number.isFinite(selEnd)) {
        const start = Math.max(0, Math.min(selStart, nextEl.value.length));
        const end = Math.max(start, Math.min(selEnd, nextEl.value.length));
        nextEl.setSelectionRange(start, end);
      }
    }
    return;
  }

  const filterEl = event.target.closest("[data-role-alert-filter]");
  if (!filterEl) return;
  const key = String(filterEl.getAttribute("data-role-alert-filter") || "").trim();
  if (!key) return;
  const nextValue = String(filterEl.value || "");
  const selStart = Number(filterEl.selectionStart);
  const selEnd = Number(filterEl.selectionEnd);
  roleAlertsCandidateFilterState = { ...roleAlertsCandidateFilterState, [key]: nextValue };
  renderRoleAlertsAnalysis(roleAlertsAnalysisState, { preserveComposerDraft: true });
  const nextEl = document.querySelector(`[data-role-alert-filter="${key}"]`);
  if (nextEl instanceof HTMLInputElement || nextEl instanceof HTMLSelectElement) {
    nextEl.focus();
    if (nextEl instanceof HTMLInputElement && Number.isFinite(selStart) && Number.isFinite(selEnd)) {
      const start = Math.max(0, Math.min(selStart, nextEl.value.length));
      const end = Math.max(start, Math.min(selEnd, nextEl.value.length));
      nextEl.setSelectionRange(start, end);
    }
  }
});

document.addEventListener("change", async (event) => {
  const cb = event.target.closest("[data-p2-demand-check]");
  if (!cb || !(cb instanceof HTMLInputElement)) return;
  const userId = String(cb.getAttribute("data-user-id") || "").trim();
  const itemID = Math.max(0, Math.floor(Number(cb.getAttribute("data-item-id") || 0)));
  if (!userId || !itemID) return;
  const key = adminP2DemandCheckKey(userId, itemID);
  const checked = cb.checked;
  const tr = cb.closest("tr");
  if (checked) adminP2DemandCheckedKeys.add(key);
  else adminP2DemandCheckedKeys.delete(key);
  tr?.classList.toggle("is-demand-checked", checked);
  cb.disabled = true;
  try {
    await getJson("/api/admin/p2-demand/check", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ userId, itemID, checked }),
    });
    refreshAdminP2DemandTable();
  } catch (error) {
    if (checked) adminP2DemandCheckedKeys.delete(key);
    else adminP2DemandCheckedKeys.add(key);
    cb.checked = !checked;
    tr?.classList.toggle("is-demand-checked", cb.checked);
    status(error?.message || "Failed to save check");
  } finally {
    cb.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-p2-id]");
  if (!btn) return;
  const id = String(btn.getAttribute("data-p2-id") || "");
  const input = document.getElementById(`p2-${id}`);
  const current = num(input?.value);
  btn.disabled = true;
  try {
    await getJson("/api/p2-preparation/materials/current", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, current }),
    });
    status(`Updated ${id} to ${current}.`);
  } catch (error) {
    status(error?.message || "P2 update failed");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("publicSnapshotReloadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("publicSnapshotReloadBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Reload status", loading: "Reloading...", success: "Reloaded", failure: "Reload failed" },
      async () => {
        await loadPublicSnapshotStatus();
      }
    );
  } catch (error) {
    status(error?.message || "Snapshot status reload failed");
  }
});

document.getElementById("publicSnapshotSyncBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("publicSnapshotSyncBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Sync data now", loading: "Syncing...", success: "Synced", failure: "Sync failed" },
      async () => {
        const out = await getJson("/api/admin/public-snapshot/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guildId: ADMIN_WCL_GUILD_ID }),
        });
        await loadPublicSnapshotStatus();
        status(
          `Public snapshot sync finished: ${Number(out?.okCount || 0)} ok, ${Number(out?.failCount || 0)} failed.`
        );
      }
    );
  } catch (error) {
    status(error?.message || "Snapshot sync failed");
  }
});

document.getElementById("adminAnalyticsReloadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("adminAnalyticsReloadBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Reload analytics", loading: "Loading...", success: "Loaded", failure: "Failed" },
      async () => {
        await loadAnalyticsPanel();
      }
    );
    status("Analytics reloaded.");
  } catch (error) {
    status(error?.message || "Analytics reload failed");
  }
});

document.getElementById("admin-panel-analytics")?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-admin-analytics-range]");
  if (!btn) return;
  const raw = btn.getAttribute("data-admin-analytics-range");
  const nextDays = Math.max(1, Math.min(365, Number(raw) || 30));
  const input = document.getElementById("adminAnalyticsDays");
  if (input) input.value = String(nextDays);
  loadAnalyticsPanel().catch((error) => {
    status(error?.message || "Analytics load failed");
  });
});

document.getElementById("raiderBlacklistFilter")?.addEventListener("change", () => {
  raiderBlacklistFilterState = String(document.getElementById("raiderBlacklistFilter")?.value || "all");
  renderRaiderBlacklistTable({ ok: true, entries: raiderBlacklistEntriesState });
});

document.getElementById("raiderBlacklistReloadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("raiderBlacklistReloadBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Reload list", loading: "Loading...", success: "Loaded", failure: "Failed" },
      async () => {
        await loadRaiderBlacklistPanel();
      }
    );
    status("Raider blacklist reloaded.");
  } catch (error) {
    status(error?.message || "Raider blacklist reload failed");
  }
});

document.getElementById("raiderBlacklistManualName")?.addEventListener("change", () => {
  raiderBlacklistSelectedPlayer = null;
  raiderBlacklistUpdateSelectedPlayerLabel();
});

document.getElementById("raiderBlacklistPlayerSearch")?.addEventListener("input", () => {
  if (Boolean(document.getElementById("raiderBlacklistManualName")?.checked)) {
    raiderBlacklistUpdateSelectedPlayerLabel();
    return;
  }
  const q = String(document.getElementById("raiderBlacklistPlayerSearch")?.value || "");
  if (raiderBlacklistSearchTimer) clearTimeout(raiderBlacklistSearchTimer);
  raiderBlacklistSearchTimer = setTimeout(() => {
    raiderBlacklistSearchIdentities(q).catch(() => {});
  }, 280);
});

document.getElementById("admin-panel-raider-blacklist")?.addEventListener("click", (event) => {
  const pickBtn = event.target.closest("[data-raider-blacklist-pick]");
  if (pickBtn) {
    const id = Number(pickBtn.getAttribute("data-raider-blacklist-pick"));
    raiderBlacklistSelectedPlayer = {
      id: Number.isFinite(id) ? id : null,
      displayName: String(pickBtn.getAttribute("data-display-name") || "").trim(),
      discordUserId: String(pickBtn.getAttribute("data-discord-id") || "").trim(),
    };
    const manual = document.getElementById("raiderBlacklistManualName");
    if (manual) manual.checked = false;
    const search = document.getElementById("raiderBlacklistPlayerSearch");
    if (search) search.value = raiderBlacklistSelectedPlayer.displayName;
    const results = document.getElementById("raiderBlacklistSearchResults");
    if (results) {
      results.hidden = true;
      results.innerHTML = "";
    }
    raiderBlacklistUpdateSelectedPlayerLabel();
    return;
  }
  const saveBtn = event.target.closest("[data-raider-blacklist-save]");
  if (saveBtn) {
    const id = String(saveBtn.getAttribute("data-raider-blacklist-save") || "").trim();
    const tr = saveBtn.closest("[data-raider-blacklist-row]");
    if (!id || !tr) return;
    const card = String(tr.querySelector('[data-raider-blacklist-k="card"]')?.value || "yellow").trim();
    const reason = String(tr.querySelector('[data-raider-blacklist-k="reason"]')?.value || "").trim();
    const contextLabel = String(tr.querySelector('[data-raider-blacklist-k="contextLabel"]')?.value || "").trim();
    const dateRaw = String(tr.querySelector('[data-raider-blacklist-k="contextDate"]')?.value || "").trim();
    let contextAt = null;
    if (dateRaw) {
      const dt = new Date(`${dateRaw}T12:00:00`);
      if (!Number.isNaN(dt.getTime())) contextAt = dt.getTime();
    }
    saveBtn.disabled = true;
    runWithButtonFeedback(
      saveBtn,
      { idle: "Save", loading: "Saving...", success: "Saved", failure: "Failed" },
      async () => {
        await getJson(`/api/admin/raider-blacklist/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card, reason, contextLabel, contextAt }),
        });
        await loadRaiderBlacklistPanel();
      }
    )
      .then(() => status("Blacklist entry updated."))
      .catch((error) => status(error?.message || "Failed to update entry"))
      .finally(() => {
        saveBtn.disabled = false;
      });
    return;
  }
  const removeBtn = event.target.closest("[data-raider-blacklist-remove]");
  if (!removeBtn) return;
  const id = String(removeBtn.getAttribute("data-raider-blacklist-remove") || "").trim();
  if (!id) return;
  const tr = removeBtn.closest("[data-raider-blacklist-row]");
  const card = String(tr?.querySelector('[data-raider-blacklist-k="card"]')?.value || "").toLowerCase();
  if (card === "black" && !window.confirm("Remove this Black Card entry?")) return;
  removeBtn.disabled = true;
  runWithButtonFeedback(
    removeBtn,
    { idle: "Remove", loading: "Removing...", success: "Removed", failure: "Failed" },
    async () => {
      await getJson(`/api/admin/raider-blacklist/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadRaiderBlacklistPanel();
    }
  )
    .then(() => status("Blacklist entry removed."))
    .catch((error) => status(error?.message || "Failed to remove entry"))
    .finally(() => {
      removeBtn.disabled = false;
    });
});

document.getElementById("raiderBlacklistAddBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("raiderBlacklistAddBtn");
  const form = raiderBlacklistReadAddForm();
  if (!form.reason) {
    status("Reason is required.");
    return;
  }
  if (form.manual && !form.displayName) {
    status("Enter a player name or pick an identity.");
    return;
  }
  if (!form.manual && !form.userId && !form.displayName) {
    status("Select a player from identity search or use manual name.");
    return;
  }
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Add card", loading: "Adding...", success: "Added", failure: "Failed" },
      async () => {
        const body = {
          card: form.card,
          reason: form.reason,
          contextLabel: form.contextLabel || undefined,
          contextAt: form.contextAt || undefined,
        };
        if (form.manual) body.displayName = form.displayName;
        else {
          if (form.userId) body.userId = form.userId;
          if (form.discordUserId) body.discordUserId = form.discordUserId;
          if (form.displayName) body.displayName = form.displayName;
        }
        await getJson("/api/admin/raider-blacklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        raiderBlacklistClearAddForm();
        await loadRaiderBlacklistPanel();
      }
    );
    status("Card added to blacklist.");
  } catch (error) {
    status(error?.message || "Failed to add card");
  }
});

document.getElementById("adminHofNotesReloadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("adminHofNotesReloadBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Reload winners", loading: "Loading...", success: "Loaded", failure: "Failed" },
      async () => {
        await loadHofNotesPanel();
      }
    );
    status("Hall of Fame winners reloaded.");
  } catch (error) {
    status(error?.message || "Hall of Fame reload failed");
  }
});

document.addEventListener("click", async (event) => {
  const saveBtn = event.target.closest("[data-hof-note-save]");
  if (!saveBtn) return;
  const winnerRaidKey = String(saveBtn.getAttribute("data-hof-note-save") || "").trim();
  if (!winnerRaidKey) return;
  const row = saveBtn.closest("[data-hof-note-row]");
  const quote = String(row?.querySelector("[data-hof-note-quote]")?.value || "").trim();
  saveBtn.disabled = true;
  try {
    await runWithButtonFeedback(
      saveBtn,
      { idle: "Save", loading: "Saving...", success: "Saved", failure: "Failed" },
      async () => {
        await getJson("/api/admin/hof-notes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            winnerRaidKey,
            quote,
            roundKey: String(row?.getAttribute("data-hof-note-round-key") || "").trim(),
            raidCode: String(row?.getAttribute("data-hof-note-raid-code") || "").trim(),
            winnerName: String(row?.getAttribute("data-hof-note-winner-name") || "").trim(),
          }),
        });
      }
    );
    status("Hall of Fame quote saved.");
    await loadHofNotesPanel();
  } catch (error) {
    status(error?.message || "Failed to save Hall of Fame quote");
  } finally {
    saveBtn.disabled = false;
  }
});

document.getElementById("adminBadgeTooltipsReloadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("adminBadgeTooltipsReloadBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Reload badges", loading: "Loading...", success: "Loaded", failure: "Failed" },
      async () => {
        await loadBadgeTooltipsPanel();
      }
    );
    status("Badge management reloaded.");
  } catch (error) {
    status(error?.message || "Badge management reload failed");
  }
});

document.getElementById("adminBadgeTooltipsSaveBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("adminBadgeTooltipsSaveBtn");
  try {
    const badges = readBadgeTooltipsFromTable();
    await runWithButtonFeedback(
      btn,
      { idle: "Save badge changes", loading: "Saving...", success: "Saved", failure: "Failed" },
      async () => {
        await getJson("/api/admin/badge-tooltips", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ badges }),
        });
      }
    );
    status("Badge changes saved.");
    await loadBadgeTooltipsPanel();
  } catch (error) {
    status(error?.message || "Failed to save badge changes");
  }
});

document.addEventListener("click", (event) => {
  const resetBtn = event.target.closest("[data-badge-tooltip-reset]");
  if (!resetBtn) return;
  const badgeId = String(resetBtn.getAttribute("data-badge-tooltip-reset") || "").trim();
  if (!badgeId) return;
  const row = badgeTooltipsRowsState.find((r) => r.badgeId === badgeId);
  const tr = resetBtn.closest("[data-badge-tooltip-row]");
  const textarea = tr?.querySelector("[data-badge-tooltip-description]");
  const select = tr?.querySelector("[data-badge-tooltip-rarity]");
  if (textarea) textarea.value = row?.defaultDescription || "";
  if (select) select.value = row?.defaultRarity || "epic";
  status("Badge reset in the editor. Click Save badge changes to persist it.");
});

/* =============================================================================
 * Database panel
 *
 * Read-only browse of the canonical user database (`users` + `user_characters`)
 * + materialised stat tables + sync worker status. Loaded lazily the first
 * time the tab is opened and on the explicit Reload button.
 * ============================================================================= */
let adminDatabaseUsersState = [];
let adminDatabaseLoaded = false;
let adminDatabaseSearchValue = "";
let adminDatabaseExpandedUserId = null;
let identityBacklogState = [];
let identityBacklogLoaded = false;
let identityAccountsState = [];
let identityAccountsLoaded = false;
let identityAccountsSearchValue = "";
let identityAccountsGuildRoleFilter = "";
let identityAccountsActivityCutoffValue = "";
let identityAccountsSortState = { key: "lastActivity", dir: "desc" };
let identityAccountsTotal = 0;
let identityAccountsServerShown = 0;
let identityAccountsLoadPromise = null;
let identityAuditLoadPromise = null;
let identityJourneyLoadPromise = null;
let identityReviewDetailsLoadPromise = null;
let adminTbcSpecIconByKey = null;
let adminTbcSpecIconLoadPromise = null;

function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  return `${(n / 60_000).toFixed(1)} min`;
}

function renderAdminDatabaseReadiness(payload) {
  const host = document.getElementById("adminDatabaseReadiness");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Could not load readiness counts.</p>`;
    return;
  }
  const counts = payload.counts || {};
  const flags = payload.flags || {};
  const ready = !!payload.ready;
  const tableRows = Object.entries(counts)
    .map(([name, value]) => {
      const v = typeof value === "number" ? value : (value && value.error) || "error";
      const cls = typeof value === "number" && value > 0 ? "" : ' style="color:#c44"';
      return `<tr><td><code>${esc(name)}</code></td><td${cls}>${esc(String(v))}</td></tr>`;
    })
    .join("");
  const flagRows = Object.entries(flags)
    .map(([name, on]) => `<tr><td><code>${esc(name)}</code></td><td>${on ? "on" : "<strong style=\"color:#c44\">off</strong>"}</td></tr>`)
    .join("");
  const banner = ready
    ? `<p class="subtle" style="color:#5b8a4a"><strong>Ready.</strong> Every materialised table is non-empty.</p>`
    : `<p class="subtle" style="color:#c44"><strong>Not ready.</strong> ${esc(payload.note || "")}</p>`;
  const ra = payload.raidAppearances || null;
  let raidAppearancesBlock = "";
  if (ra && !ra.error) {
    const cutover = ra.cutoverActive
      ? `<span style="color:#5b8a4a"><strong>active</strong></span>`
      : `<span style="color:#c44"><strong>inactive — falling back to Raid Helper signups</strong></span>`;
    const scopeLabel =
      ra.countsScope === "admin-event-management"
        ? "admin Event Management selection"
        : "all WCL reports we have";
    raidAppearancesBlock = `
      <div style="margin-top:14px">
        <p class="subtle" style="margin:0 0 4px"><strong>Leaderboard "Events" cutover</strong> (raid_appearances → wclEventCount)</p>
        <p class="subtle" style="margin:0">
          Cutover is ${cutover}.
          Counting <strong>${esc(String(ra.distinctReports || 0))}</strong> distinct WCL reports;
          <strong>${esc(String(ra.selectedReportCodes || 0))}</strong> currently flagged in Event Management;
          <strong>${esc(String(ra.usersWithCount || 0))}</strong> users have at least one appearance
          (scope: ${esc(scopeLabel)}).
        </p>
      </div>`;
  } else if (ra?.error) {
    raidAppearancesBlock = `<p class="subtle" style="color:#c44;margin-top:10px">raid_appearances inspect failed: ${esc(String(ra.error))}</p>`;
  }
  host.innerHTML = `
    <h4 class="section-title" style="margin-top:8px">Phase 8 cutover readiness</h4>
    ${banner}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <div>
        <p class="subtle" style="margin:0 0 4px"><strong>Materialised row counts</strong></p>
        <table class="admin-table"><tbody>${tableRows}</tbody></table>
      </div>
      <div>
        <p class="subtle" style="margin:0 0 4px"><strong>Materialise flags</strong></p>
        <table class="admin-table"><tbody>${flagRows}</tbody></table>
      </div>
    </div>
    ${raidAppearancesBlock}
  `;
}

function renderAdminDatabaseSync(payload) {
  const host = document.getElementById("adminDatabaseSync");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Could not load sync worker status.</p>`;
    return;
  }
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  if (!tasks.length) {
    host.innerHTML = `<p class="subtle">No sync tasks registered.</p>`;
    return;
  }
  const rows = tasks
    .map((t) => {
      const status = String(t.status || "idle");
      const tone = status === "failed" ? "color:#c44" : status === "running" ? "color:#3a82c4" : "";
      const taskId = String(t.id || t.taskId || "").trim();
      return `<tr>
        <td><code>${esc(taskId)}</code></td>
        <td style="${tone}">${esc(status)}</td>
        <td>${esc(fmtTs(t.lastCompletedAt))}</td>
        <td>${esc(fmtDuration(t.lastDurationMs))}</td>
        <td>${esc(t.lastError || "")}</td>
        <td>
          <button type="button" class="event-signup-btn event-signup-btn--softres"
            data-admin-database-sync-trigger="${esc(taskId)}">
            Run now
          </button>
        </td>
      </tr>`;
    })
    .join("");
  host.innerHTML = `
    <h4 class="section-title" style="margin-top:8px">Background sync workers</h4>
    <div class="admin-actions admin-actions--tight" style="margin-bottom:8px">
      <button type="button" class="event-signup-btn" data-admin-database-sync-all="1">
        Run all syncs now
      </button>
      <span class="subtle">
        Runs every task in order (identity → attendance → loot → parses → badges → …).
      </span>
    </div>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Task</th><th>Status</th><th>Last completed</th>
          <th>Duration</th><th>Last error</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderAdminDatabaseSummary(payload) {
  const host = document.getElementById("adminDatabaseSummary");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Could not load users.</p>`;
    return;
  }
  const total = Number(payload.total || 0);
  const shown = Number(payload.shown || 0);
  const linked = (payload.users || []).filter((u) => !!u.discordUserId).length;
  const unlinked = shown - linked;
  host.innerHTML = `
    <p class="subtle">
      <strong>${shown}</strong> of <strong>${total}</strong> users
      (${linked} linked to a Discord id, ${unlinked} RH-only).
    </p>
  `;
}

function renderAdminIdentityAudit(payload) {
  const host = document.getElementById("adminIdentityAudit");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Identity audit unavailable: ${esc(payload?.error || "")}</p>`;
    return;
  }
  const counts = payload.counts || {};
  const problems =
    Number(counts.duplicateDiscordIds || 0) +
    Number(counts.duplicateCharacterOwnership || 0) +
    Number(counts.accountsWithoutDiscordId || 0) +
    Number(counts.jsonVsSqliteDrift || 0) +
    Number(counts.charactersMissingSpec || 0);
  const badgeStyle = problems
    ? "background:rgba(249,115,22,.16);border-color:rgba(249,115,22,.35)"
    : "background:rgba(34,197,94,.14);border-color:rgba(34,197,94,.35)";
  const sampleRows = [
    ...(payload.duplicateCharacterOwnership || []).slice(0, 3).map((row) => `Duplicate character: ${row.characterName}`),
    ...(payload.accountsWithoutDiscordId || []).slice(0, 3).map((row) => `Missing Discord ID: ${row.displayName || row.raidHelperName || `user #${row.id}`}`),
    ...(payload.jsonVsSqliteDrift || []).slice(0, 3).map((row) => `JSON drift: ${row.link?.raidHelperName || row.kind}`),
  ];
  host.innerHTML = `
    <div class="admin-kpi-grid">
      <div class="admin-kpi-card" style="${badgeStyle}">
        <strong>${problems}</strong>
        <span>identity cleanup items</span>
      </div>
      <div class="admin-kpi-card"><strong>${Number(counts.duplicateDiscordIds || 0)}</strong><span>duplicate Discord IDs</span></div>
      <div class="admin-kpi-card"><strong>${Number(counts.duplicateCharacterOwnership || 0)}</strong><span>duplicate character owners</span></div>
      <div class="admin-kpi-card"><strong>${Number(counts.accountsWithoutDiscordId || 0)}</strong><span>accounts missing Discord ID</span></div>
      <div class="admin-kpi-card"><strong>${Number(counts.charactersMissingSpec || 0)}</strong><span>characters missing class/spec</span></div>
    </div>
    ${
      sampleRows.length
        ? `<p class="subtle" style="margin-top:8px">${sampleRows.map(esc).join(" · ")}</p>`
        : `<p class="subtle" style="margin-top:8px">No duplicate identity ownership found in the audit.</p>`
    }
  `;
}

function identityRoleSelectHtml(current) {
  const normalized = normalizeGuildRoleValue(current);
  const sel = ["Grunt", "Veteran"].includes(normalized) ? "Peon" : normalized;
  return `<select class="admin-input" data-identity-k="guildRole" aria-label="Role">${RH_WCL_ASSIGNABLE_GUILD_ROLES.map(
    (role) => `<option value="${esc(role)}"${role === sel ? " selected" : ""}>${esc(displayGuildRoleOptionLabel(role))}</option>`
  ).join("")}</select>`;
}

function adminIdentitySlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function adminIdentityClassDisplay(className) {
  const slug = adminIdentitySlug(className);
  const labels = {
    warrior: "Warrior",
    paladin: "Paladin",
    hunter: "Hunter",
    rogue: "Rogue",
    priest: "Priest",
    shaman: "Shaman",
    mage: "Mage",
    warlock: "Warlock",
    druid: "Druid",
  };
  return labels[slug] || String(className || "").trim();
}

function adminIdentityClassColor(className) {
  const label = adminIdentityClassDisplay(className);
  return ADMIN_WOW_CLASS_COLORS[label] || "var(--text)";
}

function adminIdentitySpecKey(character) {
  const cls = adminIdentitySlug(character?.wowClass);
  const rawSpec = adminIdentitySlug(character?.wowSpec);
  if (!cls || !rawSpec) return "";
  const aliases = {
    prot: "protection",
    protection: "protection",
    holy: "holy",
    ret: "retribution",
    retribution: "retribution",
    bm: "beastmastery",
    beastmastery: "beastmastery",
    marksmanship: "marksmanship",
    survival: "survival",
    assassination: "assassination",
    combat: "combat",
    subtlety: "subtlety",
    disc: "discipline",
    discipline: "discipline",
    shadow: "shadow",
    elemental: "elemental",
    enhancement: "enhancement",
    resto: "restoration",
    restoration: "restoration",
    arcane: "arcane",
    fire: "fire",
    frost: "frost",
    affliction: "affliction",
    demonology: "demonology",
    destruction: "destruction",
    balance: "balance",
    feral: "feralcombat",
    feralcombat: "feralcombat",
    guardian: "feralcombat",
    arms: "arms",
    fury: "fury",
  };
  const spec = aliases[rawSpec] || rawSpec;
  return `${cls}_${spec}`;
}

function adminIdentitySpecIconUrl(character) {
  const key = adminIdentitySpecKey(character);
  if (!key) return "";
  const fromJson = adminTbcSpecIconByKey?.[key]?.iconUrl;
  if (/^https?:\/\//i.test(String(fromJson || ""))) return String(fromJson);
  const texture = ADMIN_SPEC_ICON_TEXTURE_FALLBACK[key];
  return texture ? `${ADMIN_ZAM_ICON_LARGE}/${texture}.jpg` : "";
}

function loadAdminTbcSpecIconMap() {
  if (adminTbcSpecIconByKey) return Promise.resolve(adminTbcSpecIconByKey);
  if (adminTbcSpecIconLoadPromise) return adminTbcSpecIconLoadPromise;
  adminTbcSpecIconLoadPromise = getJson(`/tbc-spec-icons.json?v=${ADMIN_TBC_SPEC_ICONS_JSON_VER}`)
    .then((data) => {
      adminTbcSpecIconByKey = data?.byKey && typeof data.byKey === "object" ? data.byKey : {};
      return adminTbcSpecIconByKey;
    })
    .catch(() => {
      adminTbcSpecIconByKey = {};
      return adminTbcSpecIconByKey;
    })
    .finally(() => {
      adminTbcSpecIconLoadPromise = null;
    });
  return adminTbcSpecIconLoadPromise;
}

function identityCharacterSpecText(character) {
  if (!character) return "";
  const cls = String(character.wowClass || "").trim();
  const spec = String(character.wowSpec || "").trim();
  return [cls, spec].filter(Boolean).join(" ");
}

function identityParseColor(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct)) return { color: "#94a3b8", background: "rgba(148,163,184,.12)", border: "rgba(148,163,184,.28)" };
  if (pct >= 100) return { color: "#e5cc80", background: "rgba(229,204,128,.18)", border: "rgba(229,204,128,.42)" };
  if (pct >= 99) return { color: "#e268a8", background: "rgba(226,104,168,.18)", border: "rgba(226,104,168,.42)" };
  if (pct >= 95) return { color: "#ff8000", background: "rgba(255,128,0,.18)", border: "rgba(255,128,0,.42)" };
  if (pct >= 75) return { color: "#a335ee", background: "rgba(163,53,238,.18)", border: "rgba(163,53,238,.42)" };
  if (pct >= 50) return { color: "#0070ff", background: "rgba(0,112,255,.18)", border: "rgba(0,112,255,.42)" };
  if (pct >= 25) return { color: "#1eff00", background: "rgba(30,255,0,.16)", border: "rgba(30,255,0,.36)" };
  return { color: "#9ca3af", background: "rgba(156,163,175,.12)", border: "rgba(156,163,175,.28)" };
}

/** Classic Armory GS → 0–100 pseudo parse % so `identityParseColor` matches Admin roster parse pill colors (WoW-style tiers). */
function gearScoreToRosterHeatmapPct(gs) {
  const n = Number(gs);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  const minGs = 1050;
  const maxGs = 2100;
  if (n >= maxGs) return 100;
  if (n <= minGs) return Math.max(0, (n / minGs) * 25);
  return 25 + ((n - minGs) / (maxGs - minGs)) * 75;
}

function identityParseBracketLabel(bracket, metric) {
  const b = String(bracket || "").toLowerCase();
  if (b === "tank") return "Tank";
  if (b === "heal") return "Heal";
  if (b === "dps") return "DPS";
  const m = String(metric || "").toLowerCase();
  if (m === "hps") return "Heal";
  if (m === "dps") return "DPS";
  return "Parse";
}

function renderIdentityLatestRaidParse(parse) {
  const value = Number(parse?.bestValue);
  if (!parse || !Number.isFinite(value) || value <= 0) return "—";
  const rounded = Math.round(value * 10) / 10;
  const colors = identityParseColor(value);
  const style = [
    "display:inline-flex",
    "align-items:center",
    "gap:6px",
    "padding:2px 8px",
    "border-radius:999px",
    `color:${colors.color}`,
    `background:${colors.background}`,
    `border:1px solid ${colors.border}`,
    "font-weight:700",
  ].join(";");
  const reportCode = String(parse.reportCode || "").trim();
  const fightId = Number(parse.bestFightId || 0);
  const reportHref = reportCode
    ? `https://classic.warcraftlogs.com/reports/${encodeURIComponent(reportCode)}${Number.isInteger(fightId) && fightId > 0 ? `#fight=${fightId}` : ""}`
    : "";
  const pill = `<span style="${style}">${esc(String(rounded))}</span>`;
  const linkedPill = reportHref ? `<a href="${reportHref}" target="_blank" rel="noopener noreferrer">${pill}</a>` : pill;
  const label = identityParseBracketLabel(parse.bracket, parse.bestMetric);
  const details = [
    parse.characterName,
    label,
    parse.bestEncounter,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" · ");
  const reportAt = Number(parse.reportStartedAt || 0);
  return `
    <div>${linkedPill}</div>
    <div class="subtle">${esc(details || label)}</div>
    ${reportAt ? `<div class="subtle">${esc(fmtTs(reportAt))}</div>` : ""}
  `;
}

function identityAltTextareaValue(characters) {
  return (Array.isArray(characters) ? characters : [])
    .map((char) =>
      [
        String(char?.characterName || "").trim(),
        String(char?.wowClass || "").trim(),
        String(char?.wowSpec || "").trim(),
      ]
        .filter((value, idx) => idx === 0 || value)
        .join(" | ")
    )
    .filter(Boolean)
    .join("\n");
}

function identityAltChipHtml(character, idx) {
  const name = String(character?.characterName || "").trim();
  if (!name) return "";
  const specText = identityCharacterSpecText(character);
  const iconUrl = adminIdentitySpecIconUrl(character);
  const color = adminIdentityClassColor(character?.wowClass);
  return `<span class="admin-identity-alt-chip admin-identity-char-line" data-identity-alt-chip="${idx}" title="${esc(specText || "Spec auto-pulls on save")}">
    <span class="admin-identity-char-main">
      ${iconUrl ? `<img class="admin-identity-spec-icon" src="${esc(iconUrl)}" alt="" loading="lazy" decoding="async" />` : `<span class="admin-identity-spec-icon admin-identity-spec-icon--empty" aria-hidden="true"></span>`}
      <strong class="admin-identity-char-name" style="color:${esc(color)}">${esc(name)}</strong>
    </span>
    <button type="button" class="admin-mini-btn admin-mini-btn--icon" data-identity-alt-remove="${idx}" title="Remove this alt from the Discord identity" aria-label="Remove ${esc(name)} from this identity">-</button>
  </span>`;
}

function identityMainCharacterEditorHtml(main) {
  const character = main || {};
  const iconUrl = adminIdentitySpecIconUrl(character);
  const color = adminIdentityClassColor(character?.wowClass);
  const name = String(character.characterName || "").trim();
  const specText = identityCharacterSpecText(character);
  return `<div class="admin-identity-main-editor">
    <div class="admin-identity-char-line admin-identity-char-line--main" title="${esc(specText || "Class/spec auto-pulls on save")}">
      <span class="admin-identity-char-main">
        ${iconUrl ? `<img class="admin-identity-spec-icon" src="${esc(iconUrl)}" alt="" loading="lazy" decoding="async" />` : `<span class="admin-identity-spec-icon admin-identity-spec-icon--empty" aria-hidden="true"></span>`}
        <input class="admin-input admin-identity-char-name-input" data-identity-main="characterName" value="${esc(name)}" placeholder="Main character" style="color:${esc(color)}" />
      </span>
    </div>
    <input type="hidden" data-identity-main="wowClass" value="${esc(character.wowClass || "")}" />
    <input type="hidden" data-identity-main="wowSpec" value="${esc(character.wowSpec || "")}" />
  </div>`;
}

function identityAltRowsFromStore(store) {
  return parseIdentityAltTextarea(String(store?.value || ""));
}

function identityWriteAltRowsToStore(store, rows) {
  if (!store) return;
  store.value = identityAltTextareaValue(Array.isArray(rows) ? rows : []);
}

function identityRenderAltChipsForCell(cell) {
  if (!cell) return;
  const store = cell.querySelector('[data-identity-k="altCharacters"]');
  const chips = cell.querySelector("[data-identity-alt-chips]");
  const count = cell.querySelector("[data-identity-alt-count]");
  const rows = identityAltRowsFromStore(store);
  if (chips) {
    chips.innerHTML = rows.length
      ? rows.map(identityAltChipHtml).join("")
      : `<span class="subtle">No alts linked.</span>`;
  }
  if (count) count.textContent = `${rows.length} alt${rows.length === 1 ? "" : "s"}`;
}

function parseIdentityAltTextarea(raw) {
  return String(raw || "")
    .split(/\r?\n|,/)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const characterName = parts[0] || "";
      if (!characterName) return null;
      return {
        characterName,
        wowClass: parts[1] || "",
        wowSpec: parts[2] || "",
        realm: "Thunderstrike",
      };
    })
    .filter(Boolean);
}

function identityActivityCutoffMs() {
  const raw = String(identityAccountsActivityCutoffValue || "").trim();
  if (!raw) return 0;
  const dt = new Date(`${raw}T00:00:00`);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function filterIdentityAccountsByActivity(accounts) {
  const cutoffMs = identityActivityCutoffMs();
  if (!cutoffMs) return Array.isArray(accounts) ? accounts : [];
  return (Array.isArray(accounts) ? accounts : []).filter((account) => Number(account?.lastActivity?.at || 0) >= cutoffMs);
}

function filterIdentityAccountsByGuildRole(accounts) {
  const roleFilter = String(identityAccountsGuildRoleFilter || "").trim();
  if (!roleFilter) return Array.isArray(accounts) ? accounts : [];
  const want = normalizeGuildRoleValue(roleFilter);
  return (Array.isArray(accounts) ? accounts : []).filter(
    (account) => normalizeGuildRoleValue(account?.guildRole) === want
  );
}

function filterIdentityAccountsVisible(accounts) {
  return filterIdentityAccountsByGuildRole(filterIdentityAccountsByActivity(accounts));
}

function syncIdentityActivityCutoffFromPayload(payload) {
  const cutoff = String(payload?.publicVisibility?.lastActivityCutoff || "").trim();
  if (cutoff === identityAccountsActivityCutoffValue) return;
  identityAccountsActivityCutoffValue = cutoff;
  const input = document.getElementById("identityAccountsActivityCutoff");
  if (input && input.value !== cutoff) input.value = cutoff;
}

async function saveIdentityPublicVisibility() {
  const payload = await getJson("/api/admin/identity/public-visibility", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lastActivityCutoff: identityAccountsActivityCutoffValue }),
  });
  syncIdentityActivityCutoffFromPayload(payload);
  return payload;
}

function renderIdentityAccountsSummary(payload) {
  const host = document.getElementById("identityAccountsSummary");
  if (!host) return;
  if (payload && payload.ok === false) {
    host.innerHTML = `<p class="subtle">Could not load identities.</p>`;
    return;
  }
  if (payload) {
    identityAccountsTotal = Number(payload.total || 0);
    identityAccountsServerShown = Number(payload.shown || 0);
  }
  const cutoffMs = identityActivityCutoffMs();
  const loadedCount = Array.isArray(identityAccountsState) ? identityAccountsState.length : 0;
  const shownAfterFilters = filterIdentityAccountsVisible(identityAccountsState).length;
  const shownAfterActivity = filterIdentityAccountsByActivity(identityAccountsState).length;
  const roleFilter = String(identityAccountsGuildRoleFilter || "").trim();
  const roleText = roleFilter
    ? ` Guild role: <strong>${esc(displayGuildRoleOptionLabel(normalizeGuildRoleValue(roleFilter)))}</strong>.`
    : "";
  const cutoffText = cutoffMs
    ? ` Public website cutoff: last activity on/after <strong>${esc(new Date(cutoffMs).toLocaleDateString())}</strong>; ${Math.max(0, loadedCount - shownAfterActivity)} hidden from public profile lists.`
    : "";
  const searchNote =
    identityAccountsSearchValue && loadedCount < identityAccountsTotal
      ? ` (${loadedCount} loaded from search of ${identityAccountsTotal} total)`
      : "";
  host.innerHTML = `<p class="subtle"><strong>${shownAfterFilters}</strong> of <strong>${loadedCount || identityAccountsTotal}</strong> identities shown.${roleText}${cutoffText}${searchNote}</p>`;
}

function setIdentityAccountsTableMaximized(isMaximized) {
  const block = document.querySelector(".admin-identity-table-block");
  const btn = document.getElementById("identityAccountsMaximizeBtn");
  if (!block) return;
  block.classList.toggle("is-table-maximized", Boolean(isMaximized));
  document.body.classList.toggle("is-admin-table-maximized", Boolean(isMaximized));
  if (btn) {
    btn.setAttribute("aria-pressed", isMaximized ? "true" : "false");
    btn.textContent = isMaximized ? "Collapse table" : "Maximize table";
  }
}

function identityAccountSortValue(account, key) {
  if (!account) return "";
  if (key === "discordUserId") return String(account.discordUserId || "");
  if (key === "displayName") return String(account.displayName || account.raidHelperName || "");
  if (key === "guildRole") return String(displayGuildRoleOptionLabel(account.guildRole || ""));
  if (key === "mainCharacter") return String(account.mainCharacter?.characterName || "");
  if (key === "altCharacters") return Array.isArray(account.altCharacters) ? account.altCharacters.length : 0;
  if (key === "lastActivity") return Number(account.lastActivity?.at || 0);
  if (key === "latestRaidParse") return Number(account.latestRaidParse?.bestValue || 0);
  return String(account.displayName || "");
}

function sortIdentityAccounts(accounts) {
  const key = String(identityAccountsSortState?.key || "lastActivity");
  const dir = identityAccountsSortState?.dir === "asc" ? 1 : -1;
  return [...(Array.isArray(accounts) ? accounts : [])].sort((a, b) => {
    const av = identityAccountSortValue(a, key);
    const bv = identityAccountSortValue(b, key);
    let cmp = 0;
    if (typeof av === "number" || typeof bv === "number") {
      cmp = Number(av || 0) - Number(bv || 0);
    } else {
      cmp = String(av || "").localeCompare(String(bv || ""), undefined, { numeric: true, sensitivity: "base" });
    }
    if (!cmp && key !== "displayName") {
      cmp = String(a?.displayName || "").localeCompare(String(b?.displayName || ""), undefined, { sensitivity: "base" });
    }
    return cmp * dir;
  });
}

function identitySortIndicator(key) {
  return identityAccountsSortState?.key === key ? (identityAccountsSortState?.dir === "desc" ? " ▼" : " ▲") : "";
}

function identitySortButton(key, label) {
  return `<button type="button" class="admin-table-sort-btn" data-identity-account-sort="${esc(key)}">${esc(label)}${identitySortIndicator(key)}</button>`;
}

function renderIdentityAccountsTable(accounts) {
  const host = document.getElementById("identityAccountsTableHost");
  if (!host) return;
  const visibleAccounts = filterIdentityAccountsVisible(accounts);
  renderIdentityAccountsSummary();
  if (!visibleAccounts.length) {
    host.innerHTML = `<p class="subtle">No identities match the current filter.</p>`;
    return;
  }
  const sortedAccounts = sortIdentityAccounts(visibleAccounts);
  const rows = sortedAccounts
    .map((account) => {
      const main = account.mainCharacter || {};
      const activity = account.lastActivity || {};
      const activityAt = Number(activity.at || 0);
      const activityText = activityAt ? `${fmtTs(activityAt)} · ${activity.source || "Activity"}` : "—";
      const activityLabel = activity.label ? `<div class="subtle">${esc(activity.label)}</div>` : "";
      return `<tr data-identity-account-row="${account.id}">
        <td>
          <input class="admin-input admin-identity-id-input" data-identity-k="discordUserId" value="${esc(account.discordUserId || "")}" placeholder="Discord ID" inputmode="numeric" />
          <input class="admin-input admin-identity-name-input" data-identity-k="displayName" value="${esc(account.storedDisplayName || account.raidHelperName || account.displayName || "")}" placeholder="Discord/RH name" />
          <div class="subtle">Discord/Raid Helper name</div>
          ${identityRoleSelectHtml(account.guildRole)}
        </td>
        <td>
          ${identityMainCharacterEditorHtml(main)}
        </td>
        <td>
          <div data-identity-alt-cell>
            <textarea class="admin-input" data-identity-k="altCharacters" hidden>${esc(identityAltTextareaValue(account.altCharacters))}</textarea>
            <div class="admin-identity-alt-chips" data-identity-alt-chips>
              ${(account.altCharacters || []).length
                ? (account.altCharacters || []).map(identityAltChipHtml).join("")
                : `<span class="subtle">No alts linked.</span>`}
            </div>
            <div class="admin-identity-add-alt">
              <input class="admin-input" data-identity-alt-name placeholder="Character name" />
              <button type="button" class="event-signup-btn event-signup-btn--softres" data-identity-alt-add>Add alt</button>
            </div>
            <div class="subtle"><span data-identity-alt-count>${(account.altCharacters || []).length} alt${(account.altCharacters || []).length === 1 ? "" : "s"}</span></div>
          </div>
        </td>
        <td>
          <div>${esc(activityText)}</div>
          ${activityLabel}
          <div class="admin-identity-parse-inline">${renderIdentityLatestRaidParse(account.latestRaidParse)}</div>
        </td>
        <td class="admin-rh-actions-cell">
          <button type="button" class="event-signup-btn" data-identity-account-save="${account.id}">Save</button>
          <button type="button" class="event-signup-btn event-signup-btn--softres" data-admin-database-user-detail="${account.id}">Details</button>
          <button type="button" class="event-signup-btn event-signup-btn--softres" data-admin-database-user-merge="${account.id}">Merge</button>
        </td>
      </tr>`;
    })
    .join("");
  host.innerHTML = `
    <div class="admin-table-wrap admin-identity-table-wrap">
      <table class="admin-table admin-identity-accounts-table">
        <thead>
          <tr>
            <th>${identitySortButton("displayName", "Discord / Role")}</th>
            <th>${identitySortButton("mainCharacter", "Main Char with Spec")}</th>
            <th>${identitySortButton("altCharacters", "Alt Chars with Spec")}</th>
            <th>${identitySortButton("lastActivity", "Activity / Parse")}</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  host.querySelectorAll("[data-identity-k], [data-identity-main]").forEach((input) => {
    input.addEventListener("input", () => {
      input.closest("[data-identity-account-row]")?.setAttribute("data-identity-dirty", "1");
    });
    input.addEventListener("change", () => {
      input.closest("[data-identity-account-row]")?.setAttribute("data-identity-dirty", "1");
    });
  });
  host.querySelector(".admin-identity-table-wrap")?.addEventListener(
    "wheel",
    (event) => {
      const box = event.currentTarget;
      if (!(box instanceof HTMLElement)) return;
      const middleMouseHeld = (Number(event.buttons || 0) & 4) === 4;
      if (!middleMouseHeld) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (box.scrollWidth <= box.clientWidth) return;
      box.scrollLeft += event.deltaY;
      event.preventDefault();
    },
    { passive: false }
  );
}

function readIdentityAccountRow(tr) {
  const read = (sel) => String(tr?.querySelector(sel)?.value || "").trim();
  return {
    discordUserId: read('[data-identity-k="discordUserId"]'),
    displayName: read('[data-identity-k="displayName"]'),
    guildRole: normalizeGuildRoleValue(read('[data-identity-k="guildRole"]')),
    mainCharacter: {
      characterName: read('[data-identity-main="characterName"]'),
      wowClass: read('[data-identity-main="wowClass"]'),
      wowSpec: read('[data-identity-main="wowSpec"]'),
      realm: "Thunderstrike",
    },
    altCharacters: parseIdentityAltTextarea(read('[data-identity-k="altCharacters"]')),
  };
}

async function saveIdentityAccountRow(tr, { button = null, successMessage = "" } = {}) {
  const userId = Number(tr?.getAttribute("data-identity-account-row"));
  if (!Number.isInteger(userId) || userId <= 0 || !tr) return null;
  const payload = readIdentityAccountRow(tr);
  if (!payload.mainCharacter.characterName) {
    status("Enter a main character before saving this identity.");
    return null;
  }
  if (button) button.disabled = true;
  try {
    const result = await getJson(`/api/admin/identity/accounts/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    tr.removeAttribute("data-identity-dirty");
    status(successMessage || `Saved identity for ${payload.displayName || payload.mainCharacter.characterName}.`);
    await refreshIdentityManagement({ silent: true });
    return result;
  } catch (error) {
    status(error?.message || "Identity save failed");
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadIdentityAccounts({ silent = false } = {}) {
  if (identityAccountsLoadPromise) return identityAccountsLoadPromise;
  identityAccountsLoadPromise = (async () => {
  const host = document.getElementById("identityAccountsTableHost");
  if (!silent && host) host.innerHTML = `<p class="subtle">Loading identities…</p>`;
  const q = identityAccountsSearchValue ? `?q=${encodeURIComponent(identityAccountsSearchValue)}` : "";
  const [payload] = await Promise.all([
    getJson(`/api/admin/identity/accounts${q}`),
    loadAdminTbcSpecIconMap(),
  ]);
  syncIdentityActivityCutoffFromPayload(payload);
  identityAccountsState = Array.isArray(payload?.accounts) ? payload.accounts : [];
  renderIdentityAccountsSummary(payload);
  renderIdentityAccountsTable(identityAccountsState);
  identityAccountsLoaded = true;
  if (!identityAuditLoadPromise) {
    identityAuditLoadPromise = getJson("/api/admin/identity-audit")
      .catch((e) => ({ ok: false, error: e?.message }))
      .then(renderAdminIdentityAudit)
      .finally(() => {
        identityAuditLoadPromise = null;
      });
  }
  await identityAuditLoadPromise.catch(() => {});
  return payload;
  })().finally(() => {
    identityAccountsLoadPromise = null;
  });
  return identityAccountsLoadPromise;
}

function identityPriorityLabel(priority) {
  const p = String(priority || "medium");
  if (p === "high") return "Needs admin";
  if (p === "low") return "Low priority";
  return "Review";
}

function renderIdentityDashboard(payload) {
  const host = document.getElementById("identityDashboardHost");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Could not load identity health: ${esc(payload?.error || "")}</p>`;
    return;
  }
  const counts = payload.counts || {};
  const byPriority = counts.byPriority || {};
  const total = Number(counts.total || 0);
  host.innerHTML = `
    <div class="admin-kpi-grid">
      <div class="admin-kpi-card">
        <strong>${total}</strong>
        <span>backlog item${total === 1 ? "" : "s"}</span>
      </div>
      <div class="admin-kpi-card">
        <strong>${Number(byPriority.high || 0)}</strong>
        <span>need admin decision</span>
      </div>
      <div class="admin-kpi-card">
        <strong>${Number(byPriority.medium || 0)}</strong>
        <span>review suggestions</span>
      </div>
      <div class="admin-kpi-card">
        <strong>${Number(byPriority.low || 0)}</strong>
        <span>can wait</span>
      </div>
    </div>
    <p class="subtle" style="margin-top:8px">
      Last checked ${esc(fmtTs(payload.generatedAt))}. Automation applies confident links when a Discord ID is known; conflicts stay here for review.
    </p>
  `;
}

function renderIdentityBacklog(payload) {
  const host = document.getElementById("identityBacklogHost");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Could not load review backlog: ${esc(payload?.error || "")}</p>`;
    return;
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  identityBacklogState = items;
  const mergedCount = Number(payload?.autoMerge?.merged || 0);
  const profileCount = Number(payload?.autoProfile?.accepted || 0);
  const discordCache = payload?.autoDiscordCache || payload?.preflight?.discordCache || {};
  const cacheUserCount = Number(discordCache.usersLinked || 0);
  const cachePlaceholderCount = Number(discordCache.placeholdersMerged || 0);
  const cacheRowCount = Number(discordCache.rhWclRowsFilled || 0);
  const cacheConflictCount = Array.isArray(discordCache.conflicts) ? discordCache.conflicts.length : 0;
  const autoNotes = [
    mergedCount > 0 ? `<strong>${mergedCount}</strong> obvious duplicate account${mergedCount === 1 ? "" : "s"} auto-merged` : "",
    profileCount > 0 ? `<strong>${profileCount}</strong> gear-check profile post${profileCount === 1 ? "" : "s"} auto-linked` : "",
    cacheUserCount > 0 ? `<strong>${cacheUserCount}</strong> Discord ID${cacheUserCount === 1 ? "" : "s"} filled from Raid Helper cache` : "",
    cachePlaceholderCount > 0 ? `<strong>${cachePlaceholderCount}</strong> character account${cachePlaceholderCount === 1 ? "" : "s"} merged into Discord placeholders` : "",
    cacheRowCount > 0 ? `<strong>${cacheRowCount}</strong> RH/WCL row${cacheRowCount === 1 ? "" : "s"} backfilled from Discord cache` : "",
    cacheConflictCount > 0 ? `<strong>${cacheConflictCount}</strong> Discord cache conflict${cacheConflictCount === 1 ? "" : "s"} left for review` : "",
  ].filter(Boolean);
  const autoMergeNote = autoNotes.length
    ? `<p class="subtle" style="margin-top:6px">${autoNotes.join("; ")} before review.</p>`
    : "";
  if (!items.length) {
    host.innerHTML = `
      <h4 class="section-title" style="margin-top:8px">Review Backlog</h4>
      <p class="subtle">No identity items need admin review right now.</p>
      ${autoMergeNote}
    `;
    return;
  }
  const rows = items
    .slice(0, 100)
    .map((item, idx) => {
      const actions = (Array.isArray(item.actions) ? item.actions : [])
        .map(
          (action) => `<button type="button" class="event-signup-btn ${action.danger ? "admin-btn-danger" : "event-signup-btn--softres"}"
            data-identity-backlog-action="${idx}"
            data-identity-backlog-action-id="${esc(action.id || "")}">
            ${esc(action.label || "Action")}
          </button>`
        )
        .join("");
      return `<tr>
        <td><strong>${esc(identityPriorityLabel(item.priority))}</strong><div class="subtle">${esc(item.source || "")}</div></td>
        <td><strong>${esc(item.title || "")}</strong><div class="subtle">${esc(item.description || "")}</div></td>
        <td><code>${esc(item.type || "")}</code></td>
        <td class="admin-rh-todo-actions">${actions}</td>
      </tr>`;
    })
    .join("");
  host.innerHTML = `
    <h4 class="section-title" style="margin-top:8px">Review Backlog</h4>
    ${autoMergeNote}
    <div class="admin-table-wrap admin-identity-backlog-wrap">
      <table class="admin-table admin-rh-todo-table admin-identity-backlog-table">
        <thead><tr><th>Priority</th><th>What needs review</th><th>Type</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function loadIdentityJourney({ silent = false } = {}) {
  if (identityJourneyLoadPromise) return identityJourneyLoadPromise;
  identityJourneyLoadPromise = (async () => {
  if (!silent) {
    const dashboard = document.getElementById("identityDashboardHost");
    const backlog = document.getElementById("identityBacklogHost");
    if (dashboard) dashboard.innerHTML = `<p class="subtle">Loading identity health…</p>`;
    if (backlog) backlog.innerHTML = `<p class="subtle">Loading review backlog…</p>`;
  }
  const payload = await getJson("/api/admin/identity-backlog");
  renderIdentityDashboard(payload);
  renderIdentityBacklog(payload);
  identityBacklogLoaded = true;
  return payload;
  })().finally(() => {
    identityJourneyLoadPromise = null;
  });
  return identityJourneyLoadPromise;
}

async function refreshIdentityManagement({ silent = true } = {}) {
  await Promise.allSettled([loadIdentityAccounts({ silent }), loadIdentityJourney({ silent })]);
}

function renderAdminDatabaseUsersTable(users) {
  const host = document.getElementById("adminDatabaseTableHost");
  if (!host) return;
  if (!Array.isArray(users) || !users.length) {
    host.innerHTML = `<p class="subtle">No users match the current filter.</p>`;
    return;
  }
  const rows = users
    .map((u) => {
      const charNames = (u.characters || [])
        .map((c) => `${esc(c.characterName)}${c.isMain ? " ★" : ""}`)
        .join(", ");
      const pictureCell = u.pictureFilename
        ? `<span class="subtle" title="${esc(u.pictureFilename)}">✓</span>`
        : `<span class="subtle">—</span>`;
      const uploadDisabled = !u.discordUserId;
      const uploadTitle = uploadDisabled
        ? "User has no Discord ID; cannot store a profile picture."
        : "Upload a profile picture for this user.";
      return `<tr data-admin-database-user-row="${u.id}">
        <td>${u.id}</td>
        <td>${esc(u.displayName || u.raidHelperName || "—")}</td>
        <td>${u.discordUserId ? `<code>${esc(u.discordUserId)}</code>` : `<span class="subtle">—</span>`}</td>
        <td>${esc(u.raidHelperName || "")}</td>
        <td>${esc(u.guildRole || "")}</td>
        <td>${esc(u.mainCharacterName || "—")}</td>
        <td>${u.characterCount}</td>
        <td title="${esc(charNames)}">${esc(charNames.length > 64 ? `${charNames.slice(0, 64)}…` : charNames)}</td>
        <td>${pictureCell}</td>
        <td>${esc(fmtTs(u.lastSeenAt))}</td>
        <td>
          <button type="button" class="event-signup-btn event-signup-btn--softres"
            data-admin-database-user-detail="${u.id}">
            Details
          </button>
          <button type="button" class="event-signup-btn event-signup-btn--softres"
            data-admin-database-user-upload="${u.id}"
            title="${esc(uploadTitle)}"
            ${uploadDisabled ? "disabled" : ""}>
            ${u.pictureFilename ? "Replace pic" : "Upload pic"}
          </button>
          ${
            u.pictureFilename
              ? `<button type="button" class="event-signup-btn event-signup-btn--softres"
                  data-admin-database-user-clear-pic="${u.id}"
                  title="Remove the saved profile picture for this user.">
                  Clear pic
                </button>`
              : ""
          }
        </td>
      </tr>`;
    })
    .join("");
  host.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>ID</th><th>Display</th><th>Discord ID</th><th>RH name</th>
          <th>Role</th><th>Main</th><th>#</th><th>Characters</th>
          <th title="Whether a profile picture is stored for this user.">Pic</th>
          <th>Last seen</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <input type="file" id="adminDatabasePictureFileInput" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
  `;
}

function renderAdminDatabaseDetail(payload, userId) {
  const host = document.getElementById("adminDatabaseDetailHost");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.hidden = false;
    host.innerHTML = `<p class="subtle">Could not load user detail.</p>`;
    return;
  }
  const user = payload.user || {};
  const characters = Array.isArray(payload.characters) ? payload.characters : [];
  const m = payload.materialised || {};
  const parses = Array.isArray(m.parses) ? m.parses : [];
  const loot = Array.isArray(m.loot) ? m.loot : [];
  const badges = Array.isArray(m.badges) ? m.badges : [];

  const charRows = characters
    .map(
      (c) => `<tr>
        <td>${c.id}</td>
        <td>${esc(c.characterName)}${c.isMain ? " ★" : ""}</td>
        <td>${esc(c.wowClass || "")}</td>
        <td>${esc(c.wowSpec || "")}</td>
        <td>${esc(c.realm || "")}</td>
        <td>${esc(c.discoveredVia || "")}</td>
        <td>${esc(fmtTs(c.firstSeenAt))}</td>
        <td>${esc(fmtTs(c.lastSeenAt))}</td>
        <td>
          <button type="button" class="event-signup-btn event-signup-btn--softres"
            data-admin-database-character-move="${c.id}">
            Move
          </button>
        </td>
      </tr>`
    )
    .join("");
  const parseRows = parses
    .map(
      (p) => `<tr>
        <td>${esc(p.bracket || "")}</td>
        <td>${esc(p.characterName || "")}</td>
        <td>${typeof p.bestValue === "number" ? p.bestValue.toFixed(1) : ""}</td>
        <td>${esc(p.bestEncounter || "")}</td>
        <td>${esc(p.bestMetric || "")}</td>
        <td>${p.bestReportCode ? `<a href="https://www.warcraftlogs.com/reports/${esc(p.bestReportCode)}" target="_blank" rel="noopener noreferrer"><code>${esc(p.bestReportCode)}</code></a>` : ""}</td>
      </tr>`
    )
    .join("");
  const badgeRows = badges
    .map(
      (b) => `<tr>
        <td><code>${esc(b.badgeId || "")}</code></td>
        <td>${b.earned ? "✓" : "—"}</td>
        <td>${esc(fmtTs(b.firstEarnedAt))}</td>
        <td>${esc(fmtTs(b.lastVerifiedAt))}</td>
      </tr>`
    )
    .join("");
  const lootRows = loot
    .slice(0, 50)
    .map(
      (l) => `<tr>
        <td>${esc(fmtTs(l.awardedAt))}</td>
        <td>${esc(l.characterName || "")}</td>
        <td><a href="https://www.wowhead.com/tbc/item=${l.itemId}" target="_blank" rel="noopener noreferrer">item ${l.itemId}</a></td>
        <td>${esc(l.source || "")}</td>
        <td><code>${esc(l.sourceRef || "")}</code></td>
      </tr>`
    )
    .join("");

  host.hidden = false;
  host.innerHTML = `
    <h4 class="section-title" style="margin-top:8px">User #${user.id} — ${esc(user.displayName || user.raidHelperName || "")}</h4>
    <p class="subtle">
      Discord id: ${user.discordUserId ? `<code>${esc(user.discordUserId)}</code>` : "—"} ·
      RH name: ${esc(user.raidHelperName || "—")} ·
      Role: ${esc(user.guildRole || "—")} ·
      Main char id: ${user.mainCharacterId ?? "—"} ·
      Picture: ${user.pictureFilename ? `<code>${esc(user.pictureFilename)}</code>` : "—"} ·
      First seen ${esc(fmtTs(user.firstSeenAt))} ·
      Last seen ${esc(fmtTs(user.lastSeenAt))}
    </p>
    <h5 class="section-title">Linked characters (${characters.length})</h5>
    <table class="admin-table">
      <thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Spec</th><th>Realm</th><th>Discovered</th><th>First seen</th><th>Last seen</th><th></th></tr></thead>
      <tbody>${charRows || `<tr><td colspan="9" class="subtle">No characters linked.</td></tr>`}</tbody>
    </table>
    <h5 class="section-title">Parse summary (materialised)</h5>
    <table class="admin-table">
      <thead><tr><th>Bracket</th><th>Character</th><th>Best</th><th>Encounter</th><th>Metric</th><th>Report</th></tr></thead>
      <tbody>${parseRows || `<tr><td colspan="6" class="subtle">No parse rows.</td></tr>`}</tbody>
    </table>
    <h5 class="section-title">Badges (materialised)</h5>
    <table class="admin-table">
      <thead><tr><th>Badge</th><th>Earned</th><th>First earned</th><th>Last verified</th></tr></thead>
      <tbody>${badgeRows || `<tr><td colspan="4" class="subtle">No badge rows.</td></tr>`}</tbody>
    </table>
    <h5 class="section-title">Loot awards (latest 50)</h5>
    <table class="admin-table">
      <thead><tr><th>When</th><th>Character</th><th>Item</th><th>Source</th><th>Ref</th></tr></thead>
      <tbody>${lootRows || `<tr><td colspan="5" class="subtle">No loot awards.</td></tr>`}</tbody>
    </table>
    <div class="admin-actions admin-actions--tight">
      <button type="button" class="event-signup-btn event-signup-btn--softres" id="adminDatabaseDetailCloseBtn">
        Close detail
      </button>
      <button type="button" class="event-signup-btn event-signup-btn--softres" data-admin-database-user-merge="${user.id}">
        Merge this user into another
      </button>
    </div>
  `;
  const closeBtn = document.getElementById("adminDatabaseDetailCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      host.hidden = true;
      host.innerHTML = "";
      adminDatabaseExpandedUserId = null;
    });
  }
  void userId;
}

async function loadAdminDatabasePanel({ silent = false } = {}) {
  const me = await getJson("/api/auth/me").catch(() => null);
  if (!me?.authenticated || !me?.isAdmin) {
    const host = document.getElementById("adminDatabaseTableHost");
    if (host) host.innerHTML = `<p class="subtle">Admin access required.</p>`;
    return;
  }
  if (!silent) {
    const summary = document.getElementById("adminDatabaseSummary");
    if (summary) summary.innerHTML = `<p class="subtle">Loading users…</p>`;
    const tableHost = document.getElementById("adminDatabaseTableHost");
    if (tableHost) tableHost.innerHTML = `<p class="subtle">Loading users…</p>`;
  }
  try {
    const q = adminDatabaseSearchValue ? `?q=${encodeURIComponent(adminDatabaseSearchValue)}` : "";
    const [readiness, sync, audit, users] = await Promise.all([
      getJson("/api/admin/cutover-readiness").catch((e) => ({ ok: false, error: e?.message })),
      getJson("/api/admin/sync").catch((e) => ({ ok: false, error: e?.message })),
      getJson("/api/admin/identity-audit").catch((e) => ({ ok: false, error: e?.message })),
      getJson(`/api/admin/database/users${q}`),
    ]);
    renderAdminDatabaseReadiness(readiness);
    renderAdminDatabaseSync(sync);
    renderAdminIdentityAudit(audit);
    renderAdminDatabaseSummary(users);
    adminDatabaseUsersState = Array.isArray(users?.users) ? users.users : [];
    renderAdminDatabaseUsersTable(adminDatabaseUsersState);
    adminDatabaseLoaded = true;
  } catch (error) {
    const host = document.getElementById("adminDatabaseTableHost");
    if (host) host.innerHTML = `<p class="subtle">Failed to load database: ${esc(error?.message || "")}</p>`;
  }
}

async function adminUploadProfilePictureForUser(userId, file) {
  if (!Number.isInteger(userId) || userId <= 0) return;
  if (!file || !(file instanceof File)) return;
  const mime = String(file.type || "").toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) {
    status("Picture must be PNG, JPEG, WebP, or GIF.");
    return;
  }
  const buf = await file.arrayBuffer();
  status(`Uploading picture for user #${userId}…`);
  try {
    const res = await fetch(`/api/admin/database/users/${userId}/picture`, {
      method: "PUT",
      headers: { "Content-Type": mime },
      credentials: "include",
      body: buf,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Upload failed (${res.status})`);
    }
    status(`Picture saved for user #${userId} (${payload?.discordUserId || "?"}).`);
    await loadAdminDatabasePanel({ silent: true });
  } catch (error) {
    status(`Picture upload failed: ${error?.message || "Unknown error"}`);
  }
}

async function adminClearProfilePictureForUser(userId) {
  if (!Number.isInteger(userId) || userId <= 0) return;
  if (!window.confirm(`Remove the saved profile picture for user #${userId}?`)) return;
  status(`Clearing picture for user #${userId}…`);
  try {
    const res = await fetch(`/api/admin/database/users/${userId}/picture`, {
      method: "DELETE",
      credentials: "include",
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Delete failed (${res.status})`);
    }
    status(`Picture removed for user #${userId}.`);
    await loadAdminDatabasePanel({ silent: true });
  } catch (error) {
    status(`Picture clear failed: ${error?.message || "Unknown error"}`);
  }
}

async function resolveIdentityBacklogItem(itemId, note = "") {
  await getJson("/api/admin/identity-backlog/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, note }),
  });
}

function showDiscordIdChooserModal({ title, targetName, candidates }) {
  return new Promise((resolve) => {
    const rows = Array.isArray(candidates) ? [...candidates] : [];
    const rowIds = new Set(rows.map((row) => String(row?.discordUserId || "").trim()).filter(Boolean));
    let selectedId = rows[0]?.discordUserId || "";
    let manualValue = "";
    const normalizeChoiceText = (value) => String(value || "").trim().toLowerCase();
    const mergeSuggestionRows = (newRows) => {
      for (const row of Array.isArray(newRows) ? newRows : []) {
        const discordUserId = String(row?.discordUserId || "").trim();
        if (!discordUserId || rowIds.has(discordUserId)) continue;
        rowIds.add(discordUserId);
        rows.push(row);
      }
    };
    const renderSuggestionOptions = () =>
      rows
        .map((row) => String(row.rhName || row.nick || row.globalName || row.username || "").trim())
        .filter(Boolean)
        .filter((name, index, names) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
        .map((name) => `<option value="${esc(name)}"></option>`)
        .join("");
    const resolveManualChoice = () => {
      const value = String(manualValue || "").trim();
      if (!value) return "";
      if (/^\d{15,25}$/.test(value)) return value;
      const key = normalizeChoiceText(value);
      const exact = rows.find((row) => normalizeChoiceText(row.rhName) === key);
      if (exact?.discordUserId) return exact.discordUserId;
      const partial = rows.find((row) => {
        const name = normalizeChoiceText(row.rhName);
        return name && (name.includes(key) || key.includes(name));
      });
      return partial?.discordUserId || "";
    };
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(5,2,16,.72);backdrop-filter:blur(6px);overflow:hidden;overscroll-behavior:contain";
    const list = rows.length
      ? `<table class="admin-table" style="margin:0;width:100%;min-width:0;table-layout:fixed">
          <thead>
            <tr>
              <th style="width:44px">Pick</th>
              <th>Name</th>
              <th style="width:170px">Match</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((row) => {
                const checked = row.discordUserId === selectedId ? " checked" : "";
                const score = Number(row.matchScore || 0);
                const match = row.assigned ? "Already connected" : score >= 100 ? "Exact match" : score > 0 ? `Possible match (${score})` : "Available";
                const name = row.rhName || "Unknown Discord name";
                return `<tr data-discord-id-row="${esc(row.discordUserId)}" style="cursor:pointer">
                  <td><input type="radio" name="discord-id-choice" value="${esc(row.discordUserId)}"${checked} aria-label="Select ${esc(name)}" /></td>
                  <td><strong>${esc(name)}</strong></td>
                  <td><span class="subtle">${esc(match)}</span></td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>`
      : `<p class="subtle">No unassigned Discord IDs are currently available in the Raid Helper cache.</p>`;
    overlay.innerHTML = `
      <div data-discord-id-dialog>
        <h3 class="section-title" style="margin-top:0">${esc(title || "Select Discord ID")}</h3>
        <p class="subtle">Choose an unassigned Discord name to connect${targetName ? ` to <strong>${esc(targetName)}</strong>` : ""}. If none is suitable, resolve this backlog item.</p>
        <label style="display:grid;gap:8px;margin:14px 0 12px;padding:12px;border:1px solid rgba(236,72,153,.38);border-radius:14px;background:rgba(236,72,153,.08);flex:0 0 auto">
          <strong>Type Discord name or ID</strong>
          <input type="text" data-discord-id-manual-input list="discord-id-choice-suggestions" placeholder="Start typing a Discord name, or paste the Discord ID" style="width:100%;box-sizing:border-box;border:1px solid rgba(236,72,153,.55);border-radius:12px;background:rgba(255,255,255,.08);color:inherit;padding:12px 14px;font-weight:700" />
          <datalist id="discord-id-choice-suggestions">${renderSuggestionOptions()}</datalist>
          <span class="subtle">Suggestions include unassigned names and already connected Discord names, useful for linking alts/twinks.</span>
        </label>
        <div data-discord-id-list-scroll tabindex="0">
          ${list}
        </div>
        <div class="admin-actions admin-actions--tight" style="justify-content:flex-end;flex:0 0 auto;margin-top:auto;padding-top:10px;border-top:1px solid rgba(168,85,247,.18)">
          <button type="button" class="event-signup-btn event-signup-btn--softres" data-discord-id-choice-cancel>Cancel</button>
          <button type="button" class="event-signup-btn event-signup-btn--softres" data-discord-id-choice-none>No suitable Discord ID found</button>
          <button type="button" class="event-signup-btn" data-discord-id-choice-connect>Connect selected</button>
        </div>
      </div>`;
    const cleanup = (value) => {
      document.removeEventListener("keydown", onKeyDown);
      if (suggestionSearchTimer) window.clearTimeout(suggestionSearchTimer);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") cleanup(null);
    };
    overlay.addEventListener("change", (event) => {
      const input = event.target.closest('input[name="discord-id-choice"]');
      if (input) selectedId = String(input.value || "").trim();
    });
    overlay.addEventListener("click", (event) => {
      const row = event.target.closest("[data-discord-id-row]");
      if (!row) return;
      const id = String(row.getAttribute("data-discord-id-row") || "").trim();
      const input = row.querySelector('input[name="discord-id-choice"]');
      if (id && input) {
        selectedId = id;
        input.checked = true;
      }
    });
    const datalist = overlay.querySelector("#discord-id-choice-suggestions");
    let suggestionSearchTimer = null;
    let suggestionSearchSeq = 0;
    overlay.querySelector("[data-discord-id-manual-input]")?.addEventListener("input", (event) => {
      manualValue = String(event.target.value || "");
      const query = manualValue.trim();
      if (suggestionSearchTimer) window.clearTimeout(suggestionSearchTimer);
      if (query.length < 2 || /^\d{15,25}$/.test(query)) return;
      const seq = ++suggestionSearchSeq;
      suggestionSearchTimer = window.setTimeout(async () => {
        try {
          const params = new URLSearchParams({ q: query, limit: "25", includeAssigned: "1" });
          const payload = await getJson(`/api/admin/identity/search-discord-ids?${params.toString()}`);
          if (seq !== suggestionSearchSeq) return;
          mergeSuggestionRows(payload?.candidates || []);
          if (datalist) datalist.innerHTML = renderSuggestionOptions();
        } catch {
          /* Manual Connect still performs an exact Discord search. */
        }
      }, 180);
    });
    overlay.addEventListener("wheel", (event) => {
      const scroller = event.target.closest("[data-discord-id-list-scroll]");
      if (!scroller) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
    }, { passive: false });
    overlay.querySelector("[data-discord-id-choice-cancel]")?.addEventListener("click", () => cleanup(null));
    overlay.querySelector("[data-discord-id-choice-none]")?.addEventListener("click", () => cleanup({ kind: "resolve" }));
    overlay.querySelector("[data-discord-id-choice-connect]")?.addEventListener("click", () => {
      const manualId = resolveManualChoice();
      const typed = String(manualValue || "").trim();
      const discordUserId = manualId || (!typed ? selectedId : "");
      if (!discordUserId) {
        if (typed) {
          cleanup({ kind: "connect-query", query: typed });
          return;
        }
        status("Type a Discord ID or choose a known name from the list.");
        return;
      }
      cleanup({ kind: "connect", discordUserId });
    });
    document.addEventListener("keydown", onKeyDown);
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.appendChild(overlay);
    const scrollBox = overlay.querySelector("[data-discord-id-list-scroll]");
    const dialog = overlay.firstElementChild;
    if (dialog) {
      dialog.style.cssText =
        "width:min(920px,96vw);height:min(86vh,820px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(168,85,247,.35);border-radius:18px;background:#120923;padding:18px;box-shadow:0 24px 80px rgba(0,0,0,.55)";
    }
    if (scrollBox) {
      scrollBox.style.cssText =
        "flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;margin:0 0 14px;border:1px solid rgba(168,85,247,.18);border-radius:12px";
    }
    overlay.querySelector("input,button")?.focus();
  });
}

async function resolveDiscordUserIdChoice(choice) {
  if (choice?.discordUserId) return choice.discordUserId;
  const query = String(choice?.query || "").trim();
  if (!query) return "";
  const payload = await getJson(`/api/admin/identity/resolve-discord-id?q=${encodeURIComponent(query)}`);
  return String(payload?.discordUserId || "").trim();
}

async function chooseDiscordIdForBacklogItem(item, action) {
  const kind = String(action?.kind || "");
  const payload = action?.payload || {};
  const row = payload.row || {};
  const params = new URLSearchParams({ limit: "300", includeAssigned: "1" });
  if (kind === "add-discord-id" && payload.userId) params.set("userId", String(payload.userId));
  const targetName =
    row.raidHelperName ||
    item?.data?.user?.displayName ||
    item?.data?.user?.raidHelperName ||
    String(item?.title || "").replace(/^Missing Discord ID:\s*/i, "").trim();
  if (targetName) params.set("q", targetName);
  const payloadResult = await getJson(`/api/admin/identity/unassigned-discord-ids?${params.toString()}`);
  return showDiscordIdChooserModal({
    title: "Add Discord ID",
    targetName: payloadResult.targetName || targetName,
    candidates: payloadResult.candidates || [],
  });
}

async function performIdentityBacklogAction(item, action) {
  const kind = String(action?.kind || "");
  const payload = action?.payload || {};
  if (kind === "accept-rh-wcl-proposal") {
    await getJson("/api/admin/rh-wcl-links/proposals/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wclCharacterName: payload.wclCharacterName,
        raidHelperName: payload.raidHelperName,
        verify: Boolean(payload.verify),
      }),
    });
    status("Accepted character match.");
    return;
  }
  if (kind === "reject-rh-wcl-proposal") {
    await getJson("/api/admin/rh-wcl-links/proposals/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wclCharacterName: payload.wclCharacterName }),
    });
    status("Rejected character match.");
    return;
  }
  if (kind === "accept-discord-profile") {
    await getJson(`/api/admin/discord-profile-ingest/proposals/${encodeURIComponent(payload.proposalId)}/accept`, {
      method: "POST",
    });
    status("Accepted Discord profile post.");
    return;
  }
  if (kind === "reject-discord-profile") {
    await getJson(`/api/admin/discord-profile-ingest/proposals/${encodeURIComponent(payload.proposalId)}/reject`, {
      method: "POST",
    });
    status("Rejected Discord profile post.");
    return;
  }
  if (kind === "add-discord-id") {
    const userId = Number(payload.userId);
    const choice = await chooseDiscordIdForBacklogItem(item, action);
    if (!choice) {
      status("Add Discord ID cancelled.");
      return;
    }
    if (choice.kind === "resolve") {
      await resolveIdentityBacklogItem(item?.id, "No suitable unassigned Discord ID found.");
      status("Resolved backlog item without assigning a Discord ID.");
      return;
    }
    const discordUserId = await resolveDiscordUserIdChoice(choice);
    await getJson(`/api/admin/database/users/${userId}/discord-id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discordUserId }),
    });
    status(`Added Discord ID to user #${userId}.`);
    return;
  }
  if (kind === "add-discord-id-row") {
    const row = payload.row || {};
    const choice = await chooseDiscordIdForBacklogItem(item, action);
    if (!choice) {
      status("Add Discord ID cancelled.");
      return;
    }
    if (choice.kind === "resolve") {
      await resolveIdentityBacklogItem(item?.id, "No suitable unassigned Discord ID found.");
      status("Resolved backlog item without assigning a Discord ID.");
      return;
    }
    const discordUserId = await resolveDiscordUserIdChoice(choice);
    await getJson("/api/admin/rh-wcl-links/row", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...row, discordUserId }),
    });
    status(`Added Discord ID to ${row.raidHelperName || "identity row"}.`);
    return;
  }
  if (kind === "merge-users") {
    const sourceDefault = payload.sourceUserId ? String(payload.sourceUserId) : "";
    const targetDefault = payload.targetUserId ? String(payload.targetUserId) : "";
    const sourceUserId = Number(window.prompt("Duplicate/source user ID to merge:", sourceDefault));
    const targetUserId = Number(window.prompt("Surviving/target user ID:", targetDefault));
    if (!Number.isInteger(sourceUserId) || !Number.isInteger(targetUserId) || sourceUserId <= 0 || targetUserId <= 0 || sourceUserId === targetUserId) {
      status("Merge cancelled or invalid user IDs.");
      return;
    }
    if (!window.confirm(`Merge user #${sourceUserId} into user #${targetUserId}?`)) return;
    await getJson("/api/admin/database/users/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceUserId, targetUserId }),
    });
    status(`Merged user #${sourceUserId} into user #${targetUserId}.`);
    return;
  }
  if (kind === "move-character") {
    const characterId = Number(payload.characterId || window.prompt("Character row ID to move:"));
    const targetUserId = Number(window.prompt("Move this character to which target user ID?"));
    if (!Number.isInteger(characterId) || !Number.isInteger(targetUserId) || characterId <= 0 || targetUserId <= 0) {
      status("Character move cancelled or invalid IDs.");
      return;
    }
    await getJson(`/api/admin/database/characters/${characterId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId }),
    });
    status(`Moved character #${characterId} to user #${targetUserId}.`);
    return;
  }
  if (kind === "run-sync-task") {
    const taskId = String(payload.taskId || "").trim();
    if (!taskId) throw new Error("Missing sync task ID");
    await getJson(`/api/admin/sync/${encodeURIComponent(taskId)}`, { method: "POST" });
    status(`Triggered sync task "${taskId}".`);
    return;
  }
  if (kind === "resolve-backlog-item") {
    const itemId = String(payload.itemId || item?.id || "").trim();
    await resolveIdentityBacklogItem(itemId);
    status("Marked backlog item resolved.");
    return;
  }
  throw new Error(`Unsupported action: ${kind || "unknown"}`);
}

document.addEventListener("click", async (event) => {
  const identityAltAddBtn = event.target.closest("[data-identity-alt-add]");
  if (identityAltAddBtn) {
    event.preventDefault();
    const tr = identityAltAddBtn.closest("[data-identity-account-row]");
    const cell = identityAltAddBtn.closest("[data-identity-alt-cell]");
    const input = cell?.querySelector("[data-identity-alt-name]");
    const store = cell?.querySelector('[data-identity-k="altCharacters"]');
    const characterName = String(input?.value || "").trim();
    if (!tr || !cell || !store) return;
    if (!characterName) {
      status("Enter the alt character name.");
      return;
    }
    const rows = identityAltRowsFromStore(store);
    const exists = rows.some((row) => String(row?.characterName || "").trim().toLowerCase() === characterName.toLowerCase());
    if (exists) {
      status(`${characterName} is already linked as an alt.`);
      return;
    }
    rows.push({ characterName, wowClass: "", wowSpec: "", realm: "Thunderstrike" });
    identityWriteAltRowsToStore(store, rows);
    if (input) input.value = "";
    identityRenderAltChipsForCell(cell);
    tr.setAttribute("data-identity-dirty", "1");
    status(`Adding alt ${characterName} and pulling class/spec...`);
    await saveIdentityAccountRow(tr, {
      button: identityAltAddBtn,
      successMessage: `Added alt ${characterName}.`,
    });
    return;
  }

  const identityAltRemoveBtn = event.target.closest("[data-identity-alt-remove]");
  if (identityAltRemoveBtn) {
    event.preventDefault();
    const tr = identityAltRemoveBtn.closest("[data-identity-account-row]");
    const cell = identityAltRemoveBtn.closest("[data-identity-alt-cell]");
    const store = cell?.querySelector('[data-identity-k="altCharacters"]');
    const idx = Number(identityAltRemoveBtn.getAttribute("data-identity-alt-remove"));
    if (!tr || !cell || !store || !Number.isInteger(idx)) return;
    const rows = identityAltRowsFromStore(store);
    rows.splice(idx, 1);
    identityWriteAltRowsToStore(store, rows);
    identityRenderAltChipsForCell(cell);
    tr.setAttribute("data-identity-dirty", "1");
    status("Removing alt...");
    await saveIdentityAccountRow(tr, {
      button: identityAltRemoveBtn,
      successMessage: "Removed alt from identity.",
    });
    return;
  }

  const identitySortBtn = event.target.closest("[data-identity-account-sort]");
  if (identitySortBtn) {
    const key = String(identitySortBtn.getAttribute("data-identity-account-sort") || "").trim();
    if (!key) return;
    if (identityAccountsSortState.key === key) {
      identityAccountsSortState = { key, dir: identityAccountsSortState.dir === "asc" ? "desc" : "asc" };
    } else {
      identityAccountsSortState = {
        key,
        dir: key === "lastActivity" || key === "latestRaidParse" || key === "altCharacters" ? "desc" : "asc",
      };
    }
    renderIdentityAccountsTable(identityAccountsState);
    return;
  }

  const identitySaveBtn = event.target.closest("[data-identity-account-save]");
  if (identitySaveBtn) {
    event.preventDefault();
    const tr = identitySaveBtn.closest("[data-identity-account-row]");
    await saveIdentityAccountRow(tr, { button: identitySaveBtn });
    return;
  }
  const identityActionBtn = event.target.closest("[data-identity-backlog-action]");
  if (identityActionBtn) {
    event.preventDefault();
    const idx = Number(identityActionBtn.getAttribute("data-identity-backlog-action"));
    const actionId = String(identityActionBtn.getAttribute("data-identity-backlog-action-id") || "");
    const item = identityBacklogState[idx];
    const action = (Array.isArray(item?.actions) ? item.actions : []).find((row) => String(row?.id || "") === actionId);
    if (!item || !action) return;
    const originalText = identityActionBtn.textContent;
    const isSpecSync = String(action?.kind || "") === "run-sync-task" && String(action?.payload?.taskId || "") === "character-specs-from-guild";
    identityActionBtn.disabled = true;
    if (isSpecSync) {
      identityActionBtn.textContent = "Syncing specs...";
      status("Running WCL/Raid Helper spec sync. This can take a moment...");
    }
    try {
      await performIdentityBacklogAction(item, action);
      await refreshIdentityManagement({ silent: true });
    } catch (error) {
      status(error?.message || "Backlog action failed");
    } finally {
      identityActionBtn.disabled = false;
      identityActionBtn.textContent = originalText;
    }
    return;
  }
  const uploadBtn = event.target.closest("[data-admin-database-user-upload]");
  if (uploadBtn) {
    event.preventDefault();
    const userId = Number(uploadBtn.getAttribute("data-admin-database-user-upload"));
    if (!Number.isInteger(userId) || userId <= 0) return;
    const input = document.getElementById("adminDatabasePictureFileInput");
    if (!input) return;
    input.value = "";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.onchange = null;
      if (!file) return;
      await adminUploadProfilePictureForUser(userId, file);
    };
    input.click();
    return;
  }
  const clearPicBtn = event.target.closest("[data-admin-database-user-clear-pic]");
  if (clearPicBtn) {
    event.preventDefault();
    const userId = Number(clearPicBtn.getAttribute("data-admin-database-user-clear-pic"));
    await adminClearProfilePictureForUser(userId);
    return;
  }
  const detailBtn = event.target.closest("[data-admin-database-user-detail]");
  if (detailBtn) {
    event.preventDefault();
    const userId = Number(detailBtn.getAttribute("data-admin-database-user-detail"));
    if (!Number.isInteger(userId) || userId <= 0) return;
    adminDatabaseExpandedUserId = userId;
    const host = document.getElementById("adminDatabaseDetailHost");
    if (host) {
      host.hidden = false;
      host.innerHTML = `<p class="subtle">Loading user #${userId}…</p>`;
    }
    try {
      const payload = await getJson(`/api/admin/database/users/${userId}`);
      renderAdminDatabaseDetail(payload, userId);
    } catch (error) {
      if (host) host.innerHTML = `<p class="subtle">Failed to load user: ${esc(error?.message || "")}</p>`;
    }
    return;
  }
  const moveCharBtn = event.target.closest("[data-admin-database-character-move]");
  if (moveCharBtn) {
    event.preventDefault();
    const characterId = Number(moveCharBtn.getAttribute("data-admin-database-character-move"));
    const targetRaw = window.prompt("Move this character to which target user ID?");
    const targetUserId = Number(targetRaw);
    if (!Number.isInteger(characterId) || characterId <= 0 || !Number.isInteger(targetUserId) || targetUserId <= 0) {
      status("Character move cancelled or invalid user ID.");
      return;
    }
    try {
      await getJson(`/api/admin/database/characters/${characterId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId }),
      });
      status(`Moved character #${characterId} to user #${targetUserId}.`);
      await loadAdminDatabasePanel({ silent: true });
    } catch (error) {
      status(`Character move failed: ${error?.message || "Unknown error"}`);
    }
    return;
  }
  const mergeUserBtn = event.target.closest("[data-admin-database-user-merge]");
  if (mergeUserBtn) {
    event.preventDefault();
    const sourceUserId = Number(mergeUserBtn.getAttribute("data-admin-database-user-merge"));
    const targetRaw = window.prompt(`Merge user #${sourceUserId} into which surviving user ID?`);
    const targetUserId = Number(targetRaw);
    if (!Number.isInteger(sourceUserId) || sourceUserId <= 0 || !Number.isInteger(targetUserId) || targetUserId <= 0 || sourceUserId === targetUserId) {
      status("User merge cancelled or invalid target user ID.");
      return;
    }
    if (!window.confirm(`Merge user #${sourceUserId} into user #${targetUserId}? This moves characters and removes the duplicate user row.`)) return;
    try {
      await getJson("/api/admin/database/users/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUserId, targetUserId }),
      });
      status(`Merged user #${sourceUserId} into user #${targetUserId}.`);
      const detailHost = document.getElementById("adminDatabaseDetailHost");
      if (detailHost) {
        detailHost.hidden = true;
        detailHost.innerHTML = "";
      }
      await loadAdminDatabasePanel({ silent: true });
    } catch (error) {
      status(`User merge failed: ${error?.message || "Unknown error"}`);
    }
    return;
  }
  const syncBtn = event.target.closest("[data-admin-database-sync-trigger]");
  if (syncBtn) {
    event.preventDefault();
    const taskId = String(syncBtn.getAttribute("data-admin-database-sync-trigger") || "").trim();
    if (!taskId) return;
    syncBtn.disabled = true;
    const orig = syncBtn.textContent;
    syncBtn.textContent = "Running…";
    try {
      await getJson(`/api/admin/sync/${encodeURIComponent(taskId)}`, { method: "POST" });
      status(`Sync task "${taskId}" triggered.`);
      await loadAdminDatabasePanel({ silent: true });
    } catch (error) {
      status(`Sync trigger failed: ${error?.message || "Unknown error"}`);
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = orig || "Run now";
    }
    return;
  }
  const syncAllBtn = event.target.closest("[data-admin-database-sync-all]");
  if (syncAllBtn) {
    event.preventDefault();
    syncAllBtn.disabled = true;
    const orig = syncAllBtn.textContent;
    syncAllBtn.textContent = "Running all syncs…";
    status("Running all sync tasks (this can take a couple of minutes)…");
    let pollHandle = null;
    try {
      pollHandle = setInterval(() => {
        loadAdminDatabasePanel({ silent: true }).catch(() => {});
      }, 4000);
      const payload = await getJson("/api/admin/sync-all", { method: "POST" });
      const okCount = Number(payload?.okCount || 0);
      const failedCount = Number(payload?.failedCount || 0);
      const skippedCount = Number(payload?.skippedCount || 0);
      const totalSeconds = Math.max(1, Math.round(Number(payload?.totalDurationMs || 0) / 1000));
      const summary = `Sync-all finished in ${totalSeconds}s — ${okCount} ok, ${failedCount} failed, ${skippedCount} skipped.`;
      status(summary);
      if (failedCount > 0 && Array.isArray(payload?.results)) {
        const failed = payload.results.filter((r) => r && r.ok === false);
        if (failed.length) {
          console.warn("[sync-all] failed tasks:", failed);
        }
      }
    } catch (error) {
      status(`Run all syncs failed: ${error?.message || "Unknown error"}`);
    } finally {
      if (pollHandle) clearInterval(pollHandle);
      syncAllBtn.disabled = false;
      syncAllBtn.textContent = orig || "Run all syncs now";
      await loadAdminDatabasePanel({ silent: true }).catch(() => {});
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const identityReloadBtn = document.getElementById("identityAccountsReloadBtn");
  if (identityReloadBtn) {
    identityReloadBtn.addEventListener("click", async () => {
      identityReloadBtn.disabled = true;
      try {
        await loadIdentityAccounts();
      } finally {
        identityReloadBtn.disabled = false;
      }
    });
  }
  const identitySearch = document.getElementById("identityAccountsSearch");
  if (identitySearch) {
    let identitySearchTimer = null;
    identitySearch.addEventListener("input", () => {
      identityAccountsSearchValue = String(identitySearch.value || "").trim();
      if (identitySearchTimer) clearTimeout(identitySearchTimer);
      identitySearchTimer = setTimeout(() => loadIdentityAccounts({ silent: true }), 250);
    });
  }
  const identityGuildRole = document.getElementById("identityAccountsGuildRole");
  if (identityGuildRole) {
    identityGuildRole.addEventListener("change", () => {
      identityAccountsGuildRoleFilter = String(identityGuildRole.value || "").trim();
      renderIdentityAccountsTable(identityAccountsState);
    });
  }
  const identityActivityCutoff = document.getElementById("identityAccountsActivityCutoff");
  if (identityActivityCutoff) {
    let identityActivityCutoffSaveTimer = null;
    const applyIdentityActivityCutoff = () => {
      identityAccountsActivityCutoffValue = String(identityActivityCutoff.value || "").trim();
      renderIdentityAccountsTable(identityAccountsState);
    };
    const scheduleIdentityActivityCutoffSave = () => {
      if (identityActivityCutoffSaveTimer) clearTimeout(identityActivityCutoffSaveTimer);
      identityActivityCutoffSaveTimer = setTimeout(async () => {
        try {
          await saveIdentityPublicVisibility();
          status("Website activity cutoff saved.");
        } catch (error) {
          status(`Website activity cutoff save failed: ${error?.message || "Unknown error"}`);
        }
      }, 300);
    };
    identityActivityCutoff.addEventListener("change", () => {
      applyIdentityActivityCutoff();
      scheduleIdentityActivityCutoffSave();
    });
    identityActivityCutoff.addEventListener("input", () => {
      applyIdentityActivityCutoff();
    });
  }
  const identityMaximizeBtn = document.getElementById("identityAccountsMaximizeBtn");
  if (identityMaximizeBtn) {
    identityMaximizeBtn.addEventListener("click", () => {
      const block = document.querySelector(".admin-identity-table-block");
      setIdentityAccountsTableMaximized(!block?.classList.contains("is-table-maximized"));
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("is-admin-table-maximized")) {
      setIdentityAccountsTableMaximized(false);
    }
  });
  const reloadBtn = document.getElementById("adminDatabaseReloadBtn");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", async () => {
      reloadBtn.disabled = true;
      try {
        await loadAdminDatabasePanel();
      } finally {
        reloadBtn.disabled = false;
      }
    });
  }
  const backupBtn = document.getElementById("adminDatabaseBackupBtn");
  if (backupBtn) {
    backupBtn.addEventListener("click", async () => {
      backupBtn.disabled = true;
      const orig = backupBtn.textContent;
      backupBtn.textContent = "Backing up…";
      try {
        const r = await getJson("/api/admin/db/backup", { method: "POST" });
        status(`Backup created: ${r.filename || ""} (${fmtBytes(r.sizeBytes)})`);
      } catch (error) {
        status(`Backup failed: ${error?.message || "Unknown error"}`);
      } finally {
        backupBtn.disabled = false;
        backupBtn.textContent = orig || "Backup database (VACUUM INTO)";
      }
    });
  }
  const downloadBackupBtn = document.getElementById("adminDatabaseDownloadBackupBtn");
  if (downloadBackupBtn) {
    downloadBackupBtn.addEventListener("click", async () => {
      downloadBackupBtn.disabled = true;
      const orig = downloadBackupBtn.textContent;
      downloadBackupBtn.textContent = "Preparing download…";
      try {
        const r = await getJson("/api/admin/db/backup", { method: "POST" });
        if (!r?.filename) throw new Error("Backup created without a filename.");
        status(`Downloading DB snapshot: ${r.filename} (${fmtBytes(r.sizeBytes)})`);
        window.location.href = `/api/admin/db/backups/${encodeURIComponent(r.filename)}/download`;
      } catch (error) {
        status(`DB snapshot download failed: ${error?.message || "Unknown error"}`);
      } finally {
        downloadBackupBtn.disabled = false;
        downloadBackupBtn.textContent = orig || "Download DB snapshot";
      }
    });
  }
  const search = document.getElementById("adminDatabaseSearch");
  if (search) {
    let t = null;
    search.addEventListener("input", () => {
      adminDatabaseSearchValue = String(search.value || "").trim();
      if (t) clearTimeout(t);
      t = setTimeout(() => loadAdminDatabasePanel({ silent: true }), 250);
    });
  }
});

document.getElementById("wclPhaseAvgsRefreshBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("wclPhaseAvgsRefreshBtn");
  try {
    await refreshWclPhaseAvgsAll(btn);
  } catch (error) {
    status(error?.message || "WCL phase refresh failed");
    if (btn) resetButtonFeedback(btn, "Refresh all");
  }
});

document.getElementById("wclPhaseAvgsReloadBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("wclPhaseAvgsReloadBtn");
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Reload", loading: "Loading…", success: "Loaded", failure: "Failed" },
      async () => {
        await loadWclPhaseAvgsPanel();
      }
    );
  } catch (error) {
    status(error?.message || "Reload failed");
  }
});


document.getElementById("admin-panel-wcl-phase-avgs")?.addEventListener("click", (event) => {
  const sortBtn = event.target.closest("[data-wcl-phase-sort]");
  if (!sortBtn) return;
  const col = String(sortBtn.getAttribute("data-wcl-phase-sort") || "").trim();
  if (!col) return;
  if (wclPhaseAvgsSort.key === col) {
    wclPhaseAvgsSort.dir = wclPhaseAvgsSort.dir === "asc" ? "desc" : "asc";
  } else {
    wclPhaseAvgsSort.key = col;
    wclPhaseAvgsSort.dir = col === "characterName" || col === "realm" ? "asc" : "desc";
  }
  getJson("/api/admin/wcl-phase-avgs")
    .then((payload) => {
      wclPhaseAvgsCachedRenderKey = "";
      renderWclPhaseAvgsTable(payload);
      wclPhaseAvgsCachedRenderKey = wclPhaseAvgsTableRenderKey(payload);
    })
    .catch((error) => status(error?.message || "Sort failed"));
});

const __origShowAdminPanel = showAdminPanel;
showAdminPanel = function (panelId, opts) {
  __origShowAdminPanel(panelId, opts);
  if (panelId === "wcl-phase-avgs") {
    loadWclPhaseAvgsPanel().catch((error) => {
      status(wclPhaseAvgsLoadErrorMessage(error));
    });
  } else {
    stopWclPhaseAvgsPoll();
  }
  if (panelId === "character-kpis" && !adminCharKpiLoaded) {
    loadAdminCharacterKpiPanel().catch((error) => {
      status(error?.message || "Failed to load character KPIs.");
    });
  }
  if (panelId === "sync-center" && !adminDatabaseLoaded) {
    loadAdminDatabasePanel().catch((error) => {
      status(error?.message || "Failed to load database panel.");
    });
  }
  if (panelId === "identity" && !identityAccountsLoaded) {
    loadIdentityAccounts().catch((error) => {
      status(error?.message || "Failed to load identity accounts.");
    });
  }
  if (panelId === "identity" && !identityBacklogLoaded) {
    loadIdentityJourney().catch((error) => {
      status(error?.message || "Failed to load identity backlog.");
    });
  }
  if (panelId === "raider-blacklist") {
    loadRaiderBlacklistPanel().catch((error) => {
      status(error?.message || "Failed to load raider blacklist.");
    });
  }
};

loadAdminData().catch((error) => {
  status(error?.message || "Failed to load admin page.");
});

(function kickInitialDatabaseLoadIfActive() {
  const activePanel = document.querySelector(".admin-panel.is-admin-panel-active");
  const id = activePanel?.getAttribute("data-admin-panel");
  if (id === "sync-center" && !adminDatabaseLoaded) {
    loadAdminDatabasePanel().catch((error) => {
      status(error?.message || "Failed to load database panel.");
    });
  }
  if (id === "identity" && !identityAccountsLoaded) {
    loadIdentityAccounts().catch((error) => {
      status(error?.message || "Failed to load identity accounts.");
    });
  }
  if (id === "identity" && !identityBacklogLoaded) {
    loadIdentityJourney().catch((error) => {
      status(error?.message || "Failed to load identity backlog.");
    });
  }
  if (id === "wcl-phase-avgs") {
    loadWclPhaseAvgsPanel().catch((error) => {
      status(wclPhaseAvgsLoadErrorMessage(error));
    });
  }
  if (id === "character-kpis" && !adminCharKpiLoaded) {
    loadAdminCharacterKpiPanel().catch((error) => {
      status(error?.message || "Failed to load character KPIs.");
    });
  }
})();
