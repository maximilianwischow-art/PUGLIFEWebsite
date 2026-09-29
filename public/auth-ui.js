async function mountAuthHeaderWidget() {
  const host = document.querySelector("[data-auth-widget]");
  if (!host) return;

  const currentPath = window.location.pathname || "/";
  const loginHref = `/auth/discord/login?next=${encodeURIComponent(currentPath)}`;
  const nav = document.querySelector(".top-nav");

  function firstMemberNavAnchor() {
    if (!nav) return null;
    return nav.querySelector('a[href="/profile.html"]') || nav.querySelector('a[href="/admin.html"]');
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
      'a[href="/p2-preparation.html"], a[href="/nether-vortex.html"], a[href="/p3-preparation.html"], a[href="/heart-of-darkness.html"], a[href="/debuff-uptime.html"], a[href="/voting.html"]'
    )) {
      link.remove();
    }
    for (const link of nav.querySelectorAll('a[href="/home.html"]')) {
      link.href = "/chapter-1";
      link.textContent = "Chapter 1";
      link.title = "Chapter 1 · From Strangers to Community";
      link.classList.remove("nav-current");
      link.removeAttribute("aria-current");
    }
  }

  function ensureChapterOneNavLink() {
    if (!nav) return null;
    let chapterLink =
      nav.querySelector('a[href="/chapter-1"]') || nav.querySelector('a[href="/chapter-one.html"]');
    if (!chapterLink) {
      chapterLink = document.createElement("a");
      chapterLink.href = "/chapter-1";
      chapterLink.textContent = "Chapter 1";
      chapterLink.title = "Chapter 1 · From Strangers to Community";
      const joinLink = nav.querySelector('a[href="/join.html"]') || nav.querySelector('a[href="/"]');
      if (joinLink && joinLink.nextSibling) nav.insertBefore(chapterLink, joinLink.nextSibling);
      else if (joinLink) nav.appendChild(chapterLink);
      else nav.insertBefore(chapterLink, nav.firstChild);
    }
    const onChapter =
      currentPath === "/chapter-1" || currentPath === "/chapter-1/" || currentPath === "/chapter-one.html";
    if (onChapter) {
      chapterLink.classList.add("nav-current");
      chapterLink.setAttribute("aria-current", "page");
    } else {
      chapterLink.classList.remove("nav-current");
      chapterLink.removeAttribute("aria-current");
    }
    return chapterLink;
  }

  function ensureForeverNavLink() {
    if (!nav) return null;
    let foreverLink =
      nav.querySelector('a[href="/wow-forever"]') ||
      nav.querySelector('a[href="/wow-forever-squad.html"]');
    if (!foreverLink) {
      foreverLink = document.createElement("a");
      foreverLink.href = "/wow-forever";
      foreverLink.textContent = "Forever";
      foreverLink.title = "The WoW Forever Squad";
      const sep = ensureNavMemberSeparator();
      if (sep) nav.insertBefore(foreverLink, sep);
      else {
        const anchor = firstMemberNavAnchor();
        if (anchor) nav.insertBefore(foreverLink, anchor);
        else nav.appendChild(foreverLink);
      }
    }
    return foreverLink;
  }

  function updateForeverNavState() {
    const foreverLink = ensureForeverNavLink();
    if (!foreverLink) return;
    const onForever =
      currentPath === "/wow-forever" ||
      currentPath === "/wow-forever/" ||
      currentPath === "/wow-forever-squad.html";
    if (onForever) {
      foreverLink.classList.add("nav-current");
      foreverLink.setAttribute("aria-current", "page");
    } else {
      foreverLink.classList.remove("nav-current");
      foreverLink.removeAttribute("aria-current");
    }
  }

  function ensureProfileNavLink() {
    if (!nav) return null;
    let profileLink = nav.querySelector('a[href="/profile.html"]');
    if (!profileLink) {
      profileLink = document.createElement("a");
      profileLink.href = "/profile.html";
      profileLink.textContent = "Profile";
      profileLink.classList.add("nav-auth-member");
      const adminLink = nav.querySelector('a[href="/admin.html"]');
      if (adminLink) nav.insertBefore(profileLink, adminLink);
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
    ensureChapterOneNavLink();
    updateForeverNavState();
    updateAdminNavState(false);
    updateProfileNavState(false);
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
    ensureChapterOneNavLink();
    updateForeverNavState();
    updateAdminNavState(showAdmin);
    updateProfileNavState(true);
    updateNavMemberSeparatorVisible(true);
  } catch {
    renderLoggedOut();
  }
}

mountAuthHeaderWidget();
