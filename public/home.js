function initBackgroundStars() {
  const el = document.getElementById("stars");
  if (!el || el.childElementCount > 0) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 70; i += 1) {
    const s = document.createElement("div");
    s.className = "star";
    const sz = Math.random() * 1.8 + 0.4;
    const o = 0.08 + Math.random() * 0.35;
    s.style.cssText = `width:${sz}px;height:${sz}px;top:${Math.random() * 100}%;left:${Math.random() * 100}%;--d:${2 + Math.random() * 4}s;--dl:${Math.random() * 4}s;--o:${o}`;
    frag.appendChild(s);
  }
  el.appendChild(frag);
}

function initBasicAnalytics() {
  if (window.__plbAnalyticsBooted) return;
  window.__plbAnalyticsBooted = true;
  const sessionKey = "plb_analytics_session_v1";
  let sessionId = "session-unavailable";
  try {
    sessionId = window.sessionStorage.getItem(sessionKey) || "";
    if (!sessionId) {
      sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem(sessionKey, sessionId);
    }
  } catch {
    /* ignore */
  }
  const payload = {
    type: "pageview",
    path: String(window.location.pathname || "/"),
    title: String(document.title || "").slice(0, 160),
    referrer: String(document.referrer || "").slice(0, 220),
    sessionId,
  };
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/analytics/track", blob);
      return;
    }
  } catch {
    /* fallback */
  }
  fetch("/api/analytics/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}

function initWelcomePopup() {
  const path = String(window.location.pathname || "").replace(/\/+$/, "") || "/";
  const isJoinPage = path === "/" || path === "/join.html" || path.endsWith("/join.html");
  if (!isJoinPage) return;

  const card = document.getElementById("welcomePopupCard");
  const backdrop = document.getElementById("welcomePopupBackdrop");
  const closeBtn = document.getElementById("welcomePopupClose");
  const enterBtn = document.getElementById("welcomePopupEnter");
  if (!card || !backdrop || !closeBtn || !enterBtn) return;

  /** Detach from nested layout so `position:fixed` + hit-testing matches true viewport overlays (avoids trapped stacking contexts). */
  if (backdrop.parentElement !== document.body || card.parentElement !== document.body) {
    document.body.appendChild(backdrop);
    document.body.appendChild(card);
  }

  const dismissKey = "plb_welcome_popup_seen_session_v1";
  let alreadySeen = false;
  try {
    alreadySeen = window.sessionStorage.getItem(dismissKey) === "1";
  } catch {
    alreadySeen = false;
  }
  if (alreadySeen) return;

  backdrop.removeAttribute("hidden");
  card.removeAttribute("hidden");
  backdrop.hidden = false;
  card.hidden = false;
  card.setAttribute("aria-hidden", "false");
  backdrop.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    backdrop.hidden = false;
    card.hidden = false;
  });

  const hidePopup = () => {
    backdrop.setAttribute("hidden", "");
    card.setAttribute("hidden", "");
    card.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
  };

  const dismiss = () => {
    hidePopup();
    try {
      window.sessionStorage.setItem(dismissKey, "1");
    } catch {
      /* ignore */
    }
  };

  /** Enter only closes popup; reappears after each reload by design. */
  const enterGoHome = () => {
    dismiss();
  };

  /** Capture phase: runs before other document handlers that might interfere with closing. */
  const cap = true;
  closeBtn.addEventListener("click", dismiss, cap);
  enterBtn.addEventListener("click", enterGoHome, cap);
  backdrop.addEventListener("click", dismiss, cap);
  document.addEventListener(
    "keydown",
    (event) => {
      if (card.hidden) return;
      if (event.key === "Escape") dismiss();
    },
    cap
  );
}

initBackgroundStars();
initBasicAnalytics();
initWelcomePopup();
