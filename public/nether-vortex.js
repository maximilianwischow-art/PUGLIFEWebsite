function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
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
let tooltipEl = null;

function ensureTooltipEl() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "loot-tooltip-panel";
  tooltipEl.hidden = true;
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function positionTooltip(event) {
  if (!tooltipEl || tooltipEl.hidden) return;
  const pad = 14;
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const rect = tooltipEl.getBoundingClientRect();
  let x = event.clientX + 12;
  let y = event.clientY + 14;
  if (x + rect.width + pad > vw) x = Math.max(pad, event.clientX - rect.width - 16);
  if (y + rect.height + pad > vh) y = Math.max(pad, event.clientY - rect.height - 16);
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.hidden = true;
}

function showTooltip(event, itemId) {
  const panel = ensureTooltipEl();
  const meta = itemMetaById.get(Number(itemId));
  const html = meta?.tooltipHtml
    ? `<div class="loot-tooltip-wowhead">${meta.tooltipHtml}</div>`
    : (Array.isArray(meta?.tooltip) ? meta.tooltip : [])
        .map((line) => `<div class="loot-tooltip-line">${esc(line)}</div>`)
        .join("") || `<div class="loot-tooltip-line">No tooltip available.</div>`;
  panel.innerHTML = html;
  panel.hidden = false;
  positionTooltip(event);
}

function bindTooltipTargets() {
  document.querySelectorAll("[data-vortex-item-id]").forEach((el) => {
    el.addEventListener("mouseenter", (event) => {
      const itemId = Number(el.getAttribute("data-vortex-item-id") || 0);
      if (itemId > 0) showTooltip(event, itemId);
    });
    el.addEventListener("mousemove", (event) => positionTooltip(event));
    el.addEventListener("mouseleave", () => hideTooltip());
  });
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
    ...rows.map(
      (row) =>
        `<option value="${n(row.itemID)}">${esc(row.itemName)}${row.profession ? ` (${esc(row.profession)})` : ""}</option>`
    ),
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
        `<span class="loot-recipient-pill" data-vortex-item-id="${n(row.itemID)}">${esc(row.itemName)}${
          row.profession ? ` (${esc(row.profession)})` : ""
        } <button type="button" class="auth-chip-btn" data-remove-item="${idx}" style="padding:2px 6px;">x</button></span>`
    )
    .join("");
  bindTooltipTargets();
}

async function loadCraftables() {
  const payload = await getJson("/api/nether-vortex/craftables");
  craftables = Array.isArray(payload?.items) ? payload.items : [];
  updateCraftableOptions();
  const ids = [...new Set(craftables.map((row) => n(row.itemID)).filter((id) => id > 0))];
  itemMetaById = new Map();
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const metaPayload = await getJson(`/api/wow-classic/items?ids=${encodeURIComponent(chunk.join(","))}`);
    for (const row of metaPayload?.items || []) {
      if (n(row?.itemId) > 0) itemMetaById.set(n(row.itemId), row);
    }
  }
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
                    `<span data-vortex-item-id="${n(it.itemID)}">${esc(it.itemName)}</span>${
                      it.profession ? ` <span class="subtle">(${esc(it.profession)})</span>` : ""
                    }`
                )
                .join("<br/>");
              const updated = row.updatedAt ? new Date(Number(row.updatedAt)).toLocaleString() : "-";
              return `
                <tr>
                  <td>${esc(row.displayName || "Unknown")}</td>
                  <td>${n(row.neededCount)}</td>
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
  bindTooltipTargets();
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
  const total = n(payload?.totalNeeded);
  meta.textContent = `Total guild need: ${total} Nether Vortex`;
  renderList(payload?.entries);

  const my = payload?.myEntry || null;
  if (neededInput) neededInput.value = String(n(my?.neededCount || 0));
  selectedItems = Array.isArray(my?.items) ? my.items.map((row) => ({ ...row, itemID: n(row?.itemID) })) : [];
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
