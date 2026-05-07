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

const ADMIN_PANEL_IDS = [
  "rh-wcl",
  "wcl-events",
  "gargul-import",
  "loot-corrections",
  "p2-materials",
  "join-needs",
  "data-sync",
  "analytics",
  "hof-notes",
  "role-alerts",
  "custom-dm",
];

let customDmCandidatesState = [];
let customDmSelectedUserIds = new Set();
let customDmFilterState = { displayName: "", guildRole: "", recentClass: "", recentSpec: "", subscribed: "" };
let customDmRoleTargets = new Set(["Tanks", "Healers", "Melee", "Ranged"]);

function parseAdminHash() {
  const raw = (location.hash || "").replace(/^#/, "").trim();
  if (!raw) return null;
  const normalized = raw.startsWith("admin-") ? raw.slice(6) : raw;
  return ADMIN_PANEL_IDS.includes(normalized) ? normalized : null;
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
  if (replaceHash) {
    const next = `#admin-${panelId}`;
    if (location.hash !== next) history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
  }
  try {
    sessionStorage.setItem("adminPanel", panelId);
  } catch (_) {
    /* ignore */
  }
}

function initialAdminPanelId() {
  const fromHash = parseAdminHash();
  if (fromHash) return fromHash;
  try {
    const s = sessionStorage.getItem("adminPanel");
    if (s && ADMIN_PANEL_IDS.includes(s)) return s;
  } catch (_) {
    /* ignore */
  }
  return "rh-wcl";
}

function initAdminSubmenu() {
  showAdminPanel(initialAdminPanelId(), { replaceHash: false });

  document.querySelectorAll("[data-admin-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-admin-nav");
      if (id && ADMIN_PANEL_IDS.includes(id)) showAdminPanel(id);
    });
  });

  window.addEventListener("hashchange", () => {
    const id = parseAdminHash();
    if (id) showAdminPanel(id, { replaceHash: false });
  });
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
              return `
            <tr data-rh-wcl-row="${idx}" data-rh-wcl-stored-name="${esc(storedRh)}" data-rh-wcl-stored-id="${esc(discordId)}"${metaAttr}>
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
                  Array.isArray(row.wclCharacterNames) ? row.wclCharacterNames.join(", ") : ""
                )}" placeholder="Comma-separated, or use Add alt below" />
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
              </td>
              <td class="admin-rh-src-cell">${rhWclMatchChipsHtml(row)}</td>
              <td class="admin-rh-actions-cell">
                <button type="button" class="event-signup-btn" data-rh-wcl-save title="Save this row to disk">Save row</button>
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
  const wclCharacterNames = wclRaw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

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
  return row;
}

function readRhWclLinksFromTable() {
  return [...document.querySelectorAll("[data-rh-wcl-row]")]
    .map((tr) => readRhWclLinkRowFromTr(tr))
    .filter(Boolean);
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

loadAdminData().catch((error) => {
  status(error?.message || "Failed to load admin page.");
});
