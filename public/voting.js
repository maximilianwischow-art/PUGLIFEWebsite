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
  const badges = plb.rosterBadgeRowHtml(p);
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
        <div class="leaderboard-player-badges"><div class="raider-badges">${badges}</div></div>
      </div>
    </div>`;
}

function renderHallOfFame(payload) {
  const host = document.getElementById("votingHallOfFame");
  const rows = Array.isArray(payload?.hallOfFame) ? payload.hallOfFame : [];
  if (!rows.length) {
    host.innerHTML = `<div class="subtle">No past MVP rounds yet.</div>`;
    return;
  }
  host.innerHTML = rows
    .map((row, idx) => {
      const when = row?.raidStartTime ? new Date(row.raidStartTime).toLocaleString() : "Unknown date";
      const raidLabel = row?.raidCode ? `Log ${row.raidCode}` : "Previous raid";
      const votes = Number(row?.winnerVotes || 0);
      const voteLabel = votes === 1 ? "1 vote" : `${numberFmt(votes)} votes`;
      const peakCell = hofPeakParseCellHtml(row);
      const playerCell = hofRaiderCell(row);
      return `
        <article class="hof-row">
          <div class="hof-rank">#${idx + 1}</div>
          <div class="hof-body">
            ${playerCell}
            <span class="subtle hof-log-line">${raidLabel} · ${when}</span>
          </div>
          <div class="hof-metrics">
            <div class="hof-peak">${peakCell}</div>
            <div class="hof-votes">${voteLabel}</div>
          </div>
        </article>
      `;
    })
    .join("");
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
