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

/** Guild row + totals: pool count + sum of per-item vortex (same formula as API totalNeeded). */
function entryNetherVortexTotal(row) {
  const pool = n(row?.neededCount);
  const items = Array.isArray(row?.items) ? row.items : [];
  const fromItems = items.reduce((sum, it) => sum + vortexNeeded(it?.vortexNeeded), 0);
  return pool + fromItems;
}

function vortexNeeded(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 1;
  return Math.max(1, Math.min(20, Math.floor(x)));
}

async function getJson(url, opts) {
  const res = await fetch(url, { credentials: "include", ...(opts || {}) });
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

function renderVortexCost(cost) {
  const vortexIconSrc = normalizeItemIconUrl(netherVortexIcon);
  const icon = vortexIconSrc
    ? `<img class="vortex-inline-icon" src="${esc(vortexIconSrc)}" alt="" width="18" height="18" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : "";
  return `<span class="vortex-cost-badge">${icon}<span>${n(cost)} Nether Vortex</span></span>`;
}

function renderItemChip(itemId, itemName, profession = "") {
  const id = canonicalItemId(itemName, itemId);
  const meta = itemMetaById.get(id);
  const iconUrl = normalizeItemIconUrl(meta?.icon || "");
  const icon = iconUrl
    ? `<img class="loot-item-icon" src="${esc(iconUrl)}" alt="" width="36" height="36" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : `<span class="loot-item-icon loot-item-icon--fallback" aria-hidden="true"></span>`;
  const namePart = `${esc(itemName)}${profession ? ` (${esc(profession)})` : ""}`;
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
            ${renderVortexCost(vortexNeeded(row.vortexNeeded))}
            </span>
          </span>
          <button type="button" class="auth-chip-btn" data-remove-item="${idx}" style="padding:2px 6px;">x</button>
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

function renderList(entries) {
  const host = document.getElementById("vortexList");
  if (!host) return;
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) {
    host.innerHTML = `<p class="subtle">No submissions yet.</p>`;
    return;
  }
  host.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>Player</th><th>Need</th><th>Craftable Items</th><th>Updated</th></tr></thead>
        <tbody>
          ${rows
            .map((row) => {
              const items = (Array.isArray(row.items) ? row.items : [])
                .map(
                  (it) =>
                    `${renderItemChip(it.itemID, it.itemName, it.profession)} ${renderVortexCost(vortexNeeded(it.vortexNeeded))}`
                )
                .join("<br/>");
              const updated = row.updatedAt ? new Date(Number(row.updatedAt)).toLocaleString() : "-";
              return `
                <tr>
                  <td>${esc(row.displayName || "Unknown")}</td>
                  <td>${n(entryNetherVortexTotal(row))}</td>
                  <td>${items || "<span class='subtle'>-</span>"}</td>
                  <td>${esc(updated)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  window.WowItemTooltip.bindLootTooltipHandlers(document.getElementById("vortexList"), (id) => itemMetaById.get(Number(id)));
}

async function loadTracker() {
  const meta = document.getElementById("vortexMeta");
  const notice = document.getElementById("vortexAuthNotice");
  const neededInput = document.getElementById("vortexNeededCount");
  const saveBtn = document.getElementById("vortexSaveBtn");
  const search = document.getElementById("vortexCraftableSearch");
  const select = document.getElementById("vortexCraftableSelect");
  const addBtn = document.getElementById("vortexAddItemBtn");
  if (saveBtn) saveBtn.disabled = false;
  let craftablesError = "";
  try {
    await loadCraftables();
  } catch (error) {
    craftables = [];
    updateCraftableOptions();
    craftablesError = String(error?.message || "Failed to load craftable items");
  }
  const payload = await getJson("/api/nether-vortex/needs");
  try {
    await fetchItemMetaChunk(collectMissingMetaIds(payload?.entries, payload?.myEntry?.items));
  } catch {}
  netherVortexIcon = normalizeItemIconUrl(String(itemMetaById.get(NETHER_VORTEX_ITEM_ID)?.icon || "").trim());
  const total = n(payload?.totalNeeded);
  meta.textContent = `Total guild need: ${total} Nether Vortex`;
  renderList(payload?.entries);

  const my = payload?.myEntry || null;
  if (neededInput) neededInput.value = String(n(my?.neededCount || 0));
  selectedItems = Array.isArray(my?.items)
    ? applyCraftableVortexCounts(
        my.items.map((row) => ({
          ...row,
          itemID: canonicalItemId(row.itemName, row?.itemID),
          vortexNeeded: vortexNeeded(row?.vortexNeeded),
        }))
      )
    : [];
  renderSelectedItems();

  const canEdit = Boolean(payload?.authenticated);
  vortexCanEdit = canEdit;
  if (notice) {
    notice.textContent = canEdit
      ? "Logged in: update your own need anytime."
      : "Login with Discord to submit your Nether Vortex need.";
    if (craftablesError) {
      notice.textContent += ` Craftables unavailable right now: ${craftablesError}`;
    }
  }
  if (neededInput) neededInput.disabled = false;
  if (saveBtn) saveBtn.disabled = false;
  const canUseCraftables = craftables.length > 0;
  if (search) search.disabled = !canUseCraftables;
  if (select) select.disabled = !canUseCraftables;
  if (addBtn) addBtn.disabled = !canUseCraftables;
}

document.getElementById("vortexSaveBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("vortexSaveBtn");
  const neededInput = document.getElementById("vortexNeededCount");
  if (!btn || !neededInput) return;
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
        neededCount: n(neededInput.value),
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

loadTracker().catch((error) => {
  const meta = document.getElementById("vortexMeta");
  const host = document.getElementById("vortexList");
  if (meta) meta.textContent = error?.message || "Failed to load tracker.";
  if (host) host.innerHTML = `<p class="subtle">${esc(error?.message || "Failed to load tracker.")}</p>`;
});
