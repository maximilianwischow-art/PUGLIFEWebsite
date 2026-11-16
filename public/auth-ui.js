async function mountAuthHeaderWidget() {
  const host = document.querySelector("[data-auth-widget]");
  if (!host) return;

  const currentPath = window.location.pathname || "/";
  const loginHref = `/auth/discord/login?next=${encodeURIComponent(currentPath)}`;
  const nav = document.querySelector(".top-nav");

  function firstMemberNavAnchor() {
    if (!nav) return null;
    return nav.querySelector('a[href="/admin.html"]');
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

  function removeRetiredNavLinks() {
    if (!nav) return;
    for (const link of nav.querySelectorAll(
      [
        'a[href="/p2-preparation.html"]',
        'a[href="/nether-vortex.html"]',
        'a[href="/p3-preparation.html"]',
        'a[href="/heart-of-darkness.html"]',
        'a[href="/debuff-uptime.html"]',
        'a[href="/voting.html"]',
        'a[href="/join.html"]',
        'a[href="/leaderboard"]',
        'a[href="/rankings"]',
        'a[href="/wow-forever"]',
        'a[href="/wow-forever-squad.html"]',
        'a[href="/home.html"]',
        'a[href="/chapter-1"]',
        'a[href="/chapter-one.html"]',
      ].join(", ")
    )) {
      link.remove();
    }
  }

  function ensurePrimaryNav() {
    if (!nav) return;

    function upsert(href, text, title, isCurrent) {
      let link =
        nav.querySelector(`a[href="${href}"]`) ||
        (href === "/achievements"
          ? nav.querySelector('a[href="/chapter-1"]') || nav.querySelector('a[href="/chapter-one.html"]')
          : null);
      if (!link) {
        link = document.createElement("a");
        const sep = ensureNavMemberSeparator();
        if (sep) nav.insertBefore(link, sep);
        else {
          const anchor = firstMemberNavAnchor();
          if (anchor) nav.insertBefore(link, anchor);
          else nav.appendChild(link);
        }
      }
      link.href = href;
      link.textContent = text;
      if (title) link.title = title;
      if (isCurrent) {
        link.classList.add("nav-current");
        link.setAttribute("aria-current", "page");
      } else {
        link.classList.remove("nav-current");
        link.removeAttribute("aria-current");
      }
      return link;
    }

    const onHome = currentPath === "/" || currentPath === "/index.html" || currentPath === "/home-alliance.html";
    const onGuild =
      currentPath === "/guild-leaderboard" ||
      currentPath === "/guild-leaderboard/" ||
      currentPath === "/guild-leaderboard.html" ||
      currentPath === "/wow-forever/guild" ||
      currentPath === "/profession-leaderboard" ||
      currentPath === "/profession-leaderboard/" ||
      currentPath === "/profession-leaderboard.html";
    const onAchievements =
      currentPath === "/achievements" ||
      currentPath === "/achievements/" ||
      currentPath === "/chapter-1" ||
      currentPath === "/chapter-1/" ||
      currentPath === "/chapter-one.html";
    const onProfile = currentPath === "/profile.html";

    upsert("/", "Home", "Alliance welcome home", onHome);
    upsert("/guild-leaderboard", "Guild LB", "Forever guild leveling leaderboard · Bulwark", onGuild);
    upsert("/achievements", "Achievements", "TBC Classic achievements archive", onAchievements);
    upsert("/profile.html", "Profile", "Forever Main & Twinks, TBC characters, achievements", onProfile);
  }

  function ensureProfileNavLink() {
    if (!nav) return null;
    let profileLink = nav.querySelector('a[href="/profile.html"]');
    if (!profileLink) {
      profileLink = document.createElement("a");
      profileLink.href = "/profile.html";
      profileLink.textContent = "Profile";
      const sep = ensureNavMemberSeparator();
      if (sep) nav.insertBefore(profileLink, sep);
      else {
        const adminLink = nav.querySelector('a[href="/admin.html"]');
        if (adminLink) nav.insertBefore(profileLink, adminLink);
        else nav.appendChild(profileLink);
      }
    }
    profileLink.classList.remove("nav-auth-hidden", "nav-auth-member");
    return profileLink;
  }

  function updateProfileNavState() {
    const profileLink = ensureProfileNavLink();
    if (!profileLink) return;
    if (currentPath === "/profile.html") {
      profileLink.classList.add("nav-current");
      profileLink.setAttribute("aria-current", "page");
    } else {
      profileLink.classList.remove("nav-current");
      profileLink.removeAttribute("aria-current");
    }
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

  const renderLoggedOut = () => {
    host.innerHTML = `<a class="auth-chip-link" href="${loginHref}">Login</a>`;
    removeRetiredNavLinks();
    ensurePrimaryNav();
    updateAdminNavState(false);
    updateProfileNavState();
    updateNavMemberSeparatorVisible(false);
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
    removeRetiredNavLinks();
    ensurePrimaryNav();
    updateAdminNavState(showAdmin);
    updateProfileNavState();
    updateNavMemberSeparatorVisible(showAdmin);
  } catch {
    renderLoggedOut();
  }
}

mountAuthHeaderWidget();
