(() => {
  const ASSET_BASE = "/images/wow-forever/tavern";
  const ASSET_V = "20260914plb-tavern-v11";
  const TZ = "Europe/Berlin";

  const TIME_THEMES = {
    night: {
      label: "Late night · empty halls",
      empty: "The tavern sleeps. Only embers keep watch.",
    },
    morning: {
      label: "Morning light · For the Alliance",
      empty: "Shutters open. The first stool is yours.",
    },
    midday: {
      label: "Midday · bright tables",
      empty: "Sun on the boards — the tavern waits for company.",
    },
    evening: {
      label: "Evening · tankards out",
      empty: "The first round is poured. Who sits down first?",
    },
  };

  const RACES = ["human", "dwarf", "nightelf", "gnome", "skyborne", "orc", "undead", "tauren", "troll"];
  const GENDERS = ["male", "female"];
  const CLASSES = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];

  // Per-spec gear overlays (lore-accurate weapons/armor). Fallback: gear/{class}.webp
  const SPEC_GEAR = {
    "warrior:protection": "gear/warrior-protection.webp",
    "warrior:arms": "gear/warrior-arms.webp",
    "warrior:fury": "gear/warrior-fury.webp",
    "paladin:protection": "gear/paladin-protection.webp",
    "paladin:retribution": "gear/paladin-retribution.webp",
    "paladin:holy": "gear/paladin-holy.webp",
    "hunter:beast-mastery": "gear/hunter-beast-mastery.webp",
    "hunter:marksmanship": "gear/hunter-marksmanship.webp",
    "hunter:survival": "gear/hunter-survival.webp",
    "rogue:assassination": "gear/rogue-assassination.webp",
    "rogue:combat": "gear/rogue-combat.webp",
    "rogue:subtlety": "gear/rogue-subtlety.webp",
    "priest:shadow": "gear/priest-shadow.webp",
    "priest:holy": "gear/priest-holy.webp",
    "priest:discipline": "gear/priest-discipline.webp",
    "shaman:elemental": "gear/shaman-elemental.webp",
    "shaman:enhancement": "gear/shaman-enhancement.webp",
    "shaman:restoration": "gear/shaman-restoration.webp",
    "mage:arcane": "gear/mage-arcane.webp",
    "mage:fire": "gear/mage-fire.webp",
    "mage:frost": "gear/mage-frost.webp",
    "warlock:affliction": "gear/warlock-affliction.webp",
    "warlock:demonology": "gear/warlock-demonology.webp",
    "warlock:destruction": "gear/warlock-destruction.webp",
    "druid:balance": "gear/druid-balance.webp",
    "druid:restoration": "gear/druid-restoration.webp",
    "druid:feral-bear": "gear/druid-feral-bear.webp",
    "druid:feral-cat": "gear/druid-feral-cat.webp",
  };

  // Druid animal forms replace the race body with a full creature silhouette.
  const FORM_SPECS = new Set(["feral-bear", "feral-cat"]);

  const DEFAULT_SPEC_BY_CLASS_ROLE = {
    "warrior:tank": "protection",
    "warrior:dps": "arms",
    "paladin:tank": "protection",
    "paladin:dps": "retribution",
    "paladin:heal": "holy",
    "hunter:dps": "marksmanship",
    "rogue:dps": "combat",
    "priest:dps": "shadow",
    "priest:heal": "holy",
    "shaman:dps": "elemental",
    "shaman:heal": "restoration",
    "mage:dps": "frost",
    "warlock:dps": "affliction",
    "druid:tank": "feral-bear",
    "druid:dps": "balance",
    "druid:heal": "restoration",
  };
  const HEIGHT = {
    gnome: 0.5,
    dwarf: 0.64,
    human: 0.8,
    orc: 0.82,
    undead: 0.78,
    nightelf: 0.9,
    skyborne: 0.88,
    troll: 0.94,
    tauren: 1,
  };

  const CLASS_COLORS = {
    warrior: "#C79C6E",
    paladin: "#F58CBA",
    hunter: "#ABD473",
    rogue: "#FFF569",
    priest: "#FFFFFF",
    shaman: "#0070DD",
    mage: "#69CCF0",
    warlock: "#9482C9",
    druid: "#FF7D0A",
  };

  const SPRITES = {};
  for (const race of RACES) {
    for (const gender of GENDERS) {
      for (const classId of CLASSES) {
        SPRITES[`${race}:${gender}:${classId}`] = {
          body: `bodies/${race}-${gender}.webp`,
          gear: `gear/${classId}.webp`,
          height: HEIGHT[race] || 0.8,
        };
      }
    }
  }

  // Priority order: front table first, then walls — positions chosen to stay apart.
  const SPACED_SEATS = [
    { x: 50, y: 96, scale: 1.18 },
    { x: 26, y: 94, scale: 1.14 },
    { x: 74, y: 94, scale: 1.14 },
    { x: 12, y: 86, scale: 1.04 },
    { x: 88, y: 86, scale: 1.04 },
    { x: 38, y: 78, scale: 0.96 },
    { x: 62, y: 78, scale: 0.96 },
    { x: 8, y: 68, scale: 0.88 },
    { x: 92, y: 68, scale: 0.88 },
    { x: 22, y: 58, scale: 0.8 },
    { x: 78, y: 58, scale: 0.8 },
    { x: 50, y: 52, scale: 0.74 },
    { x: 16, y: 44, scale: 0.68 },
    { x: 84, y: 44, scale: 0.68 },
    { x: 34, y: 36, scale: 0.62 },
    { x: 66, y: 36, scale: 0.62 },
    { x: 50, y: 28, scale: 0.56 },
    { x: 10, y: 32, scale: 0.58 },
    { x: 90, y: 32, scale: 0.58 },
    { x: 24, y: 24, scale: 0.52 },
    { x: 76, y: 24, scale: 0.52 },
  ];

  function crowdLevel(count) {
    if (count > 36) return "packed";
    if (count > 20) return "busy";
    return "open";
  }

  function crowdScale(count) {
    return Math.max(0.5, 1 - Math.max(0, count - 12) * 0.012);
  }

  function onTabletop(x, y) {
    const dx = (x - 50) / 26;
    const dy = (y - 66) / 15;
    return dx * dx + dy * dy < 1 && y < 90 && y > 50;
  }

  function nearTableSeat(x, y) {
    return SPACED_SEATS.some((seat) => Math.abs(seat.x - x) < 6 && Math.abs(seat.y - y) < 7);
  }

  function figWidthPct(race, scale, crowd) {
    const heightPct = 36 * (HEIGHT[race] || 0.8) * scale * crowd;
    return heightPct * 0.52;
  }

  function seatKey(seat) {
    return `${seat.x}:${seat.y}`;
  }

  function seatsTooClose(seatA, seatB, raceA, raceB, scaleA, scaleB, crowd, tightness) {
    const wA = figWidthPct(raceA, scaleA, crowd);
    const wB = figWidthPct(raceB, scaleB, crowd);
    const minDx = (wA + wB) * tightness;
    const minDy = Math.max(8, Math.min(wA, wB) * 0.55);
    return Math.abs(seatA.x - seatB.x) < minDx && Math.abs(seatA.y - seatB.y) < minDy;
  }

  function assignSpacedSeats(picks, level, crowd) {
    const tightness = level === "packed" ? 0.38 : level === "busy" ? 0.46 : 0.62;
    const pool =
      level === "open"
        ? SPACED_SEATS
        : SPACED_SEATS.concat(overflowSeats(Math.max(0, picks.length - SPACED_SEATS.length), level));
    const placed = [];
    const used = new Set();
    const seats = [];
    for (const pick of picks) {
      let chosen = null;
      for (const candidate of pool) {
        if (onTabletop(candidate.x, candidate.y) || used.has(seatKey(candidate))) continue;
        const clash = placed.some((entry) =>
          seatsTooClose(candidate, entry.seat, pick.race, entry.pick.race, candidate.scale, entry.seat.scale, crowd, tightness)
        );
        if (!clash) {
          chosen = candidate;
          break;
        }
      }
      if (!chosen) {
        chosen =
          pool.find((candidate) => !onTabletop(candidate.x, candidate.y) && !used.has(seatKey(candidate))) ||
          pool.find((candidate) => !used.has(seatKey(candidate))) ||
          pool[0];
      }
      used.add(seatKey(chosen));
      placed.push({ pick, seat: chosen });
      seats.push(chosen);
    }
    return seats;
  }

  function overflowSeats(needed, level) {
    const rowGap = level === "packed" ? 6.1 : level === "busy" ? 7.2 : 8.6;
    const colGap = level === "packed" ? 5.1 : level === "busy" ? 6.2 : 7.6;
    const out = [];
    let row = 0;
    for (let y = 88; y >= 18 && out.length < needed; y -= rowGap) {
      const stagger = row % 2 ? colGap * 0.46 : 0;
      const scale = 0.46 + (y / 100) * 0.62;
      for (let x = 5 + stagger; x <= 97 && out.length < needed; x += colGap) {
        if (onTabletop(x, y) || nearTableSeat(x, y)) continue;
        out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, scale });
      }
      row += 1;
    }
    let extra = 0;
    while (out.length < needed && extra < 180) {
      const i = out.length;
      const x = 5 + ((i * 5.3) % 90);
      const y = 20 + (Math.floor(i / 16) % 5) * 5.5;
      if (!onTabletop(x, y)) out.push({ x, y, scale: 0.42 });
      extra += 1;
    }
    return out;
  }

  function seatsForPicks(picks, level, crowd) {
    return assignSpacedSeats(picks, level, crowd);
  }

  const el = {
    root: document.getElementById("wfTavern"),
    stage: document.getElementById("wfTavernStage"),
    empty: document.getElementById("wfTavernEmpty"),
    tip: document.getElementById("wfTavernTip"),
    wordmarkSub: document.getElementById("wfTavernWordmarkSub"),
  };

  let lastKey = "";
  let openUid = "";
  let lastPicks = [];
  let ownUserId = "";
  let lastPeriod = "";

  function berlinHour(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "numeric",
      hour12: false,
    }).formatToParts(date);
    return Number(parts.find((p) => p.type === "hour")?.value || 0);
  }

  function timePeriod(date = new Date()) {
    const hour = berlinHour(date);
    if (hour >= 23 || hour < 7) return "night";
    if (hour < 11) return "morning";
    if (hour < 17) return "midday";
    return "evening";
  }

  function applyTimeTheme(force) {
    if (!el.root) return;
    const period = timePeriod();
    if (!force && period === lastPeriod) return;
    lastPeriod = period;
    el.root.dataset.time = period;
    const theme = TIME_THEMES[period] || TIME_THEMES.evening;
    if (el.wordmarkSub) el.wordmarkSub.textContent = theme.label;
    if (el.empty && !lastPicks.length) el.empty.textContent = theme.empty;
  }

  function assetUrl(rel) {
    return `${ASSET_BASE}/${rel}?v=${ASSET_V}`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function resolveSpecId(classId, role, specId) {
    const c = String(classId || "").toLowerCase();
    const r = String(role || "").toLowerCase();
    const s = String(specId || "").toLowerCase();
    if (s && SPEC_GEAR[`${c}:${s}`]) return s;
    return DEFAULT_SPEC_BY_CLASS_ROLE[`${c}:${r}`] || "";
  }

  function spriteFor(race, gender, classId, role, specId) {
    const r = String(race || "human").toLowerCase();
    const g = gender === "female" ? "female" : "male";
    const c = String(classId || "warrior").toLowerCase();
    const spec = resolveSpecId(c, role, specId);
    const base =
      SPRITES[`${r}:${g}:${c}`] || {
        body: `bodies/${RACES.includes(r) ? r : "human"}-${g}.webp`,
        gear: CLASSES.includes(c) ? `gear/${c}.webp` : "gear/warrior.webp",
        height: HEIGHT[r] || 0.8,
      };
    if (FORM_SPECS.has(spec) && SPEC_GEAR[`${c}:${spec}`]) {
      return {
        body: SPEC_GEAR[`${c}:${spec}`],
        gear: "",
        height: spec === "feral-bear" ? Math.max(base.height, 0.92) : Math.min(base.height, 0.78),
        isForm: true,
        spec,
      };
    }
    return {
      ...base,
      gear: SPEC_GEAR[`${c}:${spec}`] || base.gear,
      isForm: false,
      spec,
    };
  }

  function sortPicks(picks) {
    return [...picks].sort((a, b) => {
      const t = (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0);
      if (t) return t;
      return String(a.userId || "").localeCompare(String(b.userId || ""));
    });
  }

  function signature(picks, uid) {
    return `${uid || ""}::${picks
      .map(
        (p) =>
          `${p.userId}:${p.race}:${p.gender}:${p.classId}:${p.characterName || ""}:${p.role || ""}:${p.specId || ""}:${p.updatedAt || ""}`
      )
      .join("|")}`;
  }

  function displayName(pick) {
    return String(pick.characterName || pick.raceName || pick.displayName || "Raider").trim() || "Raider";
  }

  function shortName(name, level) {
    if (level === "open") return name;
    const first = name.split(/\s+/)[0] || name;
    if (level === "packed") return first;
    return name.length > 14 ? first : name;
  }

  function roleSpecLabel(pick) {
    const roleName = String(pick.roleName || pick.role || "").trim();
    const specName = String(pick.specShortName || pick.specName || "").trim();
    if (roleName && specName && specName.toLowerCase() !== roleName.toLowerCase()) {
      return `${roleName} · ${specName}`;
    }
    return roleName || specName;
  }

  function closeTip() {
    openUid = "";
    if (!el.tip) return;
    el.tip.hidden = true;
    el.tip.innerHTML = "";
  }

  function positionTip(fig) {
    if (!el.tip || !el.root || !fig) return;
    const rootBox = el.root.getBoundingClientRect();
    const figBox = fig.getBoundingClientRect();
    const tipBox = el.tip.getBoundingClientRect();
    let left = figBox.left - rootBox.left + figBox.width / 2 - tipBox.width / 2;
    let top = figBox.top - rootBox.top - tipBox.height - 8;
    left = Math.max(8, Math.min(left, rootBox.width - tipBox.width - 8));
    if (top < 8) top = figBox.bottom - rootBox.top + 8;
    el.tip.style.left = `${Math.round(left)}px`;
    el.tip.style.top = `${Math.round(top)}px`;
  }

  function showTip(pick, fig) {
    if (!el.tip) return;
    const name = displayName(pick);
    const faction = String(pick.faction || "").toUpperCase();
    const raceName = pick.raceName || pick.race || "";
    const className = pick.className || pick.classId || "";
    const classId = pick.classId || "";
    const spec = roleSpecLabel(pick);
    const main = String(pick.mainCharacterName || "").trim();
    const mine = String(pick.userId || "") === ownUserId && ownUserId;
    openUid = String(pick.userId || "");
    el.tip.hidden = false;
    el.tip.innerHTML = `<strong class="wf-class-${escapeHtml(classId)}" id="wfTavernTipName">${escapeHtml(name)}</strong>
      <small>
        <span class="wf-faction-${escapeHtml(pick.faction || "")}">${escapeHtml(faction)}</span>
        · <span class="wf-race-${escapeHtml(pick.race || "")}">${escapeHtml(raceName)}</span>
        <span class="wf-class-${escapeHtml(classId)}">${escapeHtml(className)}</span>
        ${spec ? ` · ${escapeHtml(spec)}` : ""}
      </small>
      ${main ? `<small>Current main: ${escapeHtml(main)}</small>` : ""}
      ${mine ? `<button type="button" class="wf-tavern-tip-change" data-change="1">Change your character</button>` : ""}`;
    positionTip(fig);
  }

  function render(picks, options) {
    if (!el.stage) return;
    ownUserId = String(options?.ownUserId || "").trim();
    const list = Array.isArray(picks) ? picks : [];
    applyTimeTheme();
    const key = signature(list, ownUserId);
    if (key === lastKey) return;
    lastKey = key;
    lastPicks = list;

    if (el.empty) {
      el.empty.hidden = list.length > 0;
      if (!list.length) {
        const theme = TIME_THEMES[lastPeriod] || TIME_THEMES.evening;
        el.empty.textContent = theme.empty;
      }
    }
    if (!list.length) {
      if (el.root) delete el.root.dataset.crowd;
      el.stage.innerHTML = "";
      closeTip();
      return;
    }

    const ordered = sortPicks(list);
    const crowd = crowdScale(ordered.length);
    const level = crowdLevel(ordered.length);
    const seats = seatsForPicks(ordered, level, crowd);
    if (el.root) el.root.dataset.crowd = level;
    const keepOpen = openUid;
    const frag = document.createDocumentFragment();
    ordered.forEach((pick, index) => {
      const base = seats[index] || seats[seats.length - 1];
      const x = Math.min(96, Math.max(4, base.x));
      const y = Math.min(97, Math.max(18, base.y));
      const sprite = spriteFor(pick.race, pick.gender, pick.classId, pick.role, pick.specId);
      const figH = sprite.height * base.scale * crowd;
      const name = displayName(pick);
      const mine = ownUserId && String(pick.userId || "") === ownUserId;
      const faction = pick.faction === "horde" ? "horde" : pick.faction === "alliance" ? "alliance" : "";
      const label = `${name}, ${pick.raceName || pick.race || ""} ${pick.className || pick.classId || ""}${
        pick.specName || pick.specShortName ? ` ${pick.specShortName || pick.specName}` : ""
      }`.trim();
      const classId = String(pick.classId || "").toLowerCase();
      const role = String(pick.role || "").toLowerCase();
      const fig = document.createElement("button");
      fig.type = "button";
      fig.className = `wf-tavern-fig${mine ? " is-mine" : ""}${faction ? ` is-${faction}` : ""}${
        sprite.isForm ? " is-form" : ""
      }`;
      fig.setAttribute("role", "listitem");
      fig.dataset.uid = String(pick.userId || "");
      if (classId) fig.dataset.class = classId;
      if (role) fig.dataset.role = role;
      if (sprite.spec) fig.dataset.spec = sprite.spec;
      fig.setAttribute("aria-label", label);
      fig.style.left = `${x}%`;
      fig.style.bottom = `${Math.max(3, 100 - y)}%`;
      fig.style.height = `${(36 * figH).toFixed(2)}%`;
      fig.style.zIndex = String(Math.round(y * 10) + (mine ? 8 : 0));
      const idle = document.createElement("span");
      idle.className = "wf-tavern-fig-idle";
      idle.style.animationDelay = `${(index % 9) * 0.18}s`;
      const nameEl = document.createElement("span");
      nameEl.className = "wf-tavern-name";
      nameEl.textContent = shortName(name, level);
      const spriteEl = document.createElement("span");
      spriteEl.className = "wf-tavern-sprite";
      const body = document.createElement("img");
      body.className = "wf-tavern-body";
      body.src = assetUrl(sprite.body);
      body.alt = "";
      body.width = 180;
      body.height = 240;
      body.decoding = "async";
      spriteEl.append(body);
      if (sprite.gear) {
        const gear = document.createElement("img");
        gear.className = "wf-tavern-gear";
        gear.src = assetUrl(sprite.gear);
        gear.alt = "";
        gear.width = 180;
        gear.height = 240;
        gear.decoding = "async";
        spriteEl.append(gear);
      }
      idle.append(nameEl, spriteEl);
      fig.append(idle);
      frag.append(fig);
    });
    el.stage.replaceChildren(frag);

    if (keepOpen) {
      const still = lastPicks.find((p) => String(p.userId || "") === keepOpen);
      const fig = el.stage.querySelector(`[data-uid="${CSS.escape(keepOpen)}"]`);
      if (still && fig) showTip(still, fig);
      else closeTip();
    }
  }

  function pickByUid(uid) {
    return lastPicks.find((p) => String(p.userId || "") === String(uid || "")) || null;
  }

  el.stage?.addEventListener("click", (event) => {
    const fig = event.target.closest(".wf-tavern-fig");
    if (!fig) return;
    const uid = fig.getAttribute("data-uid") || "";
    if (openUid && openUid === uid) {
      closeTip();
      return;
    }
    const pick = pickByUid(uid);
    if (pick) showTip(pick, fig);
  });

  el.tip?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-change='1']")) return;
    closeTip();
    document.dispatchEvent(new CustomEvent("wf-tavern-change"));
  });

  document.addEventListener("click", (event) => {
    if (!openUid || !el.root) return;
    if (el.root.contains(event.target)) {
      if (event.target.closest(".wf-tavern-fig") || event.target.closest(".wf-tavern-tip")) return;
    }
    closeTip();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTip();
  });

  applyTimeTheme(true);
  setInterval(() => applyTimeTheme(), 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") applyTimeTheme(true);
  });

  window.WowForeverTavern = {
    render,
    sprites: SPRITES,
    timePeriod,
  };
})();
