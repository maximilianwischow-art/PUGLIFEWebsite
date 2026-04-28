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

function votingRaidHeaderImagePath(raidName) {
  const s = String(raidName || "").trim();
  if (s === "Karazhan") return "/raid-images/pb-header-kara.png?v=20260428d";
  if (s === "Gruul's Lair") return "/raid-images/pb-header-gruul.png?v=20260428d";
  if (s === "Magtheridon's Lair") return "/raid-images/pb-header-magtheridon.png?v=20260428d";
  if (s === "Serpentshrine Cavern") return "/raid-images/pb-header-ssc.png?v=20260428d";
  if (s === "Tempest Keep" || s === "The Eye") return "/raid-images/pb-header-tk.png?v=20260428d";
  return "/raid-images/pb-header-kara.png?v=20260428d";
}

function renderRaidHeader(payload) {
  const host = document.getElementById("votingRaidHeader");
  const raidName = payload?.raid?.name || "Raid";
  host.innerHTML = `<img src="${votingRaidHeaderImagePath(raidName)}" alt="${raidName}" loading="lazy" decoding="async" />`;
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
            <strong>${c.name || "Unknown"}</strong>
            <span class="subtle">${c.className || "Unknown class"}</span>
          </div>
          <div class="voting-metric"><span class="subtle">DPS</span><strong>${numberFmt(c.dps)}</strong></div>
          <div class="voting-metric"><span class="subtle">HPS</span><strong>${numberFmt(c.hps)}</strong></div>
          <div class="voting-metric"><span class="subtle">Damage Taken</span><strong>${numberFmt(c.damageTaken)}</strong></div>
          <div class="voting-metric"><span class="subtle">Votes</span><strong>${numberFmt(c.votes)}</strong></div>
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
loadVotingRound();
