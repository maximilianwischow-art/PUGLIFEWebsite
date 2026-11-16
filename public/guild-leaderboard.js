(() => {
  const state = {
    members: [],
    guild: null,
    stats: null,
    fetchedAt: 0,
    loading: false,
    sortKey: "level",
    sortDir: "desc",
    search: "",
    classFilter: "",
    linkFilter: "",
  };

  const el = {
    stats: document.getElementById("glbStats"),
    status: document.getElementById("glbStatus"),
    table: document.getElementById("glbTable"),
    body: document.getElementById("glbBody"),
    search: document.getElementById("glbSearch"),
    classFilter: document.getElementById("glbClassFilter"),
    linkFilter: document.getElementById("glbLinkFilter"),
    refresh: document.getElementById("glbRefresh"),
    breakdowns: document.getElementById("glbBreakdowns"),
    breakdownLede: document.getElementById("glbBreakdownLede"),
    byClass: document.getElementById("glbByClass"),
    byRace: document.getElementById("glbByRace"),
    levelBands: document.getElementById("glbLevelBands"),
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(ts) {
    const n = Number(ts) || 0;
    if (!n) return "—";
    try {
      return new Date(n).toLocaleString();
    } catch {
      return "—";
    }
  }

  async function api(path) {
    const res = await fetch(path, { credentials: "include" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Request failed (${res.status})`);
    }
    return payload;
  }

  function compareMembers(a, b) {
    const key = state.sortKey;
    const dir = state.sortDir === "asc" ? 1 : -1;
    let av = a?.[key];
    let bv = b?.[key];
    if (key === "discordLinked") {
      av = a.discordLinked ? (a.discordProfileExists ? 2 : 1) : 0;
      bv = b.discordLinked ? (b.discordProfileExists ? 2 : 1) : 0;
    }
    if (key === "profession1" || key === "profession2") {
      av = String(a?.[key]?.name || "");
      bv = String(b?.[key]?.name || "");
      if (!av && bv) return 1;
      if (av && !bv) return -1;
    }
    if (typeof av === "string" || typeof bv === "string") {
      const cmp = String(av || "").localeCompare(String(bv || ""), undefined, { sensitivity: "base" });
      if (cmp !== 0) return cmp * dir;
    } else {
      const an = Number(av);
      const bn = Number(bv);
      if (an !== bn) return (an - bn) * dir;
    }
    return String(a.characterName || "").localeCompare(String(b.characterName || ""));
  }

  function filteredMembers() {
    const q = state.search.trim().toLowerCase();
    return state.members
      .filter((m) => {
        if (state.classFilter && m.classId !== state.classFilter) return false;
        if (state.linkFilter === "linked" && !m.discordLinked) return false;
        if (state.linkFilter === "unlinked" && m.discordLinked) return false;
        if (!q) return true;
        const hay = [
          m.characterName,
          m.raceName,
          m.className,
          m.profession1?.name,
          m.profession2?.name,
          m.rankLabel,
          m.discord?.displayName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort(compareMembers);
  }

  function renderStats() {
    if (!el.stats) return;
    const s = state.stats || {};
    const g = state.guild || {};
    const cards = [
      { value: s.memberCount ?? "—", label: "Members" },
      { value: s.maxLevel ?? "—", label: "Top level" },
      { value: s.avgLevel ?? "—", label: "Average level" },
      { value: s.nearCapCount ?? "—", label: "Level 50+" },
      { value: s.linkedCount ?? "—", label: "Discord linked" },
      { value: s.skyborneCount ?? "—", label: "Skyborne" },
    ];
    el.stats.innerHTML = cards
      .map(
        (c) => `<div class="glb-stat"><b>${escapeHtml(c.value)}</b><span>${escapeHtml(c.label)}</span></div>`
      )
      .join("");
    if (g.name) {
      const sub = document.querySelector(".hero-sub");
      if (sub) {
        const ruleset = g.rulesetName || "Normal";
        sub.textContent = `<${g.name}> · Forever EU ${ruleset}`;
      }
    }
  }

  function renderBarList(target, rows, total, { colorByClassId = false } = {}) {
    if (!target) return;
    const guildTotal = Math.max(1, Number(total) || 0);
    if (!rows.length) {
      target.innerHTML = `<li class="glb-bar-empty">No data</li>`;
      return;
    }
    target.innerHTML = rows
      .map((row) => {
        const count = Number(row.count) || 0;
        const pct = Math.max(0, Math.min(100, Math.round((count / guildTotal) * 1000) / 10));
        const pctAttr = String(pct);
        const classId = colorByClassId ? String(row.id || "").trim().toLowerCase() : "";
        const toneClass = classId ? ` class-${escapeHtml(classId)}` : "";
        const labelClass = classId ? ` glb-bar-label${toneClass}` : " glb-bar-label";
        return `<li class="glb-bar-row${toneClass}">
          <div class="glb-bar-meta">
            <span class="${labelClass.trim()}">${escapeHtml(row.label)}</span>
            <span class="glb-bar-count">${escapeHtml(count)}</span>
          </div>
          <div class="glb-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(Math.round(pct))}" aria-label="${escapeHtml(row.label)}">
            <svg class="glb-bar-svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
              <rect class="glb-bar-bg" x="0" y="0" width="100" height="10" rx="5" ry="5"></rect>
              <rect class="glb-bar-fill" x="0" y="0" width="${escapeHtml(pctAttr)}" height="10" rx="5" ry="5"></rect>
            </svg>
          </div>
        </li>`;
      })
      .join("");
  }

  function renderBreakdowns() {
    const s = state.stats || {};
    const total = Number(s.memberCount) || state.members.length || 0;
    if (!el.breakdowns) return;
    el.breakdowns.hidden = total === 0;
    if (el.breakdownLede) {
      const bits = [];
      if (s.guildMasterName) bits.push(`Guild Master: ${s.guildMasterName}`);
      if (s.officerCount != null) bits.push(`${s.officerCount} officers`);
      if (s.topLevelCount != null) bits.push(`${s.topLevelCount} at 60`);
      if (s.nearCapCount != null) bits.push(`${s.nearCapCount} at 50+`);
      el.breakdownLede.textContent = bits.join(" · ");
    }
    renderBarList(el.byClass, Array.isArray(s.byClass) ? s.byClass : [], total, { colorByClassId: true });
    renderBarList(el.byRace, Array.isArray(s.byRace) ? s.byRace : [], total);
    renderBarList(
      el.levelBands,
      (Array.isArray(s.levelBands) ? s.levelBands : []).filter((b) => Number(b.count) > 0),
      total
    );
  }

  function fillClassFilter() {
    if (!el.classFilter) return;
    const current = state.classFilter;
    const classes = [...new Map(state.members.map((m) => [m.classId, m.className])).entries()]
      .filter(([id]) => id)
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    el.classFilter.innerHTML =
      `<option value="">All classes</option>` +
      classes.map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
    el.classFilter.value = current;
  }

  function profileHref(userId) {
    const id = String(userId || "").trim();
    return id ? `/profile.html?user=${encodeURIComponent(id)}` : "";
  }

  function discordCell(member) {
    if (!member.discordLinked || !member.discord) {
      return `<div class="glb-discord">
        <div class="glb-discord-meta">
          <span class="glb-badge glb-badge--none">Not linked</span>
        </div>
      </div>`;
    }
    const d = member.discord;
    const href = profileHref(d.userId);
    const displayName = String(d.displayName || "").trim() || "—";
    const tbcMain = String(d.profileMainCharacterName || "").trim();
    const name = href
      ? `<a class="glb-discord-name" href="${escapeHtml(href)}" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</a>`
      : `<span class="glb-discord-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>`;
    const tbcLine = tbcMain
      ? `<span class="glb-discord-tbc" title="TBC Classic main">${escapeHtml(tbcMain)}</span>`
      : "";
    return `<div class="glb-discord">
      <div class="glb-discord-meta">
        ${name}
        ${tbcLine}
      </div>
    </div>`;
  }

  function professionCell(member, key) {
    const prof = member?.[key];
    const name = String(prof?.name || "").trim();
    if (!name) {
      const hint = Number(member?.level) > 0 && Number(member.level) < 10 ? "Professions are available from level 10" : "";
      return `<span class="glb-prof-empty"${hint ? ` title="${escapeHtml(hint)}"` : ""}>—</span>`;
    }
    const skill =
      prof.skillPoints != null && prof.maxSkillPoints != null
        ? `${prof.skillPoints}/${prof.maxSkillPoints}`
        : prof.skillPoints != null
          ? String(prof.skillPoints)
          : "";
    const title = skill ? `${name} · ${skill}` : name;
    const icon =
      window.plbProfessionIcons?.iconImg(name, { className: "glb-prof-icon", size: 28 }) ||
      `<span class="glb-prof-name">${escapeHtml(name)}</span>`;
    return `<div class="glb-prof glb-prof--icon" title="${escapeHtml(title)}">
      ${icon}
      ${skill ? `<span class="glb-prof-skill">${escapeHtml(skill)}</span>` : ""}
    </div>`;
  }

  function characterCell(member) {
    const classId = String(member.classId || "").trim().toLowerCase();
    const classTone = classId ? ` class-${escapeHtml(classId)}` : "";
    const href = member.discordLinked && member.discord?.userId ? profileHref(member.discord.userId) : "";
    const pictureUrl = String(member.discord?.pictureUrl || "").trim();
    const claimRole = member.discord?.claimRole === "main" ? "main" : member.discordLinked ? "twink" : "";
    const portrait = pictureUrl
      ? `<img class="glb-char-portrait" src="${escapeHtml(pictureUrl)}" alt="" width="32" height="32" loading="lazy" decoding="async" />`
      : "";
    const portraitWrap = portrait
      ? href
        ? `<a class="glb-char-portrait-link" href="${escapeHtml(href)}" aria-label="Open profile">${portrait}</a>`
        : portrait
      : "";
    const charName = href
      ? `<a class="glb-char-name${classTone}" href="${escapeHtml(href)}">${escapeHtml(member.characterName)}</a>`
      : `<span class="glb-char-name${classTone}">${escapeHtml(member.characterName)}</span>`;
    const roleTag = claimRole
      ? `<span class="glb-char-role glb-char-role--${claimRole}">${claimRole === "main" ? "Main" : "Twink"}</span>`
      : "";
    return `<div class="glb-char${pictureUrl ? " has-portrait" : ""}">
      ${portraitWrap}
      <div class="glb-char-text">
        <div class="glb-char-name-row">${charName}${roleTag}</div>
      </div>
    </div>`;
  }

  function renderTable() {
    if (!el.body || !el.table) return;
    const rows = filteredMembers();
    el.table.hidden = false;
    if (!rows.length) {
      el.body.innerHTML = `<tr><td colspan="9" class="glb-empty">No members match these filters.</td></tr>`;
      return;
    }
    el.body.innerHTML = rows
      .map((m, idx) => {
        const classId = String(m.classId || "").trim().toLowerCase();
        const classTone = classId ? ` class-${escapeHtml(classId)}` : "";
        return `<tr class="glb-row${classId ? ` glb-row--${escapeHtml(classId)}` : ""}">
          <td class="glb-col-rank">${idx + 1}</td>
          <td>${characterCell(m)}</td>
          <td>${escapeHtml(m.raceName || "—")}</td>
          <td>
            <span class="glb-class${classTone}">
              <span class="glb-class-swatch" aria-hidden="true"></span>
              ${escapeHtml(m.className || "—")}
            </span>
          </td>
          <td>${professionCell(m, "profession1")}</td>
          <td>${professionCell(m, "profession2")}</td>
          <td class="glb-col-level"><span class="glb-level">${escapeHtml(m.level)}</span></td>
          <td>
            <div class="glb-char">
              <span>${escapeHtml(m.rankLabel || (m.rank == null ? "—" : `Rank ${m.rank}`))}</span>
              <span class="glb-char-sub">rank ${escapeHtml(m.rank ?? "—")}</span>
            </div>
          </td>
          <td>${discordCell(m)}</td>
        </tr>`;
      })
      .join("");
  }

  function renderSortButtons() {
    document.querySelectorAll(".glb-sort").forEach((btn) => {
      const key = btn.getAttribute("data-sort");
      const active = key === state.sortKey;
      btn.classList.toggle("is-active", active);
      if (active) btn.setAttribute("data-dir", state.sortDir);
      else btn.removeAttribute("data-dir");
    });
  }

  function setStatus(text) {
    if (el.status) el.status.textContent = text;
  }

  function updateMemberCountStatus(cacheNote) {
    if (!state.fetchedAt) return;
    const note = cacheNote || "cached";
    const shown = filteredMembers().length;
    const total = state.members.length;
    const countLabel = shown === total ? `${total} members` : `${shown} of ${total} members`;
    setStatus(`${countLabel} · ${note} · updated ${formatTime(state.fetchedAt)}`);
  }

  async function load({ refresh = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (el.refresh) el.refresh.disabled = true;
    setStatus(refresh ? "Refreshing from Blizzard…" : "Loading guild roster…");
    try {
      const qs = refresh ? "?refresh=1" : "";
      const payload = await api(`/api/wow-forever/guild-leaderboard${qs}`);
      state.members = Array.isArray(payload.members) ? payload.members : [];
      state.guild = payload.guild || null;
      state.stats = payload.stats || null;
      state.fetchedAt = Number(payload.fetchedAt) || Date.now();
      fillClassFilter();
      renderStats();
      renderBreakdowns();
      renderSortButtons();
      renderTable();
      const cacheNote = payload.cacheHit ? "cached" : "live";
      updateMemberCountStatus(cacheNote);
    } catch (error) {
      setStatus(error?.message || "Failed to load guild leaderboard");
      if (el.table) el.table.hidden = true;
      if (el.breakdowns) el.breakdowns.hidden = true;
    } finally {
      state.loading = false;
      if (el.refresh) el.refresh.disabled = false;
    }
  }

  function wire() {
    el.search?.addEventListener("input", () => {
      state.search = el.search.value || "";
      renderTable();
      updateMemberCountStatus();
    });
    el.classFilter?.addEventListener("change", () => {
      state.classFilter = el.classFilter.value || "";
      renderTable();
      updateMemberCountStatus();
    });
    el.linkFilter?.addEventListener("change", () => {
      state.linkFilter = el.linkFilter.value || "";
      renderTable();
      updateMemberCountStatus();
    });
    el.refresh?.addEventListener("click", () => load({ refresh: true }));
    document.querySelectorAll(".glb-sort").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-sort") || "level";
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = key === "level" || key === "rank" ? "desc" : "asc";
        }
        renderSortButtons();
        renderTable();
      });
    });
  }

  wire();
  load();
})();
