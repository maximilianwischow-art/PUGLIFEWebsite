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
      return `
        <article class="hof-row">
          <div class="hof-rank">#${idx + 1}</div>
          <div class="hof-main">
            <strong>${row?.winnerName || "Unknown"}</strong>
            <span class="subtle">${raidLabel} · ${when}</span>
          </div>
          <div class="hof-votes">${numberFmt(row?.winnerVotes || 0)} votes</div>
        </article>
      `;
    })
    .join("");
}

async function loadHallOfFame() {
  const host = document.getElementById("votingHallOfFame");
  host.innerHTML = `<div class="subtle">Loading…</div>`;
  try {
    const res = await fetch("/api/voting/hall-of-fame", { credentials: "include" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) {
      host.innerHTML = `<div class="subtle">${payload?.error || "Failed to load hall of fame."}</div>`;
      return;
    }
    renderHallOfFame(payload);
  } catch {
    host.innerHTML = `<div class="subtle">Failed to load hall of fame.</div>`;
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
  renderHallOfFame(payload);
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
