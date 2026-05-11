function initBackgroundStars() {
  const el = document.getElementById("stars");
  if (!el || el.childElementCount > 0) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 40; i += 1) {
    const s = document.createElement("div");
    s.className = "star";
    const sz = Math.random() * 1.8 + 0.4;
    const o = 0.08 + Math.random() * 0.35;
    s.style.cssText = `width:${sz}px;height:${sz}px;top:${Math.random() * 100}%;left:${Math.random() * 100}%;--d:${2 + Math.random() * 4}s;--dl:${Math.random() * 4}s;--o:${o}`;
    frag.appendChild(s);
  }
  el.appendChild(frag);
}

function scheduleNonCritical(task, timeoutMs = 1200) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => task(), { timeout: timeoutMs });
    return;
  }
  window.setTimeout(task, 0);
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
function votingRaidImagePath(raidName) {
  const raw = String(raidName || "").trim();
  const n = normalizedRaidBannerKey(raw);
  const bust = `?v=${VOTING_RAID_BANNER_VER}`;

  const hasGruul = n.includes("gruul");
  const hasMag = n.includes("magtheridon");
  if (n.includes("karazhan") || /\bkara\b/.test(n)) return `/raid-images/kara.png${bust}`;
  if (n.includes("serpentshrine") || n.includes("ssc")) return `/raid-images/ssc.png${bust}`;
  if (n.includes("tempest") || n.includes("the eye") || /\btk\b/.test(n)) return `/raid-images/tk.png${bust}`;
  if (hasMag && !hasGruul) return `/raid-images/magtheridon.png${bust}`;
  if (hasGruul) return `/raid-images/gruul.png${bust}`;
  return `/raid-images/kara.png${bust}`;
}

function votingRaidHeaderInnerHtml(raidName) {
  const raw = String(raidName || "").trim();
  const n = normalizedRaidBannerKey(raw);
  const hasGruul = n.includes("gruul");
  const hasMag = n.includes("magtheridon");

  const tile = (label) => {
    const src = votingRaidImagePath(label);
    return `<div class="voting-raid-tile">
      <img class="voting-raid-tile-img" src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(label)}" loading="lazy" decoding="async" />
      <div class="voting-raid-tile-copy">
        <span class="subtle voting-raid-kicker">Current raid</span>
        <strong class="voting-raid-title">${escapeHtml(label || "Raid")}</strong>
      </div>
    </div>`;
  };

  if (hasGruul && hasMag) {
    return `<div class="voting-raid-header-inner voting-raid-header-inner--split">${tile("Gruul's Lair")}${tile(
      "Magtheridon's Lair"
    )}</div>`;
  }
  return `<div class="voting-raid-header-inner">${tile(raw || "Raid")}</div>`;
}

function renderRaidHeader(payload) {
  const host = document.getElementById("votingRaidHeader");
  const raidName = payload?.raid?.name || "Raid";
  host.innerHTML = votingRaidHeaderInnerHtml(raidName);
  host.hidden = false;
}

/** Official default UI palette (matches `events-roster-ui` WOW_CLASS_COLORS). */
const VOTING_CLASS_HEX = {
  warrior: "#c79c6e",
  paladin: "#f58cba",
  hunter: "#abd473",
  rogue: "#fff569",
  priest: "#ffffff",
  shaman: "#0070dd",
  mage: "#69ccf0",
  warlock: "#9482c9",
  druid: "#ff7d0a",
  deathknight: "#c41f3b",
};

const VOTING_VALID_CLASS_SLUGS = new Set(Object.keys(VOTING_CLASS_HEX));

/** Mirrors server `LOCALIZED_CLASS_SLUG_TO_ENGLISH_SLUG` one-word class labels. */
const VOTING_LOCALIZED_CLASS_SLUG = {
  krieger: "warrior",
  jaeger: "hunter",
  jager: "hunter",
  schurke: "rogue",
  priester: "priest",
  schamane: "shaman",
  magier: "mage",
  hexenmeister: "warlock",
  druide: "druid",
  todesritter: "deathknight",
  guerrier: "warrior",
  chasseur: "hunter",
  voleur: "rogue",
  pretre: "priest",
  chaman: "shaman",
  demoniste: "warlock",
  chevalierdelamort: "deathknight",
  guerrero: "warrior",
  cazador: "hunter",
  picaro: "rogue",
  sacerdote: "priest",
  brujo: "warlock",
  druida: "druid",
};

function votingSlugifyLabel(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Resolve API/WCL class labels (often English display class OR combat spec `type`) to a canonical slug.
 * Does not depend on `plb.wowClassColor` (spec strings otherwise fell through to `var(--text)` ≈ white).
 */
function votingResolveClassSlug(rawLabel) {
  const cleaned = String(rawLabel || "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!cleaned) return "";
  const t = votingSlugifyLabel(cleaned);
  if (!t) return "";
  if (VOTING_VALID_CLASS_SLUGS.has(t)) return t;
  const loc = VOTING_LOCALIZED_CLASS_SLUG[t];
  if (loc) return loc;

  /* Spec tokens — mirrors server `classSlugFromWclDamageDoneType` (+ retribution). */
  if (t === "arms" || t === "fury") return "warrior";
  if (t === "elemental" || t === "enhancement") return "shaman";
  if (t === "balance" || t === "feral" || t === "guardian") return "druid";
  if (t === "arcane" || t === "fire" || t === "frost") return "mage";
  if (t === "affliction" || t === "demonology" || t === "destruction") return "warlock";
  if (t === "assassination" || t === "combat" || t === "subtlety") return "rogue";
  if (t === "beastmastery" || t === "marksmanship" || t === "survival") return "hunter";
  if (t === "shadow" || t === "discipline") return "priest";
  if (t === "retribution") return "paladin";

  const compounds = [
    ["deathknight", "deathknight"],
    ["paladin", "paladin"],
    ["warrior", "warrior"],
    ["shaman", "shaman"],
    ["hunter", "hunter"],
    ["rogue", "rogue"],
    ["warlock", "warlock"],
    ["mage", "mage"],
    ["priest", "priest"],
    ["druid", "druid"],
  ];
  for (const [needle, slug] of compounds) {
    if (t.includes(needle)) return slug;
  }
  return "";
}

function votingPlayerNameColor(classLabelRaw) {
  const slug = votingResolveClassSlug(classLabelRaw);
  return (slug && VOTING_CLASS_HEX[slug]) || "#ded6ee";
}

function votingPeakParseTierClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "leaderboard-peak-parse--empty";
  if (n >= 100) return "leaderboard-peak-parse--wcl100";
  if (n >= 99) return "leaderboard-peak-parse--wcl99";
  if (n >= 95) return "leaderboard-peak-parse--wcl95";
  if (n >= 75) return "leaderboard-peak-parse--wcl75";
  if (n >= 50) return "leaderboard-peak-parse--wcl50";
  if (n >= 25) return "leaderboard-peak-parse--wcl25";
  return "leaderboard-peak-parse--wcl0";
}

function renderCandidates(payload, canVote) {
  const list = document.getElementById("votingList");
  const myVote = String(payload?.myVote || "");
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const maxDps = Math.max(0, ...candidates.map((c) => Number(c?.dps) || 0));
  const maxHps = Math.max(0, ...candidates.map((c) => Number(c?.hps) || 0));
  const maxTank = Math.max(0, ...candidates.map((c) => Number(c?.damageTaken) || 0));
  const rows = candidates
    .map((c) => {
      const selected = myVote && myVote.toLowerCase() === String(c.name || "").toLowerCase();
      const isRoleMvpDps = maxDps > 0 && Number(c?.dps || 0) === maxDps;
      const isRoleMvpHeal = maxHps > 0 && Number(c?.hps || 0) === maxHps;
      const isRoleMvpTank = maxTank > 0 && Number(c?.damageTaken || 0) === maxTank;
      const mvpScore = Number(isRoleMvpDps) + Number(isRoleMvpHeal) + Number(isRoleMvpTank);
      const peakParse = Number(c?.peakParse);
      const peakParseText = Number.isFinite(peakParse) && peakParse >= 0 ? `${peakParse.toFixed(1)}%` : "—";
      const peakParseClass = votingPeakParseTierClass(peakParse);
      const classSlug = votingResolveClassSlug(c?.className) || "unknown";
      const classColor = votingPlayerNameColor(c?.className);
      const mvpClasses = [
        isRoleMvpDps ? "is-role-mvp-dps" : "",
        isRoleMvpHeal ? "is-role-mvp-heal" : "",
        isRoleMvpTank ? "is-role-mvp-tank" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const mvpLabels = [
        isRoleMvpDps ? '<span class="voting-role-mvp-badge">DPS MVP</span>' : "",
        isRoleMvpHeal ? '<span class="voting-role-mvp-badge">Healer MVP</span>' : "",
        isRoleMvpTank ? '<span class="voting-role-mvp-badge">Tank MVP</span>' : "",
      ]
        .filter(Boolean)
        .join("");
      return {
        html: `
        <article class="voting-row ${selected ? "is-selected" : ""} ${mvpClasses}">
          <div class="voting-player">
            <strong class="voting-player-name voting-class--${classSlug}" style="color:${escapeHtmlAttr(classColor)}">${c.name || "Unknown"}</strong>
            <span class="subtle">${c.className || "Unknown class"}</span>
            ${mvpLabels ? `<div class="voting-role-mvp-badges">${mvpLabels}</div>` : ""}
          </div>
          <div class="voting-metric voting-metric--dps"><span class="subtle">DPS</span><strong class="voting-metric-value">${numberFmt(c.dps)}</strong></div>
          <div class="voting-metric voting-metric--hps"><span class="subtle">HPS</span><strong class="voting-metric-value">${numberFmt(c.hps)}</strong></div>
          <div class="voting-metric voting-metric--taken"><span class="subtle">Damage Taken</span><strong class="voting-metric-value">${numberFmt(c.damageTaken)}</strong></div>
          <div class="voting-metric"><span class="subtle">Peak Parse (raid)</span><strong class="voting-metric-value leaderboard-peak-parse ${peakParseClass}">${peakParseText}</strong></div>
          <div class="voting-metric"><span class="subtle">Votes</span><strong class="voting-metric-value">${numberFmt(c.votes)}</strong></div>
          <div class="voting-actions">
            <button class="event-signup-btn voting-btn" data-candidate="${encodeURIComponent(c.name || "")}" data-login-required="${
              canVote ? "0" : "1"
            }">
              ${canVote ? (selected ? "Your Vote" : "Vote") : "Login to Vote"}
            </button>
          </div>
        </article>
      `,
        mvpScore,
        selected,
        votes: Number(c?.votes || 0),
        name: String(c?.name || ""),
      };
    });
  rows.sort((a, b) => {
    if (b.mvpScore !== a.mvpScore) return b.mvpScore - a.mvpScore;
    if (b.selected !== a.selected) return Number(b.selected) - Number(a.selected);
    if (b.votes !== a.votes) return b.votes - a.votes;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  list.innerHTML = rows.map((row) => row.html).join("");
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
    return { playerHtml: `<div class="hof-fallback-name"><strong>${esc(nameRaw)}</strong></div>`, badgesHtml: "" };
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
    return { playerHtml: `<div class="hof-fallback-name"><strong>${esc(nameRaw)}</strong></div>`, badgesHtml: "" };
  }

  const displayName = plb.eventsRosterCharacterLabel(p);
  const className = plb.mergedClassDisplayLabel(p);
  const specLabel = plb.displaySpecNameForRoster(String(p.specName || "").trim());
  const color = plb.wowClassColor(className);
  const priestGlow =
    plb.effectiveRosterClassSlug(p) === "priest"
      ? "text-shadow:0 0 6px rgba(0,0,0,.85),0 1px 2px rgba(0,0,0,.9);"
      : "";
  const metaBits = [specLabel, className].map((x) => String(x || "").trim()).filter(Boolean);
  const baseBadges = plb.rosterBadgeRowHtml(p);
  const hasAnyBaseBadge = /<img\b/i.test(String(baseBadges || ""));
  const cacheKey = "20260506hofbadges1";
  const fallbackBadge = (pngFile, title, alt) => {
    const png = `/images/achievements/${pngFile}?v=${cacheKey}`;
    const svg = pngFile.toLowerCase().endsWith(".png")
      ? `/images/achievements/${pngFile.replace(/\.png$/i, ".svg")}?v=${cacheKey}`
      : png;
    return `<span class="raider-badge-slot raider-badge-slot--achievement-earned" title="${esc(title)}"><img class="raider-badge-achievement-img" src="${esc(svg)}" alt="${esc(alt)}" width="44" height="44" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${esc(
      png
    )}'" /></span>`;
  };
  const parse = Number(row?.peakParse || 0);
  const fallbackBadges = [
    fallbackBadge(
      "hall-of-fame.png",
      "MVP hall of fame — You won a raid MVP vote in a past round.",
      "MVP hall of fame"
    ),
    ...(parse >= 95
      ? [
          fallbackBadge(
            "parsing-ceiling.png",
            "Parsing ceiling — High parse performance in tracked raid history.",
            "Parsing ceiling"
          ),
        ]
      : []),
  ].join("");
  const badges = hasAnyBaseBadge ? baseBadges : fallbackBadges;
  const playerHtml = `
    <div class="leaderboard-player-row">
      <div class="leaderboard-player-cell">
        <div class="leaderboard-player-main">
          <span class="leaderboard-player-name" style="color:${esc(color)};${priestGlow}">${esc(displayName)}</span>
          ${
            metaBits.length
              ? `<span class="leaderboard-player-meta">${esc(metaBits.join(" · "))}</span>`
              : ""
          }
        </div>
      </div>
    </div>`;
  return {
    playerHtml,
    badgesHtml: `<div class="leaderboard-player-badges hof-mvp-badges-wrap"><div class="raider-badges hof-mvp-badges">${badges}</div></div>`,
  };
}

function hofWinnerSpecPortraitHtml(row) {
  const plb = window.plbEventsRoster;
  const esc = plb?.escapeHtml || escapeHtml;
  const p = row?.player;
  const fallback = "/images/achievements/hall-of-fame.png?v=20260506hofspec1";
  const classIconFallback = p?.className ? `/class-icons/${encodeURIComponent(String(p.className))}.jpg` : "";
  if (!plb || !p) {
    return `<img class="hof-winner-spec-portrait" src="${fallback}" alt="Winner spec portrait" width="118" height="118" loading="lazy" decoding="async" />`;
  }
  /* Same priority order as the leaderboard: profile picture wins, then
     spec/race portraits, then class crest. `rosterPortraitChain` puts
     the uploaded picture first when one is cached for this player. */
  let chain = [];
  if (typeof plb.rosterPortraitChain === "function") {
    chain = plb.rosterPortraitChain(p) || [];
  }
  if ((!Array.isArray(chain) || !chain.length) && typeof plb.specBadgePortraitChain === "function") {
    chain = plb.specBadgePortraitChain(p) || [];
  }
  const urls = (Array.isArray(chain) ? chain : []).map((u) => String(u || "").trim()).filter(Boolean);
  const src = esc(urls[0] || classIconFallback || fallback);
  const fb = urls
    .slice(1)
    .concat([classIconFallback, fallback].filter(Boolean))
    .map((u) => esc(String(u || "")))
    .filter(Boolean)
    .join("|");
  const label = plb.displaySpecNameForRoster ? plb.displaySpecNameForRoster(String(p.specName || "").trim()) : "Spec";
  return `<img class="hof-winner-spec-portrait" src="${src}" alt="${esc(label || "Winner spec portrait")}" width="118" height="118" loading="lazy" decoding="async" data-hof-winner-spec-fallbacks="${fb}" onerror="(function(el){var raw=el.getAttribute('data-hof-winner-spec-fallbacks');if(!raw){el.onerror=null;return;}var parts=raw.split('|').filter(Boolean);var i=Number(el.dataset.hofWinnerSpecI||0);if(i<parts.length){el.dataset.hofWinnerSpecI=String(i+1);el.src=parts[i];}else{el.onerror=null;}})(this)" />`;
}

function buildMockHallOfFamePreviewRows() {
  const now = Date.now();
  return [
    {
      winnerName: "Highbullet",
      bracket: "dps",
      raidName: "Sunwell Plateau",
      raidCode: "MOCK-SWP-HIGHBULLET",
      raidStartTime: now - 7 * 24 * 60 * 60 * 1000,
      peakParse: 97,
      winnerVotes: 41,
      player: {
        name: "Highbullet",
        characterName: "Highbullet",
        className: "Hunter",
        specName: "Marksmanship",
        roleName: "Ranged",
        wclEventCount: 127,
        pastRhEvents: 127,
        attendanceRate: 94,
        wclCharacters: ["Highbullet"],
      },
    },
    {
      winnerName: "Glutelf",
      bracket: "dps",
      raidName: "Black Temple",
      raidCode: "MOCK-BT-GLUTELF",
      raidStartTime: now - 14 * 24 * 60 * 60 * 1000,
      peakParse: 93,
      winnerVotes: 36,
      player: {
        name: "Glutelf",
        characterName: "Glutelf",
        className: "Mage",
        specName: "Arcane",
        roleName: "Ranged",
        wclEventCount: 98,
        pastRhEvents: 98,
        attendanceRate: 89,
        wclCharacters: ["Glutelf"],
      },
    },
  ];
}

function renderHallOfFame(payload) {
  const host = document.getElementById("votingHallOfFame");
  const apiRows = Array.isArray(payload?.hallOfFame) ? payload.hallOfFame : [];
  const rowsUnsorted = apiRows.length ? apiRows : buildMockHallOfFamePreviewRows();
  const rows = [...rowsUnsorted].sort((a, b) => Number(b?.raidStartTime || 0) - Number(a?.raidStartTime || 0));
  const isMock = apiRows.length === 0;
  const roleLabelForRow = (row) => {
    const bracket = String(row?.bracket || "").trim().toLowerCase();
    if (bracket === "heal" || bracket === "healer") return "HEALER";
    if (bracket === "tank") return "TANK";
    const roleName = String(row?.player?.roleName || "").trim().toLowerCase();
    if (roleName.includes("heal")) return "HEALER";
    if (roleName.includes("tank")) return "TANK";
    return "DPS";
  };
  const championSubtitleForRow = (row) => {
    const raidName = String(row?.raidName || row?.raidCode || "Recent Raid").trim();
    const when = row?.raidStartTime ? new Date(row.raidStartTime).toLocaleDateString() : "Unknown date";
    return `Champion of ${raidName} on ${when}`;
  };
  const quoteForRow = (row) => {
    const custom = String(row?.customQuote || "").trim();
    if (custom) return custom;
    const role = roleLabelForRow(row);
    if (role === "TANK") return '"Frontline unbroken."';
    if (role === "HEALER") return '"Hold the raid together."';
    return '"Push for every percent."';
  };
  const roleIconForRow = (row) => {
    const role = roleLabelForRow(row);
    if (role === "TANK") return "🛡";
    if (role === "HEALER") return "❤";
    return "⚔";
  };
  const attendancePct = (row) => {
    const v = Number(row?.player?.attendanceRate);
    return Number.isFinite(v) && v >= 0 ? `${Math.round(v)}%` : "—";
  };
  const highestPeakPct = (row) => {
    const v = Number(row?.peakParse);
    return Number.isFinite(v) && v >= 0 ? `${Math.round(v)}%` : "—";
  };
  const totalRaids = (row) => {
    /* Prefer the WCL-confirmed Events count (raid_appearances scoped to
       admin-curated reports). Fall back to legacy Raid Helper signups, then
       to last-window WCL attendance for very old cached payloads. */
    const v = Number(
      row?.player?.wclEventCount ||
        row?.player?.pastRhEvents ||
        row?.player?.raidsAttended ||
        0,
    );
    return Number.isFinite(v) && v > 0 ? numberFmt(v) : "—";
  };
  host.innerHTML = rows
    .map((row, idx) => {
      const playerCell = hofRaiderCell(row);
      const role = roleLabelForRow(row);
      const subtitle = championSubtitleForRow(row);
      const quote = quoteForRow(row);
      const roleCls = role === "TANK" ? "hof-role-tank" : role === "HEALER" ? "hof-role-heal" : "hof-role-dps";
      const rowDirCls = idx % 2 === 1 ? "hof-cine-row--reverse" : "";
      /* Odd ranks (1,3,…) vs even ranks (2,4,…) — alternating card glow / tint */
      const parityCls = idx % 2 === 0 ? "hof-champion-card--parity-a" : "hof-champion-card--parity-b";
      const roleIcon = roleIconForRow(row);
      const specPortrait = hofWinnerSpecPortraitHtml(row);
      return `
        <article class="hof-champion-card ${parityCls} ${roleCls}" data-hof-winner="${escapeHtml(row?.winnerName || "")}">
          <div class="hof-cine-row ${rowDirCls}">
            <div class="hof-champion-main">
              <div class="hof-champion-topline">
                <div class="hof-role-pill-wrap">
                  <span class="hof-role-emblem">${roleIcon}</span>
                  <span class="hof-role-chip tw-plb-chip">${escapeHtml(role)}</span>
                </div>
              </div>
              <div class="hof-winner-spec-wrap">${specPortrait}</div>
              <div class="hof-champion-player">${playerCell.playerHtml}</div>
              <div class="hof-champion-copy">
                <p class="hof-champion-subtle">${escapeHtml(subtitle)}</p>
                <p class="hof-champion-quote">${escapeHtml(quote)}</p>
              </div>
              ${playerCell.badgesHtml}
            </div>
            <aside class="hof-chronicle-pane">
              <div class="hof-chronicle-title">᛫ Chronicle ᛫</div>
              <div class="hof-chronicle-grid">
                <div class="hof-chronicle-kpi"><span class="subtle" title="Number of Warcraft Logs reports for our guild that the admin has marked as official events.">Total raids</span><strong>${escapeHtml(totalRaids(row))}</strong></div>
                <div class="hof-chronicle-kpi"><span class="subtle">Attendance</span><strong>${escapeHtml(attendancePct(row))}</strong></div>
                <div class="hof-chronicle-kpi"><span class="subtle">Highest peak (all raids)</span><strong>${escapeHtml(highestPeakPct(row))}</strong></div>
              </div>
            </aside>
          </div>
        </article>
      `;
    })
    .join("");
  if (isMock) {
    host.insertAdjacentHTML(
      "afterbegin",
      `<div class="hof-empty-roll" style="margin-bottom:10px">Preview mode: showing mock winners (Highbullet, Glutelf) because no archived MVP rounds are available yet.</div>`
    );
  }
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
    });
    // Pull profile-picture overrides for the embedded `row.player` records
    // (each has the canonical `discordUserId`) so portraits show the avatar
    // instead of the class crest.
    const plb = window.plbEventsRoster;
    if (plb && typeof plb.prefetchRosterProfilePictures === "function") {
      const players = (Array.isArray(payload?.hallOfFame) ? payload.hallOfFame : [])
        .map((row) => row?.player)
        .filter(Boolean);
      try {
        await plb.prefetchRosterProfilePictures(players);
      } catch {
        /* best-effort */
      }
    }
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
  const headerEl = document.getElementById("votingRaidHeader");
  list.hidden = true;
  list.innerHTML = "";
  headerEl.hidden = true;
  headerEl.innerHTML = "";

  const res = await fetch("/api/voting/current", { credentials: "include" });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.ok) {
    statusEl.hidden = false;
    statusEl.textContent = payload?.error || "Failed to load current voting round.";
    metaEl.textContent = "";
    return;
  }

  const canVote = Boolean(payload?.authenticated);
  if (!canVote) {
    statusEl.textContent = "";
    statusEl.hidden = true;
  } else {
    statusEl.hidden = false;
    statusEl.textContent = payload?.myVote
      ? `You voted for ${payload.myVote}. You can change your vote anytime.`
      : "Choose one MVP from the latest raid.";
  }
  metaEl.textContent = `${payload?.raid?.name || "Raid"} · ${new Date(payload?.raid?.startTime || Date.now()).toLocaleString()}`;
  renderRaidHeader(payload);
  renderCandidates(payload, canVote);
  void preloadVotingPlbData();
}

document.addEventListener("click", async (event) => {
  const btn = event.target.closest(".voting-btn");
  if (!btn) return;
  const loginRequired = String(btn.getAttribute("data-login-required") || "0") === "1";
  if (loginRequired) {
    const next = encodeURIComponent(window.location.pathname || "/voting.html");
    window.location.href = `/auth/discord/login?next=${next}`;
    return;
  }
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

scheduleNonCritical(initBackgroundStars, 900);
scheduleNonCritical(loadHallOfFame, 1400);
loadVotingRound();
