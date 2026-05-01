const escapeHtml = window.WowItemTooltip.escapeHtml;
const tooltipText = window.WowItemTooltip.tooltipText;

function formatRaidDate(ts) {
  const dt = new Date(Number(ts || 0));
  if (Number.isNaN(dt.getTime())) return "Unknown date";
  return dt.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarizeLootRows(rows) {
  const byItem = new Map();
  for (const row of rows) {
    const itemName = String(row?.itemName || "Unknown item").trim() || "Unknown item";
    const recipient = String(row?.recipient || "Unknown").trim() || "Unknown";
    const rollType = String(row?.rollType || "").trim().toUpperCase();
    const mapRow = byItem.get(itemName) || { itemName, itemId: null, recipients: new Map() };
    if (!mapRow.itemId && Number(row?.itemId) > 0) mapRow.itemId = Number(row.itemId);
    const recipientKey = `${recipient}::${rollType}`;
    mapRow.recipients.set(recipientKey, {
      name: recipient,
      rollType,
      count: (mapRow.recipients.get(recipientKey)?.count || 0) + 1,
    });
    byItem.set(itemName, mapRow);
  }
  return [...byItem.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
}

function displayRaidName(row) {
  const preferred = String(row?.reportRaidName || "").trim();
  if (preferred === "Gruul's Lair" || preferred === "Magtheridon's Lair") {
    return "Gruul's Lair + Magtheridon's Lair";
  }
  if (preferred) return preferred;
  const probe = `${String(row?.reportTitle || "")} ${String(row?.reportCode || "")}`.toLowerCase();
  if (probe.includes("karazhan") || probe.includes("kara")) return "Karazhan";
  if (probe.includes("gruul") || probe.includes("magtheridon")) return "Gruul's Lair + Magtheridon's Lair";
  if (probe.includes("serpentshrine") || probe.includes("ssc")) return "Serpentshrine Cavern";
  if (probe.includes("tempest keep") || probe.includes("the eye") || probe.includes("tk")) return "Tempest Keep";
  const fallback = String(row?.reportTitle || "").trim();
  return fallback || String(row?.reportCode || "").trim() || "Unknown raid";
}

let lootItemMetaMap = new Map();

function bindEventExpandHandlers() {
  const triggers = document.querySelectorAll("[data-loot-toggle]");
  triggers.forEach((btn) => {
    const key = btn.getAttribute("data-loot-toggle");
    const body = document.querySelector(`[data-loot-body="${CSS.escape(String(key || ""))}"]`);
    if (body) {
      body.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      btn.textContent = "+";
    }
    btn.addEventListener("click", () => {
      const toggleKey = btn.getAttribute("data-loot-toggle");
      const body = document.querySelector(`[data-loot-body="${CSS.escape(String(toggleKey || ""))}"]`);
      if (!body) return;
      const expanded = body.hidden;
      body.hidden = !expanded;
      btn.setAttribute("aria-expanded", String(expanded));
      btn.textContent = expanded ? "−" : "+";
    });
  });
}

function renderLootHistory(payload, itemMetaById) {
  const list = document.getElementById("lootHistoryList");
  const meta = document.getElementById("lootHistoryMeta");
  if (!list || !meta) return;

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const raids = Array.isArray(payload?.raids) ? payload.raids : [];
  if (!items.length) {
    if (raids.length) {
      meta.textContent = payload?.note || `Found ${raids.length} raid events.`;
      list.innerHTML = raids
        .sort((a, b) => Number(b?.reportStartTime || 0) - Number(a?.reportStartTime || 0))
        .map(
          (raid) => `
            <article class="card loot-raid-card">
              <div class="loot-raid-head">
                <h3>${escapeHtml(displayRaidName(raid))}</h3>
                <p class="subtle">${escapeHtml(formatRaidDate(raid?.reportStartTime))}</p>
                <p class="subtle">
                  <a href="https://www.warcraftlogs.com/reports/${encodeURIComponent(String(raid?.reportCode || ""))}" target="_blank" rel="noreferrer">Open log</a>
                </p>
              </div>
              <div class="loot-item-list">
                <div class="loot-item-row">
                  <div class="loot-item-name">No loot data found</div>
                  <div class="loot-item-recipients">Warcraft Logs did not return loot receipt events for this raid.</div>
                </div>
              </div>
            </article>
          `
        )
        .join("");
      return;
    }
    const text = payload?.note || "No raid events found yet.";
    meta.textContent = text;
    list.innerHTML = `<article class="card"><p class="subtle">${escapeHtml(text)}</p></article>`;
    return;
  }

  const byReport = new Map();
  for (const row of items) {
    const key = String(row?.reportCode || "");
    if (!key) continue;
    if (!byReport.has(key)) {
      byReport.set(key, {
        reportCode: key,
        reportTitle: String(row?.reportTitle || "Unknown raid"),
          reportRaidName: String(row?.reportRaidName || ""),
        reportStartTime: Number(row?.reportStartTime || 0),
        rows: [],
      });
    }
    byReport.get(key).rows.push(row);
  }

  const reports = [...byReport.values()].sort((a, b) => b.reportStartTime - a.reportStartTime);
  meta.textContent = `Showing ${reports.length} raid events and ${items.length} loot entries.`;

  list.innerHTML = reports
    .map((report, idx) => {
      const summaries = summarizeLootRows(report.rows);
      const rowsHtml = summaries
        .map((entry) => {
          const itemMeta = entry.itemId ? itemMetaById.get(Number(entry.itemId)) : null;
          const recipients = [...entry.recipients.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((row) => {
              const badge = row.rollType ? `<span class="loot-roll-badge">${escapeHtml(row.rollType)}</span>` : "";
              const count = row.count > 1 ? ` x${row.count}` : "";
              return `<span class="loot-recipient-pill">${escapeHtml(row.name)}${count}${badge}</span>`;
            })
            .join("");
          const icon = itemMeta?.icon
            ? `<img class="loot-item-icon" src="${escapeHtml(itemMeta.icon)}" alt="" loading="lazy" decoding="async" />`
            : `<span class="loot-item-icon loot-item-icon--fallback" aria-hidden="true"></span>`;
          return `
            <div class="loot-item-row">
              <div class="loot-item-name" data-loot-item-id="${entry.itemId || ""}" title="${escapeHtml(tooltipText(itemMeta))}">${icon}${escapeHtml(itemMeta?.name || entry.itemName)}</div>
              <div class="loot-item-recipients">${recipients || `<span class="loot-recipient-pill">Unknown</span>`}</div>
            </div>
          `;
        })
        .join("");
      const sectionKey = `${report.reportCode}-${idx}`;

      return `
        <article class="card loot-raid-card">
          <div class="loot-raid-head">
            <div class="loot-raid-head-main">
              <h3>${escapeHtml(displayRaidName(report))}</h3>
              <p class="subtle">${escapeHtml(formatRaidDate(report.reportStartTime))}</p>
              <p class="subtle">
                <a href="https://www.warcraftlogs.com/reports/${encodeURIComponent(report.reportCode)}" target="_blank" rel="noreferrer">Open log</a>
              </p>
            </div>
            <button type="button" class="loot-expand-btn" data-loot-toggle="${escapeHtml(sectionKey)}" aria-expanded="false">+</button>
          </div>
          <div class="loot-item-list" data-loot-body="${escapeHtml(sectionKey)}" hidden>${rowsHtml}</div>
        </article>
      `;
    })
    .join("");
  bindEventExpandHandlers();
}

async function loadLootHistory() {
  const list = document.getElementById("lootHistoryList");
  if (!list) return;
  try {
    const res = await fetch("/api/loot-history?limit=20");
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || "Failed to load loot history");
    const itemIds = [...new Set((payload?.items || []).map((x) => Number(x?.itemId || 0)).filter((x) => x > 0))];
    const itemMetaById = new Map();
    if (itemIds.length) {
      const chunkSize = 80;
      for (let i = 0; i < itemIds.length; i += chunkSize) {
        const chunk = itemIds.slice(i, i + chunkSize);
        const metaRes = await fetch(`/api/wow-classic/items?ids=${encodeURIComponent(chunk.join(","))}`);
        const metaPayload = await metaRes.json().catch(() => ({}));
        if (!metaRes.ok || !Array.isArray(metaPayload?.items)) continue;
        for (const row of metaPayload.items) {
          if (Number(row?.itemId) > 0) itemMetaById.set(Number(row.itemId), row);
        }
      }
    }
    lootItemMetaMap = itemMetaById;
    renderLootHistory(payload, itemMetaById);
    window.WowItemTooltip.bindLootTooltipHandlers(document, (id) => lootItemMetaMap.get(Number(id)));
  } catch (error) {
    const message = error?.message || "Failed to load loot history";
    const meta = document.getElementById("lootHistoryMeta");
    if (meta) meta.textContent = message;
    list.innerHTML = `<article class="card"><p class="subtle">${escapeHtml(message)}</p></article>`;
  }
}

loadLootHistory();
