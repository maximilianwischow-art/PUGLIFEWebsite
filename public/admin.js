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
let roleAlertsSelectedUserIds = new Set();
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
  { id: "people", label: "People", tools: ["identity", "hof-notes", "badge-tooltips"] },
  { id: "roster", label: "Roster & Loot", tools: ["wcl-events", "gargul-import", "loot-corrections"] },
  { id: "content", label: "Content", tools: ["p2-materials", "join-needs"] },
  { id: "comms", label: "Comms", tools: ["role-alerts", "custom-dm", "discord-role-sync", "discord-news-queue", "discord-news"] },
  { id: "data-ops", label: "Data & Ops", tools: ["sync-center", "analytics"] },
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

function roleAlertsCompositionRowsHtml(analysis) {
  const desired = analysis?.desiredByRole || {};
  const current = analysis?.currentByRole || {};
  const missing = analysis?.missingByRole || {};
  const reachable = analysis?.reachableByRole || {};
  const blockerSpecNeedsByRole = analysis?.blockerSpecNeedsByRole || {};
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

function roleAlertsCompBoardHtml(analysis) {
  const board = analysis?.compBoard;
  if (!board || typeof board !== "object") {
    return `<p class="subtle">Comp board not available from Raid-Helper for this event.</p>`;
  }
  const emoteUrl = (id) =>
    id && /^\d+$/.test(String(id))
      ? `https://cdn.discordapp.com/emojis/${encodeURIComponent(String(id))}.webp?size=32&quality=lossless`
      : "";
  const roleCounts = board.roleCounts || {};
  const chips = ROLE_ALERT_ROLES.map(
    (role) => `<span class="role-alert-chip"><strong>${esc(role)}</strong> ${Number(roleCounts[role] || 0)}</span>`
  ).join("");
  const groups = Array.isArray(board.groups) ? board.groups : [];
  const groupHtml = groups
    .map((group) => {
      const slots = Array.isArray(group?.slots) ? group.slots : [];
      const rows = slots.length
        ? slots
            .map((slot) => {
              const cls = slot?.isBlocker
                ? "role-alert-slot role-alert-slot--blocker"
                : slot?.isKnownSignup
                  ? "role-alert-slot role-alert-slot--known"
                  : "role-alert-slot";
              const classColor = String(slot?.color || "").trim();
              const leftBorder = /^#[0-9a-f]{6}$/i.test(classColor)
                ? ` style="border-left: 3px solid ${esc(classColor)}"`
                : "";
              const specIcon = emoteUrl(slot?.specEmoteId);
              const classIcon = emoteUrl(slot?.classEmoteId);
              const title = `${String(slot?.className || "-")} · ${String(slot?.specName || "-")} · ${
                slot?.isBlocker ? "Blocker" : "Raider"
              }`;
              return `<div class="${cls}" title="${esc(title)}"${leftBorder}>
                <span class="role-alert-slot-main">
                  ${
                    specIcon || classIcon
                      ? `<span class="role-alert-slot-icons">
                        ${specIcon ? `<img class="role-alert-slot-icon" src="${esc(specIcon)}" alt="" loading="lazy" decoding="async" />` : ""}
                        ${classIcon ? `<img class="role-alert-slot-icon" src="${esc(classIcon)}" alt="" loading="lazy" decoding="async" />` : ""}
                      </span>`
                      : ""
                  }
                  <span class="role-alert-slot-name">${esc(slot?.name || "-")}</span>
                </span>
                <span class="role-alert-slot-meta">${esc(slot?.specName || slot?.className || "")}</span>
              </div>`;
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
    <div class="role-alert-chips">${chips}</div>
    <div class="role-alert-groups">${groupHtml}</div>
  `;
}

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
  const sorted = [...filtered].sort((a, b) => {
    const aSelected = roleAlertsSelectedUserIds.has(String(a?.userId || "").trim()) ? 1 : 0;
    const bSelected = roleAlertsSelectedUserIds.has(String(b?.userId || "").trim()) ? 1 : 0;
    if (aSelected !== bSelected) return bSelected - aSelected;
    const av =
      sortKey === "pastRaids"
        ? Number(a?.raidsSeen || 0)
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
        <td>${esc(row?.displayName || uid)}</td>
        <td>${esc(String(row?.recentClass || "-"))}</td>
        <td>${esc(String(row?.recentSpec || "-"))}</td>
        <td>${esc(String(row?.raidRole || "-"))}</td>
        <td>${esc((row?.matchedSpecs || []).join(", ") || "-")}</td>
        <td>${esc(row?.subscribedLabel || "No")}</td>
        <td>${esc(row?.dmSentLabel || "No")}</td>
        <td>${Number(row?.raidsSeen || 0)}</td>
      </tr>`;
    })
    .join("");
  return `
    <h4 class="subtle" style="margin: 12px 0 6px">Matching past raiders</h4>
    <p class="subtle">Candidates are filtered to users still in Discord server. "Subscribed" is shown as a marker only.</p>
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
          </tr>
        </thead>
        <tbody>${table}</tbody>
      </table>
    </div>
  `;
}

function renderRoleAlertsAnalysis(analysis) {
  roleAlertsAnalysisState = analysis && typeof analysis === "object" ? analysis : null;
  if (roleAlertsAnalysisState) {
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
  }
  const host = document.getElementById("roleAlertsHost");
  if (!host) return;
  if (!roleAlertsAnalysisState) {
    host.innerHTML = "Choose an event, then click Analyze event.";
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
    ${roleAlertsCompBoardHtml(roleAlertsAnalysisState)}
    ${roleAlertsCompositionRowsHtml(roleAlertsAnalysisState)}
    ${roleAlertsLfmMessageHtml(roleAlertsAnalysisState)}
    ${roleAlertsCandidatesHtml(roleAlertsAnalysisState)}
  `;
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
    setKpi("pageviews", "—", "vs prior period");
    setKpi("sessions", "—", "vs prior period");
    setKpi("avgday", "—", "vs prior period");
    setKpi("subscriberate", "—", "success ÷ join visits · vs prior");
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
              (row) => `<tr data-hof-note-row="${esc(String(row.winnerRaidKey || ""))}">
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

async function loadAdminSecondaryData() {
  const gargul = await getJson("/api/loot-history/gargul");
  const loot = await getJson("/api/loot-history?limit=25");
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
    await loadBadgeTooltipsPanel();
  } catch (error) {
    renderBadgeTooltipsTable({ ok: false });
    status(`Badge tooltips load failed: ${error?.message || "Unknown error"}`);
  }
  renderRoleAlertsEventSelect(Array.isArray(roleAlertEvents?.events) ? roleAlertEvents.events : []);
  renderRoleAlertsAnalysis(null);
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
  if (activePanel === "identity") {
    await Promise.allSettled([loadIdentityAccounts({ silent: false }), loadIdentityJourney({ silent: false })]);
    setTimeout(() => {
      loadAdminSecondaryData().catch((error) => {
        status(`Background admin data load failed: ${error?.message || "Unknown error"}`);
      });
    }, 0);
    return;
  }

  await loadAdminSecondaryData();
  if (activePanel === "identity") {
    await Promise.allSettled([loadIdentityAccounts({ silent: true }), loadIdentityJourney({ silent: true })]);
  }
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
      }
    );
    status("Role-alert event list reloaded.");
  } catch (error) {
    status(error?.message || "Failed to reload role-alert events");
  }
});

document.getElementById("roleAlertsAnalyzeBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("roleAlertsAnalyzeBtn");
  const eventId = roleAlertsSelectedEventId();
  if (!eventId) {
    status("Select a raid event first.");
    return;
  }
  try {
    await runWithButtonFeedback(
      btn,
      { idle: "Analyze event", loading: "Analyzing...", success: "Analyzed", failure: "Failed" },
      async () => {
        roleAlertsSelectedUserIds = new Set();
        const desiredByRole = roleAlertsReadDesiredByRole();
        const manualRoleSpecNeeds = roleAlertsReadManualRoleSpecNeeds();
        const overrides = roleAlertsReadOverrides();
        const payload = await getJson("/api/admin/role-alerts/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            overrides,
            desiredByRole,
            manualRoleSpecNeeds,
          }),
        });
        renderRoleAlertsAnalysis(payload);
      }
    );
    status("Role-alert analysis updated.");
  } catch (error) {
    status(error?.message || "Failed to analyze selected event");
  }
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
          renderRoleAlertsAnalysis(roleAlertsAnalysisState);
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
    renderRoleAlertsAnalysis(roleAlertsAnalysisState);
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
  renderRoleAlertsAnalysis(roleAlertsAnalysisState);
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
  renderRoleAlertsAnalysis(roleAlertsAnalysisState);
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
  renderRoleAlertsAnalysis(roleAlertsAnalysisState);
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
          body: JSON.stringify({ winnerRaidKey, quote }),
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
let identityAccountsActivityCutoffValue = "";
let identityAccountsSortState = { key: "lastActivity", dir: "desc" };
let identityAccountsTotal = 0;
let identityAccountsServerShown = 0;
let identityAccountsLoadPromise = null;
let identityAuditLoadPromise = null;
let identityJourneyLoadPromise = null;
let identityReviewDetailsLoadPromise = null;

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
  const shownAfterCutoff = filterIdentityAccountsByActivity(identityAccountsState).length;
  const cutoffText = cutoffMs
    ? ` Public website cutoff: last activity on/after <strong>${esc(new Date(cutoffMs).toLocaleDateString())}</strong>; ${Math.max(0, identityAccountsServerShown - shownAfterCutoff)} hidden from public profile lists.`
    : "";
  host.innerHTML = `<p class="subtle"><strong>${shownAfterCutoff}</strong> of <strong>${identityAccountsTotal}</strong> identities shown.${cutoffText}</p>`;
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
  const visibleAccounts = filterIdentityAccountsByActivity(accounts);
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
          <input class="admin-input" data-identity-k="discordUserId" value="${esc(account.discordUserId || "")}" placeholder="Discord ID" inputmode="numeric" />
        </td>
        <td>
          <input class="admin-input" data-identity-k="displayName" value="${esc(account.displayName || "")}" placeholder="Main character name" />
          <div class="subtle">Leaderboard/profile display</div>
        </td>
        <td>${identityRoleSelectHtml(account.guildRole)}</td>
        <td>
          <div class="admin-actions admin-actions--tight" style="align-items:flex-start">
            <input class="admin-input" data-identity-main="characterName" value="${esc(main.characterName || "")}" placeholder="Main character" />
            <input class="admin-input" data-identity-main="wowClass" value="${esc(main.wowClass || "")}" placeholder="Class" />
            <input class="admin-input" data-identity-main="wowSpec" value="${esc(main.wowSpec || "")}" placeholder="Spec" />
          </div>
          <div class="subtle" style="margin-top:4px">Realm fixed to Thunderstrike.</div>
        </td>
        <td>
          <textarea class="admin-input" data-identity-k="altCharacters" rows="3" placeholder="One per line: Name | Class | Spec">${esc(identityAltTextareaValue(account.altCharacters))}</textarea>
          <div class="subtle">${(account.altCharacters || []).length} alt${(account.altCharacters || []).length === 1 ? "" : "s"}</div>
        </td>
        <td>${esc(activityText)}${activityLabel}</td>
        <td>${renderIdentityLatestRaidParse(account.latestRaidParse)}</td>
        <td class="admin-rh-actions-cell">
          <button type="button" class="event-signup-btn" data-identity-account-save="${account.id}">Save</button>
          <button type="button" class="event-signup-btn event-signup-btn--softres" data-admin-database-user-detail="${account.id}">Details</button>
          <button type="button" class="event-signup-btn event-signup-btn--softres" data-admin-database-user-merge="${account.id}">Merge</button>
        </td>
      </tr>`;
    })
    .join("");
  host.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>${identitySortButton("discordUserId", "Discord ID")}</th>
            <th>${identitySortButton("displayName", "Display Name")}</th>
            <th>${identitySortButton("guildRole", "Role")}</th>
            <th>${identitySortButton("mainCharacter", "Main Char with Spec")}</th>
            <th>${identitySortButton("altCharacters", "Alt Chars with Spec")}</th>
            <th>${identitySortButton("lastActivity", "Last Activity")}</th>
            <th>${identitySortButton("latestRaidParse", "Highest Parse Last Raid")}</th>
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

async function loadIdentityAccounts({ silent = false } = {}) {
  if (identityAccountsLoadPromise) return identityAccountsLoadPromise;
  identityAccountsLoadPromise = (async () => {
  const host = document.getElementById("identityAccountsTableHost");
  if (!silent && host) host.innerHTML = `<p class="subtle">Loading identities…</p>`;
  const q = identityAccountsSearchValue ? `?q=${encodeURIComponent(identityAccountsSearchValue)}` : "";
  const payload = await getJson(`/api/admin/identity/accounts${q}`);
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
    const userId = Number(identitySaveBtn.getAttribute("data-identity-account-save"));
    const tr = identitySaveBtn.closest("[data-identity-account-row]");
    if (!Number.isInteger(userId) || userId <= 0 || !tr) return;
    const payload = readIdentityAccountRow(tr);
    if (!payload.mainCharacter.characterName) {
      status("Enter a main character before saving this identity.");
      return;
    }
    identitySaveBtn.disabled = true;
    try {
      await getJson(`/api/admin/identity/accounts/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      tr.removeAttribute("data-identity-dirty");
      status(`Saved identity for ${payload.displayName || payload.mainCharacter.characterName}.`);
      await refreshIdentityManagement({ silent: true });
    } catch (error) {
      status(error?.message || "Identity save failed");
    } finally {
      identitySaveBtn.disabled = false;
    }
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

const __origShowAdminPanel = showAdminPanel;
showAdminPanel = function (panelId, opts) {
  __origShowAdminPanel(panelId, opts);
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
})();
