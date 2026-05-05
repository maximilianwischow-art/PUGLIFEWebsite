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
