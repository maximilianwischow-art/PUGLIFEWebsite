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

  const dismiss = () => {
    window.localStorage.setItem(key, "1");
    notice.remove();
  };

  notice.querySelector(".cookie-notice-btn")?.addEventListener("click", dismiss);
  document.body.appendChild(notice);
}

initCookieNotice();
