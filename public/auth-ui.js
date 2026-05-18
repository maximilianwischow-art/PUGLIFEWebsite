async function mountAuthHeaderWidget() {
  const host = document.querySelector("[data-auth-widget]");
  if (!host) return;

  const currentPath = window.location.pathname || "/";
  const loginHref = `/auth/discord/login?next=${encodeURIComponent(currentPath)}`;
  const nav = document.querySelector(".top-nav");

  function firstMemberNavAnchor() {
    if (!nav) return null;
    return (
      nav.querySelector('a[href="/debuff-uptime.html"]') ||
      nav.querySelector('a[href="/profile.html"]') ||
      nav.querySelector('a[href="/p2-preparation.html"]') ||
      nav.querySelector('a[href="/admin.html"]')
    );
  }

  function ensureNavMemberSeparator() {
    if (!nav) return null;
    let sep = nav.querySelector(".top-nav-sep");
    if (!sep) {
      sep = document.createElement("span");
      sep.className = "top-nav-sep nav-auth-hidden";
      sep.setAttribute("aria-hidden", "true");
      const anchor = firstMemberNavAnchor();
      if (anchor) nav.insertBefore(sep, anchor);
      else nav.appendChild(sep);
    }
    return sep;
  }

  function updateNavMemberSeparatorVisible(show) {
    const sep = ensureNavMemberSeparator();
    if (!sep) return;
    if (show) sep.classList.remove("nav-auth-hidden");
    else sep.classList.add("nav-auth-hidden");
  }

  function ensurePhase2NavLink() {
    if (!nav) return null;
    let phase2Link = nav.querySelector('a[href="/p2-preparation.html"]');
    if (!phase2Link) {
      phase2Link = document.createElement("a");
      phase2Link.href = "/p2-preparation.html";
      phase2Link.textContent = "Phase 2";
      phase2Link.classList.add("nav-auth-member");
      const adminLink = nav.querySelector('a[href="/admin.html"]');
      if (adminLink) nav.insertBefore(phase2Link, adminLink);
      else nav.appendChild(phase2Link);
    }
    phase2Link.classList.add("nav-auth-hidden");
    return phase2Link;
  }

  function ensureProfileNavLink() {
    if (!nav) return null;
    let profileLink = nav.querySelector('a[href="/profile.html"]');
    if (!profileLink) {
      profileLink = document.createElement("a");
      profileLink.href = "/profile.html";
      profileLink.textContent = "Profile";
      profileLink.classList.add("nav-auth-member");
      const phase2Link = nav.querySelector('a[href="/p2-preparation.html"]');
      const adminLink = nav.querySelector('a[href="/admin.html"]');
      // Insert before Phase 2 / Admin so the order reads Hall of Fame · Profile · Phase 2 · Admin.
      const anchor = phase2Link || adminLink;
      if (anchor) nav.insertBefore(profileLink, anchor);
      else nav.appendChild(profileLink);
    }
    profileLink.classList.add("nav-auth-hidden");
    return profileLink;
  }

  function updateProfileNavState(isAuthenticated) {
    const profileLink = ensureProfileNavLink();
    if (!profileLink) return;
    if (currentPath === "/profile.html" && isAuthenticated) {
      profileLink.classList.add("nav-current");
      profileLink.setAttribute("aria-current", "page");
    } else {
      profileLink.classList.remove("nav-current");
      profileLink.removeAttribute("aria-current");
    }
    if (isAuthenticated) profileLink.classList.remove("nav-auth-hidden");
    else profileLink.classList.add("nav-auth-hidden");
  }

  function updatePhase2NavState(isAuthenticated) {
    const phase2Link = ensurePhase2NavLink();
    if (!phase2Link) return;
    const onPhase2 =
      currentPath === "/p2-preparation.html" || currentPath === "/nether-vortex.html";
    if (onPhase2 && isAuthenticated) {
      phase2Link.classList.add("nav-current");
      phase2Link.setAttribute("aria-current", "page");
    } else {
      phase2Link.classList.remove("nav-current");
      phase2Link.removeAttribute("aria-current");
    }
    if (isAuthenticated) phase2Link.classList.remove("nav-auth-hidden");
    else phase2Link.classList.add("nav-auth-hidden");
  }

  function ensureAdminNavLink() {
    if (!nav) return null;
    let adminLink = nav.querySelector('a[href="/admin.html"]');
    if (!adminLink) {
      adminLink = document.createElement("a");
      adminLink.href = "/admin.html";
      adminLink.textContent = "Admin";
      adminLink.classList.add("nav-auth-member");
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

  function ensureDebuffUptimeNavLink() {
    if (!nav) return null;
    let debuffLink = nav.querySelector('a[href="/debuff-uptime.html"]');
    if (!debuffLink) {
      debuffLink = document.createElement("a");
      debuffLink.href = "/debuff-uptime.html";
      debuffLink.textContent = "Debuffs";
      debuffLink.title = "Debuff uptime (Warcraft Logs)";
      debuffLink.classList.add("nav-auth-member");
      const profileLink = nav.querySelector('a[href="/profile.html"]');
      const phase2Link = nav.querySelector('a[href="/p2-preparation.html"]');
      const adminLink = nav.querySelector('a[href="/admin.html"]');
      const anchor = profileLink || phase2Link || adminLink;
      if (anchor) nav.insertBefore(debuffLink, anchor);
      else nav.appendChild(debuffLink);
    }
    debuffLink.textContent = "Debuffs";
    debuffLink.title = "Debuff uptime (Warcraft Logs)";
    debuffLink.classList.add("nav-auth-hidden");
    return debuffLink;
  }

  function updateDebuffUptimeNavState(isRaidLead) {
    const debuffLink = ensureDebuffUptimeNavLink();
    if (!debuffLink) return;
    if (currentPath === "/debuff-uptime.html" && isRaidLead) {
      debuffLink.classList.add("nav-current");
      debuffLink.setAttribute("aria-current", "page");
    } else {
      debuffLink.classList.remove("nav-current");
      debuffLink.removeAttribute("aria-current");
    }
    if (isRaidLead) debuffLink.classList.remove("nav-auth-hidden");
    else debuffLink.classList.add("nav-auth-hidden");
  }

  function updateMemberNavChrome({
    showProfile,
    showPhase2,
    showDebuffs,
    showAdmin,
  }) {
    updateNavMemberSeparatorVisible(
      Boolean(showProfile || showPhase2 || showDebuffs || showAdmin)
    );
  }

  const renderLoggedOut = () => {
    host.innerHTML = `<a class="auth-chip-link" href="${loginHref}">Login</a>`;
    updatePhase2NavState(false);
    updateAdminNavState(false);
    updateProfileNavState(false);
    updateDebuffUptimeNavState(false);
    updateMemberNavChrome({
      showProfile: false,
      showPhase2: false,
      showDebuffs: false,
      showAdmin: false,
    });
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
    const showAdmin = Boolean(payload?.isAdmin);
    const showDebuffs = Boolean(payload?.canAccessDebuffUptime ?? payload?.isRaidLead);
    updatePhase2NavState(true);
    updateAdminNavState(showAdmin);
    updateProfileNavState(true);
    updateDebuffUptimeNavState(showDebuffs);
    updateMemberNavChrome({
      showProfile: true,
      showPhase2: true,
      showDebuffs,
      showAdmin,
    });
  } catch {
    renderLoggedOut();
  }
}

mountAuthHeaderWidget();
