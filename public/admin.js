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

const ROLE_ALERT_ROLES = ["Tanks", "Healers", "Melee", "Ranged"];

/** Same guild as Leaderboard (/) / Events attendance (`VOTING_GUILD_ID` / `public/app.js`). */
const ADMIN_WCL_GUILD_ID = 817080;

/** Must match `RH_WCL_GUILD_ROLES` in `lib/rh-wcl-guess.mjs` / server sanitize. */
const RH_WCL_GUILD_ROLES = ["Peon", "Grunt", "Veteran", "Core", "Puglead", "Raidlead"];

function normalizeGuildRoleValue(role) {
  const s = String(role || "").trim();
  if (s === "Guildlead") return "Puglead";
  return RH_WCL_GUILD_ROLES.includes(s) ? s : "Peon";
}

function rhWclGuildRoleSelectHtml(current) {
  const sel = normalizeGuildRoleValue(current);
  return `<select class="admin-input admin-rh-role-select" data-rh-wcl-k="guildRole" aria-label="Guild role (Core, PUG Lead, Raidlead are fixed ranks; Peon–Veteran on Events and Roster follow WCL attendance)">${RH_WCL_GUILD_ROLES.map(
    (r) => `<option value="${esc(r)}"${r === sel ? " selected" : ""}>${esc(r)}</option>`
  ).join("")}</select>`;
}

const ADMIN_GROUPS = [
  { id: "people", label: "People", tools: ["rh-wcl", "database", "hof-notes"] },
  { id: "roster", label: "Roster & Loot", tools: ["wcl-events", "gargul-import", "loot-corrections"] },
  { id: "content", label: "Content", tools: ["p2-materials", "join-needs"] },
  { id: "comms", label: "Comms", tools: ["role-alerts", "custom-dm"] },
  { id: "data-ops", label: "Data & Ops", tools: ["sync-center", "analytics"] },
];

const ADMIN_PANEL_IDS = ADMIN_GROUPS.flatMap((g) => g.tools);

/** Hashes that used to point to a now-merged panel; redirected on hashchange + initial load. */
const ADMIN_PANEL_HASH_ALIASES = {
  "data-sync": "sync-center",
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
  document.querySelectorAll("[data-admin-panel]").forEach((el) => {
    const id = el.getAttribute("data-admin-panel");
    el.classList.toggle("is-admin-panel-active", id === panelId);
  });
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
  return { panelId: "rh-wcl", subTab: null };
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
      dataCount === 0 ? "No saved mappings" : `${dataCount} mapping${dataCount === 1 ? "" : "s"}`;
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
          <button type="button" class="event-signup-btn event-signup-btn--softres" data-rh-wcl-icebox-restore data-wcl="${esc(wcl)}" title="Remove from ICEBOX so sync can suggest this name again">Restore</button>
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
      <summary>ICEBOX (${rejectedIcebox.length})</summary>
      ${
        rejectedIcebox.length
          ? `<p class="subtle">Rejected WCL names are parked here until their TTL expires. Restore to allow suggestions again.</p>
             <div class="admin-table-wrap">
               <table class="admin-table admin-rh-todo-table">
                 <thead><tr><th>WCL character</th><th>Ignored until</th><th>Actions</th></tr></thead>
                 <tbody>${iceboxRows}</tbody>
               </table>
             </div>`
          : `<p class="subtle">ICEBOX is empty.</p>`
      }
    </details>
  `;
}

async function loadRhWclTodo() {
  const host = document.getElementById("rhWclTodoHost");
  if (host && !host.dataset.rhWclTodoLoaded) host.innerHTML = `<p class="subtle">Loading to-do…</p>`;
  try {
    const payload = await getJson("/api/admin/rh-wcl-links/proposals");
    renderRhWclTodo(payload);
    if (host) host.dataset.rhWclTodoLoaded = "1";
  } catch (error) {
    if (host) host.innerHTML = `<p class="subtle">Failed to load to-do: ${esc(error?.message || "")}</p>`;
  }
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
                <button type="button" class="event-signup-btn" data-rh-wcl-save title="Save this row to disk">Save row</button>
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
  const pick = (id, fallback) => {
    const n = Number(document.getElementById(id)?.value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
  };
  return {
    Tanks: pick("roleAlertsNeedTanks", 3),
    Healers: pick("roleAlertsNeedHealers", 5),
    Melee: pick("roleAlertsNeedMelee", 8),
    Ranged: pick("roleAlertsNeedRanged", 9),
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

function renderAnalyticsSummary(payload) {
  const host = document.getElementById("adminAnalyticsSummary");
  if (!host) return;
  if (!payload || payload.ok === false) {
    host.innerHTML = `<p class="subtle">Analytics unavailable.</p>`;
    return;
  }
  host.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>Range</td><td>${esc(String(payload.days || 0))} days</td></tr>
          <tr><td>Total events</td><td>${Number(payload.totalEvents || 0)}</td></tr>
          <tr><td>Pageviews</td><td>${Number(payload.pageviews || 0)}</td></tr>
          <tr><td>Unique visitors (sessions)</td><td>${Number(payload.uniqueSessions || 0)}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderAnalyticsTopPages(payload) {
  const host = document.getElementById("adminAnalyticsTopPages");
  if (!host) return;
  const rows = Array.isArray(payload?.topPages) ? payload.topPages : [];
  if (!rows.length) {
    host.innerHTML = `<p class="subtle">No pageview data yet.</p>`;
    return;
  }
  host.innerHTML = `
    <h4 class="subtle" style="margin: 0 0 6px"><strong>Top subpages</strong></h4>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Path</th><th>Views</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td><code>${esc(String(r.path || "/"))}</code></td><td>${Number(r.views || 0)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAnalyticsDaily(payload) {
  const host = document.getElementById("adminAnalyticsDaily");
  if (!host) return;
  const rows = Array.isArray(payload?.daily) ? payload.daily : [];
  if (!rows.length) {
    host.innerHTML = `<p class="subtle">No daily trend data yet.</p>`;
    return;
  }
  host.innerHTML = `
    <h4 class="subtle" style="margin: 0 0 6px"><strong>Daily pageviews</strong></h4>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Date</th><th>Views</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${esc(String(r.day || "-"))}</td><td>${Number(r.views || 0)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

const CONVERSION_TILE_LABELS = {
  discord_click: "Discord clicks",
  subscribe_click: "Subscribe clicks",
  subscribe_success: "Subscribe successes",
  event_signup_click: "Event sign-up clicks",
};
const CONVERSION_CATEGORIES = Object.keys(CONVERSION_TILE_LABELS);

function renderAnalyticsConversions(payload) {
  const host = document.getElementById("adminAnalyticsConversions");
  if (!host) return;
  const counts = (payload && payload.conversions) || {};
  const totalSubscribeClicks = Number(counts.subscribe_click || 0);
  const totalSubscribeSuccess = Number(counts.subscribe_success || 0);
  const conversionRate =
    totalSubscribeClicks > 0
      ? `${((totalSubscribeSuccess / totalSubscribeClicks) * 100).toFixed(1)}%`
      : "—";
  host.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Metric</th><th>Count</th></tr></thead>
        <tbody>
          ${CONVERSION_CATEGORIES.map(
            (cat) => `<tr><td>${esc(CONVERSION_TILE_LABELS[cat])}</td><td>${Number(counts[cat] || 0)}</td></tr>`
          ).join("")}
          <tr><td>Subscribe success rate</td><td>${esc(conversionRate)}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderAnalyticsConversionsByLabel(payload) {
  const host = document.getElementById("adminAnalyticsConversionsByLabel");
  if (!host) return;
  const byLabel = (payload && payload.conversionsByLabel) || {};
  const blocks = CONVERSION_CATEGORIES.map((cat) => {
    const rows = Array.isArray(byLabel[cat]) ? byLabel[cat] : [];
    if (!rows.length) {
      return `
        <div class="admin-conv-by-label-block">
          <h5 class="subtle" style="margin: 6px 0"><strong>${esc(CONVERSION_TILE_LABELS[cat])}</strong> · by source</h5>
          <p class="subtle">No data yet.</p>
        </div>
      `;
    }
    return `
      <div class="admin-conv-by-label-block">
        <h5 class="subtle" style="margin: 6px 0"><strong>${esc(CONVERSION_TILE_LABELS[cat])}</strong> · by source</h5>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>Source</th><th>Count</th></tr></thead>
            <tbody>
              ${rows
                .map(
                  (r) =>
                    `<tr><td><code>${esc(String(r.label || "(none)"))}</code></td><td>${Number(r.count || 0)}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");
  host.innerHTML = blocks;
}

function renderAnalyticsConversionsDaily(payload) {
  const host = document.getElementById("adminAnalyticsConversionsDaily");
  if (!host) return;
  const rows = Array.isArray(payload?.conversionsDaily) ? payload.conversionsDaily : [];
  if (!rows.length) {
    host.innerHTML = `<p class="subtle">No conversion events recorded yet.</p>`;
    return;
  }
  host.innerHTML = `
    <h5 class="subtle" style="margin: 6px 0"><strong>Conversions per day</strong></h5>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Date</th>
            ${CONVERSION_CATEGORIES.map((cat) => `<th>${esc(CONVERSION_TILE_LABELS[cat])}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td>${esc(String(r.day || "-"))}</td>
                ${CONVERSION_CATEGORIES.map((cat) => `<td>${Number(r[cat] || 0)}</td>`).join("")}
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
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

async function loadAnalyticsPanel() {
  const daysInput = document.getElementById("adminAnalyticsDays");
  const days = Math.max(1, Math.min(365, Number(daysInput?.value || 30) || 30));
  if (daysInput) daysInput.value = String(days);
  const [analyticsPayload, subscribersPayload] = await Promise.all([
    getJson(`/api/admin/analytics/summary?days=${days}`),
    getJson("/api/admin/subscribers"),
  ]);
  renderAnalyticsSummary(analyticsPayload);
  renderAnalyticsTopPages(analyticsPayload);
  renderAnalyticsDaily(analyticsPayload);
  renderAnalyticsConversions(analyticsPayload);
  renderAnalyticsConversionsByLabel(analyticsPayload);
  renderAnalyticsConversionsDaily(analyticsPayload);
  renderSubscribers(subscribersPayload);
}

async function loadHofNotesPanel() {
  const payload = await getJson("/api/admin/hof-notes");
  renderHofNotesTable(payload);
}

async function loadPublicSnapshotStatus() {
  const payload = await getJson("/api/admin/public-snapshot/status");
  renderPublicSnapshotStatus(payload);
}

async function loadAdminData() {
  const me = await getJson("/api/auth/me");
  const rhHost = document.getElementById("rhWclLinksTableHost");
  if (!me.authenticated || !me.isAdmin) {
    status("Admin access required (HighBullet editor account).");
    if (rhHost) {
      rhHost.innerHTML = `<p class="subtle">Log in with an authorized admin account to edit Account Assignment mappings.</p>`;
    }
    return;
  }
  status(`Logged in as ${me?.user?.globalName || me?.user?.username || "Admin"}`);
  const gargul = await getJson("/api/loot-history/gargul");
  const loot = await getJson("/api/loot-history?limit=25");
  const p2 = await getJson("/api/p2-preparation/materials");
  const joinNeeds = await getJson("/api/admin/join/current-needs");
  const roleAlertEvents = await getJson("/api/admin/role-alerts/events");
  let rhLinks = [];
  try {
    const rh = await getJson("/api/admin/rh-wcl-links");
    rhLinks = Array.isArray(rh?.links) ? rh.links : [];
  } catch (error) {
    status(
      `Could not load saved Raid Helper links (${error?.message || "error"}). Add rows below and save — or redeploy latest server.`
    );
    rhLinks = [];
  }
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
    renderAnalyticsSummary({ ok: false });
    renderAnalyticsTopPages({ ok: false });
    renderAnalyticsDaily({ ok: false });
    renderSubscribers({ ok: false });
    status(`Analytics load failed: ${error?.message || "Unknown error"}`);
  }
  try {
    await loadHofNotesPanel();
  } catch (error) {
    renderHofNotesTable({ ok: false });
    status(`Hall of Fame quotes load failed: ${error?.message || "Unknown error"}`);
  }
  renderRoleAlertsEventSelect(Array.isArray(roleAlertEvents?.events) ? roleAlertEvents.events : []);
  renderRoleAlertsAnalysis(null);
  try {
    await loadCustomDmCandidates();
  } catch (error) {
    const host = document.getElementById("customDmHost");
    if (host) host.innerHTML = `<p class="subtle">Failed to load DM candidates: ${esc(error?.message || "Unknown error")}</p>`;
  }
  renderRhWclUnmatched(null);
  renderRhWclLinksTable(rhLinks);
  loadRhWclTodo().catch(() => {});
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

document.getElementById("rhWclRefreshBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("rhWclRefreshBtn");
  const dirty = document.querySelector("[data-rh-wcl-row][data-rh-wcl-dirty='1']");
  if (dirty) {
    const ok = window.confirm(
      "There are unsaved row edits (e.g. drag-and-drop assignments). Refreshing will re-render the table from disk and discard them. Continue anyway?"
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
        const summary = result?.summary || result?.result || {};
        const auto = summary.autoApplied ?? "?";
        const proposals = summary.proposals ?? "?";
        const verified = summary.verifiedSkipped ?? 0;
        status(
          `Account Assignment synced: ${auto} row(s) on disk, ${proposals} proposal(s) waiting, ${verified} verified row(s) hard-locked.`
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
    status(`Saved ${links.length} mapping row(s) to disk (sorted: unassigned first).`);
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
      status(`Restored “${wcl}” from ICEBOX. Sync can suggest it again.`);
    } catch (error) {
      status(error?.message || "Restore from ICEBOX failed");
    } finally {
      restoreIceboxBtn.disabled = false;
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
        renderRoleAlertsAnalysis(payload);
      }
    );
    status("Role-alert analysis updated.");
  } catch (error) {
    status(error?.message || "Failed to analyze selected event");
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
      <thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Spec</th><th>Realm</th><th>Discovered</th><th>First seen</th><th>Last seen</th></tr></thead>
      <tbody>${charRows || `<tr><td colspan="8" class="subtle">No characters linked.</td></tr>`}</tbody>
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
    const [readiness, sync, users] = await Promise.all([
      getJson("/api/admin/cutover-readiness").catch((e) => ({ ok: false, error: e?.message })),
      getJson("/api/admin/sync").catch((e) => ({ ok: false, error: e?.message })),
      getJson(`/api/admin/database/users${q}`),
    ]);
    renderAdminDatabaseReadiness(readiness);
    renderAdminDatabaseSync(sync);
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

document.addEventListener("click", async (event) => {
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
  if ((panelId === "database" || panelId === "sync-center") && !adminDatabaseLoaded) {
    loadAdminDatabasePanel().catch((error) => {
      status(error?.message || "Failed to load database panel.");
    });
  }
};

loadAdminData().catch((error) => {
  status(error?.message || "Failed to load admin page.");
});

(function kickInitialDatabaseLoadIfActive() {
  const activePanel = document.querySelector(".admin-panel.is-admin-panel-active");
  const id = activePanel?.getAttribute("data-admin-panel");
  if ((id === "database" || id === "sync-center") && !adminDatabaseLoaded) {
    loadAdminDatabasePanel().catch((error) => {
      status(error?.message || "Failed to load database panel.");
    });
  }
})();
