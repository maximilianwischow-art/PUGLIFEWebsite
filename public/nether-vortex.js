const esc = window.WowItemTooltip.escapeHtml;
const tooltipText = window.WowItemTooltip.tooltipText;

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
}

/** Match server: Blizzard render CDN → Wowhead mirror (reliable for `<img>` on strict browsers/CDNs). */
function normalizeItemIconUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  const m = s.match(/\/([a-z0-9_-]+)\.(jpg|png)(?:\?|$)/i);
  if (
    m &&
    (/render\.worldofwarcraft\.com/i.test(s) ||
      /blz-static/i.test(s) ||
      /blizzard\.com\/.*?\/icons\//i.test(s))
  ) {
    return `https://wow.zamimg.com/images/wow/icons/large/${m[1]}.jpg`;
  }
  return s;
}

/** Guild row total: sum of per-item vortex only (pool / “needed count” removed). */
function entryNetherVortexTotal(row) {
  const items = Array.isArray(row?.items) ? row.items : [];
  return items.reduce((sum, it) => sum + vortexNeeded(it?.vortexNeeded), 0);
}

function vortexNeeded(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 1;
  return Math.max(1, Math.min(20, Math.floor(x)));
}

async function getJson(url, opts) {
  const merged = { credentials: "include", ...(opts || {}) };
  if (window.plbSessionApiCache) {
    return window.plbSessionApiCache.getJson(url, merged);
  }
  const res = await fetch(url, merged);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${res.status})`);
  return payload;
}

let craftables = [];
let selectedItems = [];
let itemMetaById = new Map();
let vortexCanEdit = false;
let netherVortexIcon = "";
const NETHER_VORTEX_ITEM_ID = 30183;

function canonicalItemId(itemName, fallbackId) {
  const trimmed = String(itemName || "").trim();
  if (trimmed && craftables.length) {
    const match = craftables.find((c) => String(c.itemName || "").trim() === trimmed);
    if (match && n(match.itemID) > 0) return n(match.itemID);
  }
  return n(fallbackId);
}

/** Per-item vortex counts come from the API (Wowhead `reagent-for` spell data). */
function applyCraftableVortexCounts(items) {
  if (!Array.isArray(items) || !craftables.length) {
    return Array.isArray(items) ? items.map((row) => ({ ...row, vortexNeeded: vortexNeeded(row?.vortexNeeded) })) : [];
  }
  return items.map((row) => {
    const id = canonicalItemId(row.itemName, row.itemID);
    const c = craftables.find((x) => n(x.itemID) === id);
    if (c && Number(c.vortexNeeded) > 0) {
      return { ...row, vortexNeeded: vortexNeeded(c.vortexNeeded) };
    }
    return { ...row, vortexNeeded: vortexNeeded(row?.vortexNeeded) };
  });
}

function collectMissingMetaIds(entries, myItems) {
  const ids = [];
  for (const entry of entries || []) {
    for (const it of entry.items || []) {
      ids.push(canonicalItemId(it.itemName, it.itemID));
    }
  }
  for (const it of myItems || []) {
    ids.push(canonicalItemId(it.itemName, it.itemID));
  }
  return [...new Set(ids.map((id) => n(id)).filter((id) => id > 0))].filter((id) => !itemMetaById.has(id));
}

async function fetchItemMetaChunk(ids) {
  const want = [...new Set((ids || []).map((id) => n(id)).filter((id) => id > 0))].filter((id) => !itemMetaById.has(id));
  if (!want.length) return;
  for (let i = 0; i < want.length; i += 80) {
    const chunk = want.slice(i, i + 80);
    const metaPayload = await getJson(`/api/wow-classic/items?ids=${encodeURIComponent(chunk.join(","))}`);
    for (const row of metaPayload?.items || []) {
      if (n(row?.itemId) > 0) itemMetaById.set(n(row.itemId), row);
    }
  }
}

function renderVortexCost(cost, opts = {}) {
  const compact = Boolean(opts.compact);
  const label = compact ? `${n(cost)} NV` : `${n(cost)} Nether Vortex`;
  const cls = compact ? "vortex-cost-badge vortex-cost-badge--compact" : "vortex-cost-badge";
  if (compact) {
    return `<span class="${cls}"><span>${label}</span></span>`;
  }
  const vortexIconSrc = normalizeItemIconUrl(netherVortexIcon);
  const icon = vortexIconSrc
    ? `<img class="vortex-inline-icon" src="${esc(vortexIconSrc)}" alt="" width="18" height="18" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : "";
  return `<span class="${cls}">${icon}<span>${label}</span></span>`;
}

function renderItemChip(itemId, itemName, profession = "", opts = {}) {
  const id = canonicalItemId(itemName, itemId);
  const meta = itemMetaById.get(id);
  const iconUrl = normalizeItemIconUrl(meta?.icon || "");
  const icon = iconUrl
    ? `<img class="loot-item-icon" src="${esc(iconUrl)}" alt="" width="36" height="36" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : `<span class="loot-item-icon loot-item-icon--fallback" aria-hidden="true"></span>`;
  const showProf = opts?.includeProfession !== false;
  const namePart = `${esc(itemName)}${showProf && profession ? ` (${esc(profession)})` : ""}`;
  return `<div class="loot-item-name" data-loot-item-id="${id}" title="${esc(tooltipText(meta))}">${icon}${namePart}</div>`;
}

function updateCraftableOptions() {
  const search = document.getElementById("vortexCraftableSearch");
  const select = document.getElementById("vortexCraftableSelect");
  if (!select) return;
  const previousValue = String(select.value || "");
  const query = String(search?.value || "").trim().toLowerCase();
  const rows = craftables.filter((row) => {
    if (!query) return true;
    const name = String(row?.itemName || "").toLowerCase();
    const prof = String(row?.profession || "").toLowerCase();
    return name.includes(query) || prof.includes(query);
  });
  if (!rows.length) {
    select.innerHTML = `<option value="">No matching items</option>`;
    return;
  }
  select.innerHTML = [
    `<option value="">Select an item...</option>`,
    ...rows.map((row) => {
      const nv = vortexNeeded(row.vortexNeeded);
      return `<option value="${n(row.itemID)}">${esc(row.itemName)}${row.profession ? ` (${esc(row.profession)})` : ""} — ${nv} NV</option>`;
    }),
  ].join("");
  if (previousValue && rows.some((row) => String(n(row.itemID)) === previousValue)) {
    select.value = previousValue;
  }
}

function renderSelectedItems() {
  const host = document.getElementById("vortexSelectedItems");
  if (!host) return;
  if (!selectedItems.length) {
    host.innerHTML = `<span class="subtle">No craftable items selected yet.</span>`;
    return;
  }
  host.innerHTML = selectedItems
    .map(
      (row, idx) =>
        `<span class="loot-recipient-pill">
          <span class="vortex-selected-item-main">
            ${renderItemChip(row.itemID, row.itemName, row.profession)}
            <span class="vortex-cost-wrap" title="Per craft — from TBC recipe data (Nether Vortex count).">
            ${renderVortexCost(vortexNeeded(row.vortexNeeded), { compact: true })}
            </span>
          </span>
          ${
            vortexCanEdit
              ? `<button type="button" class="auth-chip-btn" data-remove-item="${idx}" style="padding:2px 6px;">x</button>`
              : ""
          }
        </span>`
    )
    .join("");
  window.WowItemTooltip.bindLootTooltipHandlers(document.getElementById("vortexSelectedItems"), (id) =>
    itemMetaById.get(Number(id))
  );
}

async function loadCraftables() {
  const payload = await getJson("/api/nether-vortex/craftables");
  craftables = Array.isArray(payload?.items) ? payload.items : [];
  updateCraftableOptions();
  const ids = [...new Set(craftables.map((row) => n(row.itemID)).filter((id) => id > 0))];
  if (NETHER_VORTEX_ITEM_ID > 0) ids.push(NETHER_VORTEX_ITEM_ID);
  itemMetaById = new Map();
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const metaPayload = await getJson(`/api/wow-classic/items?ids=${encodeURIComponent(chunk.join(","))}`);
    for (const row of metaPayload?.items || []) {
      if (n(row?.itemId) > 0) itemMetaById.set(n(row.itemId), row);
    }
  }
  netherVortexIcon = normalizeItemIconUrl(String(itemMetaById.get(NETHER_VORTEX_ITEM_ID)?.icon || "").trim());
}

/** Raw demand rows from API; refiltered/resorted client-side. */
let demandEntriesCache = [];

function fmtDemandUpdated(ts) {
  if (!ts) return "—";
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

function demandRowMatchesFilter(row, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  if (String(row.displayName || "").toLowerCase().includes(s)) return true;
  if (String(row.characterName || "").toLowerCase().includes(s)) return true;
  for (const it of Array.isArray(row.items) ? row.items : []) {
    if (String(it.itemName || "").toLowerCase().includes(s)) return true;
    if (String(it.profession || "").toLowerCase().includes(s)) return true;
  }
  return false;
}

/**
 * Renders the "Raider" cell — character link (when available) + optional
 * Discord name subtitle.
 */
function buildDemandRaiderCell(row) {
  const discordName = String(row.displayName || "").trim();
  const characterName = String(row.characterName || "").trim() || discordName || "Unknown";
  const url = String(row.characterProfileUrl || "").trim();
  const resolvedDifferent =
    discordName &&
    characterName &&
    discordName !== "Unknown" &&
    characterName !== "Unknown" &&
    discordName.toLowerCase() !== characterName.toLowerCase();

  const nameMarkup = url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(characterName)}</a>`
    : esc(characterName);
  const subtitle = resolvedDifferent ? `<span class="p2-demand-raider-sub">${esc(discordName)}</span>` : "";
  return `<div class="p2-demand-raider-name">${nameMarkup}${subtitle}</div>`;
}

/**
 * Item cell content — keeps the `.loot-item-name` hook so the global tooltip
 * binder still wires up Wowhead lookups, then layers `.p2-demand-item*`
 * presentation on top.
 */
function renderDemandItemCell(itemId, itemName) {
  const id = canonicalItemId(itemName, itemId);
  const meta = itemMetaById.get(id);
  const iconUrl = normalizeItemIconUrl(meta?.icon || "");
  const icon = iconUrl
    ? `<img class="p2-demand-item-icon" src="${esc(iconUrl)}" alt="" width="28" height="28" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : `<span class="p2-demand-item-icon"></span>`;
  return `<div class="loot-item-name p2-demand-item" data-loot-item-id="${id}" title="${esc(tooltipText(meta))}">${icon}<span class="p2-demand-item-name">${esc(itemName)}</span></div>`;
}

/**
 * Build the table rows for one raider as a single string. Multi-item raiders
 * use `rowspan` on the Raider / Total NV / Updated cells so the Item column
 * still gets a row per item without nesting a list inside a single cell.
 */
function buildDemandRowsForRaider(row) {
  const items = Array.isArray(row.items) && row.items.length ? row.items : [];
  const totalNv = n(entryNetherVortexTotal(row));
  const updatedIso = row.updatedAt ? new Date(Number(row.updatedAt)).toISOString() : "";
  const updatedLabel = fmtDemandUpdated(row.updatedAt);
  const timeMarkup = updatedIso
    ? `<time datetime="${esc(updatedIso)}">${esc(updatedLabel)}</time>`
    : esc(updatedLabel);
  const raiderCell = buildDemandRaiderCell(row);

  if (!items.length) {
    return `
      <tr class="is-group-end">
        <td class="cell-raider">${raiderCell}</td>
        <td colspan="2"><span class="subtle">No items selected.</span></td>
        <td class="cell-num">0</td>
        <td class="cell-time">${timeMarkup}</td>
      </tr>
    `;
  }

  const span = items.length;
  return items
    .map((it, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === items.length - 1;
      const trCls = isLast ? ' class="is-group-end"' : "";
      const cells = [];
      if (isFirst) {
        cells.push(
          `<td class="cell-raider"${span > 1 ? ` rowspan="${span}"` : ""}>${raiderCell}</td>`
        );
      }
      cells.push(`<td class="cell-item">${renderDemandItemCell(it.itemID, it.itemName)}</td>`);
      cells.push(`<td class="cell-prof">${it.profession ? esc(it.profession) : "—"}</td>`);
      if (isFirst) {
        cells.push(
          `<td class="cell-num"${span > 1 ? ` rowspan="${span}"` : ""}>${totalNv}</td>`
        );
        cells.push(
          `<td class="cell-time"${span > 1 ? ` rowspan="${span}"` : ""}>${timeMarkup}</td>`
        );
      }
      return `<tr${trCls}>${cells.join("")}</tr>`;
    })
    .join("");
}

function refreshDemandTable() {
  const tbody = document.getElementById("vortexDemandTbody");
  const tfoot = document.getElementById("vortexDemandTfoot");
  const wrap = document.getElementById("vortexDemandWrap");
  const empty = document.getElementById("vortexDemandEmpty");
  if (!tbody) return;

  const all = demandEntriesCache;
  if (!all.length) {
    tbody.innerHTML = "";
    if (tfoot) {
      tfoot.hidden = true;
      tfoot.innerHTML = "";
    }
    if (wrap) wrap.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = "No submissions yet.";
    }
    return;
  }

  const q = document.getElementById("vortexDemandSearch")?.value || "";
  const rows = all
    .filter((r) => demandRowMatchesFilter(r, q))
    .sort((a, b) => entryNetherVortexTotal(b) - entryNetherVortexTotal(a));

  if (!rows.length) {
    tbody.innerHTML = "";
    if (tfoot) {
      tfoot.hidden = true;
      tfoot.innerHTML = "";
    }
    if (wrap) wrap.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = "No raiders match your filter.";
    }
    return;
  }

  if (wrap) wrap.hidden = false;
  if (empty) empty.hidden = true;

  tbody.innerHTML = rows.map((row) => buildDemandRowsForRaider(row)).join("");

  const grandTotal = rows.reduce((sum, row) => sum + entryNetherVortexTotal(row), 0);
  if (tfoot) {
    tfoot.hidden = false;
    tfoot.innerHTML = `
      <tr>
        <td colspan="3">${rows.length} ${rows.length === 1 ? "raider" : "raiders"}${
      rows.length !== all.length ? ` (of ${all.length})` : ""
    }</td>
        <td class="cell-num">${grandTotal}</td>
        <td class="cell-time"></td>
      </tr>
    `;
  }

  window.WowItemTooltip.bindLootTooltipHandlers(tbody, (id) => itemMetaById.get(Number(id)));
}

function renderList(entries) {
  demandEntriesCache = Array.isArray(entries) ? entries : [];
  refreshDemandTable();
}

let demandFilterListenersBound = false;
function ensureDemandFilterListeners() {
  if (demandFilterListenersBound) return;
  demandFilterListenersBound = true;
  const search = document.getElementById("vortexDemandSearch");
  let debounceTimer = null;
  search?.addEventListener("input", () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => refreshDemandTable(), 140);
  });
}

async function loadTracker() {
  const meta = document.getElementById("vortexMeta");
  const saveBtn = document.getElementById("vortexSaveBtn");
  const search = document.getElementById("vortexCraftableSearch");
  const select = document.getElementById("vortexCraftableSelect");
  const addBtn = document.getElementById("vortexAddItemBtn");
  try {
    await loadCraftables();
  } catch {
    craftables = [];
    updateCraftableOptions();
  }
  const payload = await getJson("/api/nether-vortex/needs");
  const canEdit = Boolean(payload?.authenticated);
  vortexCanEdit = canEdit;
  try {
    await fetchItemMetaChunk(collectMissingMetaIds(payload?.entries, payload?.myEntry?.items));
  } catch {}
  netherVortexIcon = normalizeItemIconUrl(String(itemMetaById.get(NETHER_VORTEX_ITEM_ID)?.icon || "").trim());
  const total = n(payload?.totalNeeded);
  meta.textContent = `Total guild need: ${total} Nether Vortex`;
  meta.classList.remove("animate-pulse", "opacity-60");
  renderList(payload?.entries);

  const my = payload?.myEntry || null;
  selectedItems = Array.isArray(my?.items)
    ? applyCraftableVortexCounts(
        my.items.map((row) => {
          const id = canonicalItemId(row.itemName, row?.itemID);
          const fromCraft = craftables.find((c) => n(c.itemID) === id);
          return {
            ...row,
            itemID: id,
            itemName: String(row.itemName || "").trim() || String(fromCraft?.itemName || ""),
            profession: String(row.profession || "").trim() || String(fromCraft?.profession || ""),
            vortexNeeded: vortexNeeded(row?.vortexNeeded),
          };
        })
      )
    : [];
  renderSelectedItems();

  const canUseCraftables = craftables.length > 0;
  if (saveBtn) saveBtn.disabled = !canEdit;
  /* Browse / pick craftables without login; save still requires Discord */
  if (search) search.disabled = !canUseCraftables;
  if (select) select.disabled = !canUseCraftables;
  if (addBtn) addBtn.disabled = !canUseCraftables;
}

document.getElementById("vortexSaveBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("vortexSaveBtn");
  if (!btn) return;
  if (!vortexCanEdit) {
    window.alert("Login with Discord to save your need.");
    return;
  }
  btn.disabled = true;
  const idle = btn.textContent;
  btn.textContent = "Saving...";
  try {
    await getJson("/api/nether-vortex/needs/my", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        neededCount: 0,
        items: selectedItems.map((row) => ({
          itemID: n(row.itemID),
          itemName: String(row.itemName || ""),
          profession: String(row.profession || ""),
          vortexNeeded: vortexNeeded(row.vortexNeeded),
        })),
      }),
    });
    btn.textContent = "Saved";
    await loadTracker();
  } catch (error) {
    btn.textContent = "Save failed";
    window.alert(error?.message || "Save failed");
  } finally {
    window.setTimeout(() => {
      btn.disabled = false;
      btn.textContent = idle;
    }, 1000);
  }
});

document.getElementById("vortexAddItemBtn")?.addEventListener("click", () => {
  const select = document.getElementById("vortexCraftableSelect");
  if (!select) return;
  const itemId = n(select.value);
  if (!itemId) {
    window.alert("Pick an item from the dropdown first.");
    return;
  }
  const picked = craftables.find((row) => n(row?.itemID) === itemId);
  if (!picked) {
    window.alert("Pick an item from the dropdown list.");
    return;
  }
  const exists = selectedItems.some((row) => n(row?.itemID) === n(picked.itemID));
  if (exists) {
    window.alert("That item is already in your selected list.");
    return;
  }
  selectedItems.push({
    itemID: n(picked.itemID),
    itemName: String(picked.itemName || ""),
    profession: String(picked.profession || ""),
    vortexNeeded: vortexNeeded(picked.vortexNeeded),
  });
  renderSelectedItems();
});

document.getElementById("vortexCraftableSearch")?.addEventListener("input", () => {
  updateCraftableOptions();
});

document.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove-item]");
  if (!btn) return;
  const idx = Number(btn.getAttribute("data-remove-item"));
  if (!Number.isInteger(idx) || idx < 0 || idx >= selectedItems.length) return;
  selectedItems.splice(idx, 1);
  renderSelectedItems();
});

ensureDemandFilterListeners();
loadTracker().catch((error) => {
  demandEntriesCache = [];
  refreshDemandTable();
  const meta = document.getElementById("vortexMeta");
  if (meta) {
    meta.textContent = error?.message || "Failed to load tracker.";
    meta.classList.remove("animate-pulse", "opacity-80");
  }
  const empty = document.getElementById("vortexDemandEmpty");
  if (empty) {
    empty.hidden = false;
    empty.textContent = error?.message || "Failed to load tracker.";
  }
});
