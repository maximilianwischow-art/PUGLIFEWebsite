(() => {
  const ZAM = "https://wow.zamimg.com/images/wow/icons/large";
  const WORN_ASSET_V = "20260914plb-tavern-v20";
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

  const state = {
    catalog: null,
    pick: null,
    squad: [],
    rosterSlots: Array.from({ length: 20 }, () => ""),
    rosterUpdatedAt: 0,
    selectedRosterUid: "",
    rosterSaving: false,
    faction: "alliance",
    race: "",
    gender: "male",
    classId: "",
    role: "",
    specId: "",
    saving: false,
    editing: true,
  };

  const el = {
    faction: null,
    races: document.getElementById("wfRaces"),
    gender: document.getElementById("wfGender"),
    classes: document.getElementById("wfClasses"),
    roleWrap: document.getElementById("wfRoleWrap"),
    roles: document.getElementById("wfRoles"),
    specMenu: document.getElementById("wfSpecMenu"),
    specLabel: document.getElementById("wfSpecLabel"),
    specs: document.getElementById("wfSpecs"),
    nameStepNum: document.getElementById("wfNameStepNum"),
    name: document.getElementById("wfName"),
    familyName: document.getElementById("wfFamilyName"),
    save: document.getElementById("wfSave"),
    cancel: document.getElementById("wfCancel"),
    clear: document.getElementById("wfClear"),
    status: document.getElementById("wfStatus"),
    preview: document.getElementById("wfPreview"),
    creator: document.getElementById("wfCreator"),
    heading: document.getElementById("wf-create-heading"),
    lede: document.getElementById("wfCreateLede"),
    locked: document.getElementById("wfLocked"),
    editor: document.getElementById("wfEditor"),
    squad: document.getElementById("wfSquad"),
    squadMeta: document.getElementById("wfSquadMeta"),
    roster: document.getElementById("wfRoster"),
    rosterBench: document.getElementById("wfRosterBench"),
    rosterMeta: document.getElementById("wfRosterMeta"),
    rosterStatus: document.getElementById("wfRosterStatus"),
    rosterClear: document.getElementById("wfRosterClear"),
    matrix: document.getElementById("wfMatrix"),
    sources: document.getElementById("wfSources"),
    notes: document.getElementById("wfNotes"),
    countdown: document.getElementById("wfCountdown"),
    countdownLabel: document.getElementById("wfCountdownLabel"),
    countdownUnits: document.getElementById("wfCountdownUnits"),
  };

  const countdown = {
    beta: "2026-09-17",
    launch: "2026-11-04",
    timer: null,
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function raceById(id) {
    return (state.catalog?.races || []).find((r) => r.id === id) || null;
  }

  function classById(id) {
    return (state.catalog?.classes || []).find((c) => c.id === id) || null;
  }

  function classesFor(raceId, faction) {
    const race = raceById(raceId);
    if (!race) return [];
    const key = race.faction === "both" ? `${race.id}:${faction}` : race.id;
    return [...(state.catalog?.classesByRace?.[key] || [])];
  }

  function isNewCombo(raceId, classId) {
    const race = raceById(raceId);
    if (!race) return false;
    if (race.isNewRace) return true;
    const vanilla = state.catalog?.vanillaClassesByRace?.[raceId] || [];
    return !vanilla.includes(classId);
  }

  function portraitUrl(race, gender) {
    if (!race) return "";
    const g = gender === "female" ? "female" : "male";
    if (race.portraitKey === "skyborne" || race.id === "skyborne") {
      return `${ZAM}/achievement_character_nightelf_${g}.jpg`;
    }
    const key = race.id === "undead" || race.portraitKey === "scourge" ? "undead" : race.id;
    return `${ZAM}/achievement_character_${key}_${g}.jpg`;
  }

  function resolveWornSpecId(classId, role, specId) {
    const c = String(classId || "").toLowerCase();
    const r = String(role || "").toLowerCase();
    const s = String(specId || "").toLowerCase();
    if (s) {
      const specs = specsForRole(c, r);
      if (!specs.length || specs.some((spec) => spec.id === s)) return s;
    }
    const fromRole = specsForRole(c, r);
    if (fromRole.length === 1) return fromRole[0].id;
    return DEFAULT_SPEC_BY_CLASS_ROLE[`${c}:${r}`] || fromRole[0]?.id || "";
  }

  function wornSpriteUrl({ raceId, gender, classId, role, specId }) {
    const r = String(raceId || "").toLowerCase();
    const g = gender === "female" ? "female" : "male";
    const c = String(classId || "").toLowerCase();
    const spec = resolveWornSpecId(c, role, specId);
    if (!r || !c || !spec) return "";
    if (FORM_SPECS.has(spec)) {
      return `/images/wow-forever/tavern/gear/druid-${spec}.webp?v=${WORN_ASSET_V}`;
    }
    return `/images/wow-forever/tavern/worn/${r}-${g}-${c}-${spec}.webp?v=${WORN_ASSET_V}`;
  }

  /** Class/spec-aware portrait for cards; falls back to race icon if worn asset 404s. */
  function characterPortraitHtml(race, gender, { classId, role, specId } = {}, size = 96) {
    const fallback = portraitUrl(race, gender);
    const worn = wornSpriteUrl({
      raceId: race?.id || race,
      gender,
      classId,
      role,
      specId,
    });
    const cls = `${portraitClass(race).trim()}`.trim();
    if (!worn) {
      return `<img class="${escapeHtml(cls)}" src="${escapeHtml(fallback)}" alt="" width="${size}" height="${size}" />`;
    }
    const classes = ["wf-worn-bust", cls].filter(Boolean).join(" ");
    return `<img class="${escapeHtml(classes)}" src="${escapeHtml(worn)}" alt="" width="${size}" height="${size}" data-fallback="${escapeHtml(fallback)}" onerror="this.onerror=null;this.src=this.dataset.fallback;this.classList.remove('wf-worn-bust')" />`;
  }

  function portraitClass(race) {
    if (race && (race.portraitKey === "skyborne" || race.id === "skyborne")) return " wf-portrait--skyborne";
    return "";
  }

  function classIconUrl(classId) {
    return `${ZAM}/classicon_${classId}.jpg`;
  }

  function spellIconUrl(icon) {
    if (!icon) return "";
    const file = String(icon).replace(/\.jpg$/i, "");
    return `${ZAM}/${file}.jpg`;
  }

  function rolesForClass(classId) {
    const row = state.catalog?.classRoles?.[classId] || {};
    return (state.catalog?.roles || []).filter((role) => Array.isArray(row[role.id]) && row[role.id].length);
  }

  function specsForRole(classId, roleId) {
    return [...(state.catalog?.classRoles?.[classId]?.[roleId] || [])];
  }

  function needsDpsSpecPicker(classId, roleId) {
    return roleId === "dps" && specsForRole(classId, roleId).length >= 2;
  }

  function roleById(id) {
    return (state.catalog?.roles || []).find((role) => role.id === id) || null;
  }

  function specById(classId, roleId, specId) {
    return specsForRole(classId, roleId).find((spec) => spec.id === specId) || null;
  }

  function showSpecMenu() {
    return Boolean(state.classId && needsDpsSpecPicker(state.classId, state.role));
  }

  function canSavePick() {
    if (!(state.race && state.gender && state.classId && state.role) || state.saving) return false;
    if (needsDpsSpecPicker(state.classId, state.role) && !state.specId) return false;
    return true;
  }

  function reconcileRoleAndSpec() {
    const roles = rolesForClass(state.classId);
    if (!roles.some((role) => role.id === state.role)) {
      state.role = roles.length === 1 ? roles[0].id : "";
    }
    const specs = specsForRole(state.classId, state.role);
    if (needsDpsSpecPicker(state.classId, state.role)) {
      if (!specs.some((spec) => spec.id === state.specId)) state.specId = "";
      return;
    }
    if (specs.length === 1) {
      state.specId = specs[0].id;
      return;
    }
    if (!specs.some((spec) => spec.id === state.specId)) {
      state.specId = specs[0]?.id || "";
    }
  }

  function roleSpecLabel(pick) {
    const roleId = pick?.role || "";
    const specId = pick?.specId || "";
    const roleName = pick?.roleName || roleById(roleId)?.name || "";
    const spec = specById(pick?.classId, roleId, specId);
    const specName = pick?.specShortName || pick?.specName || spec?.shortName || spec?.name || "";
    if (roleName && specName && specName.toLowerCase() !== roleName.toLowerCase()) {
      return `${roleName} · ${specName}`;
    }
    return roleName || specName;
  }

  function roleBadgeHtml(pick) {
    const role = roleById(pick?.role);
    if (!role) return "";
    const label = roleSpecLabel(pick) || role.name;
    return `<img class="wf-role-badge wf-role-badge-${escapeHtml(role.id)}" src="${escapeHtml(spellIconUrl(role.icon))}" alt="${escapeHtml(role.name)}" title="${escapeHtml(label)}" width="22" height="22" />`;
  }

  function portraitStack(imgHtml, pick) {
    return `<div class="wf-portrait-wrap">${portraitFrameWrap(imgHtml, pick)}${roleBadgeHtml(pick)}</div>`;
  }

  function parseForeverInstant(isoDate) {
    const s = String(isoDate || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00Z`);
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }

  function padCount(n) {
    return String(Math.max(0, n | 0)).padStart(2, "0");
  }

  function countdownTarget() {
    const launch = parseForeverInstant(countdown.launch);
    const now = Date.now();
    if (Number.isFinite(launch) && now < launch) {
      return { at: launch, label: "Full release in", live: false };
    }
    return { at: 0, label: "World of Warcraft: Forever", live: true };
  }

  function renderCountdown() {
    if (!el.countdownUnits || !el.countdownLabel) return;
    const target = countdownTarget();
    el.countdownLabel.textContent = target.label;
    el.countdown?.classList.toggle("is-live", target.live);
    if (target.live) {
      el.countdownUnits.innerHTML = `<div class="wf-count-unit"><b>Live now</b><span>Classic+</span></div>`;
      return;
    }
    let remaining = Math.max(0, target.at - Date.now());
    const total = Math.floor(remaining / 1000);
    const parts = [
      { value: Math.floor(total / 86400), label: "Days" },
      { value: Math.floor((total % 86400) / 3600), label: "Hours" },
      { value: Math.floor((total % 3600) / 60), label: "Minutes" },
    ];
    el.countdownUnits.innerHTML = parts
      .map((part) => `<div class="wf-count-unit"><b>${padCount(part.value)}</b><span>${part.label}</span></div>`)
      .join("");
  }

  function startCountdown() {
    renderCountdown();
    if (countdown.timer) clearInterval(countdown.timer);
    countdown.timer = setInterval(renderCountdown, 1000);
  }

  function setStatus(message, kind) {
    if (!el.status) return;
    el.status.textContent = message || "";
    el.status.className = `wf-status${kind ? ` ${kind}` : ""}`;
  }

  async function api(path, options) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { Accept: "application/json", ...(options?.body ? { "Content-Type": "application/json" } : {}) },
      ...options,
    });
    const payload = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = `/auth/discord/login?next=${encodeURIComponent("/wow-forever")}`;
      throw new Error("Login required");
    }
    if (!res.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Request failed (${res.status})`);
    }
    return payload;
  }

  function typedName() {
    const given = String(el.name?.value || "").trim();
    const family = String(el.familyName?.value || "").trim();
    return [given, family].filter(Boolean).join(" ");
  }

  function isOwnPick(pick) {
    const mine = String(state.pick?.userId || "").trim();
    const theirs = String(pick?.userId || "").trim();
    return Boolean(mine && theirs && mine === theirs);
  }

  function startChange() {
    if (!state.pick) return;
    state.editing = true;
    applySavedPick(state.pick);
    setStatus("Change race, class, or name, then save.");
    render();
    el.creator?.scrollIntoView({ behavior: "smooth", block: "start" });
    el.races?.querySelector("button.is-active")?.focus();
  }

  function cancelChange() {
    if (!state.pick) return;
    state.editing = false;
    applySavedPick(state.pick);
    setStatus("");
    render();
  }

  function applySavedPick(pick) {
    if (!pick) return;
    state.faction = "alliance";
    state.race = pick.race || "";
    state.gender = pick.gender || "male";
    state.classId = pick.classId || "";
    state.role = pick.role || "";
    state.specId = pick.specId || "";
    reconcileRoleAndSpec();
    if (el.name) el.name.value = pick.givenName || String(pick.characterName || "").split(" ")[0] || "";
    if (el.familyName) {
      el.familyName.value =
        pick.familyName ||
        String(pick.characterName || "")
          .split(" ")
          .slice(1)
          .join(" ") ||
        "";
    }
  }

  function renderFaction() {
    state.faction = "alliance";
  }

  function renderRaces() {
    if (!el.races) return;
    const races = (state.catalog?.races || []).filter(
      (r) => r.faction === "alliance" || r.faction === "both"
    );
    el.races.innerHTML = races
      .map((race) => {
        const active = state.race === race.id ? " is-active" : "";
        const neu = race.isNewRace ? " is-new" : "";
        const pill = race.isNewRace ? `<span class="wf-pill wf-pill--new">New</span>` : "";
        return `<button type="button" class="wf-tile${active}${neu}" data-race="${escapeHtml(race.id)}" data-faction="alliance">
          <img class="${portraitClass(race).trim()}" src="${escapeHtml(portraitUrl(race, state.gender))}" alt="" width="56" height="56" />
          <span class="wf-race-${escapeHtml(race.id)}">${escapeHtml(race.name)}</span>
          ${pill}
        </button>`;
      })
      .join("");
    el.races.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.race = btn.getAttribute("data-race") || "";
        state.faction = "alliance";
        if (state.classId && !classesFor(state.race, state.faction).includes(state.classId)) {
          state.classId = "";
          state.role = "";
          state.specId = "";
        }
        render();
      });
    });
  }

  function renderGender() {
    if (!el.gender) return;
    el.gender.innerHTML = ["male", "female"]
      .map((g) => {
        const active = state.gender === g ? " is-active" : "";
        const label = g === "male" ? "Male" : "Female";
        return `<button type="button"${active ? ' class="is-active"' : ""} data-gender="${g}">${label}</button>`;
      })
      .join("");
    el.gender.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.gender = btn.getAttribute("data-gender") || "male";
        render();
      });
    });
  }

  function renderClasses() {
    if (!el.classes) return;
    const allowed = new Set(classesFor(state.race, state.faction));
    el.classes.innerHTML = (state.catalog?.classes || [])
      .map((cls) => {
        const ok = !state.race || allowed.has(cls.id);
        const active = state.classId === cls.id ? " is-active" : "";
        const disabled = ok ? "" : " is-disabled";
        const neu = state.race && ok && isNewCombo(state.race, cls.id) ? " is-new" : "";
        const pill = neu ? `<span class="wf-pill wf-pill--new">New</span>` : "";
        return `<button type="button" class="wf-tile${active}${disabled}${neu}" data-class="${escapeHtml(cls.id)}" ${ok ? "" : "disabled"}>
          <img src="${escapeHtml(classIconUrl(cls.id))}" alt="" width="56" height="56" />
          <span class="wf-class-${escapeHtml(cls.id)}">${escapeHtml(cls.name)}</span>
          ${pill}
        </button>`;
      })
      .join("");
    el.classes.querySelectorAll("button:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.classId = btn.getAttribute("data-class") || "";
        reconcileRoleAndSpec();
        render();
      });
    });
  }

  function renderRoles() {
    if (el.roleWrap) el.roleWrap.hidden = !state.classId;
    if (el.nameStepNum) {
      const nameNum = 4 + (state.classId ? 1 : 0) + (showSpecMenu() ? 1 : 0);
      el.nameStepNum.textContent = `${nameNum}. Name`;
    }
    if (!el.roles) return;
    if (!state.classId) {
      el.roles.innerHTML = "";
      if (el.specMenu) el.specMenu.hidden = true;
      return;
    }
    const allowed = new Set(rolesForClass(state.classId).map((role) => role.id));
    const cls = classById(state.classId);
    el.roles.innerHTML = (state.catalog?.roles || [])
      .map((role) => {
        const ok = allowed.has(role.id);
        const active = state.role === role.id ? " is-active" : "";
        const disabled = ok ? "" : " is-disabled";
        const hasMenu = ok && needsDpsSpecPicker(state.classId, role.id);
        const expanded = hasMenu && state.role === "dps";
        const title = ok
          ? hasMenu
            ? `${role.name} — pick a spec`
            : role.name
          : `${cls?.name || "This class"} cannot play ${role.name}`;
        return `<button type="button" class="wf-role wf-role-${escapeHtml(role.id)}${active}${disabled}${hasMenu ? " has-menu" : ""}" data-role="${escapeHtml(role.id)}" ${ok ? "" : "disabled"} ${hasMenu ? 'aria-haspopup="true" aria-controls="wfSpecMenu"' : ""} aria-expanded="${expanded ? "true" : "false"}" title="${escapeHtml(title)}">
          <img src="${escapeHtml(spellIconUrl(role.icon))}" alt="" width="28" height="28" />
          <span>${escapeHtml(role.name)}</span>
        </button>`;
      })
      .join("");
    el.roles.querySelectorAll("button:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.role = btn.getAttribute("data-role") || "";
        reconcileRoleAndSpec();
        render();
      });
    });
    renderSpecs();
  }

  function renderSpecs() {
    if (!el.specMenu || !el.specs) return;
    const open = showSpecMenu();
    el.specMenu.hidden = !open;
    if (!open) {
      el.specs.innerHTML = "";
      return;
    }
    const specs = specsForRole(state.classId, "dps");
    const cls = classById(state.classId);
    if (el.specLabel) {
      el.specLabel.textContent = `${cls?.name || "Class"} DPS spec`;
    }
    el.specs.innerHTML = specs
      .map((spec) => {
        const active = state.specId === spec.id ? " is-active" : "";
        const label = spec.shortName || spec.name;
        const sub = spec.shortName && spec.shortName !== spec.name ? `<small>${escapeHtml(spec.name)}</small>` : "";
        return `<button type="button" class="wf-tile wf-spec-tile${active}" data-spec="${escapeHtml(spec.id)}">
          <img src="${escapeHtml(spellIconUrl(spec.icon))}" alt="" width="48" height="48" />
          <span>${escapeHtml(label)}</span>
          ${sub}
        </button>`;
      })
      .join("");
    el.specs.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.specId = btn.getAttribute("data-spec") || "";
        render();
      });
    });
  }

  function currentMainLabel(pick) {
    const main = String(pick?.mainCharacterName || "").trim();
    if (!main) return "";
    return `<p class="wf-main-line"><span class="wf-main-kicker">Current main</span><span class="wf-main-name">${escapeHtml(main)}</span></p>`;
  }

  function frameCaption(pick) {
    const count = Number(pick?.achievementCount) || 0;
    const label = String(pick?.frameLabel || "").trim();
    if (!label) return "";
    return `${label} · ${count} raid achievement${count === 1 ? "" : "s"}`;
  }

  function portraitFrameWrap(imgHtml, pick) {
    const tier = Number(pick?.frameTier) || 0;
    if (!tier) return imgHtml;
    const title = frameCaption(pick) || `Tier ${tier}`;
    return `<div class="wf-portrait-frame is-tier-${tier}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${imgHtml}</div>`;
  }

  function renderPreview() {
    if (!el.preview) return;
    const race = raceById(state.race);
    const cls = classById(state.classId);
    const name = typedName();
    if (!race) {
      el.preview.innerHTML = `<p class="wf-kicker">Preview</p><p class="subtle">Pick a race to start.</p>`;
      el.preview.classList.remove("is-changeable");
      el.preview.removeAttribute("role");
      el.preview.removeAttribute("tabindex");
      return;
    }
    const comboHtml = cls
      ? `<span class="wf-race-${escapeHtml(race.id)}">${escapeHtml(race.name)}</span> <span class="wf-class-${escapeHtml(cls.id)}">${escapeHtml(cls.name)}</span>`
      : `<span class="wf-race-${escapeHtml(race.id)}">${escapeHtml(race.name)}</span>`;
    const roleLabel = roleSpecLabel({ classId: state.classId, role: state.role, specId: state.specId });
    const neu = cls && isNewCombo(race.id, cls.id);
    const lockedMain = state.pick ? currentMainLabel(state.pick) : "";
    const portrait = characterPortraitHtml(race, state.gender, {
      classId: state.classId,
      role: state.role,
      specId: state.specId,
    }, 96);
    const canChange = Boolean(state.pick && !state.editing);
    el.preview.classList.toggle("is-changeable", canChange);
    if (canChange) {
      el.preview.setAttribute("role", "button");
      el.preview.setAttribute("tabindex", "0");
      el.preview.setAttribute("aria-label", "Change your Forever character");
    } else {
      el.preview.removeAttribute("role");
      el.preview.removeAttribute("tabindex");
      el.preview.removeAttribute("aria-label");
    }
    el.preview.innerHTML = `
      <p class="wf-kicker wf-faction-${escapeHtml(state.faction)}">${state.faction === "alliance" ? "Alliance" : "Horde"}</p>
      ${portraitStack(portrait, { ...(state.pick || {}), classId: state.classId, role: state.role, specId: state.specId })}
      ${state.pick && state.pick.frameLabel ? `<p class="wf-frame-tag">${escapeHtml(frameCaption(state.pick))}</p>` : ""}
      <p class="wf-preview-name wf-class-${escapeHtml(cls?.id || "")}">${escapeHtml(name || (cls ? `${race.name} ${cls.name}` : race.name))}</p>
      ${lockedMain}
      <p class="subtle">${escapeHtml(state.gender === "female" ? "Female" : "Male")} ${comboHtml}${roleLabel ? ` · ${escapeHtml(roleLabel)}` : ""}</p>
      ${neu ? `<p><span class="wf-pill wf-pill--new">New Forever combo</span></p>` : ""}
      ${canChange ? `<p class="wf-change-hint">Click to change race and class</p>` : ""}
      ${race.note ? `<p class="subtle wf-preview-note">${escapeHtml(race.note)}</p>` : ""}
    `;
  }

  function renderLocked() {
    const lockedView = Boolean(state.pick && !state.editing);
    if (el.heading) {
      el.heading.textContent = !state.pick
        ? "Create a Forever roll"
        : state.editing
          ? "Change your Forever roll"
          : "Your Forever character";
    }
    if (el.lede) {
      el.lede.textContent = lockedView
        ? "Click your character to change race and class."
        : "Alliance only · Combos follow the BlizzCon 12 Sep 2026 demo.";
    }
    if (el.editor) el.editor.hidden = lockedView;
    if (el.cancel) el.cancel.hidden = !(state.pick && state.editing);
    if (el.save) el.save.textContent = state.pick ? "Save changes" : "Lock in my Forever character";
    if (!el.locked) return;
    el.locked.hidden = !lockedView;
    if (!lockedView) {
      el.locked.innerHTML = "";
      return;
    }
    const pick = state.pick;
    const race = raceById(pick.race) || { id: pick.race, name: pick.raceName, portraitKey: pick.race };
    const name = pick.characterName || `${pick.raceName || pick.race} ${pick.className || pick.classId}`;
    const portrait = characterPortraitHtml(race, pick.gender, pick, 96);
    el.locked.innerHTML = `<button type="button" class="wf-locked-card" id="wfChangeTrigger">
      ${portraitStack(portrait, pick)}
      <span class="wf-locked-copy">
        <strong class="wf-class-${escapeHtml(pick.classId || "")}">${escapeHtml(name)}</strong>
        <small>
          <span class="wf-faction-${escapeHtml(pick.faction || "")}">${escapeHtml((pick.faction || "").toUpperCase())}</span>
          · <span class="wf-race-${escapeHtml(pick.race || "")}">${escapeHtml(pick.raceName || pick.race)}</span>
          <span class="wf-class-${escapeHtml(pick.classId || "")}">${escapeHtml(pick.className || pick.classId)}</span>
          ${roleSpecLabel(pick) ? ` · ${escapeHtml(roleSpecLabel(pick))}` : ""}
        </small>
        <span class="wf-change-hint">Click to change race and class</span>
      </span>
    </button>`;
    document.getElementById("wfChangeTrigger")?.addEventListener("click", startChange);
  }

  function renderSquad() {
    if (!el.squad || !el.squadMeta) return;
    const picks = state.squad || [];
    el.squadMeta.textContent = picks.length
      ? `${picks.length} raider${picks.length === 1 ? "" : "s"} locked in · frames rank raid achievements`
      : "Nobody has locked a Forever character yet. Be first.";
    el.squad.innerHTML = picks
      .map((p) => {
        const race = raceById(p.race) || { id: p.race, name: p.raceName, portraitKey: p.race };
        const title = p.characterName || p.raceName || "Raider";
        const neu = p.isNewCombo ? `<span class="wf-pill wf-pill--new">New</span>` : "";
        const main = String(p.mainCharacterName || "").trim();
        const portrait = characterPortraitHtml(race, p.gender, p, 56);
        const mine = isOwnPick(p);
        return `<article class="wf-card${mine ? " is-mine" : ""}"${mine ? ' data-change="1" role="button" tabindex="0" aria-label="Change your Forever character"' : ""}>
          ${portraitStack(portrait, p)}
          <div>
            <strong class="wf-class-${escapeHtml(p.classId || "")}">${escapeHtml(title)}</strong>
            ${main ? `<small class="wf-card-main"><span class="wf-main-kicker">Current main</span><span class="wf-main-name">${escapeHtml(main)}</span></small>` : ""}
            <small>
              <span class="wf-faction-${escapeHtml(p.faction || "")}">${escapeHtml((p.faction || "").toUpperCase())}</span>
              · <span class="wf-race-${escapeHtml(p.race || "")}">${escapeHtml(p.raceName || p.race)}</span>
              <span class="wf-class-${escapeHtml(p.classId || "")}">${escapeHtml(p.className || p.classId)}</span>
              ${roleSpecLabel(p) ? ` · ${escapeHtml(roleSpecLabel(p))}` : ""}
            </small>
            ${p.frameLabel ? `<span class="wf-frame-chip is-tier-${Number(p.frameTier) || 1}">${escapeHtml(p.frameLabel)}</span>` : ""}
            ${mine ? `<span class="wf-change-hint">Click to change</span>` : ""}
            ${neu}
          </div>
        </article>`;
      })
      .join("");
    renderRaidRoster();
  }

  function pickByUserId(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return null;
    return (state.squad || []).find((p) => String(p.userId || "") === uid) || null;
  }

  function setRosterStatus(msg, kind) {
    if (!el.rosterStatus) return;
    el.rosterStatus.textContent = msg || "";
    el.rosterStatus.className = `wf-status${kind ? ` ${kind}` : ""}`;
  }

  function rosterRoleCounts(slots) {
    let tank = 0;
    let heal = 0;
    let dps = 0;
    for (const uid of slots) {
      const pick = pickByUserId(uid);
      if (!pick) continue;
      const role = String(pick.role || "").toLowerCase();
      if (role === "tank") tank += 1;
      else if (role === "heal" || role === "healer") heal += 1;
      else if (pick.classId) dps += 1;
    }
    return { tank, heal, dps };
  }

  function renderRaidRoster() {
    if (!el.roster || !el.rosterBench || !el.rosterMeta) return;
    const slots = Array.from({ length: 20 }, (_, i) => String(state.rosterSlots[i] || "").trim());
    const filled = slots.filter(Boolean).length;
    const counts = rosterRoleCounts(slots);
    el.rosterMeta.textContent = `${filled}/20 seated · ${counts.tank} tank · ${counts.heal} heal · ${counts.dps} dps`;

    const groups = [];
    for (let g = 0; g < 4; g += 1) {
      const rows = [];
      for (let s = 0; s < 5; s += 1) {
        const index = g * 5 + s;
        const uid = slots[index];
        const pick = pickByUserId(uid);
        const selected = Boolean(state.selectedRosterUid);
        if (pick) {
          const race = raceById(pick.race) || { id: pick.race, name: pick.raceName, portraitKey: pick.race };
          const title = pick.characterName || pick.raceName || "Raider";
          const detail = [pick.className || pick.classId, roleSpecLabel(pick)].filter(Boolean).join(" · ");
          rows.push(`<button type="button" class="wf-roster-slot is-filled${selected ? " is-target" : ""}" data-slot="${index}" draggable="true" aria-label="Clear ${escapeHtml(title)} from group ${g + 1}">
            <img src="${escapeHtml(portraitUrl(race, pick.gender))}" alt="" width="36" height="36" draggable="false" />
            <span>
              <strong class="wf-class-${escapeHtml(pick.classId || "")}">${escapeHtml(title)}</strong>
              <small>${escapeHtml(detail || pick.raceName || "")}</small>
            </span>
          </button>`);
        } else {
          rows.push(`<button type="button" class="wf-roster-slot${selected ? " is-target" : ""}" data-slot="${index}" aria-label="Raid slot ${index + 1}">
            <span class="wf-roster-slot-empty">Empty · ${index + 1}</span>
          </button>`);
        }
      }
      groups.push(`<div class="wf-roster-group"><p class="wf-roster-group-title">Group ${g + 1}</p>${rows.join("")}</div>`);
    }
    el.roster.innerHTML = groups.join("");

    const seated = new Set(slots.filter(Boolean));
    const available = (state.squad || []).filter((p) => !seated.has(String(p.userId || "")));
    if (!available.length) {
      el.rosterBench.innerHTML = `<p class="wf-roster-chip-empty">${
        (state.squad || []).length ? "Everyone locked in is already on the roster." : "Lock Squad picks first, then seat them here."
      }</p>`;
      return;
    }
    el.rosterBench.innerHTML = available
      .map((p) => {
        const race = raceById(p.race) || { id: p.race, name: p.raceName, portraitKey: p.race };
        const title = p.characterName || p.raceName || "Raider";
        const uid = String(p.userId || "");
        const selected = state.selectedRosterUid === uid ? " is-selected" : "";
        return `<button type="button" class="wf-roster-chip${selected}" data-bench="${escapeHtml(uid)}" draggable="true" aria-pressed="${selected ? "true" : "false"}">
          <img src="${escapeHtml(portraitUrl(race, p.gender))}" alt="" width="28" height="28" draggable="false" />
          <span class="wf-class-${escapeHtml(p.classId || "")}">${escapeHtml(title)}</span>
        </button>`;
      })
      .join("");
  }

  let rosterDrag = null;
  let rosterDidDrag = false;

  function currentRosterSlots() {
    return Array.from({ length: 20 }, (_, i) => String(state.rosterSlots[i] || "").trim());
  }

  function readRosterDrag(event) {
    if (rosterDrag?.uid) return rosterDrag;
    try {
      const raw = event.dataTransfer?.getData("application/x-wf-roster") || event.dataTransfer?.getData("text/plain") || "";
      const parsed = JSON.parse(raw);
      const uid = String(parsed?.uid || "").trim();
      if (!uid) return null;
      const fromSlot = Number.isInteger(parsed.fromSlot) ? parsed.fromSlot : Number(parsed.fromSlot);
      return {
        uid,
        fromSlot: Number.isInteger(fromSlot) && fromSlot >= 0 && fromSlot <= 19 ? fromSlot : null,
      };
    } catch {
      return null;
    }
  }

  function writeRosterDrag(event, payload) {
    rosterDrag = {
      uid: String(payload.uid || "").trim(),
      fromSlot: Number.isInteger(payload.fromSlot) ? payload.fromSlot : null,
    };
    const json = JSON.stringify(rosterDrag);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-wf-roster", json);
    event.dataTransfer.setData("text/plain", json);
  }

  function clearRosterDrag() {
    rosterDrag = null;
    el.roster?.querySelectorAll(".is-drop-target, .is-dragging").forEach((node) => {
      node.classList.remove("is-drop-target", "is-dragging");
    });
    el.rosterBench?.querySelectorAll(".is-dragging").forEach((node) => node.classList.remove("is-dragging"));
    el.rosterBench?.classList.remove("is-drop-target");
  }

  async function seatRaiderInSlot(uid, targetIndex, fromSlot) {
    const selected = String(uid || "").trim();
    if (!selected || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 19) return;
    const slots = currentRosterSlots();
    if (Number.isInteger(fromSlot) && fromSlot >= 0 && fromSlot <= 19) {
      if (fromSlot === targetIndex) return;
      const moving = slots[fromSlot];
      if (moving !== selected) return;
      const swapped = slots[targetIndex] || "";
      slots[fromSlot] = swapped;
      slots[targetIndex] = selected;
      await persistRaidRoster(slots, swapped ? "Raiders swapped." : "Raider moved.");
      return;
    }
    const next = slots.map((id) => (id === selected ? "" : id));
    next[targetIndex] = selected;
    await persistRaidRoster(next, "Raider seated.");
  }

  async function unseatRaider(uid, fromSlot) {
    const selected = String(uid || "").trim();
    if (!selected) return;
    const slots = currentRosterSlots();
    if (Number.isInteger(fromSlot) && fromSlot >= 0 && fromSlot <= 19) {
      if (slots[fromSlot] !== selected) return;
      slots[fromSlot] = "";
    } else {
      for (let i = 0; i < slots.length; i += 1) {
        if (slots[i] === selected) slots[i] = "";
      }
    }
    await persistRaidRoster(slots, "Raider returned to Available.");
  }

  async function persistRaidRoster(nextSlots, okMessage) {
    if (state.rosterSaving) return;
    state.rosterSaving = true;
    setRosterStatus("Saving roster…");
    try {
      const payload = await api("/api/wow-forever/raid-roster", {
        method: "PUT",
        body: JSON.stringify({ slots: nextSlots }),
      });
      state.rosterSlots = Array.from({ length: 20 }, (_, i) => String(payload.userIds?.[i] || "").trim());
      state.rosterUpdatedAt = Number(payload.updatedAt) || 0;
      state.selectedRosterUid = "";
      setRosterStatus(okMessage || "Roster saved.", "ok");
      renderRaidRoster();
    } catch (error) {
      setRosterStatus(error.message || "Could not save roster.", "error");
    } finally {
      state.rosterSaving = false;
    }
  }

  async function onRosterSlotClick(index) {
    const slots = currentRosterSlots();
    const selected = String(state.selectedRosterUid || "").trim();
    const current = slots[index] || "";
    if (selected) {
      await seatRaiderInSlot(selected, index, null);
      return;
    }
    if (current) {
      slots[index] = "";
      await persistRaidRoster(slots, "Slot cleared.");
    }
  }

  async function clearRaidRoster() {
    if (state.rosterSaving) return;
    if (!state.rosterSlots.some(Boolean)) {
      setRosterStatus("Roster is already empty.");
      return;
    }
    if (!window.confirm("Clear the entire 20-man raid roster?")) return;
    await persistRaidRoster(Array.from({ length: 20 }, () => ""), "Roster cleared.");
  }

  async function loadRaidRoster() {
    const payload = await api("/api/wow-forever/raid-roster");
    const known = new Set((state.squad || []).map((p) => String(p.userId || "")));
    const incoming = Array.from({ length: 20 }, (_, i) => String(payload.userIds?.[i] || "").trim());
    const pruned = incoming.map((uid) => (uid && known.has(uid) ? uid : ""));
    state.rosterSlots = pruned;
    state.rosterUpdatedAt = Number(payload.updatedAt) || 0;
    if (pruned.join("|") !== incoming.join("|")) {
      await persistRaidRoster(pruned, "Roster cleaned of missing Squad picks.");
      return;
    }
    renderRaidRoster();
  }

  function renderMatrix() {
    if (!el.matrix || !state.catalog) return;
    const classes = state.catalog.classes || [];
    const rows = [];
    for (const race of state.catalog.races || []) {
      if (race.faction === "horde") continue;
      const factions = race.faction === "both" ? ["alliance"] : [race.faction];
      for (const faction of factions) {
        if (faction !== "alliance") continue;
        const allowed = new Set(classesFor(race.id, faction));
        const label = race.name;
        const cells = classes
          .map((cls) => {
            if (!allowed.has(cls.id)) return "<td></td>";
            const neu = isNewCombo(race.id, cls.id);
            return `<td class="${neu ? "new" : "yes"}">${neu ? "NEW" : "✓"}</td>`;
          })
          .join("");
        rows.push(`<tr><td class="wf-race-${escapeHtml(race.id)}">${escapeHtml(label)}</td>${cells}</tr>`);
      }
    }
    el.matrix.innerHTML = `<thead><tr><th>Race</th>${classes
      .map((c) => `<th class="wf-class-${escapeHtml(c.id)}">${escapeHtml(c.name)}</th>`)
      .join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
  }

  function renderSources() {
    if (!el.sources) return;
    el.sources.innerHTML = (state.catalog?.sources || [])
      .map(
        (s) =>
          `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a> — ${escapeHtml(s.note || "")}</li>`
      )
      .join("");
    if (el.notes) {
      el.notes.innerHTML = (state.catalog?.notes || []).map((n) => escapeHtml(n)).join("<br /><br />");
    }
  }

  function render() {
    renderLocked();
    renderFaction();
    renderRaces();
    renderGender();
    renderClasses();
    renderRoles();
    renderPreview();
    if (el.save) el.save.disabled = !canSavePick();
  }

  async function savePick() {
    if (state.saving) return;
    state.saving = true;
    setStatus("Saving…");
    render();
    try {
      const payload = await api("/api/wow-forever/me", {
        method: "PUT",
        body: JSON.stringify({
          race: state.race,
          faction: state.faction,
          gender: state.gender,
          classId: state.classId,
          role: state.role,
          specId: state.specId,
          givenName: el.name?.value || "",
          familyName: el.familyName?.value || "",
        }),
      });
      const updating = Boolean(state.pick);
      state.pick = payload.pick;
      state.editing = false;
      applySavedPick(payload.pick);
      setStatus(updating ? "Changes saved." : "Locked in.", "ok");
      await loadSquad();
    } catch (error) {
      setStatus(error.message || "Could not save.", "error");
    } finally {
      state.saving = false;
      render();
    }
  }

  async function clearPick() {
    if (state.saving) return;
    state.saving = true;
    setStatus("Clearing…");
    try {
      await api("/api/wow-forever/me", { method: "DELETE" });
      state.pick = null;
      state.editing = true;
      state.race = "";
      state.classId = "";
      state.role = "";
      state.specId = "";
      if (el.name) el.name.value = "";
      if (el.familyName) el.familyName.value = "";
      setStatus("Pick cleared.");
      await loadSquad();
    } catch (error) {
      setStatus(error.message || "Could not clear.", "error");
    } finally {
      state.saving = false;
      render();
    }
  }

  function renderTavern() {
    window.WowForeverTavern?.render(state.squad || [], {
      ownUserId: state.pick?.userId || "",
    });
  }

  async function loadSquad() {
    const payload = await api("/api/wow-forever/squad");
    state.squad = payload.picks || [];
    renderSquad();
    renderTavern();
    await loadRaidRoster();
  }

  function startTavernPoll() {
    if (countdown.tavernPoll) clearInterval(countdown.tavernPoll);
    countdown.tavernPoll = setInterval(() => {
      if (document.hidden) return;
      loadSquad().catch(() => {});
    }, 25000);
  }

  async function boot() {
    try {
      const [catalogRes, meRes] = await Promise.all([
        api("/api/wow-forever/catalog"),
        api("/api/wow-forever/me"),
      ]);
      state.catalog = catalogRes.catalog;
      state.pick = meRes.pick;
      state.editing = !meRes.pick;
      if (state.catalog?.beta) countdown.beta = state.catalog.beta;
      if (state.catalog?.launch) countdown.launch = state.catalog.launch;
      applySavedPick(meRes.pick);
      renderSources();
      renderMatrix();
      render();
      startCountdown();
      await loadSquad();
      startTavernPoll();
    } catch (error) {
      setStatus(error.message || "Failed to load Forever data.", "error");
    }
  }

  el.save?.addEventListener("click", savePick);
  el.cancel?.addEventListener("click", cancelChange);
  el.clear?.addEventListener("click", clearPick);
  el.name?.addEventListener("input", renderPreview);
  el.familyName?.addEventListener("input", renderPreview);
  el.preview?.addEventListener("click", () => {
    if (state.pick && !state.editing) startChange();
  });
  el.preview?.addEventListener("keydown", (event) => {
    if (!state.pick || state.editing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startChange();
    }
  });
  el.squad?.addEventListener("click", (event) => {
    if (event.target.closest("[data-change='1']")) startChange();
  });
  el.squad?.addEventListener("keydown", (event) => {
    if (!event.target.closest("[data-change='1']")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startChange();
    }
  });
  el.rosterBench?.addEventListener("click", (event) => {
    if (rosterDidDrag) {
      rosterDidDrag = false;
      return;
    }
    const chip = event.target.closest("[data-bench]");
    if (!chip) return;
    const uid = chip.getAttribute("data-bench") || "";
    state.selectedRosterUid = state.selectedRosterUid === uid ? "" : uid;
    renderRaidRoster();
  });
  el.rosterBench?.addEventListener("dragstart", (event) => {
    const chip = event.target.closest("[data-bench]");
    if (!chip) return;
    const uid = chip.getAttribute("data-bench") || "";
    if (!uid) return;
    rosterDidDrag = true;
    writeRosterDrag(event, { uid, fromSlot: null });
    chip.classList.add("is-dragging");
    state.selectedRosterUid = uid;
  });
  el.rosterBench?.addEventListener("dragend", () => {
    clearRosterDrag();
    setTimeout(() => {
      rosterDidDrag = false;
    }, 0);
  });
  el.rosterBench?.addEventListener("dragover", (event) => {
    const drag = readRosterDrag(event);
    if (!drag || drag.fromSlot == null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    el.rosterBench.classList.add("is-drop-target");
  });
  el.rosterBench?.addEventListener("dragleave", (event) => {
    if (!el.rosterBench.contains(event.relatedTarget)) el.rosterBench.classList.remove("is-drop-target");
  });
  el.rosterBench?.addEventListener("drop", (event) => {
    event.preventDefault();
    const drag = readRosterDrag(event);
    clearRosterDrag();
    if (!drag || drag.fromSlot == null) return;
    unseatRaider(drag.uid, drag.fromSlot);
  });
  el.roster?.addEventListener("click", (event) => {
    if (rosterDidDrag) {
      rosterDidDrag = false;
      return;
    }
    const slot = event.target.closest("[data-slot]");
    if (!slot) return;
    const index = Number(slot.getAttribute("data-slot"));
    if (!Number.isInteger(index) || index < 0 || index > 19) return;
    onRosterSlotClick(index);
  });
  el.roster?.addEventListener("dragstart", (event) => {
    const slot = event.target.closest("[data-slot].is-filled");
    if (!slot) return;
    const index = Number(slot.getAttribute("data-slot"));
    const uid = currentRosterSlots()[index] || "";
    if (!uid || !Number.isInteger(index)) return;
    rosterDidDrag = true;
    writeRosterDrag(event, { uid, fromSlot: index });
    slot.classList.add("is-dragging");
    state.selectedRosterUid = uid;
  });
  el.roster?.addEventListener("dragend", () => {
    clearRosterDrag();
    setTimeout(() => {
      rosterDidDrag = false;
    }, 0);
  });
  el.roster?.addEventListener("dragover", (event) => {
    const slot = event.target.closest("[data-slot]");
    if (!slot || !readRosterDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    el.roster.querySelectorAll(".is-drop-target").forEach((node) => {
      if (node !== slot) node.classList.remove("is-drop-target");
    });
    slot.classList.add("is-drop-target");
  });
  el.roster?.addEventListener("dragleave", (event) => {
    const slot = event.target.closest("[data-slot]");
    if (!slot) return;
    if (!slot.contains(event.relatedTarget)) slot.classList.remove("is-drop-target");
  });
  el.roster?.addEventListener("drop", (event) => {
    const slot = event.target.closest("[data-slot]");
    if (!slot) return;
    event.preventDefault();
    const index = Number(slot.getAttribute("data-slot"));
    const drag = readRosterDrag(event);
    clearRosterDrag();
    if (!drag || !Number.isInteger(index) || index < 0 || index > 19) return;
    seatRaiderInSlot(drag.uid, index, drag.fromSlot);
  });
  el.rosterClear?.addEventListener("click", clearRaidRoster);
  document.addEventListener("wf-tavern-change", startChange);

  startCountdown();
  boot();
})();
