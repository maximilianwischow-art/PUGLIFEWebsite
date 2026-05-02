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

/** Same guild as Dashboard / Events attendance (`VOTING_GUILD_ID` / `public/app.js`). */
const ADMIN_WCL_GUILD_ID = 817080;

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
    <div class="admin-table-wrap">
      <table class="admin-table">
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
  const list = Array.isArray(rows) && rows.length ? rows : [{ raidHelperName: "", wclCharacterNames: [] }];
  updateRhWclLinksChrome(list);
  host.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
            <tr>
            <th>Raid Helper name</th>
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
              return `
            <tr data-rh-wcl-row="${idx}" data-rh-wcl-stored-name="${esc(storedRh)}"${metaAttr}>
              <td><input class="admin-input" data-rh-wcl-k="rh" value="${esc(row.raidHelperName || "")}" placeholder="As on signup" /></td>
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
  host.querySelectorAll('[data-rh-wcl-k="rh"], [data-rh-wcl-k="wcl"]').forEach((inp) => {
    inp.addEventListener("input", () => {
      const tr = inp.closest("tr");
      tr?.setAttribute("data-rh-wcl-dirty", "1");
      const td = tr?.querySelector(".admin-rh-src-cell");
      if (td) td.innerHTML = `<span class="subtle">Edited — unsaved (use Save row or Save all)</span>`;
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
  if (!rh && !wclRaw) return null;
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

  const row = { raidHelperName: rh, wclCharacterNames };
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

async function loadAdminData() {
  const me = await getJson("/api/auth/me");
  const rhHost = document.getElementById("rhWclLinksTableHost");
  if (!me.authenticated || !me.isAdmin) {
    status("Admin access required (HighBullet editor account).");
    if (rhHost) {
      rhHost.innerHTML = `<p class="subtle">Log in with an authorized admin account to edit Raid Helper ↔ WCL links.</p>`;
    }
    return;
  }
  status(`Logged in as ${me?.user?.globalName || me?.user?.username || "Admin"}`);
  const gargul = await getJson("/api/loot-history/gargul");
  const loot = await getJson("/api/loot-history?limit=25");
  const p2 = await getJson("/api/p2-preparation/materials");
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
  links.push({ raidHelperName: "", wclCharacterNames: [] });
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
  renderRhWclLinksTable(links.length ? links : [{ raidHelperName: "", wclCharacterNames: [] }]);
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

loadAdminData().catch((error) => {
  status(error?.message || "Failed to load admin page.");
});
