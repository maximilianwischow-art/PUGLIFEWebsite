/**
 * Profile page — drag-drop avatar upload, main-character picker, badge grid.
 *
 * Talks to:
 *   - GET    /api/auth/me
 *   - GET    /api/profile/me
 *   - PUT    /api/profile/me/picture       (raw body, Content-Type drives mime)
 *   - DELETE /api/profile/me/picture
 *   - PUT    /api/profile/me/main-character (JSON: { mainCharacterName })
 *   - GET    /api/profile/me/badges
 */

(function profilePageMain() {
  const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const MAX_BYTES = 4 * 1024 * 1024;

  const els = {
    locked: document.getElementById("profileLockedCard"),
    grid: document.getElementById("profileGrid"),
    drop: document.getElementById("profilePictureDrop"),
    preview: document.getElementById("profilePicturePreview"),
    placeholder: document.getElementById("profilePicturePlaceholder"),
    fileInput: document.getElementById("profilePictureInput"),
    chooseBtn: document.getElementById("profilePictureChooseBtn"),
    removeBtn: document.getElementById("profilePictureRemoveBtn"),
    pictureStatus: document.getElementById("profilePictureStatus"),
    mainSelect: document.getElementById("profileMainSelect"),
    mainSaveBtn: document.getElementById("profileMainSaveBtn"),
    mainHint: document.getElementById("profileMainHint"),
    badgesHost: document.getElementById("profileBadgesCategories"),
    heroPortraitFrame: document.getElementById("profileHeroPortraitFrame"),
    heroPicture: document.getElementById("profileHeroPicture"),
    heroName: document.getElementById("profileHeroName"),
    heroMeta: document.getElementById("profileHeroMeta"),
    keyStatsHost: document.getElementById("profileKeyStats"),
    subnavButtons: document.querySelectorAll("[data-profile-tab]"),
    tabPanels: document.querySelectorAll("[data-profile-panel]"),
  };

  /** Cached active-roster fetch promise so badge resolution + key stats share one network call. */
  let activeRosterPromise = null;

  /** Local cache of the last saved main character so the Save button knows when to disable. */
  let savedMainCharacterName = null;
  /** Cached profile payload so we can reuse picture metadata after a partial update. */
  let lastProfile = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setStatus(node, text, kind) {
    if (!node) return;
    node.textContent = String(text || "");
    node.classList.remove("is-error", "is-success", "is-busy");
    if (kind) node.classList.add(`is-${kind}`);
  }

  function badgeTooltipHtml(badge, earned) {
    const rarity = ["common", "rare", "epic", "legendary"].includes(String(badge?.rarity || ""))
      ? String(badge.rarity)
      : "epic";
    const status = earned ? "Earned" : "Not yet earned";
    const description = String(badge?.description || badge?.defaultDescription || "").trim();
    const glowColor = badgeTooltipGlowColor(badge?.id, rarity);
    const style = `--achievement-glow-color:${glowColor};--achievement-rarity-color:${badgeTooltipRarityColor(rarity)};`;
    return `
      <span class="achievement-tooltip" aria-hidden="true">
        <span class="achievement-tooltip-box rarity-${escapeHtml(rarity)}" style="${escapeHtml(style)}">
          <span class="achievement-name">${escapeHtml(badge?.name || "")}</span>
          ${description ? `<span class="achievement-description">${escapeHtml(description)}</span>` : ""}
          <span class="achievement-rarity">
            <span class="achievement-rarity-text">${escapeHtml(status)} · ${escapeHtml(rarity)}</span>
          </span>
        </span>
      </span>`;
  }

  function badgeTooltipGlowColor(badgeId, rarity) {
    const id = String(badgeId || "").trim();
    const byId = {
      "iron-attendance": "#22c55e",
      "parsing-ceiling": "#ef4444",
      "most-deaths-last-6-raids": "#f97316",
      "hall-of-fame": "#f97316",
      "best-time-participant": "#a855f7",
      "aoe-cleave": "#f97316",
    };
    if (byId[id]) return byId[id];
    if (id.includes("first-time-clear")) return "#22c55e";
    if (id.startsWith("raids-with-guild-")) return "#a855f7";
    if (rarity === "legendary") return "#f97316";
    if (rarity === "rare") return "#0070de";
    if (rarity === "common") return "#9e9e9e";
    return "#a855f7";
  }

  function badgeTooltipRarityColor(rarity) {
    if (rarity === "legendary") return "rgba(255, 128, 0, 0.8)";
    if (rarity === "rare") return "rgba(0, 112, 222, 0.6)";
    if (rarity === "common") return "rgba(158, 158, 158, 0.5)";
    return "rgba(163, 53, 238, 0.7)";
  }

  function showLockedState() {
    if (els.locked) els.locked.hidden = false;
    if (els.grid) els.grid.hidden = true;
  }

  function showAuthedState() {
    if (els.locked) els.locked.hidden = true;
    if (els.grid) els.grid.hidden = false;
  }

  async function fetchAuthState() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const payload = await res.json();
      return Boolean(payload?.authenticated);
    } catch {
      return false;
    }
  }

  function applyPictureToUI(profile) {
    const url = profile?.pictureUrl;
    if (url) {
      els.preview.src = url;
      els.preview.alt = "Your profile picture";
      els.preview.classList.add("is-loaded");
      els.placeholder.hidden = true;
      els.removeBtn.hidden = false;
    } else {
      els.preview.removeAttribute("src");
      els.preview.alt = "";
      els.preview.classList.remove("is-loaded");
      els.placeholder.hidden = false;
      els.removeBtn.hidden = true;
    }
    /* Mirror the picture state on the Overview hero portrait. */
    if (els.heroPicture) {
      if (url) {
        els.heroPicture.src = url;
        els.heroPicture.alt = "Your profile picture";
        els.heroPortraitFrame?.classList.add("has-picture");
        els.heroPortraitFrame?.classList.remove("is-empty");
      } else {
        els.heroPicture.removeAttribute("src");
        els.heroPicture.alt = "";
        els.heroPortraitFrame?.classList.remove("has-picture");
        els.heroPortraitFrame?.classList.add("is-empty");
      }
    }
  }

  function applyHeroIdentity(profile, linkedCharacters) {
    if (!els.heroName) return;
    const main = String(profile?.mainCharacterName || "").trim();
    const display = String(profile?.displayName || "").trim();
    const linked = Array.isArray(linkedCharacters) ? linkedCharacters.filter(Boolean) : [];
    const primary = main || linked[0] || display || "—";
    els.heroName.textContent = primary;
    if (els.heroMeta) {
      const extras = [];
      if (display && display !== primary) extras.push(display);
      if (linked.length > 1) extras.push(`${linked.length} linked characters`);
      els.heroMeta.textContent = extras.join(" · ");
    }
  }

  function applyMainCharacterToUI(linkedCharacters, currentMain) {
    const opts = ['<option value="">— No main selected —</option>'];
    const seen = new Set();
    for (const name of linkedCharacters || []) {
      const trimmed = String(name || "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const selected = currentMain && currentMain.toLowerCase() === key ? " selected" : "";
      opts.push(`<option value="${escapeHtml(trimmed)}"${selected}>${escapeHtml(trimmed)}</option>`);
    }
    els.mainSelect.innerHTML = opts.join("");
    savedMainCharacterName = currentMain || "";
    els.mainSaveBtn.disabled = true;
    if (!linkedCharacters || !linkedCharacters.length) {
      els.mainHint.textContent =
        "No character linked. Ask an admin to add a row on the Account Assignment table.";
      els.mainSelect.disabled = true;
      els.mainSaveBtn.disabled = true;
    } else {
      els.mainHint.textContent = "";
      els.mainSelect.disabled = false;
    }
  }

  function bindSubnav() {
    if (!els.subnavButtons || !els.subnavButtons.length) return;
    els.subnavButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-profile-tab") || "";
        if (!target) return;
        els.subnavButtons.forEach((b) => {
          const active = b.getAttribute("data-profile-tab") === target;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", active ? "true" : "false");
        });
        els.tabPanels.forEach((panel) => {
          const match = panel.getAttribute("data-profile-panel") === target;
          panel.hidden = !match;
        });
      });
    });
  }

  async function loadProfile() {
    setStatus(els.pictureStatus, "Loading profile…", "busy");
    try {
      const res = await fetch("/api/profile/me", { credentials: "include" });
      if (res.status === 401) {
        showLockedState();
        return;
      }
      const payload = await res.json();
      if (!payload?.ok) throw new Error(payload?.error || "Failed to load profile");
      showAuthedState();
      lastProfile = payload.profile || null;
      const linkedCharacters = payload.linkedCharacters || [];
      applyPictureToUI(payload.profile);
      applyHeroIdentity(payload.profile, linkedCharacters);
      applyMainCharacterToUI(linkedCharacters, payload?.profile?.mainCharacterName || null);
      hydrateKeyStats(payload.profile, linkedCharacters).catch((error) => {
        console.warn("[profile] key stats hydrate failed:", error?.message || error);
      });
      setStatus(els.pictureStatus, "");
    } catch (error) {
      setStatus(els.pictureStatus, error?.message || "Failed to load profile", "error");
    }
  }

  /**
   * Pull the user's row out of /active-roster so we can render Events,
   * Attendance %, Peak parse, and Guild rank tiles. The same payload feeds
   * Leaderboard, so this is essentially free (session-cached on hover).
   */
  function fetchActiveRosterOnce() {
    if (activeRosterPromise) return activeRosterPromise;
    const guildId = window.plbEventsRoster?.EVENTS_WCL_GUILD_ID || 817080;
    activeRosterPromise = fetch(
      `/api/wcl/guild/${guildId}/active-roster?limit=40&top=250&maxRhPastEvents=0`,
      { credentials: "include" },
    )
      .then((res) => (res.ok ? res.json() : { players: [] }))
      .catch(() => ({ players: [] }));
    return activeRosterPromise;
  }

  function findRosterRowForLinkedNames(rosterPayload, linkedCharacters, mainCharacterName) {
    const players = Array.isArray(rosterPayload?.players) ? rosterPayload.players : [];
    if (!players.length) return null;
    const plb = window.plbEventsRoster;
    const norm = (s) =>
      typeof plb?.rosterNameKey === "function"
        ? plb.rosterNameKey(s)
        : String(s || "").trim().toLowerCase();
    const wanted = new Set();
    if (mainCharacterName) wanted.add(norm(mainCharacterName));
    for (const cn of linkedCharacters || []) wanted.add(norm(cn));
    if (!wanted.size) return null;
    /* Prefer a player whose primary name matches the user's main character;
       fall back to any linked character match. */
    let fallback = null;
    for (const p of players) {
      const candidates = [
        norm(p?.characterName),
        norm(p?.name),
        ...(Array.isArray(p?.wclCharacters) ? p.wclCharacters.map(norm) : []),
      ].filter(Boolean);
      if (mainCharacterName && candidates.includes(norm(mainCharacterName))) return p;
      if (!fallback && candidates.some((c) => wanted.has(c))) fallback = p;
    }
    return fallback;
  }

  function pickPeakParseFromPlayer(player) {
    const ps = player?.parseSummaries;
    if (!ps || typeof ps !== "object") return { value: null, bracket: null };
    const role = String(player?.roleName || "").trim().toLowerCase();
    let bracket = "dps";
    if (role === "tank" || role === "tanks") bracket = "tank";
    else if (role === "healer" || role === "healers") bracket = "heal";
    let value = null;
    if (bracket === "heal") value = Number(ps.bestHeal || 0) || Number(ps.bestDps || 0) || null;
    else if (bracket === "tank") value = Number(ps.bestTank || 0) || Number(ps.bestDps || 0) || null;
    else value = Number(ps.bestDps || 0) || null;
    /* If the bracket-specific best is 0, fall back to whichever metric is highest. */
    if (!value) {
      const candidates = [Number(ps.bestDps || 0), Number(ps.bestHeal || 0), Number(ps.bestTank || 0)].filter(
        (n) => Number.isFinite(n) && n > 0,
      );
      value = candidates.length ? Math.max(...candidates) : null;
      if (value && !role) bracket = null;
    }
    return { value, bracket };
  }

  function setStatTile(name, text, title) {
    const node = els.keyStatsHost?.querySelector(`[data-stat="${name}"]`);
    if (!node) return;
    node.textContent = String(text ?? "—");
    if (title) {
      const card = node.closest(".profile-stat-card");
      if (card) card.setAttribute("title", title);
    }
  }

  async function hydrateKeyStats(profile, linkedCharacters) {
    if (!els.keyStatsHost) return;
    const rosterPayload = await fetchActiveRosterOnce();
    const player = findRosterRowForLinkedNames(
      rosterPayload,
      linkedCharacters,
      profile?.mainCharacterName,
    );
    const recentCap = Number(rosterPayload?.attendanceScope?.recentRaidCap || 6);

    if (!player) {
      setStatTile("events", "—", "No Warcraft Logs row matched your linked characters yet.");
      setStatTile("attendance", "—");
      setStatTile("peak-parse", "—");
      setStatTile(
        "guild-rank",
        "—",
        "Guild rank is set on the Account Assignment table — ask an admin to map your Discord ID.",
      );
      return;
    }

    const events = Number(player.wclEventCount ?? player.rhPastEventCount ?? 0);
    setStatTile(
      "events",
      events > 0 ? events.toString() : "0",
      "Distinct guild raid reports on Warcraft Logs (admin-curated event scope).",
    );

    const attendance = Number(player.attendanceRate);
    setStatTile(
      "attendance",
      Number.isFinite(attendance) && attendance > 0 ? `${Math.round(attendance)}%` : "—",
      `Last ${recentCap} 25-player raids: ${Number(player.raidsAttended || 0)}/${recentCap}.`,
    );

    const { value: peakValue, bracket } = pickPeakParseFromPlayer(player);
    const bracketLabel = bracket === "heal" ? "HPS" : bracket === "tank" ? "Tank DPS" : "DPS";
    setStatTile(
      "peak-parse",
      peakValue != null ? `${Math.round(peakValue)}%` : "—",
      peakValue != null
        ? `Best single-boss percentile across the tracked window (${bracketLabel}).`
        : "No WCL parse in the tracked window yet.",
    );

    const rank = String(player.guildRole || "").trim() || "Peon";
    setStatTile(
      "guild-rank",
      rank,
      "Set on the Account Assignment table — ask an admin to update your row.",
    );
  }

  async function uploadPictureBlob(blob) {
    if (!blob) return;
    if (!ALLOWED_MIME.has(blob.type)) {
      setStatus(els.pictureStatus, "Pick a JPEG, PNG, WebP, or GIF image.", "error");
      return;
    }
    if (blob.size > MAX_BYTES) {
      setStatus(els.pictureStatus, "That image is over the 4 MB limit.", "error");
      return;
    }
    setStatus(els.pictureStatus, "Uploading…", "busy");
    try {
      const res = await fetch("/api/profile/me/picture", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) throw new Error(payload?.error || "Upload failed");
      lastProfile = payload.profile;
      applyPictureToUI(payload.profile);
      // Bust the leaderboard / Hall of Fame session caches so the next
      // navigation re-fetches active-roster + profile pictures and the
      // newly-uploaded avatar replaces the class crest immediately.
      try {
        window.plbSessionApiCache?.clearAll();
      } catch {
        /* ignore */
      }
      setStatus(els.pictureStatus, "Saved. It will replace your class crest across the site.", "success");
    } catch (error) {
      setStatus(els.pictureStatus, error?.message || "Upload failed", "error");
    }
  }

  async function removePicture() {
    setStatus(els.pictureStatus, "Removing…", "busy");
    try {
      const res = await fetch("/api/profile/me/picture", {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) throw new Error(payload?.error || "Failed to remove picture");
      lastProfile = payload.profile;
      applyPictureToUI(payload.profile);
      try {
        window.plbSessionApiCache?.clearAll();
      } catch {
        /* ignore */
      }
      setStatus(els.pictureStatus, "Picture removed.", "success");
    } catch (error) {
      setStatus(els.pictureStatus, error?.message || "Failed to remove picture", "error");
    }
  }

  async function saveMainCharacter() {
    const value = String(els.mainSelect.value || "").trim();
    els.mainSaveBtn.disabled = true;
    els.mainHint.textContent = "Saving…";
    try {
      const res = await fetch("/api/profile/me/main-character", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainCharacterName: value }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) throw new Error(payload?.error || "Failed to save main character");
      lastProfile = payload.profile;
      savedMainCharacterName = payload?.profile?.mainCharacterName || "";
      els.mainHint.textContent = savedMainCharacterName
        ? `Main character set to ${savedMainCharacterName}.`
        : "Main character cleared.";
    } catch (error) {
      els.mainHint.textContent = error?.message || "Failed to save";
      els.mainSaveBtn.disabled = false;
    }
  }

  async function loadBadges() {
    if (!els.badgesHost) return;
    /* Pre-warm the WCL fan-out (`/attendance`, `/boss-times`,
       `/voting/hall-of-fame`, `/first-clear-participants`,
       `/death-leaderboard`) in parallel with the badges fetch so the
       Achievements row resolves as soon as the slowest of the two
       finishes — instead of waiting until *after* the server response
       renders before kicking it off (the previous serial behaviour). */
    const plb = window.plbEventsRoster;
    const wclWarmup =
      plb && typeof plb.loadWclAttendanceForEvents === "function"
        ? plb.loadWclAttendanceForEvents({ skipCache: true }).catch((error) => {
            console.warn("[profile] WCL pre-warm failed:", error?.message || error);
          })
        : Promise.resolve();
    try {
      const res = await fetch("/api/profile/me/badges", { credentials: "include" });
      if (res.status === 401) {
        els.badgesHost.innerHTML = '<p class="subtle">Sign in to view your badges.</p>';
        return;
      }
      const payload = await res.json();
      if (!payload?.ok) throw new Error(payload?.error || "Failed to load badges");
      const categories = Array.isArray(payload.categories) ? payload.categories : [];
      if (!categories.length) {
        els.badgesHost.innerHTML = '<p class="subtle">No badges defined yet.</p>';
        return;
      }
      const lazyBadgeIds = Array.isArray(payload.lazyBadges) ? payload.lazyBadges : [];
      els.badgesHost.innerHTML = categories
        .map((cat) => renderBadgeCategoryHtml(cat, lazyBadgeIds))
        .join("");

      // Lazy second-pass: re-run the leaderboard's badge matchers against the
      // user's linked WoW characters so iron-attendance / parsing-ceiling /
      // most-deaths-last-6 / best-time-participant + the achievements scanned
      // by name (HoF, first clears) all light up — even when the server-side
      // resolver missed them (e.g. linked names not present on the Account
      // Assignment row, cold WCL cache, etc.).
      const linkedCharacters = Array.isArray(payload.linkedCharacters) ? payload.linkedCharacters : [];
      resolveBadgesClientSide(linkedCharacters, categories, wclWarmup).catch(() => {
        /* leaderboard-only badges stay locked if WCL data is unavailable */
      });
    } catch (error) {
      els.badgesHost.innerHTML = `<p class="subtle is-error">${escapeHtml(error?.message || "Failed to load badges")}</p>`;
    }
  }

  function renderBadgeCategoryHtml(cat, lazyBadgeIds) {
    const lazySet = new Set(Array.isArray(lazyBadgeIds) ? lazyBadgeIds : []);
    const hasLazy = (cat.badges || []).some((b) => lazySet.has(b.id));
    const earnedCount = (cat.badges || []).filter((b) => b.earned).length;
    const total = (cat.badges || []).length;
    const items = (cat.badges || [])
      .map((b) => {
        const cls = b.earned
          ? "profile-badge-tile achievement-badge-container is-earned"
          : "profile-badge-tile achievement-badge-container is-locked";
        const desc = `${b.name} — ${b.description || b.defaultDescription || (b.earned ? "earned" : "not yet earned")}`;
        return `
          <div class="${cls}" data-badge-id="${escapeHtml(b.id)}" aria-label="${escapeHtml(desc)}">
            <div class="profile-badge-tile-icon achievement-badge-frame" aria-hidden="true">
              <img class="achievement-badge-img" src="${escapeHtml(b.icon)}" alt="${escapeHtml(b.name)}" loading="lazy" decoding="async" />
              <span class="achievement-badge-glow" aria-hidden="true"></span>
            </div>
            <span class="profile-badge-name">${escapeHtml(b.name)}</span>
            ${badgeTooltipHtml(b, b.earned)}
          </div>`;
      })
      .join("");
    const meterHtml = hasLazy
      ? `<span class="profile-badge-resolving" title="Looking up Warcraft Logs…">resolving…</span>`
      : `${earnedCount} / ${total}`;
    const resolvingHint = hasLazy
      ? `<p class="subtle profile-badge-resolving-hint">Looking up Warcraft Logs… achievements light up once your linked characters are matched.</p>`
      : "";
    return `
      <section class="profile-badge-category${hasLazy ? " is-resolving" : ""}" data-category-id="${escapeHtml(cat.id || "")}">
        <header class="profile-badge-category-head">
          <h4 class="profile-badge-category-title">${escapeHtml(cat.label)}</h4>
          <span class="profile-badge-category-meter" data-meter-total="${total}">${meterHtml}</span>
        </header>
        ${cat.description ? `<p class="subtle profile-badge-category-desc">${escapeHtml(cat.description)}</p>` : ""}
        ${resolvingHint}
        <div class="profile-badge-grid">${items}</div>
      </section>`;
  }

  /**
   * Run the leaderboard's badge matchers against the user's linked characters.
   * Each `linkedCharacters` entry is treated as a possible identity for the
   * user — we OR the results so any character hitting a matcher unlocks the
   * badge. After resolution, swap tile classes from `is-locked` to `is-earned`
   * and update each category's "x / total" meter.
   */
  async function resolveBadgesClientSide(linkedCharacters, serverCategories, wclPrefetch) {
    const plb = window.plbEventsRoster;
    if (!plb || typeof plb.loadWclAttendanceForEvents !== "function") return;
    const names = (linkedCharacters || []).map((s) => String(s || "").trim()).filter(Boolean);
    if (!names.length) {
      // Even with no linked characters, drop the "resolving…" placeholders so
      // the meter doesn't sit stuck on "resolving…" forever for a brand-new
      // user without an Account Assignment row.
      finalizeLazyBadgeCategoriesUI();
      return;
    }

    /* Prefer the prefetch promise kicked off by `loadBadges` so we don't fire
       a second WCL fan-out. Fall back to a fresh load if the caller didn't
       pre-warm (e.g. a future caller). */
    if (wclPrefetch && typeof wclPrefetch.then === "function") {
      await wclPrefetch;
    } else {
      await plb.loadWclAttendanceForEvents({ skipCache: true });
    }

    const resolvers = {
      "best-time-participant": plb.playerEarnedBestTimeParticipantBadge,
      "hall-of-fame": plb.playerEarnedHallOfFameMvpBadge,
      "most-deaths-last-6-raids": plb.playerEarnedMostDeathsLastSixBadge,
      "iron-attendance": plb.playerEarnedIronAttendanceBadge,
      "parsing-ceiling": plb.playerEarnedParsingCeilingBadge,
      "kara-first-time-clear": plb.playerEarnedFirstClearKaraBadge,
      "gruul-first-time-clear": plb.playerEarnedFirstClearGruulBadge,
      "magtheridon-first-time-clear": plb.playerEarnedFirstClearMagBadge,
      "raids-with-guild-5": (p) => plb.playerEarnedRaidsWithGuildMilestone(p, 5),
      "raids-with-guild-10": (p) => plb.playerEarnedRaidsWithGuildMilestone(p, 10),
      "raids-with-guild-25": (p) => plb.playerEarnedRaidsWithGuildMilestone(p, 25),
      "raids-with-guild-50": (p) => plb.playerEarnedRaidsWithGuildMilestone(p, 50),
      "raids-with-guild-100": (p) => plb.playerEarnedRaidsWithGuildMilestone(p, 100),
      "aoe-cleave":
        typeof plb.playerEarnedSpecificEventBadge === "function"
          ? (p) => plb.playerEarnedSpecificEventBadge(p, "aoe-cleave")
          : () => false,
    };

    // Synthetic "player" — feeding the user's primary linked name as
    // characterName + every linked name as wclCharacters covers both code
    // paths in `attendanceLookupNameCandidates` / `playerMatchesAchievementNameSet`.
    const synthPlayer = {
      characterName: names[0],
      name: names[0],
      wclCharacters: names.slice(),
    };
    const attRow =
      typeof plb.attendanceRowForRosterPlayerResolved === "function"
        ? plb.attendanceRowForRosterPlayerResolved(synthPlayer)
        : null;
    let rosterPlayer = null;
    try {
      const guildId = window.plbEventsRoster?.EVENTS_WCL_GUILD_ID || 817080;
      const res = await fetch(
        `/api/wcl/guild/${guildId}/active-roster?limit=40&top=250&maxRhPastEvents=0&_badgeBust=${Date.now()}`,
        { credentials: "include", cache: "no-store" },
      );
      const rosterPayload = res.ok ? await res.json() : { players: [] };
      rosterPlayer = findRosterRowForLinkedNames(
        rosterPayload,
        linkedCharacters,
        lastProfile?.mainCharacterName || null,
      );
    } catch {
      rosterPlayer = null;
    }

    const synthPlayerMerged = {
      ...synthPlayer,
      wclEventCount: attRow?.wclEventCount,
      rhPastEventCount: attRow?.rhPastEventCount,
      ...(Array.isArray(rosterPlayer?.specificEventBadges)
        ? { specificEventBadges: rosterPlayer.specificEventBadges }
        : {}),
    };

    const earnedFromClient = new Set();
    for (const [badgeId, fn] of Object.entries(resolvers)) {
      if (typeof fn !== "function") continue;
      try {
        if (fn(synthPlayerMerged)) earnedFromClient.add(badgeId);
      } catch {
        /* one bad matcher shouldn't kill the rest */
      }
    }

    // Server-side resolution wins where it already says "earned"; client
    // resolution is additive (it only ever upgrades a tile from locked → earned).
    const serverEarnedIds = new Set();
    for (const cat of serverCategories || []) {
      for (const b of cat.badges || []) {
        if (b?.earned && b?.id) serverEarnedIds.add(b.id);
      }
    }

    if (!els.badgesHost) return;
    const tiles = els.badgesHost.querySelectorAll("[data-badge-id]");
    tiles.forEach((tile) => {
      const id = tile.getAttribute("data-badge-id") || "";
      const img = tile.querySelector("img");
      const badgeName = img?.getAttribute("alt") || id;
      const currentTitle = String(tile.getAttribute("aria-label") || "");
      const description = currentTitle.includes(" — ") ? currentTitle.slice(currentTitle.indexOf(" — ") + 3) : "";
      const accessibleLabel = `${badgeName}${description ? ` — ${description}` : ""}`;

      const isEarnedNow = serverEarnedIds.has(id) || earnedFromClient.has(id);

      if (isEarnedNow) {
        if (tile.classList.contains("is-earned")) return;
        tile.classList.remove("is-locked");
        tile.classList.add("is-earned");
        tile.setAttribute("aria-label", accessibleLabel);
        return;
      }

      if (tile.classList.contains("is-earned")) {
        tile.classList.remove("is-earned");
        tile.classList.add("is-locked");
        tile.setAttribute("aria-label", accessibleLabel);
      }
    });

    finalizeLazyBadgeCategoriesUI();
  }

  /**
   * Replace the "resolving…" indicator on lazy categories with the real
   * `earned / total` count and remove the temporary hint text. Also recounts
   * meters on every category so first-clear / milestone tiles stay in sync
   * after client-side resolution.
   */
  function finalizeLazyBadgeCategoriesUI() {
    if (!els.badgesHost) return;
    const categories = els.badgesHost.querySelectorAll(".profile-badge-category");
    categories.forEach((cat) => {
      const total = cat.querySelector(".profile-badge-category-meter")?.getAttribute("data-meter-total");
      const earned = cat.querySelectorAll(".profile-badge-tile.is-earned").length;
      const meter = cat.querySelector(".profile-badge-category-meter");
      if (meter && total != null) meter.textContent = `${earned} / ${total}`;
      cat.classList.remove("is-resolving");
      const hint = cat.querySelector(".profile-badge-resolving-hint");
      if (hint) hint.remove();
    });
  }

  function bindUI() {
    if (!els.drop || !els.fileInput) return;

    els.chooseBtn?.addEventListener("click", () => els.fileInput.click());
    els.drop.addEventListener("click", (event) => {
      // Don't trigger the file picker when the user clicks inside the buttons row below.
      if (event.target instanceof HTMLElement && event.target.closest(".profile-picture-actions")) return;
      els.fileInput.click();
    });
    els.drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        els.fileInput.click();
      }
    });
    els.fileInput.addEventListener("change", () => {
      const file = els.fileInput.files?.[0];
      if (file) uploadPictureBlob(file);
      els.fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach((evt) =>
      els.drop.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        els.drop.classList.add("is-drag-over");
      })
    );
    ["dragleave", "drop"].forEach((evt) =>
      els.drop.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        els.drop.classList.remove("is-drag-over");
      })
    );
    els.drop.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) uploadPictureBlob(file);
    });

    els.removeBtn?.addEventListener("click", () => removePicture());

    els.mainSelect?.addEventListener("change", () => {
      const value = String(els.mainSelect.value || "").trim();
      els.mainSaveBtn.disabled = value === (savedMainCharacterName || "");
    });
    els.mainSaveBtn?.addEventListener("click", () => saveMainCharacter());
  }

  async function init() {
    bindUI();
    bindSubnav();
    const authed = await fetchAuthState();
    if (!authed) {
      showLockedState();
      return;
    }
    await Promise.all([loadProfile(), loadBadges()]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
