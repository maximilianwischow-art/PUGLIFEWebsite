function escJoin(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const JOIN_PAGE_NEXT = "/join.html#join-future-events";
const JOIN_DISCORD_INVITE = "https://discord.gg/TBnt5f8DFc";
const JOIN_EVENT_IMG_VER = "20260504j";
const JOIN_GUILD_ID = 817080;
const JOIN_DISCORD_CLICKED_KEY = "plb_join_discord_clicked_v1";
const JOIN_CLASS_LABELS = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];

let joinSpecIconsReady = null;
let joinSpecIconByKey = new Map();
let joinSpecIconBySpecOnly = new Map();

/* ─────────────────────────── Conversion tracking ─────────────────────────── */

/** Best-effort beacon to /api/analytics/track. Never blocks UI; never throws. */
function trackJoinEvent(category, label) {
  try {
    const body = JSON.stringify({
      type: "event",
      category: String(category || "").slice(0, 60),
      label: String(label || "").slice(0, 120),
      path: "/join.html",
      title: String(document.title || "").slice(0, 160),
      sessionId: (() => {
        try {
          return window.sessionStorage.getItem("plb_analytics_session_v1") || "";
        } catch {
          return "";
        }
      })(),
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/analytics/track", blob)) return;
    }
    fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

function markDiscordClickedThisSession() {
  try {
    window.sessionStorage.setItem(JOIN_DISCORD_CLICKED_KEY, "1");
  } catch {
    /* ignore */
  }
}

function hasClickedDiscordThisSession() {
  try {
    return window.sessionStorage.getItem(JOIN_DISCORD_CLICKED_KEY) === "1";
  } catch {
    return false;
  }
}

function joinIconSlug(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function joinNormalizeSpecSlug(specName, className = "") {
  const spec = joinIconSlug(specName);
  const cls = joinIconSlug(className);
  if (cls === "druid" && spec === "feral") return "feralcombat";
  if (cls === "hunter" && (spec === "beastmaster" || spec === "bm")) return "beastmastery";
  if (cls === "paladin" && spec === "ret") return "retribution";
  return spec;
}

function joinSpecIconKey(className, specName) {
  const cls = joinIconSlug(className);
  const spec = joinNormalizeSpecSlug(specName, className);
  return cls && spec ? `${cls}_${spec}` : "";
}

async function loadJoinSpecIcons() {
  if (joinSpecIconsReady) return joinSpecIconsReady;
  joinSpecIconsReady = (async () => {
    try {
      const res = await fetch("/tbc-spec-icons.json", { credentials: "same-origin" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("Failed to load spec icons");
      const byKey = new Map();
      const bySpecOnly = new Map();
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      for (const entry of entries) {
        const iconUrl = String(entry?.iconUrl || "").trim();
        const className = String(entry?.className || "").trim();
        const specName = String(entry?.specName || "").trim();
        const key = String(entry?.key || joinSpecIconKey(className, specName)).trim().toLowerCase();
        if (!key || !iconUrl) continue;
        byKey.set(key, { iconUrl, className, specName });
        const specOnly = joinNormalizeSpecSlug(specName, className);
        if (specOnly) {
          bySpecOnly.set(specOnly, bySpecOnly.has(specOnly) ? null : { iconUrl, className, specName });
        }
      }
      joinSpecIconByKey = byKey;
      joinSpecIconBySpecOnly = bySpecOnly;
    } catch {
      joinSpecIconByKey = new Map();
      joinSpecIconBySpecOnly = new Map();
    }
    return joinSpecIconByKey;
  })();
  return joinSpecIconsReady;
}

/* ─────────────────────────── Subscribe button ─────────────────────────── */

async function apiJson(url, init) {
  const res = await fetch(url, { credentials: "include", ...(init || {}) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${res.status})`);
  return payload;
}

function joinSubscribeButtons() {
  return Array.from(document.querySelectorAll("[data-track-subscribe]"));
}

function setSubscribeButtonState(state) {
  const buttons = joinSubscribeButtons();
  if (!buttons.length) return;
  const microcopy = document.getElementById("joinSubscribeMicrocopy");
  let labelText = "Get raid DM alerts";
  let symbol = "○";
  let title = "Subscribe to Discord DM for SignUps";
  let microText = "DM the moment new raids open. No spam, unsubscribe anytime.";
  if (state === "loading") {
    labelText = "Connecting Discord…";
    symbol = "⋯";
    microText = "Authenticating with Discord — this only takes a second.";
  } else if (state === "subscribed") {
    labelText = "DM alerts on";
    symbol = "✓";
    title = "You are subscribed to Discord DM for SignUps";
    microText = "You're on the list. We'll DM you the moment new raids open.";
  }
  for (const btn of buttons) {
    const textEl = btn.querySelector(".join-subscribe-btn-text");
    const statusEl = btn.querySelector(".join-subscribe-btn-status");
    if (textEl) textEl.textContent = labelText;
    else btn.textContent = labelText;
    if (statusEl) statusEl.textContent = symbol;
    btn.setAttribute("title", title);
    btn.setAttribute("aria-label", title);
    if (state === "loading") {
      btn.setAttribute("aria-busy", "true");
    } else {
      btn.removeAttribute("aria-busy");
    }
    btn.classList.toggle("join-discord-btn--subscribed", state === "subscribed");
  }
  if (microcopy) microcopy.textContent = microText;
}

function showJoinSubscribePopup() {
  const backdrop = document.getElementById("joinSubscribePopupBackdrop");
  const card = document.getElementById("joinSubscribePopupCard");
  if (!backdrop || !card) return;
  backdrop.hidden = false;
  card.hidden = false;
}

function hideJoinSubscribePopup() {
  const backdrop = document.getElementById("joinSubscribePopupBackdrop");
  const card = document.getElementById("joinSubscribePopupCard");
  if (!backdrop || !card) return;
  backdrop.hidden = true;
  card.hidden = true;
}

async function handleJoinDmSubscribeClick(event) {
  const btn = event.currentTarget;
  const placement = String(btn?.getAttribute("data-track-subscribe") || "hero");
  trackJoinEvent("subscribe_click", placement);
  event.preventDefault();
  setSubscribeButtonState("loading");
  try {
    const me = await apiJson("/api/auth/me");
    if (!me?.authenticated) {
      const next = encodeURIComponent("/join.html?subscribe_dm=1");
      window.location.href = `/auth/discord/login?next=${next}`;
      return;
    }
    const out = await apiJson("/api/join/dm-subscription", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscribed: true }),
    });
    setSubscribeButtonState(out?.subscribed ? "subscribed" : "idle");
    if (out?.subscribed) {
      trackJoinEvent("subscribe_success", placement);
      showJoinSubscribePopup();
    }
  } catch (_error) {
    setSubscribeButtonState("idle");
  }
}

async function initJoinDmSubscriptionButton() {
  const buttons = joinSubscribeButtons();
  if (!buttons.length) return;
  for (const btn of buttons) btn.addEventListener("click", handleJoinDmSubscribeClick);
  const params = new URLSearchParams(window.location.search);
  const shouldAutoSubscribe = params.get("subscribe_dm") === "1";
  const shouldAutoUnsubscribe = params.get("unsubscribe_dm") === "1";
  try {
    const me = await apiJson("/api/auth/me");
    if (!me?.authenticated) {
      if (shouldAutoUnsubscribe) {
        const next = encodeURIComponent("/join.html?unsubscribe_dm=1");
        window.location.href = `/auth/discord/login?next=${next}`;
        return;
      }
      setSubscribeButtonState("idle");
      return;
    }
    if (shouldAutoUnsubscribe) {
      await apiJson("/api/join/dm-subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribed: false }),
      });
      setSubscribeButtonState("idle");
      const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
      window.history.replaceState(null, "", cleanUrl);
      return;
    }
    const state = await apiJson("/api/join/dm-subscription");
    if (state?.subscribed) {
      setSubscribeButtonState("subscribed");
      return;
    }
    if (shouldAutoSubscribe) {
      await apiJson("/api/join/dm-subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribed: true }),
      });
      setSubscribeButtonState("subscribed");
      trackJoinEvent("subscribe_success", "redirect-return");
      showJoinSubscribePopup();
      const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
      window.history.replaceState(null, "", cleanUrl);
      return;
    }
    setSubscribeButtonState("idle");
  } catch {
    setSubscribeButtonState("idle");
  }
}

initJoinDmSubscriptionButton();

function initJoinSubscribePopup() {
  const closeBtn = document.getElementById("joinSubscribePopupClose");
  const okBtn = document.getElementById("joinSubscribePopupOk");
  const backdrop = document.getElementById("joinSubscribePopupBackdrop");
  closeBtn?.addEventListener("click", hideJoinSubscribePopup);
  okBtn?.addEventListener("click", hideJoinSubscribePopup);
  backdrop?.addEventListener("click", hideJoinSubscribePopup);
}

initJoinSubscribePopup();

/* ─────────────────────────── Discord click tracking + smart mobile CTA ─────────────────────────── */

function setMobileCtaMode(mode) {
  const cta = document.getElementById("joinMobileCta");
  if (!cta) return;
  if (mode === "subscribe") {
    cta.textContent = "Get raid DM alerts";
    cta.setAttribute("href", "/auth/discord/login?next=%2Fjoin.html%3Fsubscribe_dm%3D1");
    cta.removeAttribute("target");
    cta.removeAttribute("rel");
    cta.setAttribute("data-mode", "subscribe");
    cta.setAttribute("data-track-subscribe", "mobile-sticky");
    cta.removeAttribute("data-track-discord");
  } else {
    cta.textContent = "Join our Discord";
    cta.setAttribute("href", JOIN_DISCORD_INVITE);
    cta.setAttribute("target", "_blank");
    cta.setAttribute("rel", "noopener noreferrer");
    cta.setAttribute("data-mode", "discord");
    cta.setAttribute("data-track-discord", "mobile-sticky");
    cta.removeAttribute("data-track-subscribe");
  }
}

function refreshMobileCtaForSession() {
  const cta = document.getElementById("joinMobileCta");
  if (!cta) return;
  const mode = hasClickedDiscordThisSession() ? "subscribe" : "discord";
  if (cta.getAttribute("data-mode") !== mode) setMobileCtaMode(mode);
}

function initDiscordClickTracking() {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const discordEl = target.closest("[data-track-discord]");
    if (discordEl) {
      const placement = String(discordEl.getAttribute("data-track-discord") || "");
      trackJoinEvent("discord_click", placement);
      const href = String(discordEl.getAttribute("href") || "");
      if (/discord\.gg\//i.test(href)) {
        markDiscordClickedThisSession();
        // After a small delay, swap mobile CTA so the next mobile interaction biases toward subscribe.
        setTimeout(refreshMobileCtaForSession, 200);
      }
      return;
    }
    // Subscribe-button clicks are handled by handleJoinDmSubscribeClick via direct listeners; the
    // mobile sticky CTA, when in subscribe mode, also has data-track-subscribe but its anchor will
    // navigate to /auth/discord/login — we still record the intent here for clarity.
    const subscribeEl = target.closest("[data-track-subscribe]");
    if (subscribeEl && subscribeEl.id !== "joinDmSubscribeBtn" && subscribeEl.id !== "joinFooterSubscribeBtn") {
      const placement = String(subscribeEl.getAttribute("data-track-subscribe") || "");
      trackJoinEvent("subscribe_click", placement);
    }
  });
  refreshMobileCtaForSession();
}

initDiscordClickTracking();

/* ─────────────────────────── Trust strip (boss-times + Event Management meta) ─────────────────────────── */

async function loadJoinTrustStrip() {
  const strip = document.getElementById("joinTrustStrip");
  if (!strip) return;
  const raidersEl = strip.querySelector('[data-trust="raiders"]');
  const curatedEl = strip.querySelector('[data-trust="curated-count"]');
  const raidersStat = strip.querySelector('[data-trust-stat="raiders"]');
  const curatedStat = strip.querySelector('[data-trust-stat="curated"]');

  try {
    const [bossRes, emRes] = await Promise.all([
      fetch(`/api/wcl/guild/${JOIN_GUILD_ID}/boss-times?limit=40&scope=public&live=1`, {
        credentials: "same-origin",
      }),
      fetch("/api/join/event-management-selection", { credentials: "same-origin" }),
    ]);

    const payload = await bossRes.json().catch(() => ({}));
    const emPayload = await emRes.json().catch(() => ({}));

    if (!bossRes.ok) {
      if (raidersEl) raidersEl.textContent = "—";
    } else {
      const source = String(payload?.rosterInfo?.source || "");
      if (raidersStat) {
        if (source === "event_management") {
          raidersStat.title =
            "Warcraft Logs: unique names on the ranked roster from reports selected in Admin → Event Management.";
        } else if (source === "join_public_fallback") {
          raidersStat.title =
            "Warcraft Logs: unique ranked roster names from recent guild logs (no reports selected in Event Management yet — choose them in Admin).";
        } else {
          raidersStat.title =
            "Warcraft Logs: no Event Management selections and no roster sample loaded yet.";
        }
      }
      const raiders = Number(payload?.rosterInfo?.rankedRosterCount || 0);
      if (raidersEl) raidersEl.textContent = raiders > 0 ? String(raiders) : "—";
    }

    const emCount =
      emRes.ok && emPayload?.ok === true && Number.isFinite(Number(emPayload.count))
        ? Number(emPayload.count)
        : Array.isArray(payload?.rosterInfo?.selectedReportCodes)
          ? payload.rosterInfo.selectedReportCodes.filter(Boolean).length
          : 0;
    const countSource = String(emPayload?.countSource || "");
    if (curatedStat) {
      if (countSource === "sqlite_raid_appearances_fallback") {
        curatedStat.title =
          "Distinct Warcraft Logs raid reports with roster data stored on this server. Your gargul-loot-history.json has no Event Management list yet — click Save Event Selection in Admin after ticking raids so this matches your curated IDs exactly.";
      } else {
        curatedStat.title =
          "Number of Warcraft Logs report codes selected in Admin → Event Management (same scope as leaderboard / attendance).";
      }
    }
    if (curatedEl) curatedEl.textContent = String(emCount);
  } catch {
    if (raidersEl) raidersEl.textContent = "—";
    if (curatedEl) curatedEl.textContent = "—";
  }
}

loadJoinTrustStrip();

/* ─────────────────────────── Future Events (compact tiles + hero capsule) ─────────────────────────── */

function joinVersionedRaidImage(path) {
  const p = String(path || "").trim();
  if (!p) return "";
  const sep = p.includes("?") ? "&" : "?";
  return `${p}${sep}v=${JOIN_EVENT_IMG_VER}`;
}

function joinDetectEventRaids(event) {
  const text = `${event?.title || ""} ${event?.description || ""}`.toLowerCase();
  const matches = [];
  const v = (p) => joinVersionedRaidImage(p);
  if (text.includes("karazhan") || /\bkara\b/.test(text)) {
    matches.push({ id: "kara", image: v("/raid-images/pb-header-kara.png"), squareImage: v("/raid-images/kara.png"), rosterCap: 10 });
  }
  if (text.includes("gruul")) {
    matches.push({ id: "gruul", image: v("/raid-images/pb-header-gruul.png"), squareImage: v("/raid-images/gruul.png"), rosterCap: 25 });
  }
  if (text.includes("magtheridon") || /\bmag\b/.test(text)) {
    matches.push({
      id: "mag",
      image: v("/raid-images/pb-header-magtheridon.png"),
      squareImage: v("/raid-images/magtheridon.png"),
      rosterCap: 25,
    });
  }
  if (text.includes("serpentshrine") || /\bssc\b/.test(text)) {
    matches.push({ id: "ssc", image: v("/raid-images/pb-header-ssc.png"), squareImage: v("/raid-images/ssc.png"), rosterCap: 25 });
  }
  if (text.includes("tempest keep") || /\btk\b/.test(text) || text.includes("the eye")) {
    matches.push({ id: "tk", image: v("/raid-images/pb-header-tk.png"), squareImage: v("/raid-images/tk.png"), rosterCap: 25 });
  }
  if (text.includes("zul'aman") || text.includes("zul aman") || /\bza\b/.test(text)) {
    matches.push({ id: "za", image: v("/raid-images/pb-header-kara.png"), squareImage: v("/raid-images/kara.png"), rosterCap: 10 });
  }
  if (!matches.length) {
    return [{ id: "fallback", image: v("/raid-images/pb-header-kara.png"), squareImage: v("/raid-images/kara.png"), rosterCap: 25 }];
  }
  return matches.slice(0, 2);
}

function joinRosterCapacityForEvent(event) {
  const raids = joinDetectEventRaids(event);
  if (!raids.some((raid) => raid.rosterCap === 25)) return 10;
  return 25;
}

function joinNonP2RaidHelperEvents(events) {
  return (events || []).filter((event) => String(event?.title || "").trim().toLowerCase() !== "p2 raids");
}

/** Next hero capsule: earliest upcoming **25-player** raid (Gruul/Mag/SSC/TK/…); avoids Kara/ZA 10-player rows when a Thu raid exists. */
function joinPickHeroNextRaidEvent(events) {
  const now = Math.floor(Date.now() / 1000);
  const rows = joinNonP2RaidHelperEvents(events)
    .filter((e) => Number(e?.startTime || 0) > 0)
    .sort((a, b) => Number(a.startTime) - Number(b.startTime));
  if (!rows.length) return null;
  const upcoming = rows.filter((e) => Number(e.startTime) >= now);
  const timeline = upcoming.length ? upcoming : rows;
  const preferred25 = timeline.filter((e) => joinRosterCapacityForEvent(e) === 25);
  return preferred25.length ? preferred25[0] : timeline[0];
}

function joinRoleCompositionTargets(capacity, roleTargets) {
  const fallback = capacity <= 10 ? { Tanks: 2, Healers: 2, Melee: 3, Ranged: 3 } : { Tanks: 3, Healers: 5, Melee: 8, Ranged: 9 };
  const src = roleTargets && typeof roleTargets === "object" ? roleTargets : {};
  const next = { ...fallback };
  for (const role of ["Tanks", "Healers", "Melee", "Ranged"]) {
    const value = Number(src[role]);
    if (Number.isFinite(value) && value >= 0) next[role] = Math.floor(value);
  }
  return next;
}

function joinRoleTargetCapacity(capacity, roleTargets) {
  const targets = joinRoleCompositionTargets(capacity, roleTargets);
  const total = Number(targets.Tanks || 0) + Number(targets.Healers || 0) + Number(targets.Melee || 0) + Number(targets.Ranged || 0);
  return total > 0 ? total : capacity;
}

function joinRoleGapLabel(role, n) {
  const labels = {
    Tanks: n === 1 ? "tank" : "tanks",
    Healers: n === 1 ? "healer" : "healers",
    Melee: "melee",
    Ranged: "ranged",
  };
  return labels[role] || role;
}

function joinFmtEventDateTime(unixSec) {
  if (!unixSec) return { date: "—", time: "—" };
  const dt = new Date(Number(unixSec) * 1000);
  if (Number.isNaN(dt.getTime())) return { date: "—", time: "—" };
  return {
    date: dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    time: dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

function joinPublicNeededSpecs(neededSpecs) {
  if (!Array.isArray(neededSpecs)) return [];
  return neededSpecs
    .map((row) => {
      const role = String(row?.role || "").trim();
      const spec = String(row?.spec || "").trim();
      const count = Math.max(0, Math.floor(Number(row?.count) || 0));
      return { role, spec, count };
    })
    .filter((row) => row.spec && row.count > 0);
}

function joinRoleProgressRowsHtml(rosterByRole, capacity, roleTargets) {
  const targets = joinRoleCompositionTargets(capacity, roleTargets);
  const rows = [
    {
      key: "tanks",
      label: "Tanks",
      current: Number(rosterByRole?.Tanks || 0),
      target: Number(targets.Tanks || 0),
    },
    {
      key: "healers",
      label: "Healers",
      current: Number(rosterByRole?.Healers || 0),
      target: Number(targets.Healers || 0),
    },
    {
      key: "dps",
      label: "DPS",
      current: Number(rosterByRole?.Melee || 0) + Number(rosterByRole?.Ranged || 0),
      target: Number(targets.Melee || 0) + Number(targets.Ranged || 0),
    },
  ];
  return `<div class="join-role-bars">${rows
    .map((row) => {
      const target = Math.max(1, Math.floor(Number(row.target || 0)));
      const current = Math.max(0, Math.floor(Number(row.current || 0)));
      const missing = Math.max(0, target - current);
      const value = Math.min(current, target);
      return `<div class="join-role-bar join-role-bar--${escJoin(row.key)}">
        <div class="join-role-bar-meta">
          <span class="join-role-bar-label">${escJoin(row.label)}</span>
          <span class="join-role-bar-count">${escJoin(String(current))}/${escJoin(String(target))}${
            missing > 0 ? ` <span>${escJoin(String(missing))} needed</span>` : ""
          }</span>
        </div>
        <progress class="join-role-progress join-role-progress--${escJoin(row.key)}" value="${escJoin(
          String(value)
        )}" max="${escJoin(String(target))}" aria-label="${escJoin(`${row.label}: ${current} of ${target}`)}"></progress>
      </div>`;
    })
    .join("")}</div>`;
}

function joinParseNeededSpecLabel(label) {
  const raw = String(label || "").trim();
  const lower = raw.toLowerCase();
  for (const className of JOIN_CLASS_LABELS) {
    const classLower = className.toLowerCase();
    if (lower === classLower) return { className, specName: "" };
    if (lower.endsWith(` ${classLower}`)) {
      return { className, specName: raw.slice(0, -className.length).trim() };
    }
  }
  return { className: "", specName: raw };
}

function joinSpecNeedIcon(row) {
  const parsed = joinParseNeededSpecLabel(row?.spec);
  const key = joinSpecIconKey(parsed.className, parsed.specName);
  if (key && joinSpecIconByKey.has(key)) return joinSpecIconByKey.get(key);
  const specOnly = joinNormalizeSpecSlug(parsed.specName || row?.spec || "", parsed.className);
  return specOnly ? joinSpecIconBySpecOnly.get(specOnly) || null : null;
}

function joinSpecNeedInitials(label) {
  const parsed = joinParseNeededSpecLabel(label);
  const base = parsed.specName || label;
  const initials = String(base || "")
    .split(/\s+/)
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "?";
}

function joinSpecIconNeedsHtml(neededSpecs, confirmed, capacity) {
  const specNeeds = joinPublicNeededSpecs(neededSpecs);
  if (!specNeeds.length) {
    return `<div class="join-spec-icon-needs join-spec-icon-needs--empty">
      <span>No specific spec blockers</span>
      <span class="join-event-gap-meta">${escJoin(String(confirmed))}/${escJoin(String(capacity))} confirmed</span>
    </div>`;
  }
  const maxVisibleSpecs = 12;
  const buttons = specNeeds.slice(0, maxVisibleSpecs).map((row) => {
    const label = `${row.count} ${row.spec}`;
    const icon = joinSpecNeedIcon(row);
    const iconMarkup = icon?.iconUrl
      ? `<img class="join-spec-icon-img" src="${escJoin(icon.iconUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
      : `<span class="join-spec-icon-fallback" aria-hidden="true">${escJoin(joinSpecNeedInitials(row.spec))}</span>`;
    return `<span class="join-spec-icon-btn" title="${escJoin(label)}" role="img" aria-label="${escJoin(label)}">
      ${iconMarkup}
      ${row.count > 1 ? `<span class="join-spec-icon-count">${escJoin(String(row.count))}</span>` : ""}
    </span>`;
  });
  const hiddenCount = specNeeds.length - buttons.length;
  if (hiddenCount > 0) {
    buttons.push(`<span class="join-spec-icon-more" title="${escJoin(String(hiddenCount))} more missing specs">+${escJoin(
      String(hiddenCount)
    )}</span>`);
  }
  return `<div class="join-spec-icon-needs">${buttons.join(
    ""
  )}<span class="join-event-gap-meta">${escJoin(String(confirmed))}/${escJoin(String(capacity))} confirmed</span></div>`;
}

function joinFormatCountdownRemaining(totalSec) {
  if (totalSec <= 0) return "Starting soon";
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d >= 1) return `${d}d ${h}h ${m}m`;
  if (totalSec >= 3600) return `${h}h ${m}m ${s}s`;
  if (totalSec >= 60) return `${m}m ${s}s`;
  return `${s}s`;
}

function joinMissingGapsHtml(rosterByRole, capacity, confirmed, neededSpecs, roleTargets) {
  const c = Math.max(0, Number(confirmed || 0));
  return `<div class="join-event-needs-summary" role="status">
    ${joinRoleProgressRowsHtml(rosterByRole, capacity, roleTargets)}
    ${joinSpecIconNeedsHtml(neededSpecs, c, capacity)}
  </div>`;
}

function joinSignupActionsHtml(event, isAuthenticated) {
  const eventId = String(event?.id || "");
  if (!isAuthenticated) {
    const next = encodeURIComponent(JOIN_PAGE_NEXT);
    return `<a href="/auth/discord/login?next=${next}" class="join-event-signup-btn" data-track-subscribe="event-tile-login">Login to sign up</a>`;
  }
  const currentStatus = String(event?.currentUserSignup?.status || "").toLowerCase();
  const isSignedUp = currentStatus === "primary";
  return `
      <button type="button" class="join-event-signup-btn" data-join-event-signup-action="${
        isSignedUp ? "signoff" : "signup"
      }" data-join-event-id="${escJoin(eventId)}">${isSignedUp ? "Sign off" : "Sign up"}</button>
      <a href="${escJoin(JOIN_DISCORD_INVITE)}" target="_blank" rel="noreferrer" class="join-event-signup-btn join-event-signup-btn--ghost" data-track-discord="event-tile">Discord</a>
    `;
}

async function joinSubmitSignupAction(eventId, action) {
  const method = action === "signoff" ? "DELETE" : "POST";
  const res = await fetch(`/api/raid-helper/events/${encodeURIComponent(eventId)}/signup`, {
    method,
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const next = encodeURIComponent(JOIN_PAGE_NEXT);
    window.location.href = `/auth/discord/login?next=${next}`;
    return;
  }
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error || "Failed to update signup");
  }
}

let joinEventsCountdownTimer = null;

function joinUpdateEventCountdowns() {
  const now = Math.floor(Date.now() / 1000);
  document.querySelectorAll("[data-join-event-start]").forEach((el) => {
    const start = Number(el.getAttribute("data-join-event-start"));
    const inner = el.querySelector(".join-event-countdown-value, .join-next-raid-countdown-value");
    if (!inner || !start) return;
    inner.textContent = joinFormatCountdownRemaining(start - now);
  });
}

function joinStartEventCountdowns() {
  if (joinEventsCountdownTimer != null) {
    clearInterval(joinEventsCountdownTimer);
    joinEventsCountdownTimer = null;
  }
  joinUpdateEventCountdowns();
  joinEventsCountdownTimer = setInterval(joinUpdateEventCountdowns, 1000);
}

async function joinLoadAuthMeForEvents() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    const payload = await res.json().catch(() => ({}));
    return payload?.authenticated ? payload : { authenticated: false };
  } catch {
    return { authenticated: false };
  }
}

function joinRenderHeroNextRaidCapsule(events) {
  const capsule = document.getElementById("joinNextRaidCapsule");
  if (!capsule) return;
  const next = joinPickHeroNextRaidEvent(events);
  if (!next || !Number(next.startTime)) {
    capsule.hidden = true;
    capsule.removeAttribute("data-join-event-start");
    return;
  }
  const titleEl = capsule.querySelector("[data-next-raid-title]");
  const whenEl = capsule.querySelector("[data-next-raid-when]");
  const countdownEl = capsule.querySelector("[data-next-raid-countdown]");
  const startSec = Number(next.startTime);
  const { date, time } = joinFmtEventDateTime(startSec);
  if (titleEl) titleEl.textContent = String(next.title || "Next raid");
  if (whenEl) whenEl.textContent = `${date} · ${time}`;
  capsule.setAttribute("data-join-event-start", String(startSec));
  if (countdownEl) {
    countdownEl.innerHTML = `
      <span class="join-next-raid-countdown-label">Starts in</span>
      <span class="join-next-raid-countdown-value">${escJoin(joinFormatCountdownRemaining(startSec - Math.floor(Date.now() / 1000)))}</span>
    `;
  }
  capsule.hidden = false;
}

function joinEventBannerSrc(event) {
  const raids = joinDetectEventRaids(event);
  return (
    String(event?.headerImage || "").trim() ||
    raids[0]?.image ||
    joinVersionedRaidImage("/raid-images/pb-header-kara.png")
  );
}

function joinEventSquareThumbSrc(event) {
  const raids = joinDetectEventRaids(event);
  return raids[0]?.squareImage || raids[0]?.image || joinVersionedRaidImage("/raid-images/kara.png");
}

function joinEventRosterCapacity(event) {
  return joinRosterCapacityForEvent(event);
}

function joinRenderFeaturedNextEvent(event, isAuthenticated) {
  const bannerSrc = joinEventBannerSrc(event);
  const cap = joinRoleTargetCapacity(joinEventRosterCapacity(event), event?.roleTargets);
  const confirmed = Number(event?.signups?.confirmed ?? 0);
  const signupsTotal = Number(event?.signups?.total ?? 0);
  const startSec = Number(event?.startTime || 0);
  const { date, time } = joinFmtEventDateTime(startSec);
  const gapsHtml = joinMissingGapsHtml(event?.rosterByRole, cap, confirmed, event?.neededSpecs, event?.roleTargets);
  const actions = joinSignupActionsHtml(event, isAuthenticated);

  return `
    <article class="join-featured-event" data-join-featured-event>
      <div class="join-featured-event-media" aria-hidden="true">
        <img src="${escJoin(bannerSrc)}" alt="" loading="eager" decoding="async" width="900" height="260" />
      </div>
      <div class="join-featured-event-content">
        <div class="join-featured-event-main">
          <p class="join-featured-event-kicker">Next raid</p>
          <h4 class="join-featured-event-title">${escJoin(event?.title || "Upcoming raid")}</h4>
          <div class="join-featured-event-time" data-join-event-start="${startSec}">
            <span class="join-featured-event-date">${escJoin(date)}</span>
            <span class="join-featured-event-hour">${escJoin(time)}</span>
            <span class="join-featured-event-countdown">
              <span class="join-event-countdown-label">Starts in</span>
              <span class="join-event-countdown-value">—</span>
            </span>
          </div>
        </div>
        <div class="join-featured-event-side">
          <div class="join-featured-event-roster">
            <span>${escJoin(String(confirmed))}/${escJoin(String(cap))} roster</span>
            <span>${escJoin(String(signupsTotal))} signups</span>
          </div>
          <div class="join-featured-event-needs">
            <span class="join-featured-event-label">Still needed</span>
            ${gapsHtml}
          </div>
          <div class="join-featured-event-signup">
            <span class="join-featured-event-label">Where to sign up</span>
            <div class="join-featured-event-actions">${actions}</div>
          </div>
        </div>
      </div>
    </article>`;
}

function joinRenderUpcomingEventCard(event, isAuthenticated) {
  const thumbSrc = joinEventSquareThumbSrc(event);
  const cap = joinRoleTargetCapacity(joinEventRosterCapacity(event), event?.roleTargets);
  const confirmed = Number(event?.signups?.confirmed ?? 0);
  const signupsTotal = Number(event?.signups?.total ?? 0);
  const gapsHtml = joinMissingGapsHtml(event?.rosterByRole, cap, confirmed, event?.neededSpecs, event?.roleTargets);
  const { date, time } = joinFmtEventDateTime(event?.startTime);
  const startSec = Number(event?.startTime || 0);
  const actions = joinSignupActionsHtml(event, isAuthenticated);

  return `
    <article class="join-upcoming-event-row">
      <div class="join-upcoming-event-thumb">
        <img src="${escJoin(thumbSrc)}" alt="" loading="lazy" decoding="async" width="180" height="180" />
      </div>
      <div class="join-upcoming-event-main">
        <h4 class="join-upcoming-event-title">${escJoin(event?.title || "Upcoming raid")}</h4>
        <div class="join-upcoming-event-when">
          <span class="join-upcoming-event-date">${escJoin(date)}</span>
          <span class="join-upcoming-event-time">${escJoin(time)}</span>
          <span class="join-upcoming-event-countdown" data-join-event-start="${startSec}">
            <span class="join-event-countdown-label">Starts in</span>
            <span class="join-event-countdown-value">—</span>
          </span>
        </div>
        <div class="join-upcoming-event-stats">
          <span title="Primary roster">${escJoin(String(confirmed))}/${escJoin(String(cap))} roster</span>
          <span title="Total signups incl. bench etc.">${escJoin(String(signupsTotal))} signups</span>
        </div>
      </div>
      <div class="join-upcoming-event-needs">
        <span class="join-upcoming-event-label">Still needed</span>
        ${gapsHtml}
      </div>
      <div class="join-upcoming-event-actions">
        ${actions}
      </div>
    </article>`;
}

function joinRenderFutureEvents(events, isAuthenticated) {
  const host = document.getElementById("joinEventsList");
  joinRenderHeroNextRaidCapsule(events);
  if (!host) return;

  const rows = (events || []).filter((event) => String(event?.title || "").trim().toLowerCase() !== "p2 raids");
  if (!rows.length) {
    host.innerHTML = `<p class="subtle join-events-empty">No upcoming events right now. Check Discord for the latest announcements.</p>`;
    return;
  }

  const featured = joinPickHeroNextRaidEvent(rows) || rows[0];
  const featuredId = String(featured?.id || "");
  const secondaryRows = rows.filter((event) => String(event?.id || "") !== featuredId);
  const secondaryHtml = secondaryRows.length
    ? `<div class="join-events-secondary">
        <div class="join-events-secondary-head">
          <span>More upcoming runs</span>
        </div>
        <div class="join-events-grid-secondary">
          ${secondaryRows.map((event) => joinRenderUpcomingEventCard(event, isAuthenticated)).join("")}
        </div>
      </div>`
    : "";

  host.innerHTML = `${joinRenderFeaturedNextEvent(featured, isAuthenticated)}${secondaryHtml}`;

  joinStartEventCountdowns();
}

async function loadJoinFutureEvents() {
  const host = document.getElementById("joinEventsList");
  if (!host) return;
  host.innerHTML = `<p class="subtle join-events-loading">Loading upcoming events…</p>`;
  try {
    const [me, payload] = await Promise.all([
      joinLoadAuthMeForEvents(),
      fetch("/api/raid-helper/future-events?joinSpecNeeds=3", { credentials: "include" }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
        return body;
      }),
      loadJoinSpecIcons(),
    ]);
    joinRenderFutureEvents(payload?.events || [], Boolean(me?.authenticated));
  } catch (err) {
    host.innerHTML = `<p class="subtle join-events-error">Could not load events. ${escJoin(err?.message || "Unknown error")}</p>`;
  }
}

function initJoinFutureEventsSection() {
  const host = document.getElementById("joinEventsList");
  if (!host) return;

  document.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-join-event-signup-action][data-join-event-id]");
    if (!btn) return;
    const eventId = String(btn.getAttribute("data-join-event-id") || "").trim();
    const action = String(btn.getAttribute("data-join-event-signup-action") || "").trim();
    if (!eventId || !action) return;
    if (action === "signup") trackJoinEvent("event_signup_click", eventId);
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = action === "signoff" ? "Signing off…" : "Signing up…";
    try {
      await joinSubmitSignupAction(eventId, action);
      await loadJoinFutureEvents();
    } catch (error) {
      btn.textContent = originalText;
      btn.disabled = false;
      window.alert(error?.message || "Failed to update signup");
    }
  });

  loadJoinFutureEvents();
}

initJoinFutureEventsSection();
