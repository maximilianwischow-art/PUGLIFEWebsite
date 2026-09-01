(() => {
  const boardBar = document.getElementById("rankingsBoardBar");
  const listEl = document.getElementById("rankingsList");
  const matrixHost = document.getElementById("rankingsMatrixHost");
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

  function breakdownHtml(breakdown) {
    const rows = Array.isArray(breakdown) ? breakdown : [];
    if (!rows.length) {
      return `<div class="rankings-breakdown-empty muted">No per-item breakdown available yet.</div>`;
    }
    return `<ul class="rankings-breakdown-list">
      ${rows
        .map(
          (row) => `<li class="rankings-breakdown-item">
            <span class="rankings-breakdown-label">${escapeHtml(row.label || row.key || "?")}</span>
            <span class="rankings-breakdown-count"><strong>${escapeHtml(row.count)}</strong></span>
          </li>`
        )
        .join("")}
    </ul>`;
  }

  function closeExpandedRows(exceptLi = null) {
    if (!listEl) return;
    for (const li of listEl.querySelectorAll(".rankings-row.is-expanded")) {
      if (exceptLi && li === exceptLi) continue;
      li.classList.remove("is-expanded");
      const btn = li.querySelector("[data-rankings-name]");
      if (btn) btn.setAttribute("aria-expanded", "false");
      const panel = li.querySelector(".rankings-breakdown");
      if (panel) panel.hidden = true;
    }
  }

  function renderEntries(entries, metricLabel, { expandable = false } = {}) {
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
      const nameInner = expandable
        ? `<button type="button" class="rankings-row-name rankings-row-name--btn" data-rankings-name="${escapeHtml(row.name)}" aria-expanded="false" title="Show consumable breakdown">${escapeHtml(row.name)}</button>`
        : `<span class="rankings-row-name">${escapeHtml(row.name)}</span>`;
      const breakdownPanel = expandable
        ? `<div class="rankings-breakdown" hidden>
              <p class="rankings-breakdown-title">Consumables counted</p>
              ${breakdownHtml(row.breakdown)}
            </div>`
        : "";
      li.innerHTML = `
        <span class="rankings-row-rank">${escapeHtml(row.rank)}</span>
        <div class="rankings-row-main">
          <div class="rankings-row-name-line">
            ${nameInner}
            ${badgeHtml}
          </div>
          <div class="rankings-row-bar" aria-hidden="true"><span style="width:${Math.max(4, Math.min(100, Number(row._pct || 0)))}%"></span></div>
          ${breakdownPanel}
        </div>
        <span class="rankings-row-value"><strong>${escapeHtml(row.value)}</strong> ${escapeHtml(metricLabel || "")}</span>
      `;
      listEl.appendChild(li);
    }
  }

  function cellLineHtml(line) {
    const kindClass = line.kind === "flask" ? "rankings-matrix-line--flask" : "rankings-matrix-line--potion";
    return `<span class="rankings-matrix-line ${kindClass}" title="${escapeHtml(line.name)}">${escapeHtml(line.label)} <strong>×${escapeHtml(line.count)}</strong></span>`;
  }

  function renderMatrixCell(cell) {
    const lines = Array.isArray(cell?.lines) ? cell.lines : [];
    if (!lines.length) {
      return `<span class="rankings-matrix-empty">—</span>`;
    }
    return `<div class="rankings-matrix-cell">${lines.map(cellLineHtml).join("")}</div>`;
  }

  function renderMatrix({ reports, catalog, matrix }) {
    if (!matrixHost) return;
    matrixHost.innerHTML = "";
    const raidCols = Array.isArray(reports) ? reports : [];
    const rows = Array.isArray(matrix) ? matrix : [];
    const items = Array.isArray(catalog) ? catalog : [];

    if (!raidCols.length) {
      matrixHost.innerHTML = `<p class="rankings-empty muted">No Phase 3 raid logs in Event Management yet. Add Mount Hyjal / Black Temple reports to see flask and potion usage here.</p>`;
      return;
    }

    const head = raidCols
      .map(
        (report) =>
          `<th scope="col" class="rankings-matrix-raid-col" title="${escapeHtml(report.reportCode || "")}">${escapeHtml(report.label || report.raidKey || "Raid")}</th>`
      )
      .join("");

    const legend = items
      .map(
        (item) =>
          `<span class="rankings-matrix-legend-item rankings-matrix-legend-item--${escapeHtml(item.kind || "item")}">${escapeHtml(item.shortLabel || item.name)}</span>`
      )
      .join("");

    const body = rows
      .map((row) => {
        const cells = raidCols
          .map((report) => {
            const cell = row.cells?.[report.reportCode] || null;
            return `<td class="rankings-matrix-data">${renderMatrixCell(cell)}</td>`;
          })
          .join("");
        return `<tr>
          <th scope="row" class="rankings-matrix-name">${escapeHtml(row.name)}</th>
          ${cells}
          <td class="rankings-matrix-total is-num"><strong>${escapeHtml(row.totalUses || 0)}</strong></td>
        </tr>`;
      })
      .join("");

    matrixHost.innerHTML = `
      <div class="rankings-matrix-legend" aria-label="Tracked consumables">${legend}</div>
      <div class="admin-table-wrap plb-debuff-table-wrap rankings-matrix-wrap">
        <table class="admin-table plb-debuff-table rankings-matrix-table">
          <thead>
            <tr>
              <th scope="col" class="rankings-matrix-sticky">Raider</th>
              ${head}
              <th scope="col" class="is-num">Total</th>
            </tr>
          </thead>
          <tbody>${body || `<tr><td colspan="${raidCols.length + 2}" class="muted">No raiders found in the scanned logs.</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  function setViewMode(mode) {
    const matrixMode = mode === "matrix";
    if (matrixHost) matrixHost.hidden = !matrixMode;
    if (listEl) listEl.hidden = matrixMode;
  }

  listEl?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-rankings-name]");
    if (!btn || activeBoard !== "consumables") return;
    const li = btn.closest(".rankings-row");
    if (!li) return;
    const panel = li.querySelector(".rankings-breakdown");
    const opening = !li.classList.contains("is-expanded");
    closeExpandedRows(opening ? li : null);
    if (!opening) {
      li.classList.remove("is-expanded");
      btn.setAttribute("aria-expanded", "false");
      if (panel) panel.hidden = true;
      return;
    }
    li.classList.add("is-expanded");
    btn.setAttribute("aria-expanded", "true");
    if (panel) panel.hidden = false;
  });

  async function loadBoard() {
    setStatus("Loading rankings…");
    if (listEl) listEl.innerHTML = "";
    if (matrixHost) matrixHost.innerHTML = "";
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
      const board = data.board || boards.find((b) => b.id === activeBoard) || boards[0];
      renderMeta(board);

      const view = String(data.view || board?.view || "ladder");
      if (view === "matrix" || activeBoard === "p3-consumables") {
        setViewMode("matrix");
        renderMatrix({
          reports: data.reports,
          catalog: data.catalog,
          matrix: data.matrix,
        });
        const rowCount = Array.isArray(data.matrix) ? data.matrix.length : 0;
        const raidCount = Array.isArray(data.reports) ? data.reports.length : 0;
        const bits = [`${rowCount} raiders`, `${raidCount} P3 raid${raidCount === 1 ? "" : "s"}`];
        if (data.updatedAt) bits.push(`updated ${new Date(data.updatedAt).toLocaleString()}`);
        if (data.reportsScanned) bits.push(`${data.reportsScanned} reports scanned`);
        setStatus(bits.join(" · "));
        return;
      }

      setViewMode("ladder");
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const maxVal = Math.max(1, ...entries.map((e) => Number(e.value) || 0));
      for (const entry of entries) {
        entry._pct = Math.round(((Number(entry.value) || 0) / maxVal) * 100);
      }
      renderEntries(entries, board?.metricLabel || "Score", {
        expandable: activeBoard === "consumables",
      });

      const bits = [`${entries.length} raiders`];
      if (activeBoard === "consumables") bits.push("click a name for breakdown");
      if (data.updatedAt) bits.push(`updated ${new Date(data.updatedAt).toLocaleString()}`);
      if (data.reportsScanned) bits.push(`${data.reportsScanned} reports`);
      setStatus(bits.join(" · "));
    } catch (error) {
      setStatus(error?.message || "Failed to load rankings");
      if (listEl) listEl.innerHTML = "";
      if (matrixHost) matrixHost.innerHTML = "";
    }
  }

  loadBoard();
})();
