(() => {
  const icons = window.plbProfessionIcons || {};
  const PROFESSION_ORDER = Array.isArray(icons.ALL_ORDER)
    ? icons.ALL_ORDER
    : [
        "Alchemy",
        "Blacksmithing",
        "Enchanting",
        "Engineering",
        "Herbalism",
        "Leatherworking",
        "Mining",
        "Skinning",
        "Tailoring",
        "Cooking",
        "Fishing",
        "First Aid",
      ];

  const state = {
    members: [],
    fetchedAt: 0,
    loading: false,
    cacheNote: "cached",
  };

  const el = {
    status: document.getElementById("plbStatus"),
    boards: document.getElementById("plbBoards"),
    refresh: document.getElementById("plbRefresh"),
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

  function profileHref(userId) {
    const id = String(userId || "").trim();
    return id ? `/profile.html?user=${encodeURIComponent(id)}` : "";
  }

  function professionIndex(name) {
    const idx = PROFESSION_ORDER.indexOf(name);
    return idx === -1 ? PROFESSION_ORDER.length : idx;
  }

  function iterProfessionSlots(member) {
    const slots = [];
    for (const key of ["profession1", "profession2"]) {
      const prof = member?.[key];
      if (prof?.name) slots.push(prof);
    }
    for (const prof of Array.isArray(member?.secondaries) ? member.secondaries : []) {
      if (prof?.name) slots.push(prof);
    }
    return slots;
  }

  function boardsFromMembers(members) {
    const grouped = new Map(PROFESSION_ORDER.map((name) => [name, new Map()]));
    for (const member of Array.isArray(members) ? members : []) {
      const characterName = String(member?.characterName || "").trim();
      if (!characterName) continue;
      for (const prof of iterProfessionSlots(member)) {
        const name = String(prof?.name || "").trim();
        const skillPoints = Number(prof?.skillPoints);
        if (!name || !Number.isFinite(skillPoints)) continue;
        if (!grouped.has(name)) grouped.set(name, new Map());
        const byCharacter = grouped.get(name);
        const existing = byCharacter.get(characterName.toLowerCase());
        const row = {
          characterName,
          classId: String(member.classId || "").trim().toLowerCase(),
          className: String(member.className || "").trim(),
          level: Number(member.level) || 0,
          skillPoints,
          maxSkillPoints: Number.isFinite(Number(prof.maxSkillPoints)) ? Number(prof.maxSkillPoints) : null,
          discordLinked: Boolean(member.discordLinked),
          userId: String(member.discord?.userId || "").trim(),
        };
        if (!existing || row.skillPoints > existing.skillPoints) byCharacter.set(characterName.toLowerCase(), row);
      }
    }

    return [...grouped.entries()]
      .sort((a, b) => professionIndex(a[0]) - professionIndex(b[0]) || a[0].localeCompare(b[0]))
      .map(([name, byCharacter]) => {
        const ranked = [...byCharacter.values()].sort(
          (a, b) => b.skillPoints - a.skillPoints || a.characterName.localeCompare(b.characterName)
        );
        return {
          name,
          total: ranked.length,
          entries: ranked.slice(0, 5),
        };
      });
  }

  function nameCell(entry) {
    const classTone = entry.classId ? ` class-${escapeHtml(entry.classId)}` : "";
    const href = entry.discordLinked ? profileHref(entry.userId) : "";
    const name = href
      ? `<a class="glb-char-name${classTone}" href="${escapeHtml(href)}">${escapeHtml(entry.characterName)}</a>`
      : `<span class="glb-char-name${classTone}">${escapeHtml(entry.characterName)}</span>`;
    const meta = [entry.className, entry.level ? `level ${entry.level}` : ""].filter(Boolean).join(" · ");
    return `<div class="glb-top5-who">
      ${name}
      ${meta ? `<span class="glb-char-sub">${escapeHtml(meta)}</span>` : ""}
    </div>`;
  }

  function skillCell(entry) {
    const current = escapeHtml(entry.skillPoints);
    const cap = entry.maxSkillPoints != null ? `<span>/${escapeHtml(entry.maxSkillPoints)}</span>` : "";
    return `<span class="glb-top5-skill"><b>${current}</b>${cap}</span>`;
  }

  function renderBoard(board) {
    const slug = board.name.toLowerCase().replace(/\s+/g, "-");
    const countLabel =
      board.total === 0
        ? "No crafters yet"
        : board.entries.length < board.total
          ? `Top ${board.entries.length} of ${board.total}`
          : board.total === 1
            ? "1 crafter"
            : `${board.total} crafters`;
    const icon =
      icons.iconImg?.(board.name, { className: "glb-prof-card-icon", size: 36 }) ||
      `<span class="glb-prof-card-icon-fallback" aria-hidden="true"></span>`;
    const rows = board.entries.length
      ? board.entries
          .map((entry, index) => {
            return `<li class="glb-top5-row${index === 0 ? " is-first" : ""}">
          <span class="glb-top5-rank">${index + 1}</span>
          ${nameCell(entry)}
          ${skillCell(entry)}
        </li>`;
          })
          .join("")
      : `<li class="glb-top5-empty">No skill data yet.</li>`;
    return `<section class="card surface-elevated glb-prof-card" aria-labelledby="plb-${escapeHtml(slug)}">
      <div class="glb-prof-card-head">
        <div class="glb-prof-card-title-row">
          ${icon}
          <h3 class="glb-prof-card-title" id="plb-${escapeHtml(slug)}">${escapeHtml(board.name)}</h3>
        </div>
        <p class="glb-prof-card-meta">${escapeHtml(countLabel)}</p>
      </div>
      <ol class="glb-top5">${rows}</ol>
    </section>`;
  }

  function render() {
    if (!el.boards) return;
    const boards = boardsFromMembers(state.members);
    el.boards.hidden = boards.length === 0;
    el.boards.innerHTML = boards.map(renderBoard).join("");
    if (el.status) {
      if (!boards.length) {
        el.status.textContent = "No profession skill data on the roster yet.";
        return;
      }
      const withData = boards.filter((b) => b.total > 0).length;
      el.status.textContent = `${withData} of ${boards.length} professions with data · ${state.cacheNote} · updated ${formatTime(state.fetchedAt)}`;
    }
  }

  async function load({ refresh = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (el.refresh) el.refresh.disabled = true;
    if (el.status) el.status.textContent = refresh ? "Refreshing from Blizzard…" : "Loading profession leaderboards…";
    try {
      const qs = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/wow-forever/guild-leaderboard${qs}`, { credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.ok === false) {
        throw new Error(payload?.error || `Request failed (${res.status})`);
      }
      state.members = Array.isArray(payload.members) ? payload.members : [];
      state.fetchedAt = Number(payload.fetchedAt) || Date.now();
      state.cacheNote = payload.cacheHit ? "cached" : "live";
      render();
    } catch (error) {
      if (el.status) el.status.textContent = error?.message || "Failed to load profession leaderboards";
      if (el.boards) el.boards.hidden = true;
    } finally {
      state.loading = false;
      if (el.refresh) el.refresh.disabled = false;
    }
  }

  el.refresh?.addEventListener("click", () => load({ refresh: true }));
  load();
})();
