function escJoin(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function joinPriorityClass(priority) {
  const key = String(priority || "").toLowerCase();
  if (key === "high") return "join-priority--high";
  if (key === "medium") return "join-priority--medium";
  return "join-priority--open";
}

function renderJoinNeeds(rows) {
  const host = document.getElementById("joinNeedsList");
  if (!host) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    host.innerHTML = `<p class="subtle">No specific roles listed right now. Exceptional players are always welcome.</p>`;
    return;
  }
  host.innerHTML = `
    <div class="join-need-row join-need-row--head" aria-hidden="true">
      <span>Class</span>
      <span>Spec focus</span>
      <span>Priority</span>
    </div>
    ${list
      .map((row) => {
        const className = String(row?.className || "").trim();
        const specFocus = String(row?.specFocus || "").trim();
        const priority = String(row?.priority || "open").trim();
        const color = String(row?.color || "").trim();
        const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff";
        return `
          <div class="join-need-row">
            <div class="join-class">
              <span class="join-class-dot" style="background: ${escJoin(safeColor)}"></span>
              ${escJoin(className)}
            </div>
            <span class="join-spec">${escJoin(specFocus)}</span>
            <span class="join-priority ${joinPriorityClass(priority)}">${escJoin(priority || "Open")}</span>
          </div>
        `;
      })
      .join("")}
  `;
}

async function loadJoinNeeds() {
  const host = document.getElementById("joinNeedsList");
  try {
    const res = await fetch("/api/join/current-needs", { credentials: "same-origin" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) throw new Error(payload?.error || "Failed to load current needs");
    renderJoinNeeds(Array.isArray(payload?.rows) ? payload.rows : []);
  } catch (_error) {
    if (host) host.innerHTML = `<p class="subtle">Could not load current needs right now.</p>`;
  }
}

loadJoinNeeds();

async function apiJson(url, init) {
  const res = await fetch(url, { credentials: "include", ...(init || {}) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${res.status})`);
  return payload;
}

function setSubscribeButtonState(btn, state) {
  if (!btn) return;
  const textEl = btn.querySelector(".join-subscribe-btn-text");
  const statusEl = btn.querySelector(".join-subscribe-btn-status");
  const setLabel = (text, symbol) => {
    if (textEl) textEl.textContent = text;
    else btn.textContent = text;
    if (statusEl) statusEl.textContent = symbol;
  };
  if (state === "loading") {
    setLabel("Loading...", "⋯");
    btn.setAttribute("aria-busy", "true");
    return;
  }
  btn.removeAttribute("aria-busy");
  if (state === "subscribed") {
    setLabel("Subscribed", "✓");
    btn.setAttribute("title", "You are subscribed to Discord DM for SignUps");
    btn.setAttribute("aria-label", "You are subscribed to Discord DM for SignUps");
    return;
  }
  setLabel("Subscribe", "○");
  btn.setAttribute("title", "Subscribe to Discord DM for SignUps");
  btn.setAttribute("aria-label", "Subscribe to Discord DM for SignUps");
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
  event.preventDefault();
  const btn = event.currentTarget;
  setSubscribeButtonState(btn, "loading");
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
    setSubscribeButtonState(btn, out?.subscribed ? "subscribed" : "idle");
    if (out?.subscribed) showJoinSubscribePopup();
  } catch (_error) {
    setSubscribeButtonState(btn, "idle");
  }
}

async function initJoinDmSubscriptionButton() {
  const btn = document.getElementById("joinDmSubscribeBtn");
  if (!btn) return;
  btn.addEventListener("click", handleJoinDmSubscribeClick);
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
      setSubscribeButtonState(btn, "idle");
      return;
    }
    if (shouldAutoUnsubscribe) {
      await apiJson("/api/join/dm-subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribed: false }),
      });
      setSubscribeButtonState(btn, "idle");
      const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
      window.history.replaceState(null, "", cleanUrl);
      return;
    }
    const state = await apiJson("/api/join/dm-subscription");
    if (state?.subscribed) {
      setSubscribeButtonState(btn, "subscribed");
      return;
    }
    if (shouldAutoSubscribe) {
      await apiJson("/api/join/dm-subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribed: true }),
      });
      setSubscribeButtonState(btn, "subscribed");
      showJoinSubscribePopup();
      const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
      window.history.replaceState(null, "", cleanUrl);
      return;
    }
    setSubscribeButtonState(btn, "idle");
  } catch {
    setSubscribeButtonState(btn, "idle");
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

/** ─── Future Events (compact tiles on Join Us) ─────────────────────────── */

const JOIN_PAGE_NEXT = "/join.html#join-future-events";
const JOIN_DISCORD_INVITE = "https://discord.gg/TBnt5f8DFc";
const JOIN_EVENT_IMG_VER = "20260504j";

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
    matches.push({ id: "kara", image: v("/raid-images/pb-header-kara.png"), rosterCap: 10 });
  }
  if (text.includes("gruul")) {
    matches.push({ id: "gruul", image: v("/raid-images/pb-header-gruul.png"), rosterCap: 25 });
  }
  if (text.includes("magtheridon") || /\bmag\b/.test(text)) {
    matches.push({ id: "mag", image: v("/raid-images/pb-header-magtheridon.png"), rosterCap: 25 });
  }
  if (text.includes("serpentshrine") || /\bssc\b/.test(text)) {
    matches.push({ id: "ssc", image: v("/raid-images/pb-header-ssc.png"), rosterCap: 25 });
  }
  if (text.includes("tempest keep") || /\btk\b/.test(text) || text.includes("the eye")) {
    matches.push({ id: "tk", image: v("/raid-images/pb-header-tk.png"), rosterCap: 25 });
  }
  if (text.includes("zul'aman") || text.includes("zul aman") || /\bza\b/.test(text)) {
    matches.push({ id: "za", image: v("/raid-images/pb-header-kara.png"), rosterCap: 10 });
  }
  if (!matches.length) {
    return [{ id: "fallback", image: v("/raid-images/pb-header-kara.png"), rosterCap: 25 }];
  }
  return matches.slice(0, 2);
}

function joinRosterCapacityForEvent(event) {
  const raids = joinDetectEventRaids(event);
  if (!raids.some((raid) => raid.rosterCap === 25)) return 10;
  return 25;
}

function joinRoleCompositionTargets(capacity) {
  if (capacity <= 10) {
    return { Tanks: 2, Healers: 2, Melee: 3, Ranged: 3 };
  }
  return { Tanks: 3, Healers: 6, Melee: 8, Ranged: 8 };
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

function joinMissingGapsHtml(rosterByRole, capacity, confirmed) {
  const targets = joinRoleCompositionTargets(capacity);
  const keys = ["Tanks", "Healers", "Melee", "Ranged"];
  const gaps = keys
    .map((role) => {
      const have = Number(rosterByRole?.[role] ?? 0);
      const need = Math.max(0, targets[role] - have);
      return { role, need };
    })
    .filter((g) => g.need > 0);

  const c = Math.max(0, Number(confirmed || 0));
  const openSlots = Math.max(0, capacity - c);

  if (openSlots === 0 && gaps.length === 0) {
    return `<div class="join-event-gaps join-event-gaps--ok" role="status"><span class="join-event-gap-chip">Composition OK</span><span class="join-event-gap-meta">${c}/${capacity}</span></div>`;
  }

  const chips = gaps.map(
    (g) =>
      `<span class="join-event-gap-chip join-event-gap-chip--need">${escJoin(String(g.need))} ${escJoin(
        joinRoleGapLabel(g.role, g.need)
      )}</span>`
  );
  if (!gaps.length && openSlots > 0) {
    chips.push(`<span class="join-event-gap-chip">${escJoin(String(openSlots))} open slot${openSlots === 1 ? "" : "s"}</span>`);
  }

  return `<div class="join-event-gaps" role="status">${chips.join(
    ""
  )}<span class="join-event-gap-meta">${escJoin(String(c))}/${escJoin(String(capacity))} confirmed</span></div>`;
}

function joinSignupActionsHtml(event, isAuthenticated) {
  const eventId = String(event?.id || "");
  if (!isAuthenticated) {
    const next = encodeURIComponent(JOIN_PAGE_NEXT);
    return `<a href="/auth/discord/login?next=${next}" class="join-event-signup-btn">Login to sign up</a>`;
  }
  const currentStatus = String(event?.currentUserSignup?.status || "").toLowerCase();
  const isSignedUp = currentStatus === "primary";
  return `
      <button type="button" class="join-event-signup-btn" data-join-event-signup-action="${
        isSignedUp ? "signoff" : "signup"
      }" data-join-event-id="${escJoin(eventId)}">${isSignedUp ? "Sign off" : "Sign up"}</button>
      <a href="${escJoin(JOIN_DISCORD_INVITE)}" target="_blank" rel="noreferrer" class="join-event-signup-btn join-event-signup-btn--ghost">Discord</a>
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

function joinTruncateDesc(text, maxLen) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

let joinEventsCountdownTimer = null;

function joinUpdateEventCountdowns() {
  const now = Math.floor(Date.now() / 1000);
  document.querySelectorAll("[data-join-event-start]").forEach((el) => {
    const start = Number(el.getAttribute("data-join-event-start"));
    const inner = el.querySelector(".join-event-countdown-value");
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

function joinRenderFutureEvents(events, isAuthenticated) {
  const host = document.getElementById("joinEventsList");
  if (!host) return;

  const rows = (events || []).filter((event) => String(event?.title || "").trim().toLowerCase() !== "p2 raids");
  if (!rows.length) {
    host.innerHTML = `<p class="subtle join-events-empty">No upcoming events right now. Check Discord for the latest announcements.</p>`;
    return;
  }

  host.innerHTML = rows
    .map((event) => {
      const raids = joinDetectEventRaids(event);
      const bannerSrc =
        String(event.headerImage || "").trim() ||
        raids[0]?.image ||
        joinVersionedRaidImage("/raid-images/pb-header-kara.png");
      const cap = joinRosterCapacityForEvent(event);
      const confirmed = Number(event?.signups?.confirmed ?? 0);
      const signupsTotal = Number(event?.signups?.total ?? 0);
      const gapsHtml = joinMissingGapsHtml(event.rosterByRole, cap, confirmed);
      const softres =
        event.softres?.enabled && event.softres?.url
          ? `<a class="join-event-softres" href="${escJoin(event.softres.url)}" target="_blank" rel="noreferrer">SoftRes</a>`
          : "";
      const { date, time } = joinFmtEventDateTime(event.startTime);
      const startSec = Number(event.startTime || 0);
      const desc = joinTruncateDesc(event.description, 140);
      const actions = joinSignupActionsHtml(event, isAuthenticated);

      return `
        <article class="join-event-tile">
          <div class="join-event-tile-banner">
            <img src="${escJoin(bannerSrc)}" alt="" loading="lazy" decoding="async" width="400" height="90" />
          </div>
          <div class="join-event-tile-body">
            <h4 class="join-event-tile-title">${escJoin(event.title)}</h4>
            <div class="join-event-tile-when">
              <span class="join-event-tile-date">${escJoin(date)}</span>
              <span class="join-event-tile-time">${escJoin(time)}</span>
              <span class="join-event-tile-countdown" data-join-event-start="${startSec}">
                <span class="join-event-countdown-label">Starts in</span>
                <span class="join-event-countdown-value">—</span>
              </span>
            </div>
            ${desc ? `<p class="join-event-tile-desc subtle">${escJoin(desc)}</p>` : ""}
            <div class="join-event-tile-stats">
              <span title="Primary roster">${escJoin(String(confirmed))}/${escJoin(String(cap))} roster</span>
              <span title="Total signups incl. bench etc.">${escJoin(String(signupsTotal))} signups</span>
            </div>
            ${gapsHtml}
            <div class="join-event-tile-actions">
              ${actions}
              ${softres}
            </div>
          </div>
        </article>`;
    })
    .join("");

  joinStartEventCountdowns();
}

async function loadJoinFutureEvents() {
  const host = document.getElementById("joinEventsList");
  if (!host) return;
  host.innerHTML = `<p class="subtle join-events-loading">Loading upcoming events…</p>`;
  try {
    const [me, payload] = await Promise.all([
      joinLoadAuthMeForEvents(),
      fetch("/api/raid-helper/future-events", { credentials: "include" }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
        return body;
      }),
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
