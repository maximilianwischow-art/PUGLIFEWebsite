function initCookieNotice() {
  const key = "plb_cookie_notice_ack_v1";
  if (window.localStorage.getItem(key) === "1") return;

  const notice = document.createElement("aside");
  notice.className = "cookie-notice";
  notice.setAttribute("role", "region");
  notice.setAttribute("aria-label", "Cookie notice");
  notice.innerHTML = `
    <p>
      We use a necessary login cookie for Discord authentication and account session handling.
      <a href="/privacy.html">Privacy Policy</a>
    </p>
    <button type="button" class="cookie-notice-btn">OK</button>
  `;

  // Mark the body so CSS can reserve enough bottom padding for the fixed
  // notice — otherwise it covers buttons (e.g. Phase 2 "Save need") on phones.
  const dismiss = () => {
    window.localStorage.setItem(key, "1");
    document.body.classList.remove("has-cookie-notice");
    notice.remove();
  };

  notice.querySelector(".cookie-notice-btn")?.addEventListener("click", dismiss);
  document.body.appendChild(notice);
  document.body.classList.add("has-cookie-notice");
}

initCookieNotice();
