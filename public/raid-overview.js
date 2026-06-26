const PHASE2_OVERVIEW_GUILD_ID = 817080;
const PHASE2_OVERVIEW_CACHE_KEY = "plb-phase2-raids-v9";
const PHASE2_OVERVIEW_CACHE_MS = 5 * 60 * 1000;

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function apiGetJson(url, init) {
  const c = window.plbSessionApiCache;
  if (c) return c.getJson(url, init);
  return fetch(url, { method: "GET", ...init }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    if (body?.ok === false) throw new Error(body.error || "Request failed");
    return body;
  });
}

function readOverviewCache() {
  try {
    const raw = sessionStorage.getItem(PHASE2_OVERVIEW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.payload || !parsed?.savedAt) return null;
    if (Date.now() - parsed.savedAt > PHASE2_OVERVIEW_CACHE_MS) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

function writeOverviewCache(payload) {
  try {
    sessionStorage.setItem(
      PHASE2_OVERVIEW_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), payload })
    );
  } catch {
    /* ignore */
  }
}

function parseColor(rankPercent) {
  const value = Number(rankPercent);
  if (!Number.isFinite(value)) return "#94a3b8";
  if (value >= 100) return "#e5cc80";
  if (value >= 99) return "#e268a8";
  if (value >= 95) return "#ff8000";
  if (value >= 75) return "#a335ee";
  if (value >= 50) return "#0070ff";
  if (value >= 25) return "#1eff00";
  return "#9d9d9d";
}

function fmtDurationMs(ms) {
  const totalSeconds = Math.floor(Number(ms || 0) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function fmtDate(ms) {
  if (!ms) return "—";
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

const ICON_SKULL = `<svg class="plb-ro-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C7.03 2 3 6.03 3 11c0 2.2.9 4.18 2.34 5.62L4 22h6l1-3h2l1 3h6l-1.34-5.38A7.96 7.96 0 0 0 21 11c0-4.97-4.03-9-9-9zm-3 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>`;
const ICON_USERS = `<svg class="plb-ro-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`;
const ICON_TROPHY = `<svg class="plb-ro-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 16.9V19H7v2h10v-2h-4v-2.1a5.01 5.01 0 0 0 3.61-3.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>`;
const ICON_CLOCK = `<svg class="plb-ro-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`;
const ICON_TREND = `<svg class="plb-ro-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m16 6 2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>`;
const ICON_CAL = `<svg class="plb-ro-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z"/></svg>`;
const ICON_CHEVRON = `<svg class="plb-ro-icon plb-ro-icon--chevron" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`;

function statCell(icon, label, value, valueClass = "", valueStyle = "", title = "") {
  const styleAttr = valueStyle ? ` style="${valueStyle}"` : "";
  const titleAttr = title ? ` title="${esc(title)}"` : "";
  return `<div class="plb-ro-stat"${titleAttr}>
    <span class="plb-ro-stat-icon">${icon}</span>
    <span class="plb-ro-stat-label">${esc(label)}</span>
    <span class="plb-ro-stat-value${valueClass ? ` ${valueClass}` : ""}"${styleAttr}>${esc(value)}</span>
  </div>`;
}

function renderRaidCard(raid) {
  const color = esc(raid.color || "#a855f7");
  const prog = Number(raid.progression) || 0;
  const parsePct = raid.coreAverageParse;
  const parseText = parsePct != null && Number.isFinite(Number(parsePct)) ? `${Number(parsePct).toFixed(1)}%` : "—";
  const parseStyle =
    parsePct != null && Number.isFinite(Number(parsePct))
      ? `color:${parseColor(parsePct)}`
      : "";
  const parseTitle = raidCoreParseStatTitle(raid);
  const img = esc(raid.headerImageUrl || raid.imageUrl || "");
  const imgSecondary = esc(raid.headerImageUrlSecondary || "");
  const sizeLabel = raid.size === 10 ? "10-Man" : "25-Man";
  const isOneNight = raid.kind === "one-night" || raid.id === "t5-one-night";
  const bestTimeLabel = isOneNight ? "Best total" : "Best time";
  const heroInner = isOneNight && imgSecondary
    ? `<img class="plb-ro-card-bg plb-ro-card-bg--left" src="${img}" alt="" loading="lazy" decoding="async" />
      <img class="plb-ro-card-bg plb-ro-card-bg--right" src="${imgSecondary}" alt="" loading="lazy" decoding="async" />
      <div class="plb-ro-card-hero-split" aria-hidden="true"></div>`
    : `<img class="plb-ro-card-bg" src="${img}" alt="" loading="lazy" decoding="async" />`;

  return `<article class="plb-ro-card plb-ro-card--tone-${esc(raid.progressionTone || "none")}${isOneNight ? " plb-ro-card--one-night" : ""}" style="--plb-ro-color:${color}" role="article" aria-label="${esc(raid.name)} raid card">
    <div class="plb-ro-card-hero">
      ${heroInner}
      <div class="plb-ro-card-hero-overlay" aria-hidden="true"></div>
      <span class="plb-ro-badge plb-ro-badge--size">${ICON_USERS}<span>${esc(sizeLabel)}</span></span>
      <span class="plb-ro-badge plb-ro-badge--tier">${esc(isOneNight ? "T5·1N" : raid.tier)}</span>
      <div class="plb-ro-card-titles">
        <h3 class="plb-ro-card-name">${esc(raid.name)}</h3>
        <p class="plb-ro-card-short">${esc(raid.shortName)}</p>
      </div>
    </div>
    <div class="plb-ro-card-body">
      <div class="plb-ro-progress-head">
        <span class="plb-ro-progress-label">Progression</span>
        <span class="plb-ro-progress-count">${raid.bosses?.cleared ?? 0}/${raid.bosses?.total ?? 0}</span>
      </div>
      <div class="plb-ro-progress-track" role="progressbar" aria-valuenow="${esc(String(prog))}" aria-valuemin="0" aria-valuemax="100" aria-label="Raid progression ${esc(String(prog))} percent">
        <span class="plb-ro-progress-fill plb-ro-progress-fill--${esc(raid.progressionTone || "none")}" style="width:${Math.min(100, Math.max(0, prog))}%"></span>
      </div>
      <div class="plb-ro-quick-stats">
        ${statCell(ICON_CLOCK, bestTimeLabel, raid.bestTime || "—")}
        ${statCell(ICON_TROPHY, "Clears", String(raid.totalClears ?? 0))}
        ${statCell(ICON_TREND, "Core avg parse", parseText, "plb-ro-stat-value--parse", parseStyle, parseTitle)}
        ${statCell(ICON_CAL, "Last kill", raid.lastClear || "—")}
      </div>
      <button type="button" class="plb-ro-details-btn" data-ro-raid-id="${esc(raid.id)}">
        <span>View details</span>${ICON_CHEVRON}
      </button>
    </div>
  </article>`;
}

function coreParseStatTitle(s) {
  const n = Number(s?.coreRaiderWithParseCount || 0);
  const assigned = Number(s?.coreRaiderCount || 0);
  if (!assigned) {
    return "No roster members assigned the Core guild role in Account Assignment.";
  }
  if (!n) {
    return `${assigned} Core member(s) — no WCL boss parse data in loaded reports yet.`;
  }
  return `Average peak boss parse across ${n} Core member(s) (${assigned} assigned Core role). Same metric family as Leaderboard peak parse.`;
}

function raidCoreParseStatTitle(raid) {
  const name = String(raid?.name || raid?.shortName || "this raid").trim();
  if (raid?.kind === "one-night" || raid?.id === "t5-one-night") {
    return "Average of Core roster peak parse on SSC and TK reports (combined one-night metric).";
  }
  return `Average peak boss parse for Core roster members on ${name} reports only. Same metric family as Leaderboard peak parse.`;
}

const T5_RAID_ORDER = ["ssc", "tk", "t5-one-night"];

function sortTierRaids(raids) {
  return [...raids].sort((a, b) => {
    const ai = T5_RAID_ORDER.indexOf(a.id);
    const bi = T5_RAID_ORDER.indexOf(b.id);
    const aRank = ai >= 0 ? ai : 99;
    const bRank = bi >= 0 ? bi : 99;
    return aRank - bRank;
  });
}

function renderTierDivider(label, tone) {
  return `<div class="plb-ro-tier-divider plb-ro-tier-divider--${tone}" role="separator">
    <span class="plb-ro-tier-line" aria-hidden="true"></span>
    <span class="plb-ro-tier-text">${esc(label)}</span>
    <span class="plb-ro-tier-line" aria-hidden="true"></span>
  </div>`;
}

function renderOverview(payload) {
  const s = payload?.summary || {};
  const raids = Array.isArray(payload?.raids) ? payload.raids : [];
  const t5 = sortTierRaids(raids.filter((r) => r.tier === "T5"));
  const t4 = raids.filter((r) => r.tier === "T4");
  const overall = Number(s.overallProgression) || 0;

  const headerStats = [
    statCell(ICON_SKULL, "Bosses killed", `${s.totalKilled ?? 0}/${s.totalBosses ?? 0}`),
    statCell(ICON_TROPHY, "Total clears", String(s.totalClears ?? 0)),
    statCell(
      ICON_TREND,
      "Core avg parse",
      s.coreAverageParse != null ? `${Number(s.coreAverageParse).toFixed(1)}%` : "—",
      "plb-ro-stat-value--parse",
      s.coreAverageParse != null && Number.isFinite(Number(s.coreAverageParse))
        ? `color:${parseColor(s.coreAverageParse)}`
        : "",
      coreParseStatTitle(s)
    ),
  ].join("");

  const headerStatsHtml = `<div class="plb-ro-header-stats">${headerStats}</div>`;
  const t5Cards = t5.map((r) => renderRaidCard(r)).join("");
  const t4Cards = t4.map((r) => renderRaidCard(r)).join("");

  return `<div class="plb-ro-inner">
    <header class="plb-ro-header card surface-elevated">
      <div class="plb-ro-header-top">
        <div class="plb-ro-header-title-wrap">
          ${ICON_SKULL}
          <div>
            <h2 id="phase2-overview-heading" class="plb-ro-title">Phase 2 Raid Overview</h2>
            <p class="plb-ro-sub">${raids.length} raid instances · ${s.totalBosses ?? 0} bosses total</p>
          </div>
        </div>
        <div class="plb-ro-overall plb-ro-overall--${esc(s.overallProgressionTone || "none")}">
          <span class="plb-ro-overall-value">${overall.toFixed(1)}%</span>
          <span class="plb-ro-overall-label">Overall</span>
        </div>
      </div>
      ${headerStatsHtml}
    </header>
    ${t5.length ? renderTierDivider("Tier 5 Content", "t5") : ""}
    ${t5.length ? `<div class="plb-ro-grid plb-ro-grid--t5">${t5Cards}</div>` : ""}
    ${t4.length ? renderTierDivider("Tier 4 Content", "t4") : ""}
    ${t4.length ? `<div class="plb-ro-grid plb-ro-grid--t4">${t4Cards}</div>` : ""}
    <p class="plb-ro-foot subtle">Based on ${s.reportsScanned ?? 0} Warcraft Logs report(s) · Event Management selection applies to 25-man raids.</p>
  </div>`;
}

function buildOneNightSessionsTableHtml(raid) {
  const sessions = Array.isArray(raid.oneNightSessions) ? [...raid.oneNightSessions] : [];
  if (!sessions.length) {
    return `<p class="subtle">No qualifying one-night clears yet — need a full SSC clear and a full TK clear on the same evening (TK after SSC).</p>`;
  }
  sessions.sort((a, b) => Number(a.totalClearMs || 0) - Number(b.totalClearMs || 0));
  const bestMs = Number(sessions[0]?.totalClearMs || 0);
  const rows = sessions
    .map((session) => {
      const totalMs = Number(session.totalClearMs || 0);
      const isBest = totalMs > 0 && totalMs === bestMs;
      const sscLink = session.ssc?.wclUrl
        ? `<a href="${esc(session.ssc.wclUrl)}" target="_blank" rel="noopener noreferrer">SSC</a>`
        : "—";
      const tkLink = session.tk?.wclUrl
        ? `<a href="${esc(session.tk.wclUrl)}" target="_blank" rel="noopener noreferrer">TK</a>`
        : "—";
      return `<tr${isBest ? ' class="plb-ro-one-night-row--best"' : ""}>
        <td>${esc(fmtDate(session.startTime))}</td>
        <td>${esc(fmtDurationMs(session.ssc?.clearDurationMs))}</td>
        <td>${esc(fmtDurationMs(session.tk?.clearDurationMs))}</td>
        <td><strong>${esc(fmtDurationMs(totalMs))}</strong>${isBest ? ' <span class="plb-ro-one-night-best-tag">PB</span>' : ""}</td>
        <td>${sscLink}</td>
        <td>${tkLink}</td>
      </tr>`;
    })
    .join("");
  return `<p class="subtle plb-ro-one-night-intro">Combined full-clear time per evening (SSC clear + TK clear, TK log after SSC). Sorted fastest first.</p>
  <table class="times-table times-table--pb plb-ro-boss-table plb-ro-one-night-table">
    <thead><tr><th>Evening</th><th>SSC</th><th>TK</th><th>Total</th><th>SSC log</th><th>TK log</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildBossTableHtml(raid) {
  const rows = (raid.bossRows || [])
    .map((boss) => {
      if (!boss.bestKill) {
        return `<tr><td>${esc(boss.bossName)}</td><td>—</td><td>—</td><td>Not killed yet</td></tr>`;
      }
      const link = `https://fresh.warcraftlogs.com/reports/${esc(boss.bestKill.reportCode)}#fight=${esc(String(boss.bestKill.fightId))}`;
      return `<tr>
        <td>${esc(boss.bossName)}</td>
        <td>${esc(fmtDurationMs(boss.bestKill.durationMs))}</td>
        <td>${esc(fmtDate(boss.bestKill.reportStartTime))}</td>
        <td><a href="${link}" target="_blank" rel="noopener noreferrer">View log</a></td>
      </tr>`;
    })
    .join("");
  return `<table class="times-table times-table--pb plb-ro-boss-table">
    <thead><tr><th>Boss</th><th>Best time</th><th>Date</th><th>Source</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

let phase2OverviewPayload = null;

function openRaidDetailModal(raidId) {
  const raid = (phase2OverviewPayload?.raids || []).find((r) => r.id === raidId);
  const dialog = document.getElementById("plbRoDetailDialog");
  const title = document.getElementById("plbRoDetailTitle");
  const body = document.getElementById("plbRoDetailBody");
  if (!raid || !dialog || !title || !body) return;
  title.textContent = raid.name;
  const isOneNight = raid.kind === "one-night" || raid.id === "t5-one-night";
  const wcl = isOneNight
    ? ""
    : raid.wclUrl
      ? `<p class="plb-ro-modal-wcl"><a href="${esc(raid.wclUrl)}" target="_blank" rel="noopener noreferrer">Open fastest full clear on Warcraft Logs</a></p>`
      : "";
  body.innerHTML = `${wcl}${isOneNight ? buildOneNightSessionsTableHtml(raid) : buildBossTableHtml(raid)}`;
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function bindOverviewInteractions(host) {
  host.querySelectorAll(".plb-ro-details-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-ro-raid-id");
      if (id) openRaidDetailModal(id);
    });
  });
}

function showLoading(host) {
  host.innerHTML = `<div class="plb-ro-inner plb-ro-inner--loading"><p class="subtle">Loading Phase 2 raid overview…</p></div>`;
}

function showError(host, message) {
  host.innerHTML = `<div class="plb-ro-inner plb-ro-inner--error"><p class="subtle">${esc(message || "Could not load raid overview.")}</p></div>`;
}

async function loadPhase2RaidOverview(host, { force = false } = {}) {
  if (!host) return;
  if (!force) {
    const cached = readOverviewCache();
    if (cached?.raids?.length) {
      phase2OverviewPayload = cached;
      host.innerHTML = renderOverview(cached);
      bindOverviewInteractions(host);
      return;
    }
  }
  showLoading(host);
  try {
    const q = new URLSearchParams({
      guildId: String(PHASE2_OVERVIEW_GUILD_ID),
      limit: "50",
    });
    q.set("nocache", "1");
    q.set("t", String(Date.now()));
    const payload = await apiGetJson(`/api/raids/phase2/overview?${q}`, {
      credentials: "include",
      skipCache: true,
    });
    if (!payload?.raids?.length) throw new Error("No raid data returned.");
    phase2OverviewPayload = payload;
    writeOverviewCache(payload);
    host.innerHTML = renderOverview(payload);
    bindOverviewInteractions(host);
  } catch (err) {
    showError(host, err?.message || "Failed to load overview.");
  }
}

function initPhase2RaidOverview() {
  const host = document.getElementById("phase2RaidOverviewHost");
  if (!host) return;
  loadPhase2RaidOverview(host);

  const dialog = document.getElementById("plbRoDetailDialog");
  const closeBtn = document.getElementById("plbRoDetailClose");
  closeBtn?.addEventListener("click", () => dialog?.close?.());
  dialog?.addEventListener("click", (ev) => {
    if (ev.target === dialog) dialog.close();
  });
}

initPhase2RaidOverview();
