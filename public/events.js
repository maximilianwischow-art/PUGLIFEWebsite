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

const eventsList = document.querySelector("#eventsList");
const DISCORD_INVITE_URL = "https://discord.gg/TBnt5f8DFc";
const IMAGE_ASSET_VERSION = "20260428f";
const ROLE_ORDER = ["Tanks", "Healers", "Melee", "Ranged"];
let authMe = null;
const CLASS_COLORS = {
  Warrior: "#a87040",
  Paladin: "#f472b6",
  Hunter: "#3ddc6e",
  Rogue: "#c9b430",
  Priest: "#e8e0d0",
  "Death Knight": "#c41e3a",
  Shaman: "#6366f1",
  Mage: "#60a5fa",
  Warlock: "#8b5cf6",
  Druid: "#e8943a",
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rosterLine(player) {
  const className = String(player.className || "").trim();
  const color = CLASS_COLORS[className] || "var(--text)";
  return `<span class="roster-pill"><span class="roster-name" style="color:${color}">${escapeHtml(player.name)}</span> · ${escapeHtml(className)}${player.specName ? ` (${escapeHtml(player.specName)})` : ""}</span>`;
}

function fmtEventDate(unixSec) {
  if (!unixSec) return "-";
  const dt = new Date(Number(unixSec) * 1000);
  return Number.isNaN(dt.getTime())
    ? "-"
    : dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtEventTime(unixSec) {
  if (!unixSec) return "-";
  const dt = new Date(Number(unixSec) * 1000);
  return Number.isNaN(dt.getTime())
    ? "-"
    : dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function versionedImagePath(path) {
  return `${path}?v=${IMAGE_ASSET_VERSION}`;
}

function rosterCapacityForEvent(event) {
  const raids = detectEventRaids(event);
  if (!raids.some((raid) => raid.rosterCap === 25)) return 10;
  return 25;
}

function detectEventRaids(event) {
  const text = `${event?.title || ""} ${event?.description || ""}`.toLowerCase();
  const matches = [];
  if (text.includes("karazhan") || /\bkara\b/.test(text)) {
    matches.push({ id: "kara", image: versionedImagePath("/raid-images/pb-header-kara.png"), rosterCap: 10 });
  }
  if (text.includes("gruul")) {
    matches.push({ id: "gruul", image: versionedImagePath("/raid-images/pb-header-gruul.png"), rosterCap: 25 });
  }
  if (text.includes("magtheridon") || /\bmag\b/.test(text)) {
    matches.push({
      id: "mag",
      image: versionedImagePath("/raid-images/pb-header-magtheridon.png"),
      rosterCap: 25,
    });
  }
  if (text.includes("serpentshrine") || /\bssc\b/.test(text)) {
    matches.push({ id: "ssc", image: versionedImagePath("/raid-images/pb-header-ssc.png"), rosterCap: 25 });
  }
  if (text.includes("tempest keep") || /\btk\b/.test(text) || text.includes("the eye")) {
    matches.push({ id: "tk", image: versionedImagePath("/raid-images/pb-header-tk.png"), rosterCap: 25 });
  }
  if (text.includes("zul'aman") || text.includes("zul aman") || /\bza\b/.test(text)) {
    matches.push({ id: "za", image: versionedImagePath("/raid-images/pb-header-kara.png"), rosterCap: 10 });
  }

  if (!matches.length) {
    return [{ id: "fallback", image: versionedImagePath("/raid-images/pb-header-kara.png"), rosterCap: 25 }];
  }
  return matches.slice(0, 2);
}

function eventHeaderMarkup(event) {
  const raids = detectEventRaids(event);
  if (raids.length === 1) {
    return `<div class="event-raid-header"><img src="${escapeHtml(raids[0].image)}" alt="" loading="lazy" decoding="async" /></div>`;
  }
  return `
    <div class="event-raid-header event-raid-header--split">
      <img src="${escapeHtml(raids[0].image)}" alt="" loading="lazy" decoding="async" />
      <img src="${escapeHtml(raids[1].image)}" alt="" loading="lazy" decoding="async" />
    </div>
  `;
}

function groupedRosterByRole(confirmedRoster) {
  const grouped = new Map(ROLE_ORDER.map((role) => [role, []]));
  for (const player of confirmedRoster || []) {
    const role = ROLE_ORDER.includes(player?.roleName) ? player.roleName : "Ranged";
    grouped.get(role).push(player);
  }
  for (const role of ROLE_ORDER) {
    grouped.get(role).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }
  return grouped;
}

function formatCountdownRemaining(totalSec) {
  if (totalSec <= 0) return "Starting soon";
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d >= 1) return `${d}d ${h}h ${m}m`;
  if (totalSec >= 3600) return `${h}h ${m}m ${s}s`;
  if (totalSec >= 60) return `${m}m ${s}s`;
  return `${s}s`;
}

let countdownIntervalId = null;

function updateEventCountdowns() {
  const now = Math.floor(Date.now() / 1000);
  document.querySelectorAll("[data-event-start]").forEach((el) => {
    const start = Number(el.getAttribute("data-event-start"));
    const inner = el.querySelector(".event-countdown-value");
    if (!inner || !start) return;
    inner.textContent = formatCountdownRemaining(start - now);
  });
}

function startEventCountdowns() {
  if (countdownIntervalId != null) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
  updateEventCountdowns();
  countdownIntervalId = setInterval(updateEventCountdowns, 1000);
}

async function loadAuthMe() {
  if (authMe !== null) return authMe;
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    const payload = await res.json().catch(() => ({}));
    authMe = payload?.authenticated ? payload : { authenticated: false };
  } catch {
    authMe = { authenticated: false };
  }
  return authMe;
}

function signupActionsMarkup(event, isAuthenticated) {
  const eventId = String(event?.id || "");
  if (!isAuthenticated) {
    const next = encodeURIComponent("/events.html");
    return `<a href="/auth/discord/login?next=${next}" class="event-signup-btn">Login to Sign up</a>`;
  }
  const currentStatus = String(event?.currentUserSignup?.status || "").toLowerCase();
  const isSignedUp = currentStatus === "primary";
  return `
    <button type="button" class="event-signup-btn" data-event-signup-action="${isSignedUp ? "signoff" : "signup"}" data-event-id="${escapeHtml(eventId)}">
      ${isSignedUp ? "Sign off" : "Sign up"}
    </button>
    <a href="${escapeHtml(DISCORD_INVITE_URL)}" target="_blank" rel="noreferrer" class="event-signup-btn event-signup-btn--softres">Discord</a>
  `;
}

async function submitEventSignupAction(eventId, action) {
  const method = action === "signoff" ? "DELETE" : "POST";
  const res = await fetch(`/api/raid-helper/events/${encodeURIComponent(eventId)}/signup`, {
    method,
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const next = encodeURIComponent("/events.html");
    window.location.href = `/auth/discord/login?next=${next}`;
    return;
  }
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error || "Failed to update signup");
  }
}

async function loadEvents() {
  try {
    const me = await loadAuthMe();
    const isAuthenticated = Boolean(me?.authenticated);
    const res = await fetch("/api/raid-helper/future-events", { credentials: "include" });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Failed to load events");

    const rows = (payload?.events || []).filter(
      (event) => String(event?.title || "").trim().toLowerCase() !== "p2 raids"
    );
    if (!rows.length) {
      eventsList.innerHTML = `<article class="card"><h2>No upcoming events.</h2></article>`;
      return;
    }

    eventsList.innerHTML = rows
      .map((event) => {
        const softresBtn = event.softres?.enabled
          ? `<a href="${escapeHtml(event.softres.url)}" target="_blank" rel="noreferrer" class="event-signup-btn event-signup-btn--softres">SoftRes</a>`
          : "";
        const directSignupMarkup = signupActionsMarkup(event, isAuthenticated);
        const linksRow = event.softres?.enabled ? `${softresBtn}${directSignupMarkup}` : directSignupMarkup;

        const signups = Number(event?.signups?.total || 0);
        const rosterCapacity = rosterCapacityForEvent(event);
        const groupedRoster = groupedRosterByRole(event.confirmedRoster);
        const groupedRosterHtml = ROLE_ORDER.filter((role) => groupedRoster.get(role).length > 0)
          .map(
            (role) => `
              <div class="roster-role-group">
                <div class="roster-role-title">${escapeHtml(role)} (${groupedRoster.get(role).length})</div>
                <div class="roster-grid">${groupedRoster.get(role).map(rosterLine).join("")}</div>
              </div>
            `
          )
          .join("");

        const headerMarkup = eventHeaderMarkup(event);
        const startSec = Number(event.startTime || 0);

        return `
          <article class="card event-card">
            ${headerMarkup}
            <div class="event-card-inner">
            <div class="event-main-row">
              <div class="event-time-col">
                <div class="event-date">${escapeHtml(fmtEventDate(event.startTime))}</div>
                <div class="event-time">${escapeHtml(fmtEventTime(event.startTime))}</div>
                <div class="event-countdown" data-event-start="${startSec}">
                  <span class="event-countdown-label">Starts in</span>
                  <span class="event-countdown-value">—</span>
                </div>
              </div>
              <div class="event-boss-col">
                <h2>${escapeHtml(event.title)}</h2>
                <p class="subtle">${escapeHtml(event.description || "No description")}</p>
                <p class="subtle">Roster: T ${event.rosterByRole.Tanks} / H ${event.rosterByRole.Healers} / M ${event.rosterByRole.Melee} / R ${event.rosterByRole.Ranged}</p>
              </div>
              <div class="event-signup-col">
                <div class="event-signup-summary">
                  <span class="event-signup-count">${signups}<span>/${rosterCapacity}</span></span>
                </div>
                <div class="event-links">${linksRow}</div>
              </div>
            </div>
            ${groupedRosterHtml || `<div class="subtle">No confirmed roster yet.</div>`}
            </div>
          </article>
        `;
      })
      .join("");

    startEventCountdowns();
  } catch (error) {
    eventsList.innerHTML = `<article class="card"><h2>Failed to load events.</h2><p class="subtle">${escapeHtml(error.message || "Unknown error")}</p></article>`;
  }
}

document.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-event-signup-action][data-event-id]");
  if (!btn) return;
  const eventId = String(btn.getAttribute("data-event-id") || "").trim();
  const action = String(btn.getAttribute("data-event-signup-action") || "").trim();
  if (!eventId || !action) return;
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = action === "signoff" ? "Signing off..." : "Signing up...";
  try {
    await submitEventSignupAction(eventId, action);
    await loadEvents();
  } catch (error) {
    btn.textContent = originalText;
    btn.disabled = false;
    window.alert(error?.message || "Failed to update signup");
  }
});

initBackgroundStars();
loadEvents();
