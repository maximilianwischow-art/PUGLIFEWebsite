/** Twinkling starfield (matches Fallen Tacticians design kit). */
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

const statusEl = document.querySelector("#status");
const dashboardPbRow = document.querySelector("#dashboardPbRow");
const dashboardRosterBlock = document.querySelector("#dashboardRosterBlock");
const GUILD_ID = 817080;
const potrRaidBanner = document.querySelector("#potrRaidBanner");
const potrRaidDate = document.querySelector("#potrRaidDate");
const potrRaidStatus = document.querySelector("#potrRaidStatus");
const potrDps = document.querySelector("#potrDps");
const potrHeal = document.querySelector("#potrHeal");
const potrTank = document.querySelector("#potrTank");
const deathMeta = document.querySelector("#deathMeta");
const deathLeaderboard = document.querySelector("#deathLeaderboard");
const attendanceMeta = document.querySelector("#attendanceMeta");
const attendanceList = document.querySelector("#attendanceList");
const deathEncounterMeta = document.querySelector("#deathEncounterMeta");
const deathEncounterHeatmap = document.querySelector("#deathEncounterHeatmap");
const raidCalendarGrid = document.querySelector("#raidCalendarGrid");
const raidDayBackdrop = document.querySelector("#raidDayBackdrop");
const raidDayModal = document.querySelector("#raidDayModal");
const raidDayModalTitle = document.querySelector("#raidDayModalTitle");
const raidDayModalBody = document.querySelector("#raidDayModalBody");
const raidDayModalClose = document.querySelector("#raidDayModalClose");

/** Tracked raids → latest run rows shown per column (sync with server TRACKED_RAIDS). */
const RAID_CALENDAR_RAID_ORDER = ["Karazhan", "Gruul's Lair", "Magtheridon's Lair"];
const RAID_CALENDAR_PER_RAID = 20;

/** @type {Record<string, Array>} */
let raidCalendarColumnsData = {};

/** Fastest full clear first; logs without a full-clear time at the bottom (newest last among those). */
function compareRaidCalendarByRunTime(a, b) {
  const aMs = a.isFullClear && Number(a.clearDurationMs) > 0 ? Number(a.clearDurationMs) : null;
  const bMs = b.isFullClear && Number(b.clearDurationMs) > 0 ? Number(b.clearDurationMs) : null;
  if (aMs != null && bMs != null) return aMs - bMs;
  if (aMs != null && bMs == null) return -1;
  if (aMs == null && bMs != null) return 1;
  return (Number(b.startTime) || 0) - (Number(a.startTime) || 0);
}

if (raidCalendarGrid) {
  raidCalendarGrid.addEventListener("click", (ev) => {
    const row = ev.target.closest(".raid-cal-run[data-cal-raid]");
    if (!row) return;
    const key = row.dataset.calRaid;
    const i = Number(row.dataset.calI);
    const list = raidCalendarColumnsData[key];
    const entry = Array.isArray(list) ? list[i] : null;
    if (!entry) return;
    openRaidDetailModal(`${shortRaidName(entry.raidName)} · ${fmtDate(entry.startTime)}`, [entry]);
  });
}

if (raidDayModalClose) raidDayModalClose.addEventListener("click", closeRaidDayModal);
if (raidDayBackdrop) raidDayBackdrop.addEventListener("click", closeRaidDayModal);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && raidDayModal && !raidDayModal.hidden) closeRaidDayModal();
});

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function fmtDate(timestampMs) {
  if (!timestampMs) return "-";
  const date = new Date(Number(timestampMs));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

/** Long-form date for POTR strip (no log title). */
function fmtPotrRaidDate(timestampMs) {
  if (!timestampMs) return "";
  const date = new Date(Number(timestampMs));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
}

function parseColor(rankPercent) {
  const value = Number(rankPercent);
  if (!Number.isFinite(value)) return "#a08850";
  if (value >= 100) return "#e5cc80"; // gold
  if (value >= 99) return "#e268a8"; // pink
  if (value >= 95) return "#ff8000"; // orange
  if (value >= 75) return "#a335ee"; // purple
  if (value >= 50) return "#0070ff"; // blue
  if (value >= 25) return "#1eff00"; // green
  return "#9d9d9d"; // gray
}

const BOSS_ICON_BY_NAME = {
  "Attumen the Huntsman": "/boss-icons/652.jpg",
  Moroes: "/boss-icons/653.jpg",
  "Maiden of Virtue": "/boss-icons/654.jpg",
  "Opera Hall": "/boss-icons/655.jpg",
  "The Curator": "/boss-icons/656.jpg",
  "Terestian Illhoof": "/boss-icons/657.jpg",
  "Shade of Aran": "/boss-icons/658.jpg",
  Netherspite: "/boss-icons/659.jpg",
  "Chess Event": "/boss-icons/660.jpg",
  "Prince Malchezaar": "/boss-icons/661.jpg",
  Nightbane: "/boss-icons/662.jpg",
  "High King Maulgar": "/boss-icons/649.jpg",
  "Gruul the Dragonkiller": "/boss-icons/650.jpg",
  Magtheridon: "/boss-icons/651.jpg",
};

function bossIconUrl(bossName) {
  return BOSS_ICON_BY_NAME[bossName] || "/boss-icons/660.jpg";
}

function classIconCandidates(iconKey, className) {
  const result = [];
  if (iconKey) result.push(`/class-icons/${iconKey}.jpg`);
  if (className) result.push(`/class-icons/${className}.jpg`);
  result.push("/class-icons/Warrior.jpg");
  return result;
}

function classIconImg(iconKey, className, alt) {
  const candidates = classIconCandidates(iconKey, className);
  const escaped = candidates.map((x) => `'${x}'`).join(",");
  return `<img class="class-icon" src="${candidates[0]}" alt="${alt}" loading="lazy" data-fallbacks="${escaped}" onerror="(function(img){const arr=img._fb||(img._fb=[${escaped}]);const i=arr.indexOf(img.getAttribute('src'));if(i>=0&&i<arr.length-1){img.setAttribute('src',arr[i+1]);}else{img.onerror=null;}})(this)" />`;
}

function fmtDuration(ms) {
  const totalSeconds = Math.floor(Number(ms || 0) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "-";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function localYmd(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shortRaidName(raidName) {
  const s = String(raidName || "");
  if (s === "Karazhan") return "Kara";
  if (s === "Gruul's Lair") return "Gruul";
  if (s === "Magtheridon's Lair") return "Mag";
  return s || "?";
}

function raidListingImagePath(raidName) {
  const s = String(raidName || "");
  if (s === "Karazhan") return "/raid-images/kara.png";
  if (s === "Gruul's Lair") return "/raid-images/gruul.png";
  if (s === "Magtheridon's Lair") return "/raid-images/magtheridon.png";
  return "/raid-images/kara.png";
}

/** Wide cinematic headers for dashboard personal-best tiles (_best time_ row only). */
function raidPbHeaderImagePath(raidName) {
  const s = String(raidName || "");
  if (s === "Karazhan") return "/raid-images/pb-header-kara.png";
  if (s === "Gruul's Lair") return "/raid-images/pb-header-gruul.png";
  if (s === "Magtheridon's Lair") return "/raid-images/pb-header-magtheridon.png";
  return "/raid-images/pb-header-kara.png";
}

/** Kara + Gruul's Lair show per-encounter times in an expandable tile; Magtheridon is a single boss. */
function raidHasEncounterBreakdown(raidName) {
  return raidName === "Karazhan" || raidName === "Gruul's Lair";
}

function buildEncounterTableHtml(raid) {
  const rows = (raid.bosses || []).map(buildBestTimeRow).join("");
  return `
    <table class="times-table times-table--pb">
      <thead>
        <tr>
          <th>Boss</th>
          <th>Best time</th>
          <th>Date</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderDashboardOverview(raidSummary, rosterInfo) {
  const ri = rosterInfo || {};
  const roster = ri.recentRankedRoster || [];

  if (dashboardPbRow) {
    const tiles = (raidSummary || []).map((raid) => {
      const bc = raid.bestClear;
      const dur = bc ? fmtDuration(bc.durationMs) : "—";
      const when = bc ? fmtDate(bc.reportStartTime) : "";
      const logHref = bc
        ? `https://fresh.warcraftlogs.com/reports/${escapeHtml(bc.reportCode)}`
        : "";
      const sub = bc ? `${when}` : "No full clear in loaded reports yet";
      const bannerSrc = raidPbHeaderImagePath(raid.raidName);

      if (!raidHasEncounterBreakdown(raid.raidName)) {
        return `
        <article class="pb-tile">
          <img class="pb-tile-banner" src="${escapeHtml(bannerSrc)}" alt="" loading="lazy" />
          <div class="pb-tile-body">
            <h3 class="pb-tile-name">${escapeHtml(shortRaidName(raid.raidName))}</h3>
            <p class="pb-tile-time">${escapeHtml(dur)}</p>
            <p class="pb-tile-sub">${escapeHtml(sub)}</p>
            ${
              bc
                ? `<a class="pb-tile-link" href="${logHref}" target="_blank" rel="noreferrer">Open log</a>`
                : ""
            }
          </div>
        </article>`;
      }

      const ariaToggle = `Encounter best times for ${shortRaidName(raid.raidName)}`;

      return `
        <article class="pb-tile pb-tile--expandable">
          <img class="pb-tile-banner" src="${escapeHtml(bannerSrc)}" alt="" loading="lazy" />
          <details class="pb-tile-details">
            <summary class="pb-tile-summary" aria-label="${escapeHtml(ariaToggle)}">
              <div class="pb-tile-summary-main">
                <h3 class="pb-tile-name">${escapeHtml(shortRaidName(raid.raidName))}</h3>
                <p class="pb-tile-time">${escapeHtml(dur)}</p>
                <p class="pb-tile-sub">${escapeHtml(sub)}</p>
              </div>
              <span class="pb-tile-chevron" aria-hidden="true">▼</span>
            </summary>
            <div class="pb-tile-encounters">
              ${buildEncounterTableHtml(raid)}
            </div>
          </details>
          ${
            bc
              ? `<div class="pb-tile-footer"><a class="pb-tile-link" href="${logHref}" target="_blank" rel="noreferrer">Open log</a></div>`
              : ""
          }
        </article>`;
    });
    dashboardPbRow.innerHTML = tiles.join("") || '<p class="subtle">No raid data.</p>';
  }

  if (dashboardRosterBlock) {
    const pbCodes = ri.pbClearReportCodes || [];
    const rosterEmptyMsg =
      pbCodes.length === 0
        ? `<p class="subtle">No roster yet — personal-best full clears only appear after each tracked raid has a fastest clear in the loaded logs.</p>`
        : `<p class="subtle">Those personal-best logs list no ranked characters.</p>`;

    const rosterNames = roster
      .map((x) => (typeof x === "string" ? x : String(x?.name || "")).trim())
      .filter(Boolean);

    const rosterHtml =
      rosterNames.length === 0
        ? rosterEmptyMsg
        : `<div class="roster-pills">${rosterNames
            .map((n) => `<span class="roster-chip">${escapeHtml(n)}</span>`)
            .join("")}</div>`;

    dashboardRosterBlock.innerHTML = `
      <div class="roster-overview-roster-only">
        <h3 class="roster-block-title">Raid roster (personal-best clears)</h3>
        ${rosterHtml}
      </div>
    `;
  }
}

function clearHeatLabel(heat) {
  const h = Number(heat);
  if (!Number.isFinite(h)) return "";
  if (h >= 0.95) return "Excellent vs recent clears";
  if (h >= 0.75) return "Strong vs recent clears";
  if (h >= 0.5) return "Average vs recent clears";
  if (h >= 0.25) return "Below recent clears";
  return "Slow vs recent clears";
}

function clearHeatColor(heat) {
  const h = Number(heat);
  if (!Number.isFinite(h)) return null;
  const hue = 200 - h * 95;
  const sat = 58 + h * 22;
  const light = 32 + h * 18;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function buildRaidDayDetailRowHtml(e) {
  const timeLine =
    e.isFullClear && e.clearDurationMs
      ? `Clear ${fmtDuration(e.clearDurationMs)}`
      : `Bosses ${e.bossesKilled}/${e.bossesTotal}`;
  const fill = clearHeatColor(e.clearHeat) || "var(--text-muted)";
  const width = typeof e.clearHeat === "number" ? `${Math.round(e.clearHeat * 100)}%` : "0%";
  const qualTitle = typeof e.clearHeat === "number" ? clearHeatLabel(e.clearHeat) : "";
  const heatRow =
    typeof e.clearHeat === "number"
      ? `<div class="raid-day-heat" title="${escapeHtml(qualTitle || "vs best / slowest in loaded history")}"><div class="raid-day-heat-fill" style="width:${width};background:${fill}"></div></div><p class="subtle raid-day-qual">${escapeHtml(qualTitle)}</p>`
      : "";
  const pb =
    e.isFullClear && e.isBestClearInCalendar
      ? '<p class="raid-day-pb">Personal best in loaded history for this raid</p>'
      : "";
  const behind =
    e.isFullClear && Number(e.deltaBehindBestMs) > 0
      ? `<p class="subtle">${fmtDuration(e.deltaBehindBestMs)} behind fastest in window</p>`
      : "";
  const recordClass = e.isBestClearInCalendar ? " raid-day-row--record" : "";
  return `
        <div class="raid-day-row${recordClass}">
          <img src="${e.image}" alt="${escapeHtml(e.raidName)}" loading="lazy" />
          <div>
            <h4>${escapeHtml(e.raidName)}</h4>
            <p class="subtle">${escapeHtml(e.title)}</p>
            <p class="subtle">Uploaded by ${escapeHtml(e.uploadedBy || "—")}</p>
            <p class="raid-day-clear-line">${escapeHtml(timeLine)}</p>
            ${pb}
            ${behind}
            ${heatRow}
            <a href="${escapeHtml(e.wclUrl)}" target="_blank" rel="noreferrer">Warcraft Logs</a>
          </div>
        </div>
      `;
}

/** One selectable row within a raid column (newest-first stack). */
function buildRaidCalendarColumnRunHtml(e, raidKey, idx) {
  const heat = typeof e.clearHeat === "number" ? e.clearHeat : null;
  const heatFill = clearHeatColor(heat) || "rgba(232,148,58,0.35)";
  const recordClass = e.isBestClearInCalendar ? " raid-cal-run--record" : "";
  const timeLine =
    e.isFullClear && e.clearDurationMs ? fmtDuration(e.clearDurationMs) : `${e.bossesKilled}/${e.bossesTotal}`;
  const qualBar =
    heat != null
      ? `<div class="raid-cal-run-heat" title="${escapeHtml(clearHeatLabel(heat))}"><span style="width:${Math.round(heat * 100)}%;background:${heatFill}"></span></div>`
      : "";
  const badge = e.isBestClearInCalendar
    ? '<span class="raid-cal-run-badge" title="Fastest full clear in loaded history for this raid">PB</span>'
    : "";
  const deltaTitle =
    heat != null && Number(e.deltaBehindBestMs) > 0
      ? ` title="${escapeHtml(`${fmtDuration(e.deltaBehindBestMs)} slower than fastest in window`)}"`
      : heat != null
        ? ` title="${escapeHtml(clearHeatLabel(heat))}"`
        : "";
  const dateLine = fmtDate(e.startTime);
  const rk = escapeHtml(raidKey);
  return `<button type="button" class="raid-cal-run raid-cal-run--column${recordClass}"${deltaTitle} data-cal-raid="${rk}" data-cal-i="${idx}">
      <img src="${escapeHtml(e.image)}" alt="" loading="lazy" />
      <div class="raid-cal-run-body">
        <span class="raid-cal-run-meta">${escapeHtml(dateLine)}</span>
        <span class="raid-cal-run-time">${escapeHtml(timeLine)}</span>
        ${qualBar}
      </div>
      ${badge}
    </button>`;
}

function renderRaidCalendarColumns() {
  if (!raidCalendarGrid) return;
  const cols = RAID_CALENDAR_RAID_ORDER.map((raidName) => {
    const rows = raidCalendarColumnsData[raidName] || [];
    const runsHtml = rows
      .map((e, idx) => buildRaidCalendarColumnRunHtml(e, raidName, idx))
      .join("");
    const empty = runsHtml
      ? ""
      : '<p class="subtle raid-cal-empty">No runs in loaded reports.</p>';
    return `
      <div class="raid-cal-column">
        <div class="raid-cal-column-head">
          <img src="${escapeHtml(raidListingImagePath(raidName))}" alt="" loading="lazy" />
          <span class="raid-cal-column-title">${escapeHtml(shortRaidName(raidName))}</span>
        </div>
        <div class="raid-cal-column-body">${runsHtml}${empty}</div>
      </div>`;
  }).join("");
  raidCalendarGrid.innerHTML = `<div class="raid-cal-columns">${cols}</div>`;
}

function openRaidDetailModal(titleText, entries) {
  if (!raidDayModalTitle || !raidDayModalBody) return;
  raidDayModalTitle.textContent = titleText;
  raidDayModalBody.innerHTML = (entries || []).map((e) => buildRaidDayDetailRowHtml(e)).join("");
  if (raidDayBackdrop) raidDayBackdrop.hidden = false;
  if (raidDayModal) raidDayModal.hidden = false;
}

function closeRaidDayModal() {
  if (raidDayBackdrop) raidDayBackdrop.hidden = true;
  if (raidDayModal) raidDayModal.hidden = true;
}

async function loadRecentRaidsCalendar() {
  if (!raidCalendarGrid) return;
  raidCalendarGrid.innerHTML = '<div class="subtle">Loading…</div>';
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/recent-raids-calendar?limit=120`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch raid calendar");
    }
    const entries = payload.entries || [];
    raidCalendarColumnsData = {};
    for (const name of RAID_CALENDAR_RAID_ORDER) {
      raidCalendarColumnsData[name] = [];
    }
    for (const e of entries) {
      const k = e.raidName;
      if (!raidCalendarColumnsData[k]) continue;
      raidCalendarColumnsData[k].push(e);
    }
    for (const name of RAID_CALENDAR_RAID_ORDER) {
      raidCalendarColumnsData[name].sort(compareRaidCalendarByRunTime);
      raidCalendarColumnsData[name] = raidCalendarColumnsData[name].slice(0, RAID_CALENDAR_PER_RAID);
    }
    renderRaidCalendarColumns();
  } catch (error) {
    raidCalendarGrid.innerHTML = `<div class="subtle">${escapeHtml(error.message)}</div>`;
  }
}

function buildBestTimeRow(boss) {
  if (!boss.bestKill) {
    return `
      <tr>
        <td>${boss.bossName}</td>
        <td>-</td>
        <td>-</td>
        <td>Not killed yet</td>
      </tr>
    `;
  }

  const fightLink = `https://fresh.warcraftlogs.com/reports/${boss.bestKill.reportCode}#fight=${boss.bestKill.fightId}`;
  return `
    <tr>
      <td>
        <span class="boss-cell">
          <img src="${bossIconUrl(boss.bossName)}" alt="${boss.bossName}" loading="lazy" />
          ${boss.bossName}
        </span>
      </td>
      <td>${fmtDuration(boss.bestKill.durationMs)}</td>
        <td>${fmtDate(boss.bestKill.reportStartTime)}</td>
      <td>
        <a href="${fightLink}" target="_blank" rel="noreferrer">View log</a>
      </td>
    </tr>
  `;
}

async function loadBossTimes() {
  setStatus("Loading best kill times...");
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/boss-times?limit=50`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch boss times");
    }

    renderDashboardOverview(payload.raidSummary || [], payload.rosterInfo);
    setStatus("Best times updated.");
  } catch (error) {
    if (dashboardPbRow) {
      dashboardPbRow.innerHTML = `<p class="subtle">${escapeHtml(error.message)}</p>`;
    }
    if (dashboardRosterBlock) {
      dashboardRosterBlock.innerHTML = `<p class="subtle">${escapeHtml(error.message)}</p>`;
    }
    setStatus(error.message || "Failed to fetch boss times.", true);
  }
}

function renderPotr(target, label, player) {
  if (!player) {
    target.textContent = `No ${label.toLowerCase()} data.`;
    return;
  }
  const totalLabel =
    label === "DPS" ? "Total DPS" : label === "Healer" ? "Total HPS" : "Total Damage Taken";
  const parseText =
    typeof player.bestParse?.rankPercent === "number"
      ? `Highest Parse:
        <span class="boss-cell">
          <img src="${bossIconUrl(player.bestParse.bossName)}" alt="${player.bestParse.bossName}" loading="lazy" />
          <span style="color:${parseColor(player.bestParse.rankPercent)};font-weight:700">${player.bestParse.rankPercent.toFixed(
            1
          )}</span>
          <span>(${player.bestParse.bossName})</span>
        </span>`
      : "Highest Parse: -";
  target.innerHTML = `
    <strong class="player-title">${classIconImg(player.icon, player.type, player.name)}${player.name}</strong>
    <div>${player.type}</div>
    <div>${totalLabel}: ${fmtNumber(player.total)}</div>
    <div>${parseText}</div>
  `;
}

function renderPotrRaidStrip(raid) {
  if (!potrRaidBanner || !potrRaidDate) return;
  const raidName = raid?.raidName;
  const ts = raid?.startTime;

  if (raidName) {
    potrRaidBanner.src = raidPbHeaderImagePath(raidName);
    potrRaidBanner.alt = `${shortRaidName(raidName)}`;
    potrRaidBanner.hidden = false;
  } else {
    potrRaidBanner.removeAttribute("src");
    potrRaidBanner.alt = "";
    potrRaidBanner.hidden = true;
  }

  if (ts) {
    const d = new Date(Number(ts));
    if (!Number.isNaN(d.getTime())) {
      potrRaidDate.dateTime = d.toISOString();
      potrRaidDate.textContent = fmtPotrRaidDate(ts);
    } else {
      potrRaidDate.removeAttribute("datetime");
      potrRaidDate.textContent = "";
    }
  } else {
    potrRaidDate.removeAttribute("datetime");
    potrRaidDate.textContent = "";
  }
}

async function loadLatestRaidMvp() {
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/latest-raid-mvp?limit=20`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch latest raid MVP");
    }

    renderPotrRaidStrip(payload.raid);
    if (potrRaidStatus) {
      potrRaidStatus.hidden = true;
      potrRaidStatus.textContent = "";
    }
    renderPotr(potrDps, "DPS", payload.dps);
    renderPotr(potrHeal, "Healer", payload.heal);
    renderPotr(potrTank, "Tank", payload.tank);
  } catch (error) {
    renderPotrRaidStrip(null);
    renderPotr(potrDps, "DPS", null);
    renderPotr(potrHeal, "Healer", null);
    renderPotr(potrTank, "Tank", null);
    if (potrRaidStatus) {
      potrRaidStatus.hidden = false;
      potrRaidStatus.textContent = error.message || "Unable to load latest raid.";
    }
  }
}

async function loadDeathLeaderboard() {
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/death-leaderboard?limit=50`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch death leaderboard");
    }

    const rows = payload?.leaderboard || [];
    deathMeta.textContent = `Across ${payload?.scannedReports || 0} tracked raid report(s).`;
    if (!rows.length) {
      deathLeaderboard.innerHTML = "<li>No death data available yet.</li>";
      return;
    }

    deathLeaderboard.innerHTML = rows
      .map(
        (row) =>
          `<li><span class="death-name">${row.name}</span><span class="death-value">${fmtNumber(
            row.deaths
          )} deaths</span></li>`
      )
      .join("");
  } catch (error) {
    deathMeta.textContent = error.message || "Unable to load deaths.";
    deathLeaderboard.innerHTML = "<li>Could not load death tracker.</li>";
  }
}

async function loadAttendanceTracker() {
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/attendance?limit=40&top=12`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch attendance");
    }

    const rows = payload?.leaderboard || [];
    attendanceMeta.textContent = `Across ${payload?.consideredRaids || 0} recent tracked raids.`;
    if (!rows.length) {
      attendanceList.innerHTML = "<div>No attendance data yet.</div>";
      return;
    }

    attendanceList.innerHTML = rows
      .map(
        (row, idx) => `
          <div class="attendance-row">
            <span class="attendance-rank">#${idx + 1}</span>
            <span class="attendance-name">${row.name}</span>
            <span class="attendance-value">${row.raidsAttended}/${payload.consideredRaids}</span>
            <span class="attendance-rate">${row.attendanceRate.toFixed(0)}%</span>
            <span class="attendance-history">
              ${(Array.isArray(row.attendanceHistory) ? row.attendanceHistory : [])
                .map((v) => `<span class="attendance-dot ${v ? "on" : "off"}"></span>`)
                .join("")}
            </span>
          </div>
        `
      )
      .join("");
  } catch (error) {
    attendanceMeta.textContent = error.message || "Unable to load attendance.";
    attendanceList.innerHTML = "<div>Could not load attendance tracker.</div>";
  }
}

async function loadDeathEncounterHeatmap() {
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/death-encounter-heatmap?limit=50`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch death encounter heatmap");
    }

    const rows = payload?.heatmap || [];
    deathEncounterMeta.textContent = `${rows.length} tracked boss(es) across recent raids.`;
    if (!rows.length) {
      deathEncounterHeatmap.innerHTML = "<div>No encounter death data yet.</div>";
      return;
    }

    deathEncounterHeatmap.innerHTML = rows
      .slice(0, 12)
      .map((row) => {
        const severity = row.deathsPerAttempt >= 15 ? "high" : row.deathsPerAttempt >= 8 ? "mid" : "low";
        return `
          <div class="heatmap-row ${severity}">
            <div>
              <span class="boss-cell">
                <img src="${bossIconUrl(row.bossName)}" alt="${row.bossName}" loading="lazy" />
                <strong>${row.bossName}</strong>
              </span>
              <span class="subtle">(${row.raidName})</span>
            </div>
            <div class="heatmap-stats">
              <span>${fmtNumber(row.totalDeaths)} deaths</span>
              <span>${row.deathsPerAttempt.toFixed(1)}/attempt</span>
              <span>${row.wipeRate.toFixed(0)}% wipe</span>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    deathEncounterMeta.textContent = error.message || "Unable to load encounter death heatmap.";
    deathEncounterHeatmap.innerHTML = "<div>Could not load encounter death data.</div>";
  }
}

initBackgroundStars();
loadBossTimes();
loadLatestRaidMvp();
loadDeathLeaderboard();
loadAttendanceTracker();
loadDeathEncounterHeatmap();
loadRecentRaidsCalendar();
