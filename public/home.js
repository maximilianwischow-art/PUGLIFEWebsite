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

function formatPhaseCountdown(totalSec) {
  if (totalSec <= 0) return "Live now";
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

function startPhase2Countdown() {
  const output = document.getElementById("phase2CountdownValue");
  if (!output) return;

  const update = () => {
    const now = Math.floor(Date.now() / 1000);
    const releaseTs = Math.floor(new Date(2026, 4, 14, 0, 0, 0).getTime() / 1000);
    output.textContent = formatPhaseCountdown(releaseTs - now);
  };

  update();
  setInterval(update, 1000);
}

function initWelcomePopup() {
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

  /** Once dismissed (any control), never show again on this origin. Bump key when popup markup/behavior changes. */
  const dismissKey = "plb_welcome_popup_dismissed_v3";

  let dismissedInMemory = false;

  function readDismissed() {
    try {
      if (window.localStorage.getItem(dismissKey) === "1") return true;
    } catch {}
    try {
      if (window.sessionStorage.getItem(dismissKey) === "1") return true;
    } catch {}
    return dismissedInMemory;
  }

  function persistDismissed() {
    dismissedInMemory = true;
    try {
      window.localStorage.setItem(dismissKey, "1");
    } catch {}
    try {
      window.sessionStorage.setItem(dismissKey, "1");
    } catch {}
  }

  function pathLooksLikeHome() {
    const p = String(window.location.pathname || "").replace(/\/+$/, "") || "/";
    return p === "/home.html" || p.endsWith("/home.html");
  }

  if (!readDismissed()) {
    backdrop.removeAttribute("hidden");
    card.removeAttribute("hidden");
    card.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
  }

  const hidePopup = () => {
    backdrop.setAttribute("hidden", "");
    card.setAttribute("hidden", "");
    card.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
  };

  const dismiss = () => {
    hidePopup();
    persistDismissed();
  };

  /** Enter: dismiss permanently; reload Home only if we are not already there (avoids reload loops). */
  const enterGoHome = () => {
    dismiss();
    if (!pathLooksLikeHome()) window.location.assign("/home.html");
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
startPhase2Countdown();
initWelcomePopup();
