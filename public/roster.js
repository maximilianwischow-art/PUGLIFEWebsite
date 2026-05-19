const rosterActiveGrid = document.querySelector("#rosterActiveGrid");
const rosterPageMeta = document.querySelector("#rosterPageMeta");

/** Display order: officers first (must match admin Account Assignment role names). */
const GUILD_ROLE_SECTION_ORDER = ["Puglead", "Raidlead", "Heallead", "Dpslead", "Core", "Veteran", "Grunt", "Peon"];

function normalizeGuildRoleForSection(player, plb) {
  const raw = plb.effectiveGuildRole ? plb.effectiveGuildRole(player).label : plb.primaryGuildRankLabel(player);
  const r = raw === "Guildlead" ? "Puglead" : raw;
  return GUILD_ROLE_SECTION_ORDER.includes(r) ? r : "Peon";
}

function groupActiveRosterByGuildRole(players, plb) {
  /** @type {Map<string, object[]>} */
  const byRole = new Map(GUILD_ROLE_SECTION_ORDER.map((role) => [role, []]));
  for (const p of players || []) {
    const role = normalizeGuildRoleForSection(p, plb);
    byRole.get(role).push(p);
  }
  const label = plb.eventsRosterCharacterLabel;
  for (const role of GUILD_ROLE_SECTION_ORDER) {
    byRole.get(role).sort((a, b) => label(a).localeCompare(label(b)));
  }
  return byRole;
}

function rosterHtmlByGuildRoleSections(players, plb) {
  const roster = players;
  const byRole = groupActiveRosterByGuildRole(players, plb);
  const card = (p) => plb.rosterRaiderCard(p, roster);
  const heading = plb.rosterGuildRoleSectionTitleHtml;
  return GUILD_ROLE_SECTION_ORDER.filter((role) => byRole.get(role).length > 0)
    .map(
      (role) => `
    <div class="roster-role-group roster-role-group--guild-tier">
      ${heading(role, byRole.get(role).length)}
      <div class="raider-grid">${byRole.get(role).map(card).join("")}</div>
    </div>`
    )
    .join("");
}

async function loadGuildRosterPage() {
  const plb = window.plbEventsRoster;
  if (!plb) {
    if (rosterPageMeta) rosterPageMeta.textContent = "Roster UI failed to load (events-roster-ui.js).";
    if (rosterActiveGrid) rosterActiveGrid.innerHTML = "";
    return;
  }
  try {
    if (rosterPageMeta) rosterPageMeta.textContent = "Loading roster…";
    if (rosterActiveGrid) rosterActiveGrid.innerHTML = "";
    await Promise.all([plb.loadTbcSpecIconMap(), plb.loadWclAttendanceForEvents()]);
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
    await plb.loadRosterGearSummaries(players, { warmMissing: true });
    if (rosterActiveGrid) {
      rosterActiveGrid.innerHTML = players.length
        ? rosterHtmlByGuildRoleSections(players, plb)
        : `<p class="subtle">No players with attendance in those raids yet.</p>`;
    }
  } catch (e) {
    if (rosterPageMeta) rosterPageMeta.textContent = e?.message || "Failed to load roster.";
    if (rosterActiveGrid) rosterActiveGrid.innerHTML = "";
  }
}

window.plbEventsRoster.initBackgroundStars();
loadGuildRosterPage();
