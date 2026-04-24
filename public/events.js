const eventsMeta = document.querySelector("#eventsMeta");
const eventsList = document.querySelector("#eventsList");
const DISCORD_INVITE_URL = "https://discord.gg/QgBNZEtHa";

function fmtDateTime(unixSec) {
  if (!unixSec) return "-";
  const dt = new Date(Number(unixSec) * 1000);
  return Number.isNaN(dt.getTime()) ? "-" : dt.toLocaleString();
}

function rosterLine(player) {
  return `<span class="roster-pill">${player.name} · ${player.className}${player.specName ? ` (${player.specName})` : ""}</span>`;
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
        return `
          <article class="card event-card">
            <img class="event-raid-image" src="${event.raidImage || "/boss-icons/660.jpg"}" alt="${event.title}" loading="lazy" />
            <h2>${event.title}</h2>
            <p class="subtle">${fmtDateTime(event.startTime)} · Signups ${event.signups.confirmed}/${event.signups.total}</p>
            <p class="subtle">${event.description || "No description"}</p>
            <p class="subtle">SoftRes: ${softres}</p>
            <p class="subtle">Discord: ${discordLink}</p>
            <p class="subtle">Roster: T ${event.rosterByRole.Tanks} / H ${event.rosterByRole.Healers} / M ${event.rosterByRole.Melee} / R ${event.rosterByRole.Ranged}</p>
            <div class="roster-grid">${event.confirmedRoster.map(rosterLine).join("")}</div>
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
