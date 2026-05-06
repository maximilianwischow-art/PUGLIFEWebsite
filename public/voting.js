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

function numberFmt(v) {
  return new Intl.NumberFormat("en-US").format(Number(v || 0));
}

function escapeHtmlAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Normalize labels so WCL/Unicode apostrophes still match (strict === used to fall through to Kara). */
function normalizedRaidBannerKey(s) {
  return String(s || "")
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .trim()
    .toLowerCase();
}

const VOTING_RAID_BANNER_VER = "20260509a";

/** Split Gruul + Mag into two headers; substring matching for combined nights. */
function votingRaidHeaderInnerHtml(raidName) {
  const raw = String(raidName || "").trim();
  const n = normalizedRaidBannerKey(raw);
  const bust = `?v=${VOTING_RAID_BANNER_VER}`;
  const img = (src, alt) =>
    `<img src="${src}${bust}" alt="${escapeHtmlAttr(alt)}" loading="lazy" decoding="async" />`;

  const hasGruul = n.includes("gruul");
  const hasMag = n.includes("magtheridon");

  if (hasGruul && hasMag) {
    return `<div class="voting-raid-header-inner voting-raid-header-inner--split">
      ${img("/raid-images/pb-header-gruul.png", "Gruul's Lair")}
      ${img("/raid-images/pb-header-magtheridon.png", "Magtheridon's Lair")}
    </div>`;
  }
  if (n.includes("karazhan") || /\bkara\b/.test(n)) {
    return img("/raid-images/pb-header-kara.png", raw || "Karazhan");
  }
  if (n.includes("serpentshrine") || n.includes("ssc")) {
    return img("/raid-images/pb-header-ssc.png", raw || "Serpentshrine Cavern");
  }
  if (n.includes("tempest") || n.includes("the eye") || /\btk\b/.test(n)) {
    return img("/raid-images/pb-header-tk.png", raw || "Tempest Keep");
  }
  if (hasMag && !hasGruul) {
    return img("/raid-images/pb-header-magtheridon.png", raw || "Magtheridon's Lair");
  }
  if (hasGruul) {
    return img("/raid-images/pb-header-gruul.png", raw || "Gruul's Lair");
  }
  return img("/raid-images/pb-header-kara.png", raw || "Raid");
}

function renderRaidHeader(payload) {
  const host = document.getElementById("votingRaidHeader");
  const raidName = payload?.raid?.name || "Raid";
  host.innerHTML = votingRaidHeaderInnerHtml(raidName);
  host.hidden = false;
}

function renderCandidates(payload) {
  const list = document.getElementById("votingList");
  const myVote = String(payload?.myVote || "");
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  list.innerHTML = candidates
    .map((c) => {
      const selected = myVote && myVote.toLowerCase() === String(c.name || "").toLowerCase();
      return `
        <article class="voting-row ${selected ? "is-selected" : ""}">
          <div class="voting-player">
            <strong class="voting-player-name">${c.name || "Unknown"}</strong>
            <span class="subtle">${c.className || "Unknown class"}</span>
          </div>
          <div class="voting-metric"><span class="subtle">DPS</span><strong class="voting-metric-value">${numberFmt(c.dps)}</strong></div>
          <div class="voting-metric"><span class="subtle">HPS</span><strong class="voting-metric-value">${numberFmt(c.hps)}</strong></div>
          <div class="voting-metric"><span class="subtle">Damage Taken</span><strong class="voting-metric-value">${numberFmt(c.damageTaken)}</strong></div>
          <div class="voting-metric"><span class="subtle">Votes</span><strong class="voting-metric-value">${numberFmt(c.votes)}</strong></div>
          <div class="voting-actions">
            <button class="event-signup-btn voting-btn" data-candidate="${encodeURIComponent(c.name || "")}">
              ${selected ? "Your Vote" : "Vote"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
  list.hidden = false;
}

function fmtParsePct(n) {
  const x = Number(n);
  return Number.isFinite(x) && x >= 0 ? `${x.toFixed(1)}` : "—";
}

/** Warcraft Logs–style tier suffix (matches leaderboard peak-parse styling). */
function hofPeakParseWclTierClass(pct) {
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

function hofPeakParseCellHtml(row) {
  const plb = window.plbEventsRoster;
  const escapeHtml = plb?.escapeHtml || ((s) => String(s ?? ""));
  const v = row?.peakParse != null && Number.isFinite(Number(row.peakParse)) ? Number(row.peakParse) : null;
  const txt = fmtParsePct(v);
  let title =
    "Peak parse for this MVP raid — best boss percentile in that Warcraft Logs report for your role bracket (DPS / tank / heal).";
  if (plb?.rosterParseSourceTooltipFragment && row?.peakParseSource) {
    title += plb.rosterParseSourceTooltipFragment(row.peakParseSource);
  }
  if (v == null) {
    return `<span class="leaderboard-peak-parse leaderboard-peak-parse--empty hof-peak-parse" title="${escapeHtml(title)}">${escapeHtml(txt)}</span>`;
  }
  const tier = hofPeakParseWclTierClass(v);
  if (!tier) {
    return `<strong class="leaderboard-peak-parse hof-peak-parse" title="${escapeHtml(title)}">${escapeHtml(txt)}</strong>`;
  }
  return `<strong class="leaderboard-peak-parse hof-peak-parse ${tier}" title="${escapeHtml(title)}">${escapeHtml(txt)}</strong>`;
}

/** Same layout as leaderboard player column (portrait, coloured name, spec · class, badges). */
function hofRaiderCell(row) {
  const plb = window.plbEventsRoster;
  const nameRaw = String(row?.winnerName || "Unknown");
  const esc = plb?.escapeHtml || escapeHtml;
  if (!plb) {
    return `<div class="hof-fallback-name"><strong>${esc(nameRaw)}</strong></div>`;
  }
  let p = row?.player;
  if (!p && row?.wclClassName) {
    p = {
      name: nameRaw,
      characterName: nameRaw,
      className: row.wclClassName,
      specName: "",
      roleName: "Ranged",
      wclCharacters: [],
    };
  }
  if (!p) {
    return `<div class="hof-fallback-name"><strong>${esc(nameRaw)}</strong></div>`;
  }

  const chain = plb.rosterPortraitChain(p);
  const portraitSrc = esc(chain[0] || "");
  const portraitFb = chain.slice(1).map((u) => esc(u)).join("|");
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
  const baseBadges = plb.rosterBadgeRowHtml(p);
  const hasAnyBaseBadge = /<img\b/i.test(String(baseBadges || ""));
  const cacheKey = "20260506hofbadges1";
  const fallbackBadge = (pngFile, title, alt) => {
    const png = `/images/achievements/${pngFile}?v=${cacheKey}`;
    const svg = pngFile.toLowerCase().endsWith(".png")
      ? `/images/achievements/${pngFile.replace(/\.png$/i, ".svg")}?v=${cacheKey}`
      : png;
    return `<span class="raider-badge-slot raider-badge-slot--achievement-earned" title="${esc(title)}"><img class="raider-badge-achievement-img" src="${esc(svg)}" alt="${esc(alt)}" width="44" height="44" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${esc(
      png
    )}'" /></span>`;
  };
  const parse = Number(row?.peakParse || 0);
  const fallbackBadges = [
    fallbackBadge(
      "hall-of-fame.png",
      "MVP hall of fame — You won a raid MVP vote in a past round.",
      "MVP hall of fame"
    ),
    ...(parse >= 95
      ? [
          fallbackBadge(
            "parsing-ceiling.png",
            "Parsing ceiling — High parse performance in tracked raid history.",
            "Parsing ceiling"
          ),
        ]
      : []),
  ].join("");
  const badges = hasAnyBaseBadge ? baseBadges : fallbackBadges;
  return `
    <div class="leaderboard-player-row">
      <div class="leaderboard-portrait-stack">
        <img
          class="raider-champion-img leaderboard-spec-img"
          src="${portraitSrc}"
          alt="${esc(portraitAlt)}"
          width="44"
          height="44"
          loading="lazy"
          decoding="async"
          data-champ-fallbacks="${portraitFb}"
          onerror="(function(el){var raw=el.getAttribute('data-champ-fallbacks');if(!raw){el.onerror=null;return;}var parts=raw.split('|').filter(Boolean);var i=Number(el.dataset.champI||0);if(i<parts.length){el.dataset.champI=String(i+1);el.src=parts[i];}else{el.onerror=null;}})(this)"
        />
      </div>
      <div class="leaderboard-player-cell">
        <div class="leaderboard-player-main">
          <span class="leaderboard-player-name" style="color:${esc(color)};${priestGlow}">${esc(displayName)}</span>
          ${
            metaBits.length
              ? `<span class="leaderboard-player-meta">${esc(metaBits.join(" · "))}</span>`
              : ""
          }
        </div>
        <div class="leaderboard-player-badges hof-mvp-badges-wrap"><div class="raider-badges hof-mvp-badges">${badges}</div></div>
      </div>
    </div>`;
}

function hofSpecIconHtml(row) {
  const plb = window.plbEventsRoster;
  const esc = plb?.escapeHtml || escapeHtml;
  const p = row?.player;
  if (!plb || !p) return "";
  let chain = [];
  if (typeof plb.specBadgePortraitChain === "function") {
    chain = plb.specBadgePortraitChain(p) || [];
  }
  if ((!Array.isArray(chain) || !chain.length) && typeof plb.rosterPortraitChain === "function") {
    chain = plb.rosterPortraitChain(p) || [];
  }
  const src = esc(String((Array.isArray(chain) && chain[0]) || ""));
  const fb = (Array.isArray(chain) ? chain.slice(1) : [])
    .map((u) => esc(String(u || "")))
    .filter(Boolean)
    .join("|");
  const label = plb.displaySpecNameForRoster ? plb.displaySpecNameForRoster(String(p.specName || "").trim()) : "Spec";
  const initials = esc(String(label || p.className || "Spec").slice(0, 2).toUpperCase());
  if (!src) {
    return `<span class="hof-spec-icon-wrap hof-spec-icon-wrap--fallback" title="${esc(label || "Spec")}">${initials}</span>`;
  }
  return `<span class="hof-spec-icon-wrap" title="${esc(label || "Spec")}"><img class="hof-spec-icon" src="${src}" alt="${esc(
    label || "Spec icon"
  )}" width="28" height="28" loading="lazy" decoding="async" data-hof-spec-fallbacks="${fb}" onerror="(function(el){var raw=el.getAttribute('data-hof-spec-fallbacks');if(raw){var parts=raw.split('|').filter(Boolean);var i=Number(el.dataset.hofSpecI||0);if(i<parts.length){el.dataset.hofSpecI=String(i+1);el.src=parts[i];return;}} var host=el.closest('.hof-spec-icon-wrap'); if(host){host.classList.add('hof-spec-icon-wrap--fallback');host.textContent='${initials}';} el.remove();})(this)" /></span>`;
}

function hofMvpAchievementBadgesHtml(row) {
  const esc = escapeHtml;
  const cacheKey = "20260506hofachv2";
  const badge = (file, title, alt) => {
    const png = `/images/achievements/${file}?v=${cacheKey}`;
    const svg = file.toLowerCase().endsWith(".png")
      ? `/images/achievements/${file.replace(/\.png$/i, ".svg")}?v=${cacheKey}`
      : png;
    return `<span class="raider-badge-slot raider-badge-slot--achievement-earned" title="${esc(title)}"><img class="raider-badge-achievement-img" src="${esc(svg)}" alt="${esc(
      alt
    )}" width="44" height="44" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${esc(
      png
    )}'" /></span>`;
  };
  const parse = Number(row?.peakParse || 0);
  const out = [
    badge("hall-of-fame.png", "MVP hall of fame winner", "MVP hall of fame"),
    ...(parse >= 95
      ? [badge("parsing-ceiling.png", "Top parsing performance", "Parsing ceiling")]
      : [badge("best-time-participant.png", "Best time participant", "Best time participant")]),
  ];
  return `<div class="raider-badges hof-mvp-badges">${out.join("")}</div>`;
}

function buildMockHallOfFamePreviewRows() {
  const now = Date.now();
  return [
    {
      winnerName: "Highbullet",
      bracket: "dps",
      raidName: "Sunwell Plateau",
      raidCode: "MOCK-SWP-HIGHBULLET",
      raidStartTime: now - 7 * 24 * 60 * 60 * 1000,
      peakParse: 97,
      winnerVotes: 41,
      player: {
        name: "Highbullet",
        characterName: "Highbullet",
        className: "Hunter",
        specName: "Marksmanship",
        roleName: "Ranged",
        pastRhEvents: 127,
        attendanceRate: 94,
        wclCharacters: ["Highbullet"],
      },
    },
    {
      winnerName: "Glutelf",
      bracket: "dps",
      raidName: "Black Temple",
      raidCode: "MOCK-BT-GLUTELF",
      raidStartTime: now - 14 * 24 * 60 * 60 * 1000,
      peakParse: 93,
      winnerVotes: 36,
      player: {
        name: "Glutelf",
        characterName: "Glutelf",
        className: "Mage",
        specName: "Arcane",
        roleName: "Ranged",
        pastRhEvents: 98,
        attendanceRate: 89,
        wclCharacters: ["Glutelf"],
      },
    },
  ];
}

function renderHallOfFame(payload) {
  const host = document.getElementById("votingHallOfFame");
  const apiRows = Array.isArray(payload?.hallOfFame) ? payload.hallOfFame : [];
  const rows = apiRows.length ? apiRows : buildMockHallOfFamePreviewRows();
  const isMock = apiRows.length === 0;
  const roleLabelForRow = (row) => {
    const bracket = String(row?.bracket || "").trim().toLowerCase();
    if (bracket === "heal" || bracket === "healer") return "HEALER";
    if (bracket === "tank") return "TANK";
    const roleName = String(row?.player?.roleName || "").trim().toLowerCase();
    if (roleName.includes("heal")) return "HEALER";
    if (roleName.includes("tank")) return "TANK";
    return "DPS";
  };
  const championSubtitleForRow = (row) => {
    const raidName = String(row?.raidName || row?.raidCode || "Recent Raid").trim();
    return `Champion of ${raidName}`;
  };
  const quoteForRow = (row) => {
    const role = roleLabelForRow(row);
    if (role === "TANK") return '"Frontline unbroken."';
    if (role === "HEALER") return '"Hold the raid together."';
    return '"Push for every percent."';
  };
  const roleIconForRow = (row) => {
    const role = roleLabelForRow(row);
    if (role === "TANK") return "🛡";
    if (role === "HEALER") return "❤";
    return "⚔";
  };
  const attendancePct = (row) => {
    const v = Number(row?.player?.attendanceRate);
    return Number.isFinite(v) && v >= 0 ? `${Math.round(v)}%` : "—";
  };
  const avgParsePct = (row) => {
    const v = Number(row?.peakParse);
    return Number.isFinite(v) && v >= 0 ? `${Math.round(v)}%` : "—";
  };
  const totalRaids = (row) => {
    const v = Number(row?.player?.pastRhEvents || row?.player?.raidsAttended || 0);
    return Number.isFinite(v) && v > 0 ? numberFmt(v) : "—";
  };
  const topParse = (row) => {
    const v = Number(row?.peakParse);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : "—";
  };
  host.innerHTML = rows
    .map((row, idx) => {
      const when = row?.raidStartTime ? new Date(row.raidStartTime).toLocaleString() : "Unknown date";
      const playerCell = hofRaiderCell(row);
      const role = roleLabelForRow(row);
      const subtitle = championSubtitleForRow(row);
      const quote = quoteForRow(row);
      const roleCls = role === "TANK" ? "hof-role-tank" : role === "HEALER" ? "hof-role-heal" : "hof-role-dps";
      const rowDirCls = idx % 2 === 1 ? "hof-cine-row--reverse" : "";
      const roleIcon = roleIconForRow(row);
      const specIconHtml = hofSpecIconHtml(row);
      const crownedRaid = String(row?.raidName || row?.raidCode || "Unknown raid").trim();
      return `
        <article class="hof-champion-card ${roleCls}" data-hof-winner="${escapeHtml(row?.winnerName || "")}">
          <div class="hof-rank-bg" aria-hidden="true">${idx + 1}</div>
          <div class="hof-cine-row ${rowDirCls}">
            <div class="hof-champion-main">
              <div class="hof-champion-topline">
                <div class="hof-role-pill-wrap">
                  ${specIconHtml}
                  <span class="hof-role-emblem">${roleIcon}</span>
                  <span class="hof-role-chip tw-plb-chip">${escapeHtml(role)}</span>
                </div>
              </div>
              <div class="hof-champion-player">${playerCell}</div>
              <div class="hof-champion-copy">
                <p class="hof-champion-subtle">${escapeHtml(subtitle)}</p>
                <p class="hof-crowned-raid">Crowned for: ${escapeHtml(crownedRaid)}</p>
                <p class="hof-achievements-title">Achievements</p>
                ${hofMvpAchievementBadgesHtml(row)}
                <p class="hof-champion-quote">${escapeHtml(quote)}</p>
                <p class="subtle hof-log-line">${escapeHtml(when)}</p>
              </div>
            </div>
            <aside class="hof-chronicle-pane">
              <div class="hof-chronicle-title">᛫ Chronicle ᛫</div>
              <div class="hof-chronicle-grid">
                <div class="hof-chronicle-kpi"><span class="subtle">Total raids</span><strong>${escapeHtml(totalRaids(row))}</strong></div>
                <div class="hof-chronicle-kpi"><span class="subtle">Attendance</span><strong>${escapeHtml(attendancePct(row))}</strong></div>
                <div class="hof-chronicle-kpi"><span class="subtle">Avg parse</span><strong>${escapeHtml(avgParsePct(row))}</strong></div>
                <div class="hof-chronicle-kpi"><span class="subtle">Top parse</span><strong>${escapeHtml(String(topParse(row)))}</strong></div>
              </div>
            </aside>
          </div>
        </article>
      `;
    })
    .join("");
  if (isMock) {
    host.insertAdjacentHTML(
      "afterbegin",
      `<div class="hof-empty-roll" style="margin-bottom:10px">Preview mode: showing mock winners (Highbullet, Glutelf) because no archived MVP rounds are available yet.</div>`
    );
  }
}

async function votingGetJson(url, init) {
  if (window.plbSessionApiCache?.getJson) {
    return window.plbSessionApiCache.getJson(url, init);
  }
  const res = await fetch(url, { method: "GET", ...(init || {}) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Request failed (${res.status})`);
  }
  return payload;
}

let votingPlbPreloadPromise = null;

function preloadVotingPlbData() {
  const plb = window.plbEventsRoster;
  if (!plb) return Promise.resolve();
  if (votingPlbPreloadPromise) return votingPlbPreloadPromise;
  const tasks = [];
  if (typeof plb.loadTbcSpecIconMap === "function") tasks.push(plb.loadTbcSpecIconMap());
  if (typeof plb.loadWclAttendanceForEvents === "function") tasks.push(plb.loadWclAttendanceForEvents());
  votingPlbPreloadPromise = Promise.allSettled(tasks).then(() => undefined);
  return votingPlbPreloadPromise;
}

async function loadHallOfFame() {
  const host = document.getElementById("votingHallOfFame");
  host.innerHTML = `<div class="subtle">Loading…</div>`;
  const preload = preloadVotingPlbData();
  try {
    const payload = await votingGetJson("/api/voting/hall-of-fame", {
      credentials: "include",
      skipCache: true,
    });
    renderHallOfFame(payload);
    await preload;
    renderHallOfFame(payload);
  } catch (error) {
    host.innerHTML = `<div class="subtle">${escapeHtml(error?.message || "Failed to load hall of fame.")}</div>`;
  }
}

async function submitVote(candidateName) {
  const statusEl = document.getElementById("votingStatus");
  statusEl.textContent = `Submitting vote for ${candidateName}...`;
  const res = await fetch("/api/voting/vote", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateName }),
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const next = encodeURIComponent(window.location.pathname || "/voting.html");
    window.location.href = `/auth/discord/login?next=${next}`;
    return;
  }
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error || "Vote failed");
  }
}

async function loadVotingRound() {
  const statusEl = document.getElementById("votingStatus");
  const metaEl = document.getElementById("votingRoundMeta");
  const list = document.getElementById("votingList");
  const loginCta = document.getElementById("votingLoginCta");
  const headerEl = document.getElementById("votingRaidHeader");
  list.hidden = true;
  list.innerHTML = "";
  loginCta.hidden = true;
  loginCta.style.display = "none";
  headerEl.hidden = true;
  headerEl.innerHTML = "";

  const res = await fetch("/api/voting/current", { credentials: "include" });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 401) {
    statusEl.textContent = "Please login with Discord to vote.";
    metaEl.textContent = "";
    loginCta.hidden = false;
    loginCta.style.display = "";
    return;
  }
  if (!res.ok || !payload?.ok) {
    statusEl.textContent = payload?.error || "Failed to load current voting round.";
    metaEl.textContent = "";
    return;
  }

  statusEl.textContent = payload?.myVote
    ? `You voted for ${payload.myVote}. You can change your vote anytime.`
    : "Choose one MVP from the latest raid.";
  metaEl.textContent = `${payload?.raid?.name || "Raid"} · ${new Date(payload?.raid?.startTime || Date.now()).toLocaleString()}`;
  renderRaidHeader(payload);
  renderCandidates(payload);
  void preloadVotingPlbData();
}

document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".voting-btn");
  if (!btn) return;
  const candidateName = decodeURIComponent(String(btn.dataset.candidate || ""));
  if (!candidateName) return;
  btn.disabled = true;
  try {
    await submitVote(candidateName);
    await loadVotingRound();
  } catch (error) {
    const statusEl = document.getElementById("votingStatus");
    statusEl.textContent = error?.message || "Failed to submit vote.";
  } finally {
    btn.disabled = false;
  }
});

initBackgroundStars();
loadHallOfFame();
loadVotingRound();
