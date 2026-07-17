(() => {
  const boardBar = document.getElementById("rankingsBoardBar");
  const listEl = document.getElementById("rankingsList");
  const statusEl = document.getElementById("rankingsStatus");
  const titleEl = document.getElementById("rankingsBoardTitle");
  const descEl = document.getElementById("rankingsBoardDesc");
  const windowEl = document.getElementById("rankingsBoardWindow");
  const iconEl = document.getElementById("rankingsBoardIcon");

  const params = new URLSearchParams(window.location.search);
  let activeBoard = String(params.get("board") || "deaths").trim().toLowerCase() || "deaths";

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function podiumClass(rank) {
    if (rank === 1) return "rankings-row--gold";
    if (rank === 2) return "rankings-row--silver";
    if (rank === 3) return "rankings-row--bronze";
    return "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderBoards(boards) {
    if (!boardBar) return;
    boardBar.innerHTML = "";
    for (const board of boards) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rankings-board-chip" + (board.id === activeBoard ? " rankings-board-chip--active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", board.id === activeBoard ? "true" : "false");
      btn.dataset.board = board.id;
      btn.innerHTML = `
        <img class="rankings-board-chip-icon" src="${escapeHtml(board.badgeIcon)}" alt="" width="28" height="28" />
        <span>${escapeHtml(board.label)}</span>
      `;
      btn.addEventListener("click", () => {
        if (board.id === activeBoard) return;
        activeBoard = board.id;
        const url = new URL(window.location.href);
        url.searchParams.set("board", activeBoard);
        window.history.replaceState({}, "", url);
        loadBoard();
      });
      boardBar.appendChild(btn);
    }
  }

  function renderMeta(board) {
    if (titleEl) titleEl.textContent = board?.label || "Rankings";
    if (descEl) descEl.textContent = board?.description || "";
    if (windowEl) {
      windowEl.textContent = board?.windowLabel
        ? `${board.windowLabel} · metric: ${board.metricLabel || "Score"}`
        : "";
    }
    if (iconEl) {
      iconEl.src = board?.badgeIcon || "";
      iconEl.alt = board?.label || "";
    }
  }

  function renderEntries(entries, metricLabel) {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!entries.length) {
      listEl.innerHTML = `<li class="rankings-empty muted">No rankings yet for this board.</li>`;
      return;
    }

    for (const row of entries) {
      const li = document.createElement("li");
      li.className = `rankings-row ${podiumClass(row.rank)}`.trim();
      const badgeHtml = row.badgeId
        ? `<img class="rankings-row-badge" src="/images/achievements/${escapeHtml(row.badgeId)}.png" alt="" title="Holds this badge" width="36" height="36" />`
        : `<span class="rankings-row-badge-spacer" aria-hidden="true"></span>`;
      li.innerHTML = `
        <span class="rankings-row-rank">${escapeHtml(row.rank)}</span>
        <div class="rankings-row-main">
          <div class="rankings-row-name-line">
            <span class="rankings-row-name">${escapeHtml(row.name)}</span>
            ${badgeHtml}
          </div>
          <div class="rankings-row-bar" aria-hidden="true"><span style="width:${Math.max(4, Math.min(100, Number(row._pct || 0)))}%"></span></div>
        </div>
        <span class="rankings-row-value"><strong>${escapeHtml(row.value)}</strong> ${escapeHtml(metricLabel || "")}</span>
      `;
      listEl.appendChild(li);
    }
  }

  async function loadBoard() {
    setStatus("Loading rankings…");
    if (listEl) listEl.innerHTML = "";
    try {
      const res = await fetch(`/api/rankings?board=${encodeURIComponent(activeBoard)}&limit=50`, {
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to load rankings (${res.status})`);
      }

      const boards = Array.isArray(data.boards) ? data.boards : [];
      if (!boards.some((b) => b.id === activeBoard) && boards[0]) {
        activeBoard = boards[0].id;
      }
      renderBoards(boards);
      renderMeta(data.board || boards.find((b) => b.id === activeBoard) || boards[0]);

      const entries = Array.isArray(data.entries) ? data.entries : [];
      const maxVal = Math.max(1, ...entries.map((e) => Number(e.value) || 0));
      for (const entry of entries) {
        entry._pct = Math.round(((Number(entry.value) || 0) / maxVal) * 100);
      }
      renderEntries(entries, data.board?.metricLabel || "Score");

      const bits = [`${entries.length} raiders`];
      if (data.updatedAt) {
        bits.push(`updated ${new Date(data.updatedAt).toLocaleString()}`);
      }
      if (data.reportsScanned) bits.push(`${data.reportsScanned} reports`);
      setStatus(bits.join(" · "));
    } catch (error) {
      setStatus(error?.message || "Failed to load rankings");
      if (listEl) listEl.innerHTML = "";
    }
  }

  loadBoard();
})();
