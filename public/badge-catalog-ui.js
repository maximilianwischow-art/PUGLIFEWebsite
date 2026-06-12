/**
 * Shared badge grid renderer for profile + leaderboard expand panels.
 */
(function badgeCatalogUiMain() {
  const PHASE_TAB_ORDER = [
    { id: "P1", label: "P1" },
    { id: "P2", label: "P2" },
    { id: "performance", label: "Performance" },
    { id: "meta", label: "Guild" },
    { id: "P3", label: "P3" },
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
      "ssc-first-event": "#14b8a6",
      "ssc-first-clear": "#14b8a6",
      "tk-first-kael-kill": "#22c55e",
      "ssc-0611-2026": "#a855f7",
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

  function badgeFrameAttrs(badge) {
    const rarity = ["common", "rare", "epic", "legendary"].includes(String(badge?.rarity || ""))
      ? String(badge.rarity)
      : "epic";
    return `class="profile-badge-tile-icon achievement-badge-frame achievement-badge-frame--${escapeHtml(rarity)}"`;
  }

  function parseEarnedLazyInput(cat, earnedSetOrLazyIds) {
    if (earnedSetOrLazyIds && typeof earnedSetOrLazyIds === "object" && earnedSetOrLazyIds.earnedSet) {
      return {
        earnedSet: earnedSetOrLazyIds.earnedSet instanceof Set ? earnedSetOrLazyIds.earnedSet : new Set(),
        lazySet: new Set(Array.isArray(earnedSetOrLazyIds.lazyBadgeIds) ? earnedSetOrLazyIds.lazyBadgeIds : []),
      };
    }
    if (earnedSetOrLazyIds instanceof Set) {
      return { earnedSet: earnedSetOrLazyIds, lazySet: new Set() };
    }
    if (Array.isArray(earnedSetOrLazyIds)) {
      return {
        earnedSet: new Set((cat.badges || []).filter((b) => b.earned).map((b) => b.id)),
        lazySet: new Set(earnedSetOrLazyIds),
      };
    }
    return {
      earnedSet: new Set((cat.badges || []).filter((b) => b.earned).map((b) => b.id)),
      lazySet: new Set(),
    };
  }

  function renderBadgeCategoryHtml(cat, earnedSetOrLazyIds) {
    const { earnedSet, lazySet } = parseEarnedLazyInput(cat, earnedSetOrLazyIds);
    const hasLazy = (cat.badges || []).some((b) => lazySet.has(b.id));
    const earnedCount = (cat.badges || []).filter((b) => earnedSet.has(b.id) || b.earned).length;
    const total = (cat.badges || []).length;
    const catId = String(cat.id || "");
    const isGuildCategory = catId === "guild-rank" || catId === "raid-loyalty";
    const items = (cat.badges || [])
      .map((b) => {
        const isEarned = earnedSet.has(b.id) || !!b.earned;
        const isGuildRole =
          isGuildCategory || String(b.icon || "").includes("/guild-roles/");
        const cls = [
          isEarned
            ? "profile-badge-tile achievement-badge-container is-earned"
            : "profile-badge-tile achievement-badge-container is-locked",
          isGuildRole ? "profile-badge-tile--guild-role" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const desc = `${b.name} — ${b.description || b.defaultDescription || (isEarned ? "earned" : "not yet earned")}`;
        const plb = window.plbEventsRoster;
        const icon =
          plb && typeof plb.badgeIconSrcFromCatalogPath === "function"
            ? plb.badgeIconSrcFromCatalogPath(b.icon, b.id)
            : { src: String(b.icon || ""), onerror: "" };
        return `
          <div class="${cls}" data-badge-id="${escapeHtml(b.id)}" aria-label="${escapeHtml(desc)}">
            <div ${badgeFrameAttrs(b)} aria-hidden="true">
              <img class="achievement-badge-img" src="${escapeHtml(icon.src)}" alt="" loading="lazy" decoding="async"${icon.onerror} />
              <span class="achievement-badge-glow" aria-hidden="true"></span>
            </div>
            <span class="profile-badge-name">${escapeHtml(b.name)}</span>
            ${badgeTooltipHtml(b, isEarned)}
          </div>`;
      })
      .join("");
    const meterHtml = hasLazy
      ? `<span class="profile-badge-resolving" title="Looking up Warcraft Logs…">resolving…</span>`
      : `${earnedCount} / ${total}`;
    return `
      <section class="profile-badge-category${hasLazy ? " is-resolving" : ""}" data-category-id="${escapeHtml(cat.id || "")}" data-phase="${escapeHtml(cat.phase || "")}">
        <header class="profile-badge-category-head">
          <h4 class="profile-badge-category-title">${escapeHtml(cat.label)}</h4>
          <span class="profile-badge-category-meter" data-meter-total="${total}">${meterHtml}</span>
        </header>
        <div class="profile-badge-grid">${items}</div>
      </section>`;
  }

  function categoriesForPhase(categories, phaseId) {
    return (categories || []).filter((cat) => {
      const phase = String(cat.phase || "");
      const catId = String(cat.id || "");
      if (phaseId === "meta") {
        return phase === "meta" || catId === "guild-rank" || catId === "raid-loyalty";
      }
      if (phaseId === "performance") {
        return phase === "performance" || catId === "performance" || catId === "honour";
      }
      return phase === phaseId;
    });
  }

  function phaseHasBadges(categories, phaseId) {
    return categoriesForPhase(categories, phaseId).some((cat) => (cat.badges || []).length > 0);
  }

  function renderPhasedBadgePanel(categories, earnedBadgeIds, options) {
    const opts = options || {};
    const earnedSet = earnedBadgeIds instanceof Set ? earnedBadgeIds : new Set(earnedBadgeIds || []);
    const lazyBadgeIds = Array.isArray(opts.lazyBadgeIds) ? opts.lazyBadgeIds : [];
    const earnedInput = { earnedSet, lazyBadgeIds };
    const cats = Array.isArray(categories) ? categories : [];
    const includeMeta = opts.includeMeta !== false;
    const panelClass = String(opts.panelClass || "leaderboard-badge-panel").trim();
    const title = String(opts.title || "Badge collection").trim();
    const tabs = PHASE_TAB_ORDER.filter((tab) => {
      if (tab.id === "meta" && !includeMeta) return false;
      if (tab.id === "P3") return phaseHasBadges(cats, "P3");
      return phaseHasBadges(cats, tab.id);
    });
    const defaultTab = tabs[0]?.id || "P1";
    const tabButtons = tabs
      .map((tab, idx) => {
        const active = tab.id === defaultTab;
        return `<button type="button" class="badge-phase-tab${active ? " is-active" : ""}" data-badge-phase="${escapeHtml(tab.id)}" aria-selected="${active ? "true" : "false"}">${escapeHtml(tab.label)}</button>`;
      })
      .join("");
    const tabPanels = tabs
      .map((tab) => {
        const active = tab.id === defaultTab;
        const phaseCats = categoriesForPhase(cats, tab.id);
        const body = phaseCats.length
          ? phaseCats.map((cat) => renderBadgeCategoryHtml(cat, earnedInput)).join("")
          : `<p class="subtle">No badges in this phase yet.</p>`;
        return `<div class="badge-phase-panel${active ? " is-active" : ""}" data-badge-phase-panel="${escapeHtml(tab.id)}"${active ? "" : " hidden"}>${body}</div>`;
      })
      .join("");
    return `
      <div class="${escapeHtml(panelClass)}">
        <header class="leaderboard-badge-panel-head">
          <h3 class="leaderboard-badge-panel-title">${escapeHtml(title)}</h3>
        </header>
        <div class="badge-phase-tabs" role="tablist" aria-label="Badge phases">${tabButtons}</div>
        <div class="badge-phase-panels">${tabPanels}</div>
      </div>`;
  }

  function countAchievementBadges(categories) {
    let total = 0;
    for (const cat of categories || []) {
      if (String(cat.id || "") === "guild-rank") continue;
      total += (cat.badges || []).length;
    }
    return total;
  }

  function countEarnedAchievementBadges(categories, earnedBadgeIds) {
    const earnedSet = earnedBadgeIds instanceof Set ? earnedBadgeIds : new Set(earnedBadgeIds || []);
    const allIds = new Set();
    for (const cat of categories || []) {
      if (String(cat.id || "") === "guild-rank") continue;
      for (const b of cat.badges || []) allIds.add(b.id);
    }
    let n = 0;
    for (const id of earnedSet) {
      if (allIds.has(id)) n++;
    }
    return n;
  }

  function wirePhaseTabs(root) {
    if (!root || root.dataset.phaseTabsWired === "1") return;
    root.dataset.phaseTabsWired = "1";
    root.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-badge-phase]");
      if (!btn || !root.contains(btn)) return;
      const phase = btn.getAttribute("data-badge-phase");
      const tabs = root.querySelectorAll("[data-badge-phase]");
      const panels = root.querySelectorAll("[data-badge-phase-panel]");
      tabs.forEach((t) => {
        const on = t.getAttribute("data-badge-phase") === phase;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      panels.forEach((p) => {
        const on = p.getAttribute("data-badge-phase-panel") === phase;
        p.classList.toggle("is-active", on);
        p.hidden = !on;
      });
    });
  }

  window.plbBadgeCatalogUi = {
    escapeHtml,
    badgeTooltipHtml,
    badgeFrameAttrs,
    renderBadgeCategoryHtml,
    renderPhasedBadgePanel,
    countAchievementBadges,
    countEarnedAchievementBadges,
    wirePhaseTabs,
    achievementCategoriesFromCatalog: (categories) =>
      (categories || []).filter((cat) => cat.id !== "guild-rank" && (cat.badges || []).length > 0),
  };
})();
