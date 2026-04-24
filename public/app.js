const statusEl = document.querySelector("#status");
const raidsBoard = document.querySelector("#raidsBoard");
const GUILD_ID = 817080;
const latestRaidMeta = document.querySelector("#latestRaidMeta");
const potrDps = document.querySelector("#potrDps");
const potrHeal = document.querySelector("#potrHeal");
const potrTank = document.querySelector("#potrTank");
const deathMeta = document.querySelector("#deathMeta");
const deathLeaderboard = document.querySelector("#deathLeaderboard");
const attendanceMeta = document.querySelector("#attendanceMeta");
const attendanceList = document.querySelector("#attendanceList");
const deathEncounterMeta = document.querySelector("#deathEncounterMeta");
const deathEncounterHeatmap = document.querySelector("#deathEncounterHeatmap");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function fmtDate(timestampMs) {
  if (!timestampMs) return "-";
  const date = new Date(Number(timestampMs));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function fmtNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
}

function parseColor(rankPercent) {
  const value = Number(rankPercent);
  if (!Number.isFinite(value)) return "#a08850";
  if (value >= 100) return "#e5cc80"; // gold
  if (value >= 99) return "#e268a8"; // pink
  if (value >= 95) return "#ff8000"; // orange
  if (value >= 75) return "#a335ee"; // purple
  if (value >= 50) return "#0070ff"; // blue
  if (value >= 25) return "#1eff00"; // green
  return "#9d9d9d"; // gray
}

const BOSS_ICON_BY_NAME = {
  "Attumen the Huntsman": "/boss-icons/652.jpg",
  Moroes: "/boss-icons/653.jpg",
  "Maiden of Virtue": "/boss-icons/654.jpg",
  "Opera Hall": "/boss-icons/655.jpg",
  "The Curator": "/boss-icons/656.jpg",
  "Terestian Illhoof": "/boss-icons/657.jpg",
  "Shade of Aran": "/boss-icons/658.jpg",
  Netherspite: "/boss-icons/659.jpg",
  "Chess Event": "/boss-icons/660.jpg",
  "Prince Malchezaar": "/boss-icons/661.jpg",
  Nightbane: "/boss-icons/662.jpg",
  "Gruul the Dragonkiller": "/boss-icons/650.jpg",
  Magtheridon: "/boss-icons/651.jpg",
};

function bossIconUrl(bossName) {
  return BOSS_ICON_BY_NAME[bossName] || "/boss-icons/660.jpg";
}

function classIconCandidates(iconKey, className) {
  const result = [];
  if (iconKey) result.push(`/class-icons/${iconKey}.jpg`);
  if (className) result.push(`/class-icons/${className}.jpg`);
  result.push("/class-icons/Warrior.jpg");
  return result;
}

function classIconImg(iconKey, className, alt) {
  const candidates = classIconCandidates(iconKey, className);
  const escaped = candidates.map((x) => `'${x}'`).join(",");
  return `<img class="class-icon" src="${candidates[0]}" alt="${alt}" loading="lazy" data-fallbacks="${escaped}" onerror="(function(img){const arr=img._fb||(img._fb=[${escaped}]);const i=arr.indexOf(img.getAttribute('src'));if(i>=0&&i<arr.length-1){img.setAttribute('src',arr[i+1]);}else{img.onerror=null;}})(this)" />`;
}

function fmtDuration(ms) {
  const totalSeconds = Math.floor(Number(ms || 0) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "-";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildBestTimeRow(boss) {
  if (!boss.bestKill) {
    return `
      <tr>
        <td>${boss.bossName}</td>
        <td>-</td>
        <td>-</td>
        <td>Not killed yet</td>
      </tr>
    `;
  }

  const fightLink = `https://fresh.warcraftlogs.com/reports/${boss.bestKill.reportCode}#fight=${boss.bestKill.fightId}`;
  return `
    <tr>
      <td>
        <span class="boss-cell">
          <img src="${bossIconUrl(boss.bossName)}" alt="${boss.bossName}" loading="lazy" />
          ${boss.bossName}
        </span>
      </td>
      <td>${fmtDuration(boss.bestKill.durationMs)}</td>
        <td>${fmtDate(boss.bestKill.reportStartTime)}</td>
      <td>
        <a href="${fightLink}" target="_blank" rel="noreferrer">View log</a>
      </td>
    </tr>
  `;
}

function renderRaidCards(raidSummary) {
  raidsBoard.innerHTML = "";
  for (const raid of raidSummary) {
    const card = document.createElement("article");
    card.className = "card raid-card";
    const clearInfo = raid.bestClear
      ? `Best Clear: ${fmtDuration(raid.bestClear.durationMs)} (${fmtDate(raid.bestClear.reportStartTime)})`
      : "Best Clear: -";
    card.innerHTML = `
      <h2>${raid.raidName}</h2>
      <p class="subtle">${clearInfo}</p>
      <table class="times-table">
        <thead>
          <tr>
            <th>Boss</th>
            <th>Best Time</th>
            <th>Date</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          ${raid.bosses.map(buildBestTimeRow).join("")}
        </tbody>
      </table>
    `;
    raidsBoard.appendChild(card);
  }
}

async function loadBossTimes() {
  setStatus("Loading best kill times...");
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/boss-times?limit=50`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch boss times");
    }

    renderRaidCards(payload.raidSummary || []);
    setStatus("Best times updated.");
  } catch (error) {
    setStatus(error.message || "Failed to fetch boss times.", true);
  }
}

function renderPotr(target, label, player) {
  if (!player) {
    target.textContent = `No ${label.toLowerCase()} data.`;
    return;
  }
  const totalLabel =
    label === "DPS" ? "Total DPS" : label === "Healer" ? "Total HPS" : "Total Damage Taken";
  const parseText =
    typeof player.bestParse?.rankPercent === "number"
      ? `Highest Parse:
        <span class="boss-cell">
          <img src="${bossIconUrl(player.bestParse.bossName)}" alt="${player.bestParse.bossName}" loading="lazy" />
          <span style="color:${parseColor(player.bestParse.rankPercent)};font-weight:700">${player.bestParse.rankPercent.toFixed(
            1
          )}</span>
          <span>(${player.bestParse.bossName})</span>
        </span>`
      : "Highest Parse: -";
  target.innerHTML = `
    <strong class="player-title">${classIconImg(player.icon, player.type, player.name)}${player.name}</strong>
    <div>${player.type}</div>
    <div>${totalLabel}: ${fmtNumber(player.total)}</div>
    <div>${parseText}</div>
  `;
}

async function loadLatestRaidMvp() {
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/latest-raid-mvp?limit=20`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch latest raid MVP");
    }

    const raidDate = fmtDate(payload?.raid?.startTime);
    latestRaidMeta.textContent = `${payload?.raid?.title || "Latest Raid"} - ${raidDate}`;
    renderPotr(potrDps, "DPS", payload.dps);
    renderPotr(potrHeal, "Healer", payload.heal);
    renderPotr(potrTank, "Tank", payload.tank);
  } catch (error) {
    latestRaidMeta.textContent = error.message || "Unable to load latest raid.";
  }
}

async function loadDeathLeaderboard() {
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/death-leaderboard?limit=50`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch death leaderboard");
    }

    const rows = payload?.leaderboard || [];
    deathMeta.textContent = `Across ${payload?.scannedReports || 0} tracked raid report(s).`;
    if (!rows.length) {
      deathLeaderboard.innerHTML = "<li>No death data available yet.</li>";
      return;
    }

    deathLeaderboard.innerHTML = rows
      .map(
        (row) =>
          `<li><span class="death-name">${row.name}</span><span class="death-value">${fmtNumber(
            row.deaths
          )} deaths</span></li>`
      )
      .join("");
  } catch (error) {
    deathMeta.textContent = error.message || "Unable to load deaths.";
    deathLeaderboard.innerHTML = "<li>Could not load death tracker.</li>";
  }
}

async function loadAttendanceTracker() {
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/attendance?limit=40&top=12`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch attendance");
    }

    const rows = payload?.leaderboard || [];
    attendanceMeta.textContent = `Across ${payload?.consideredRaids || 0} recent tracked raids.`;
    if (!rows.length) {
      attendanceList.innerHTML = "<div>No attendance data yet.</div>";
      return;
    }

    attendanceList.innerHTML = rows
      .map(
        (row, idx) => `
          <div class="attendance-row">
            <span class="attendance-rank">#${idx + 1}</span>
            <span class="attendance-name">${row.name}</span>
            <span class="attendance-value">${row.raidsAttended}/${payload.consideredRaids}</span>
            <span class="attendance-rate">${row.attendanceRate.toFixed(0)}%</span>
            <span class="attendance-history">
              ${(Array.isArray(row.attendanceHistory) ? row.attendanceHistory : [])
                .map((v) => `<span class="attendance-dot ${v ? "on" : "off"}"></span>`)
                .join("")}
            </span>
          </div>
        `
      )
      .join("");
  } catch (error) {
    attendanceMeta.textContent = error.message || "Unable to load attendance.";
    attendanceList.innerHTML = "<div>Could not load attendance tracker.</div>";
  }
}

async function loadDeathEncounterHeatmap() {
  try {
    const response = await fetch(`/api/wcl/guild/${GUILD_ID}/death-encounter-heatmap?limit=50`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to fetch death encounter heatmap");
    }

    const rows = payload?.heatmap || [];
    deathEncounterMeta.textContent = `${rows.length} tracked boss(es) across recent raids.`;
    if (!rows.length) {
      deathEncounterHeatmap.innerHTML = "<div>No encounter death data yet.</div>";
      return;
    }

    deathEncounterHeatmap.innerHTML = rows
      .slice(0, 12)
      .map((row) => {
        const severity = row.deathsPerAttempt >= 15 ? "high" : row.deathsPerAttempt >= 8 ? "mid" : "low";
        return `
          <div class="heatmap-row ${severity}">
            <div>
              <span class="boss-cell">
                <img src="${bossIconUrl(row.bossName)}" alt="${row.bossName}" loading="lazy" />
                <strong>${row.bossName}</strong>
              </span>
              <span class="subtle">(${row.raidName})</span>
            </div>
            <div class="heatmap-stats">
              <span>${fmtNumber(row.totalDeaths)} deaths</span>
              <span>${row.deathsPerAttempt.toFixed(1)}/attempt</span>
              <span>${row.wipeRate.toFixed(0)}% wipe</span>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    deathEncounterMeta.textContent = error.message || "Unable to load encounter death heatmap.";
    deathEncounterHeatmap.innerHTML = "<div>Could not load encounter death data.</div>";
  }
}

loadBossTimes();
loadLatestRaidMvp();
loadDeathLeaderboard();
loadAttendanceTracker();
loadDeathEncounterHeatmap();
