(() => {
  const ASSET_BASE = "/images/wow-forever/tavern";
  const ASSET_V = "20260914plb-tavern-v1";

  const RACES = ["human", "dwarf", "nightelf", "gnome", "skyborne", "orc", "undead", "tauren", "troll"];
  const GENDERS = ["male", "female"];
  const CLASSES = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];

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

  const TABLE_SEATS = [
    { x: 32, y: 96, scale: 1.18 },
    { x: 50, y: 98, scale: 1.22 },
    { x: 68, y: 96, scale: 1.18 },
    { x: 18, y: 92, scale: 1.08 },
    { x: 82, y: 92, scale: 1.08 },
    { x: 8, y: 86, scale: 1.0 },
    { x: 92, y: 86, scale: 1.0 },
    { x: 12, y: 76, scale: 0.92 },
    { x: 88, y: 76, scale: 0.92 },
    { x: 6, y: 66, scale: 0.84 },
    { x: 94, y: 66, scale: 0.84 },
    { x: 26, y: 88, scale: 1.02 },
    { x: 74, y: 88, scale: 1.02 },
    { x: 40, y: 94, scale: 1.12 },
    { x: 60, y: 94, scale: 1.12 },
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
    return TABLE_SEATS.some((seat) => Math.abs(seat.x - x) < 6 && Math.abs(seat.y - y) < 7);
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

  function seatsForCount(count) {
    const level = crowdLevel(count);
    if (count <= TABLE_SEATS.length) return TABLE_SEATS.slice(0, count);
    return TABLE_SEATS.concat(overflowSeats(count - TABLE_SEATS.length, level));
  }

  const el = {
    root: document.getElementById("wfTavern"),
    stage: document.getElementById("wfTavernStage"),
    empty: document.getElementById("wfTavernEmpty"),
    tip: document.getElementById("wfTavernTip"),
  };

  let lastKey = "";
  let openUid = "";
  let lastPicks = [];
  let ownUserId = "";

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

  function spriteFor(race, gender, classId) {
    const r = String(race || "human").toLowerCase();
    const g = gender === "female" ? "female" : "male";
    const c = String(classId || "warrior").toLowerCase();
    return (
      SPRITES[`${r}:${g}:${c}`] || {
        body: `bodies/${RACES.includes(r) ? r : "human"}-${g}.webp`,
        gear: CLASSES.includes(c) ? `gear/${c}.webp` : "gear/warrior.webp",
        height: HEIGHT[r] || 0.8,
      }
    );
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
    const key = signature(list, ownUserId);
    if (key === lastKey) return;
    lastKey = key;
    lastPicks = list;

    if (el.empty) el.empty.hidden = list.length > 0;
    if (!list.length) {
      if (el.root) delete el.root.dataset.crowd;
      el.stage.innerHTML = "";
      closeTip();
      return;
    }

    const ordered = sortPicks(list);
    const crowd = crowdScale(ordered.length);
    const level = crowdLevel(ordered.length);
    const seats = seatsForCount(ordered.length);
    if (el.root) el.root.dataset.crowd = level;
    const keepOpen = openUid;
    const frag = document.createDocumentFragment();
    ordered.forEach((pick, index) => {
      const base = seats[index] || seats[seats.length - 1];
      const x = Math.min(96, Math.max(4, base.x));
      const y = Math.min(97, Math.max(18, base.y));
      const sprite = spriteFor(pick.race, pick.gender, pick.classId);
      const figH = sprite.height * base.scale * crowd;
      const name = displayName(pick);
      const mine = ownUserId && String(pick.userId || "") === ownUserId;
      const faction = pick.faction === "horde" ? "horde" : pick.faction === "alliance" ? "alliance" : "";
      const label = `${name}, ${pick.raceName || pick.race || ""} ${pick.className || pick.classId || ""}`.trim();
      const fig = document.createElement("button");
      fig.type = "button";
      fig.className = `wf-tavern-fig${mine ? " is-mine" : ""}${faction ? ` is-${faction}` : ""}`;
      fig.setAttribute("role", "listitem");
      fig.dataset.uid = String(pick.userId || "");
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
      const gear = document.createElement("img");
      gear.className = "wf-tavern-gear";
      gear.src = assetUrl(sprite.gear);
      gear.alt = "";
      gear.width = 80;
      gear.height = 80;
      gear.decoding = "async";
      spriteEl.append(body, gear);
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

  window.WowForeverTavern = {
    render,
    sprites: SPRITES,
  };
})();
