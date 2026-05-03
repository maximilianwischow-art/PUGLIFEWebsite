const rosterActiveGrid = document.querySelector("#rosterActiveGrid");
const rosterPageMeta = document.querySelector("#rosterPageMeta");

async function loadGuildRosterPage() {
  const plb = window.plbEventsRoster;
  if (!plb) {
    if (rosterPageMeta) rosterPageMeta.textContent = "Roster UI failed to load (events-roster-ui.js).";
    return;
  }
  try {
    if (rosterPageMeta) rosterPageMeta.textContent = "Loading roster…";
    await plb.loadTbcSpecIconMap();
    await plb.loadWclAttendanceForEvents();
    const gid = plb.EVENTS_WCL_GUILD_ID;
    const res = await fetch(`/api/wcl/guild/${gid}/active-roster?limit=40&top=250`, {
      credentials: "include",
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    const players = Array.isArray(payload.players) ? payload.players : [];
    const cap = payload.attendanceScope?.recentRaidCap ?? "?";
    const considered = payload.consideredRaids ?? "?";
    if (rosterPageMeta) {
      rosterPageMeta.textContent = `${players.length} active players · appeared in at least one of the last ${considered} tracked 25-player raids (recent cap ${cap}; Karazhan & Zul'Aman excluded from attendance %). Guild role from Account Assignment.`;
    }
    const roster = players;
    if (rosterActiveGrid) {
      rosterActiveGrid.innerHTML = players.length
        ? players.map((p) => plb.rosterRaiderCard(p, roster)).join("")
        : `<p class="subtle">No players with attendance in those raids yet.</p>`;
    }
  } catch (e) {
    if (rosterPageMeta) rosterPageMeta.textContent = e?.message || "Failed to load roster.";
    if (rosterActiveGrid) rosterActiveGrid.innerHTML = "";
  }
}

window.plbEventsRoster.initBackgroundStars();
loadGuildRosterPage();
