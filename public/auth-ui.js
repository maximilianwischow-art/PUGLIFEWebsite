async function mountAuthHeaderWidget() {
  const host = document.querySelector("[data-auth-widget]");
  if (!host) return;

  const currentPath = window.location.pathname || "/";
  const loginHref = `/auth/discord/login?next=${encodeURIComponent(currentPath)}`;
  const nav = document.querySelector(".top-nav");

  function ensureAdminNavLink() {
    if (!nav) return null;
    let adminLink = nav.querySelector('a[href="/admin.html"]');
    if (!adminLink) {
      adminLink = document.createElement("a");
      adminLink.href = "/admin.html";
      adminLink.textContent = "Admin";
      nav.appendChild(adminLink);
    }
    adminLink.classList.add("nav-auth-hidden");
    return adminLink;
  }

  function updateAdminNavState(isAdmin) {
    const adminLink = ensureAdminNavLink();
    if (!adminLink) return;
    if (currentPath === "/admin.html") {
      adminLink.classList.add("nav-current");
      adminLink.setAttribute("aria-current", "page");
    } else {
      adminLink.classList.remove("nav-current");
      adminLink.removeAttribute("aria-current");
    }
    if (isAdmin) adminLink.classList.remove("nav-auth-hidden");
    else adminLink.classList.add("nav-auth-hidden");
  }

  function ensurePhase2NavLink() {
    if (!nav) return null;
    let phase2Link = nav.querySelector('a[href="/p2-preparation.html"]');
    if (!phase2Link) {
      phase2Link = document.createElement("a");
      phase2Link.href = "/p2-preparation.html";
      phase2Link.textContent = "Phase 2";
      nav.appendChild(phase2Link);
    }
    // Keep DOM order stable across pages/sessions; only visibility changes with auth state.
    phase2Link.classList.add("nav-auth-hidden");
    return phase2Link;
  }

  function updatePhase2NavState(isAuthenticated) {
    const phase2Link = ensurePhase2NavLink();
    if (!phase2Link) return;
    if (currentPath === "/p2-preparation.html") {
      phase2Link.classList.add("nav-current");
      phase2Link.setAttribute("aria-current", "page");
    } else {
      phase2Link.classList.remove("nav-current");
      phase2Link.removeAttribute("aria-current");
    }
    if (isAuthenticated) phase2Link.classList.remove("nav-auth-hidden");
    else phase2Link.classList.add("nav-auth-hidden");
  }

  const renderLoggedOut = () => {
    host.innerHTML = `<a class="auth-chip-link" href="${loginHref}">Login</a>`;
    updateAdminNavState(false);
    updatePhase2NavState(false);
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
    updateAdminNavState(Boolean(payload?.isAdmin));
    updatePhase2NavState(true);
  } catch {
    renderLoggedOut();
  }
}

mountAuthHeaderWidget();
