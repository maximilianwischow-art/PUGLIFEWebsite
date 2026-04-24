const eventsMeta = document.querySelector("#eventsMeta");
const eventsList = document.querySelector("#eventsList");
const DISCORD_INVITE_URL = "https://discord.gg/QgBNZEtHa";
const ROLE_ORDER = ["Tanks", "Healers", "Melee", "Ranged"];
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

function rosterLine(player) {
  const className = String(player.className || "").trim();
  const color = CLASS_COLORS[className] || "var(--text)";
  return `<span class="roster-pill"><span class="roster-name" style="color:${color}">${player.name}</span> · ${className}${player.specName ? ` (${player.specName})` : ""}</span>`;
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

async function loadEvents() {
  try {
    const res = await fetch("/api/raid-helper/future-events");
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Failed to load events");

    const rows = payload?.events || [];
    eventsMeta.textContent = `${rows.length} future event(s) synced from Raid-Helper.`;
    if (!rows.length) {
      eventsList.innerHTML = `<article class="card"><h2>No upcoming events.</h2></article>`;
      return;
    }

    eventsList.innerHTML = rows
      .map((event) => {
        const softres = event.softres?.enabled
          ? `<a href="${event.softres.url}" target="_blank" rel="noreferrer">SoftRes active</a>`
          : "No SoftRes";
        const discordLink = `<a href="${DISCORD_INVITE_URL}" target="_blank" rel="noreferrer">Discord</a>`;
        const signups = Number(event?.signups?.total || 0);
        const confirmed = Number(event?.signups?.confirmed || 0);
        const isFull = signups > 0 && confirmed >= signups;
        const statusLabel = isFull ? "FULL" : "OPEN";
        const groupedRoster = groupedRosterByRole(event.confirmedRoster);
        const groupedRosterHtml = ROLE_ORDER.filter((role) => groupedRoster.get(role).length > 0)
          .map(
            (role) => `
              <div class="roster-role-group">
                <div class="roster-role-title">${role} (${groupedRoster.get(role).length})</div>
                <div class="roster-grid">${groupedRoster.get(role).map(rosterLine).join("")}</div>
              </div>
            `
          )
          .join("");
        return `
          <article class="card event-card">
            <div class="event-main-row">
              <div class="event-time-col">
                <div class="event-date">${fmtEventDate(event.startTime)}</div>
                <div class="event-time">${fmtEventTime(event.startTime)}</div>
                <div class="event-type">Raid Helper Event</div>
              </div>
              <div class="event-boss-col">
                <h2>${event.title}</h2>
                <p class="subtle">${event.description || "No description"}</p>
                <p class="subtle">Roster: T ${event.rosterByRole.Tanks} / H ${event.rosterByRole.Healers} / M ${event.rosterByRole.Melee} / R ${event.rosterByRole.Ranged}</p>
              </div>
              <div class="event-signup-col">
                <div class="event-signup-count">${confirmed}<span>/${signups}</span></div>
                <div class="event-signup-label">${statusLabel}</div>
                <div class="event-links">${softres} · ${discordLink}</div>
              </div>
            </div>
            <img class="event-raid-image" src="${event.raidImage || "/boss-icons/660.jpg"}" alt="${event.title}" loading="lazy" />
            ${groupedRosterHtml || `<div class="subtle">No confirmed roster yet.</div>`}
          </article>
        `;
      })
      .join("");

  } catch (error) {
    eventsMeta.textContent = error.message || "Could not load events.";
    eventsList.innerHTML = `<article class="card"><h2>Failed to load events.</h2></article>`;
  }
}

loadEvents();
