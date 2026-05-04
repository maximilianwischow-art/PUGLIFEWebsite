/**
 * Raid Leaderboard (/): active roster + attendance + merged death totals, sortable table.
 */
const plb = window.plbEventsRoster;
const leaderboardTbody = document.querySelector("#leaderboardTableBody");
const leaderboardTable = document.querySelector("#leaderboardTable");

/** Display / default sort: highest rank first (Guildlead → Peon). */
const RAID_RANK_SORT_ORDER = ["Guildlead", "Raidlead", "Core", "Veteran", "Grunt", "Peon"];

/** @type {{ key: string, dir: "asc"|"desc" }} */
let sortState = { key: "raidRank", dir: "asc" };

/** @type {object[]} */
let leaderboardRows = [];

/** Normalized display-name key of the open row (loot sub-row), or null. */
let expandedPlayerKey = null;

/** Item metadata from `GET /api/wow-classic/items` for leaderboard loot lines (icons + tooltips). */
let leaderboardLootItemMetaMap = new Map();

/** Session-only cache (tab lifetime) to avoid re-fetching heavy roster/death/loot APIs on every navigation. */
const LEADERBOARD_SESSION_CACHE_KEY = "plb-lb-sess-v1";
const LEADERBOARD_SESSION_TTL_MS = 5 * 60 * 1000;

function lbApiGetJson(url, init) {
  const c = window.plbSessionApiCache;
  if (c) return c.getJson(url, init);
  return fetch(url, { method: "GET", ...init }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Request failed");
    return body;
  });
}

function readLeaderboardSessionCache(guildId) {
  try {
    const raw = sessionStorage.getItem(`${LEADERBOARD_SESSION_CACHE_KEY}:${guildId}`);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.at !== "number" || !Array.isArray(o.rows) || !Array.isArray(o.lootEntries)) return null;
    if (Date.now() - o.at > LEADERBOARD_SESSION_TTL_MS) return null;
    return o;
  } catch {
    return null;
  }
}

function writeLeaderboardSessionCache(guildId, rows, lootMap) {
  try {
    const lootEntries = [...lootMap.entries()].map(([id, meta]) => [id, meta]);
    sessionStorage.setItem(
      `${LEADERBOARD_SESSION_CACHE_KEY}:${guildId}`,
      JSON.stringify({
        at: Date.now(),
        rows,
        lootEntries,
      })
    );
  } catch {
    /* QuotaExceeded / private mode — skip */
  }
}

/**
 * Match roster / Gargul / WCL names: strip realm & /alt (via `rosterNameKey`), lowercase, fold diacritics.
 * Fixes loot/death rows when the log says "Toffiy-Realm" but the roster is "Toffiy".
 */
function rosterMatchKey(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  let k;
  if (plb && typeof plb.rosterNameKey === "function") {
    k = plb.rosterNameKey(raw);
  } else {
    k = raw.toLowerCase();
  }
  try {
    return k.normalize("NFD").replace(/\p{M}/gu, "");
  } catch {
    return k;
  }
}

function buildDeathTotalsMap(deathLeaderboard) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const row of deathLeaderboard || []) {
    const k = rosterMatchKey(row?.name);
    if (!k) continue;
    const d = Number(row?.deaths || 0);
    if (!Number.isFinite(d) || d <= 0) continue;
    m.set(k, (m.get(k) || 0) + d);
  }
  return m;
}

function lootItemsForPlayer(player, allItems) {
  const nameKeys = new Set();
  const add = (n) => {
    const k = rosterMatchKey(n);
    if (k) nameKeys.add(k);
  };
  for (const w of Array.isArray(player?.wclCharacters) ? player.wclCharacters : []) add(w);
  add(player?.name);
  add(player?.characterName);
  add(player?.rioProfileLookupName);
  const out = [];
  for (const it of allItems || []) {
    const rk = rosterMatchKey(it?.recipient);
    if (!rk || !nameKeys.has(rk)) continue;
    out.push(it);
  }
  out.sort((a, b) => Number(b?.reportStartTime || 0) - Number(a?.reportStartTime || 0));
  return out;
}

function formatLootWhen(ts) {
  const dt = new Date(Number(ts || 0));
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function playerRowKey(p) {
  if (!plb) return rosterMatchKey(p?.name);
  return rosterMatchKey(plb.eventsRosterCharacterLabel(p));
}

function totalDeathsForPlayer(player, deathMap) {
  const seen = new Set();
  let total = 0;
  const add = (name) => {
    const k = rosterMatchKey(name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    total += deathMap.get(k) || 0;
  };
  for (const w of Array.isArray(player?.wclCharacters) ? player.wclCharacters : []) add(w);
  add(player?.name);
  add(player?.characterName);
  add(player?.rioProfileLookupName);
  return total;
}

function raidRankSortIndex(label) {
  const i = RAID_RANK_SORT_ORDER.indexOf(String(label || ""));
  return i === -1 ? 999 : i;
}

function roleSortIndex(roleBucket, ROLE_ORDER) {
  const r = String(roleBucket || "");
  const i = ROLE_ORDER.indexOf(r);
  return i === -1 ? 999 : i;
}

function defaultDirForKey(key) {
  if (key === "name" || key === "roleName" || key === "raidRank") return "asc";
  return "desc";
}

function compareRows(a, b, key, dir, ROLE_ORDER) {
  const sign = dir === "asc" ? 1 : -1;
  let cmp = 0;
  if (key === "name") {
    cmp = String(a._sortName || "").localeCompare(String(b._sortName || ""));
  } else if (key === "roleName") {
    cmp =
      roleSortIndex(a._roleBucket, ROLE_ORDER) - roleSortIndex(b._roleBucket, ROLE_ORDER) ||
      String(a._sortName || "").localeCompare(String(b._sortName || ""));
  } else if (key === "raidRank") {
    cmp =
      raidRankSortIndex(a._raidRank) - raidRankSortIndex(b._raidRank) ||
      String(a._sortName || "").localeCompare(String(b._sortName || ""));
  } else if (key === "attendanceRate") {
    cmp =
      Number(a.attendanceRate || 0) - Number(b.attendanceRate || 0) ||
      Number(a.raidsAttended || 0) - Number(b.raidsAttended || 0);
  } else if (key === "pastRhEvents") {
    cmp =
      Number(a._pastRhEvents || 0) - Number(b._pastRhEvents || 0) ||
      String(a._sortName || "").localeCompare(String(b._sortName || ""));
  } else if (key === "deaths") {
    cmp = Number(a._deaths || 0) - Number(b._deaths || 0);
  } else if (key === "peakParse") {
    const pa = Number(a._peakParse);
    const pb = Number(b._peakParse);
    const va = Number.isFinite(pa) ? pa : -1;
    const vb = Number.isFinite(pb) ? pb : -1;
    cmp = va - vb;
  }
  if (cmp !== 0) return sign * cmp;
  return String(a._sortName || "").localeCompare(String(b._sortName || ""));
}

function sortRowsInPlace(rows, key, dir, ROLE_ORDER) {
  rows.sort((a, b) => compareRows(a, b, key, dir, ROLE_ORDER));
}

function fmtPct(n) {
  const x = Number(n);
  return Number.isFinite(x) ? `${x.toFixed(0)}%` : "—";
}

function fmtParse(n) {
  const x = Number(n);
  return Number.isFinite(x) && x >= 0 ? `${x.toFixed(1)}` : "—";
}

/** Warcraft Logs–style tier suffix for CSS (classes use !important so row text colour cannot override). */
function peakParseWclTierClass(pct) {
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

function peakParseCellHtml(p) {
  const escapeHtml = plb.escapeHtml;
  const ps = plb.rosterParseForDisplay(p, p);
  const v = ps.value != null && Number.isFinite(Number(ps.value)) ? Number(ps.value) : null;
  const txt = fmtParse(v);
  let title =
    "Peak parse — Warcraft Logs ranked percentile for your role in the tracked raid window (DPS / tank / heal bracket).";
  if (plb.rosterParseSourceTooltipFragment && ps.parseSource) {
    title += plb.rosterParseSourceTooltipFragment(ps.parseSource);
  }
  if (v == null) {
    return `<span class="leaderboard-peak-parse leaderboard-peak-parse--empty" title="${escapeHtml(title)}">${escapeHtml(txt)}</span>`;
  }
  const tier = peakParseWclTierClass(v);
  if (!tier) {
    return `<strong class="leaderboard-peak-parse" title="${escapeHtml(title)}">${escapeHtml(txt)}</strong>`;
  }
  return `<strong class="leaderboard-peak-parse ${tier}" title="${escapeHtml(title)}">${escapeHtml(txt)}</strong>`;
}

/** Single-word display for pill (e.g. Guildlead → GUILDLEAD, Raid lead → RAIDLEAD). */
function raidRankPillDisplay(label) {
  return String(label || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function raidRankPillHtml(raidRank) {
  if (!plb) {
    return `<span class="leaderboard-raid-rank-pill">${String(raidRank || "—")}</span>`;
  }
  const escapeHtml = plb.escapeHtml;
  const raw = String(raidRank || "").trim();
  if (!raw) {
    return `<span class="leaderboard-raid-rank-pill leaderboard-raid-rank-pill--empty">—</span>`;
  }
  const display = raidRankPillDisplay(raw);
  return `<span class="leaderboard-raid-rank-pill" title="Raid rank: ${escapeHtml(raw)}">${escapeHtml(display)}</span>`;
}

function lootItemTooltipTitle(meta) {
  if (window.WowItemTooltip && typeof window.WowItemTooltip.tooltipText === "function") {
    return window.WowItemTooltip.tooltipText(meta);
  }
  const lines = Array.isArray(meta?.tooltip) ? meta.tooltip : [];
  return lines.filter(Boolean).join("\n");
}

function lootPanelHtml(p, itemMetaById) {
  const escapeHtml = plb.escapeHtml;
  const map = itemMetaById instanceof Map ? itemMetaById : leaderboardLootItemMetaMap;
  const items = p._lootItems || [];
  if (!items.length) {
    return `<div class="leaderboard-loot-empty subtle">No loot matched to this character in the tracked guild loot history yet.</div>`;
  }
  const max = 60;
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  const list = shown
    .map((it) => {
      const itemId = Number(it?.itemId || 0);
      const itemMeta = itemId > 0 ? map.get(itemId) : null;
      const labelRaw = String(itemMeta?.name || it?.itemName || "Item").trim() || "Item";
      const nameHtml = escapeHtml(labelRaw);
      const icon = itemMeta?.icon
        ? `<img class="loot-item-icon" src="${escapeHtml(itemMeta.icon)}" alt="" loading="lazy" decoding="async" />`
        : `<span class="loot-item-icon loot-item-icon--fallback" aria-hidden="true"></span>`;
      const tip = lootItemTooltipTitle(itemMeta);
      const titleAttr = tip ? ` title="${escapeHtml(tip)}"` : "";
      const idAttr = itemId > 0 ? ` data-loot-item-id="${itemId}"` : "";
      const when = formatLootWhen(it?.reportStartTime);
      const whenPart = when ? ` · ${escapeHtml(when)}` : "";
      const src = String(it?.source || "").toLowerCase() === "gargul" ? "Gargul" : "WCL";
      const code = String(it?.reportCode || "").trim();
      const wclOk = code && !/^gargul-/i.test(code);
      const log = wclOk
        ? ` <a href="https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}" target="_blank" rel="noreferrer" class="leaderboard-loot-log">log</a>`
        : "";
      return `<li class="leaderboard-loot-line">
        <div class="leaderboard-loot-line-left">
          <div class="loot-item-name leaderboard-loot-item-trigger"${idAttr}${titleAttr}>${icon}<span class="leaderboard-loot-item-label">${nameHtml}</span></div>
        </div>
        <span class="leaderboard-loot-meta subtle">${escapeHtml(src)}${whenPart}${log}</span>
      </li>`;
    })
    .join("");
  const moreLine =
    more > 0
      ? `<p class="subtle leaderboard-loot-more">…and ${more} more (only the ${max} most recent drops are listed here)</p>`
      : "";
  return `<ul class="leaderboard-loot-list" role="list">${list}</ul>${moreLine}`;
}

function attendancePercentTooltip(player, recentRaidCap, consideredRaids) {
  const cap = Number(recentRaidCap) || 6;
  const win = Number(consideredRaids) || 0;
  const att = Number(player?.raidsAttended || 0);
  return `Attendance % uses only the last ${cap} tracked 25-player Warcraft Logs raids (Karazhan and Zul'Aman excluded from that window). You attended ${att} of ${win} raid(s) in that window.`;
}

function raiderCellHtml(p) {
  const escapeHtml = plb.escapeHtml;
  const chain = typeof plb.specBadgePortraitChain === "function" ? plb.specBadgePortraitChain(p) : plb.rosterPortraitChain(p);
  const portraitSrc = escapeHtml(chain[0] || "");
  const portraitFb = chain.slice(1).map((u) => escapeHtml(u)).join("|");
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
          alt="${escapeHtml(portraitAlt)}"
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
          <span class="leaderboard-player-name" style="color:${escapeHtml(color)};${priestGlow}">${escapeHtml(displayName)}</span>
          ${
            metaBits.length
              ? `<span class="leaderboard-player-meta">${escapeHtml(metaBits.join(" · "))}</span>`
              : ""
          }
        </div>
        <div class="leaderboard-player-badges"><div class="raider-badges">${badges}</div></div>
      </div>
    </div>`;
}

function renderLeaderboardTable() {
  if (!leaderboardTbody || !plb) return;
  const ROLE_ORDER = plb.ROLE_ORDER;
  const escapeHtml = plb.escapeHtml;
  sortRowsInPlace(leaderboardRows, sortState.key, sortState.dir, ROLE_ORDER);

  const recentCap = leaderboardRows[0]?._recentRaidCap ?? 6;
  const considered = leaderboardRows[0]?._consideredRaids ?? 0;

  leaderboardTbody.innerHTML = leaderboardRows
    .map((p, idx) => {
      const baseKey = playerRowKey(p);
      const rowKey = baseKey || `__row_${idx}`;
      const keyAttr = escapeHtml(rowKey);
      const isOpen = expandedPlayerKey && expandedPlayerKey === rowKey;
      const rankPill = raidRankPillHtml(p._raidRank);
      const att = fmtPct(p.attendanceRate);
      const attTip = escapeHtml(attendancePercentTooltip(p, recentCap, considered));
      const events = Number(p._pastRhEvents || 0).toLocaleString();
      const deaths = Number(p._deaths || 0).toLocaleString();
      const peakCell = peakParseCellHtml(p);
      const playerCell = raiderCellHtml(p);
      const lootCount = Number(p._lootItems?.length || 0);
      const hint =
        lootCount > 0
          ? `${lootCount} item${lootCount === 1 ? "" : "s"} in history — click to expand`
          : "Click to see loot (if any)";
      const panelId = `lb-loot-${idx}`;

      return `
        <tr
          class="leaderboard-row-leader"
          data-lb-key="${keyAttr}"
          role="button"
          tabindex="0"
          aria-expanded="${isOpen ? "true" : "false"}"
          aria-controls="${panelId}"
          title="${escapeHtml(hint)}"
        >
          <td class="leaderboard-td-player">${playerCell}</td>
          <td class="leaderboard-td-rank">${rankPill}</td>
          <td data-numeric class="leaderboard-td-att" title="${attTip}">
            <strong>${escapeHtml(att)}</strong>
          </td>
          <td data-numeric title="Primary Raid Helper signups in scanned past events">${escapeHtml(events)}</td>
          <td data-numeric>${escapeHtml(deaths)}</td>
          <td data-numeric class="leaderboard-td-peak">${peakCell}</td>
        </tr>
        <tr class="leaderboard-row-loot" data-lb-key="${keyAttr}" data-lb-loot-wrap="1" ${isOpen ? "" : "hidden"}>
          <td colspan="6" class="leaderboard-td-loot">
            <div id="${panelId}" class="leaderboard-loot-panel" role="region" aria-label="Loot received">${lootPanelHtml(p, leaderboardLootItemMetaMap)}</div>
          </td>
        </tr>`;
    })
    .join("");

  document.querySelectorAll("[data-leaderboard-sort]").forEach((btn) => {
    const k = String(btn.getAttribute("data-leaderboard-sort") || "");
    const active = k === sortState.key;
    btn.classList.toggle("leaderboard-sort--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    if (active) {
      btn.setAttribute("aria-sort", sortState.dir === "asc" ? "ascending" : "descending");
    } else {
      btn.removeAttribute("aria-sort");
    }
    const caret = btn.querySelector(".leaderboard-sort-dir");
    if (caret) {
      caret.textContent = active ? (sortState.dir === "asc" ? " ↑" : " ↓") : "";
    }
  });

  const lootScroll = document.querySelector(".leaderboard-table-scroll");
  if (
    window.WowItemTooltip &&
    typeof window.WowItemTooltip.bindLootTooltipHandlers === "function" &&
    (lootScroll || leaderboardTbody)
  ) {
    window.WowItemTooltip.bindLootTooltipHandlers(lootScroll || leaderboardTbody, (id) =>
      leaderboardLootItemMetaMap.get(Number(id))
    );
  }
}

function toggleLeaderboardRowByKey(key) {
  if (!key) return;
  expandedPlayerKey = expandedPlayerKey === key ? null : key;
  if (!leaderboardTbody) return;
  leaderboardTbody.querySelectorAll("tr.leaderboard-row-leader").forEach((tr) => {
    const k = tr.getAttribute("data-lb-key");
    const open = k && expandedPlayerKey === k;
    tr.setAttribute("aria-expanded", open ? "true" : "false");
    tr.classList.toggle("leaderboard-row-leader--open", open);
  });
  leaderboardTbody.querySelectorAll("tr.leaderboard-row-loot").forEach((tr) => {
    const k = tr.getAttribute("data-lb-key");
    const open = k && expandedPlayerKey === k;
    tr.hidden = !open;
  });
}

function wireLeaderboardRowExpand() {
  if (!leaderboardTbody) return;
  leaderboardTbody.addEventListener("click", (ev) => {
    if (ev.target.closest("a, button")) return;
    const tr = ev.target.closest("tr.leaderboard-row-leader");
    if (!tr) return;
    const key = tr.getAttribute("data-lb-key");
    if (key) toggleLeaderboardRowByKey(key);
  });
  leaderboardTbody.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const tr = ev.target.closest("tr.leaderboard-row-leader");
    if (!tr || tr !== document.activeElement) return;
    ev.preventDefault();
    const key = tr.getAttribute("data-lb-key");
    if (key) toggleLeaderboardRowByKey(key);
  });
}

function wireSortHeaders() {
  if (!leaderboardTable) return;
  leaderboardTable.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-leaderboard-sort]");
    if (!btn) return;
    const key = String(btn.getAttribute("data-leaderboard-sort") || "");
    if (!key) return;
    if (key === sortState.key) {
      sortState = { key, dir: sortState.dir === "asc" ? "desc" : "asc" };
    } else {
      sortState = { key, dir: defaultDirForKey(key) };
    }
    renderLeaderboardTable();
  });
}

/**
 * Fetches roster, deaths, loot + item icons from the API and builds row models (same work as a full reload).
 * @returns {{ rows: object[], lootMap: Map<number, object> }}
 */
async function fetchAndBuildLeaderboardRows(gid, reportLimit) {
  const rosterUrl = `/api/wcl/guild/${gid}/active-roster?limit=${reportLimit}&top=250&maxRhPastEvents=80`;
  const [rosterPayload, deathPayload, lootPayload] = await Promise.all([
    lbApiGetJson(rosterUrl, { credentials: "include" }),
    lbApiGetJson(`/api/wcl/guild/${gid}/death-leaderboard?limit=${reportLimit}&top=400`),
    lbApiGetJson(`/api/wcl/guild/${gid}/loot-received?limit=${reportLimit}`).catch(() => ({ items: [] })),
  ]);
  const allLootItems = Array.isArray(lootPayload?.items) ? lootPayload.items : [];

  const lootMap = new Map();
  const lootItemIds = [
    ...new Set(allLootItems.map((x) => Number(x?.itemId || 0)).filter((n) => Number.isInteger(n) && n > 0)),
  ];
  const chunkSize = 80;
  const chunks = [];
  for (let i = 0; i < lootItemIds.length; i += chunkSize) {
    chunks.push(lootItemIds.slice(i, i + chunkSize));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const metaPayload = await lbApiGetJson(
          `/api/wow-classic/items?ids=${encodeURIComponent(chunk.join(","))}`
        );
        if (!Array.isArray(metaPayload?.items)) return;
        for (const row of metaPayload.items) {
          if (Number(row?.itemId) > 0) lootMap.set(Number(row.itemId), row);
        }
      } catch {
        /* icons/tooltips best-effort */
      }
    })
  );

  const players = Array.isArray(rosterPayload.players) ? rosterPayload.players : [];
  const deathMap = buildDeathTotalsMap(deathPayload.leaderboard);
  const consideredRaids = Number(rosterPayload.consideredRaids || 0);
  const recentRaidCap = Number(rosterPayload.attendanceScope?.recentRaidCap || 6);

  const rows = players.map((p) => {
    const ps = plb.rosterParseForDisplay(p, p);
    return {
      ...p,
      _deaths: totalDeathsForPlayer(p, deathMap),
      _consideredRaids: consideredRaids,
      _recentRaidCap: recentRaidCap,
      _peakParse: ps.value != null && Number.isFinite(Number(ps.value)) ? Number(ps.value) : null,
      _raidRank: plb.primaryGuildRankLabel(p),
      _roleBucket: plb.rosterBucketRoleName(p.roleName),
      _pastRhEvents: Number(p.rhPastEventCount || 0),
      _sortName: plb.eventsRosterCharacterLabel(p).toLowerCase(),
      _lootItems: lootItemsForPlayer(p, allLootItems),
    };
  });

  return { rows, lootMap };
}

async function refreshLeaderboardFromNetwork(gid, reportLimit) {
  try {
    const { rows, lootMap } = await fetchAndBuildLeaderboardRows(gid, reportLimit);
    leaderboardRows = rows;
    leaderboardLootItemMetaMap = lootMap;
    writeLeaderboardSessionCache(gid, leaderboardRows, leaderboardLootItemMetaMap);
    if (!leaderboardRows.length) {
      leaderboardTbody.innerHTML = `<tr><td colspan="6" class="subtle">No players in the active roster yet.</td></tr>`;
      return;
    }
    renderLeaderboardTable();
  } catch {
    /* Keep showing session cache if refresh fails */
  }
}

async function loadGuildLeaderboard() {
  if (!plb || !leaderboardTbody) return;
  expandedPlayerKey = null;

  const gid = plb.EVENTS_WCL_GUILD_ID;
  const reportLimit = 40;

  try {
    const prep = Promise.all([plb.loadTbcSpecIconMap(), plb.loadWclAttendanceForEvents()]);

    const cached = readLeaderboardSessionCache(gid);
    if (cached) {
      leaderboardRows = cached.rows;
      leaderboardLootItemMetaMap = new Map(cached.lootEntries);
      if (!leaderboardRows.length) {
        leaderboardTbody.innerHTML = `<tr><td colspan="6" class="subtle">No players in the active roster yet.</td></tr>`;
      } else {
        renderLeaderboardTable();
      }
      void refreshLeaderboardFromNetwork(gid, reportLimit);
      try {
        await prep;
        renderLeaderboardTable();
      } catch {
        /* badges/spec icons best-effort */
      }
      return;
    }

    leaderboardTbody.innerHTML = `<tr><td colspan="6" class="subtle">Loading roster…</td></tr>`;

    const [{ rows, lootMap }] = await Promise.all([fetchAndBuildLeaderboardRows(gid, reportLimit), prep]);
    leaderboardRows = rows;
    leaderboardLootItemMetaMap = lootMap;

    if (!leaderboardRows.length) {
      leaderboardTbody.innerHTML = `<tr><td colspan="6" class="subtle">No players in the active roster yet.</td></tr>`;
      return;
    }

    writeLeaderboardSessionCache(gid, leaderboardRows, leaderboardLootItemMetaMap);
    renderLeaderboardTable();
  } catch (e) {
    leaderboardTbody.innerHTML = `<tr><td colspan="6" class="subtle">${plb.escapeHtml(
      e?.message || "Failed to load leaderboard."
    )}</td></tr>`;
  }
}

plb.initBackgroundStars();
wireSortHeaders();
wireLeaderboardRowExpand();
loadGuildLeaderboard();
