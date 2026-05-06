async function mountAuthHeaderWidget() {
  const host = document.querySelector("[data-auth-widget]");
  if (!host) return;

  const currentPath = window.location.pathname || "/";
  const loginHref = `/auth/discord/login?next=${encodeURIComponent(currentPath)}`;

  const renderLoggedOut = () => {
    host.innerHTML = `<a class="auth-chip-link" href="${loginHref}">Login</a>`;
  };

  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    const payload = await res.json();
    if (!payload?.authenticated) {
      renderLoggedOut();
      return;
    }

    const u = payload.user || {};
    const displayName = u.globalName || u.username || "Discord";
    const avatarUrl =
      u.id && u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : "";

    host.innerHTML = `
      <span class="auth-chip">
        ${
          avatarUrl
            ? `<img class="auth-chip-avatar" src="${avatarUrl}" alt="" loading="lazy" decoding="async" />`
            : `<span class="auth-chip-avatar" aria-hidden="true"></span>`
        }
        <span>${displayName}</span>
      </span>
      <span class="auth-chip-actions">
        <button type="button" class="auth-chip-btn" id="authLogoutBtn">Logout</button>
      </span>
    `;

    const logoutBtn = document.getElementById("authLogoutBtn");
    logoutBtn?.addEventListener("click", async () => {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
      try {
        window.plbSessionApiCache?.clearAll();
      } catch {
        /* ignore */
      }
      window.location.reload();
    });

    const nav = document.querySelector(".top-nav");
    if (nav) {
      const path = window.location.pathname || "";

      let adminLink = nav.querySelector('a[href="/admin.html"]');
      if (!adminLink) {
        adminLink = document.createElement("a");
        adminLink.href = "/admin.html";
        adminLink.textContent = "Admin";
      }
      if (path === "/admin.html") {
        adminLink.className = "nav-current";
        adminLink.setAttribute("aria-current", "page");
      } else {
        adminLink.classList.remove("nav-current");
        adminLink.removeAttribute("aria-current");
      }
      if (!adminLink.parentElement) nav.appendChild(adminLink);

      let phase2Link = nav.querySelector('a[href="/p2-preparation.html"]');
      if (!phase2Link) {
        phase2Link = document.createElement("a");
        phase2Link.href = "/p2-preparation.html";
        phase2Link.textContent = "Phase 2";
      }
      if (path === "/p2-preparation.html") {
        phase2Link.className = "nav-current";
        phase2Link.setAttribute("aria-current", "page");
      } else {
        phase2Link.classList.remove("nav-current");
        phase2Link.removeAttribute("aria-current");
      }
      // Keep Phase 2 as the right-most main-nav item after login.
      nav.appendChild(phase2Link);
    }
  } catch {
    renderLoggedOut();
  }
}

mountAuthHeaderWidget();
