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
  const dismissKey = "plb_welcome_popup_dismissed_v4";

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

  /** Root Leaderboard (/) and Raid Performance home both skip the "Enter" redirect. */
  function pathShouldSkipEnterRedirect() {
    const p = String(window.location.pathname || "").replace(/\/+$/, "") || "/";
    if (p === "/") return true;
    return p === "/home.html" || p.endsWith("/home.html");
  }

  if (!readDismissed()) {
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

  /** Enter: dismiss permanently; open Raid Performance only when not already on / or home (avoids reload loops). */
  const enterGoHome = () => {
    dismiss();
    if (!pathShouldSkipEnterRedirect()) window.location.assign("/home.html");
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
initWelcomePopup();
