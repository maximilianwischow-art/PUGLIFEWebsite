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
  };

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
        "No Warcraft Logs character is linked to your Discord ID yet. Ask an admin to add a row on the Account Assignment table.";
      els.mainSelect.disabled = true;
      els.mainSaveBtn.disabled = true;
    } else {
      els.mainHint.textContent =
        linkedCharacters.length === 1
          ? "Only one character is linked — selecting it as your main is optional."
          : "Pick which of your linked characters represents you across the site.";
      els.mainSelect.disabled = false;
    }
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
      applyPictureToUI(payload.profile);
      applyMainCharacterToUI(payload.linkedCharacters || [], payload?.profile?.mainCharacterName || null);
      setStatus(els.pictureStatus, "");
    } catch (error) {
      setStatus(els.pictureStatus, error?.message || "Failed to load profile", "error");
    }
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
      els.badgesHost.innerHTML = categories.map(renderBadgeCategoryHtml).join("");

      // Lazy second-pass: re-run the leaderboard's badge matchers against the
      // user's linked WoW characters so iron-attendance / parsing-ceiling /
      // most-deaths-last-6 / best-time-participant + the achievements scanned
      // by name (HoF, first clears) all light up — even when the server-side
      // resolver missed them (e.g. linked names not present on the Account
      // Assignment row, cold WCL cache, etc.).
      const linkedCharacters = Array.isArray(payload.linkedCharacters) ? payload.linkedCharacters : [];
      resolveBadgesClientSide(linkedCharacters, categories).catch(() => {
        /* leaderboard-only badges stay locked if WCL data is unavailable */
      });
    } catch (error) {
      els.badgesHost.innerHTML = `<p class="subtle is-error">${escapeHtml(error?.message || "Failed to load badges")}</p>`;
    }
  }

  function renderBadgeCategoryHtml(cat) {
    const earnedCount = (cat.badges || []).filter((b) => b.earned).length;
    const total = (cat.badges || []).length;
    const items = (cat.badges || [])
      .map((b) => {
        const cls = b.earned ? "profile-badge-tile is-earned" : "profile-badge-tile is-locked";
        const desc = b.earned ? `${b.name} — earned` : `${b.name} — not yet earned`;
        return `
          <div class="${cls}" data-badge-id="${escapeHtml(b.id)}" title="${escapeHtml(desc)}">
            <img src="${escapeHtml(b.icon)}" alt="${escapeHtml(b.name)}" loading="lazy" decoding="async" />
            <span class="profile-badge-name">${escapeHtml(b.name)}</span>
          </div>`;
      })
      .join("");
    return `
      <section class="profile-badge-category" data-category-id="${escapeHtml(cat.id || "")}">
        <header class="profile-badge-category-head">
          <h4 class="profile-badge-category-title">${escapeHtml(cat.label)}</h4>
          <span class="profile-badge-category-meter" data-meter-total="${total}">${earnedCount} / ${total}</span>
        </header>
        ${cat.description ? `<p class="subtle profile-badge-category-desc">${escapeHtml(cat.description)}</p>` : ""}
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
  async function resolveBadgesClientSide(linkedCharacters, serverCategories) {
    const plb = window.plbEventsRoster;
    if (!plb || typeof plb.loadWclAttendanceForEvents !== "function") return;
    const names = (linkedCharacters || []).map((s) => String(s || "").trim()).filter(Boolean);
    if (!names.length) return;

    await plb.loadWclAttendanceForEvents({ skipCache: true });

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
    };

    // Synthetic "player" — feeding the user's primary linked name as
    // characterName + every linked name as wclCharacters covers both code
    // paths in `attendanceLookupNameCandidates` / `playerMatchesAchievementNameSet`.
    const synthPlayer = {
      characterName: names[0],
      name: names[0],
      wclCharacters: names.slice(),
    };

    const earnedFromClient = new Set();
    for (const [badgeId, fn] of Object.entries(resolvers)) {
      if (typeof fn !== "function") continue;
      try {
        if (fn(synthPlayer)) earnedFromClient.add(badgeId);
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
      const isEarnedNow = serverEarnedIds.has(id) || earnedFromClient.has(id);
      if (!isEarnedNow) return;
      if (tile.classList.contains("is-earned")) return;
      tile.classList.remove("is-locked");
      tile.classList.add("is-earned");
      const img = tile.querySelector("img");
      const name = img?.getAttribute("alt") || "";
      tile.setAttribute("title", `${name} — earned`);
    });

    // Recount each category meter.
    const categories = els.badgesHost.querySelectorAll(".profile-badge-category");
    categories.forEach((cat) => {
      const total = cat.querySelector(".profile-badge-category-meter")?.getAttribute("data-meter-total");
      const earned = cat.querySelectorAll(".profile-badge-tile.is-earned").length;
      const meter = cat.querySelector(".profile-badge-category-meter");
      if (meter && total != null) meter.textContent = `${earned} / ${total}`;
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
