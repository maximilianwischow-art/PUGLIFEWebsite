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
/** @type {Set<string>} keys from admin P2 demand checks (`userId:itemId`) */
let demandCheckedKeys = new Set();
const NETHER_VORTEX_ITEM_ID = 30183;
/** @type {string[]} */
let linkedCharacterNames = [];
let profileMainCharacterName = "";
let selectedCharacterRole = "main";
const CUSTOM_CHARACTER_VALUE = "__custom__";
/** The signed-in user's saved craftable lists, one per character. */
let myEntries = [];
/** @type {Map<string, object>} normalized character key → saved entry */
let myEntriesByCharKey = new Map();

function charKeyOf(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Per-character fulfillment key (matches server `p2DemandAdminItemCheckKey`). */
function demandCheckKeyEntry(entryKey, itemId) {
  return `${String(entryKey || "").trim()}::${Math.max(0, Math.floor(Number(itemId) || 0))}`;
}

/** Legacy `userId:itemId` key, still honored so pre-existing checks show through. */
function demandLegacyCheckKey(userId, itemId) {
  return `${String(userId || "").trim()}:${Math.max(0, Math.floor(Number(itemId) || 0))}`;
}

function isDemandItemChecked(row, itemId) {
  return (
    demandCheckedKeys.has(demandCheckKeyEntry(row?.entryKey, itemId)) ||
    demandCheckedKeys.has(demandLegacyCheckKey(row?.userId, itemId))
  );
}

/** Open (not marked done) items first; received/done last. */
function sortDemandItemsOpenFirst(row, items) {
  return (Array.isArray(items) ? items.slice() : []).sort((a, b) => {
    const aId = Math.max(0, Math.floor(Number(a?.itemID) || 0));
    const bId = Math.max(0, Math.floor(Number(b?.itemID) || 0));
    const aDone = isDemandItemChecked(row, aId) ? 1 : 0;
    const bDone = isDemandItemChecked(row, bId) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return String(a?.itemName || "").localeCompare(String(b?.itemName || ""));
  });
}

function demandRowOpenItemCount(row) {
  const items = Array.isArray(row?.items) ? row.items : [];
  let open = 0;
  for (const it of items) {
    const id = Math.max(0, Math.floor(Number(it?.itemID) || 0));
    if (!isDemandItemChecked(row, id)) open += 1;
  }
  return open;
}

function compareDemandRowsOpenFirst(a, b) {
  const aOpen = demandRowOpenItemCount(a);
  const bOpen = demandRowOpenItemCount(b);
  const aHasOpen = aOpen > 0 ? 1 : 0;
  const bHasOpen = bOpen > 0 ? 1 : 0;
  if (aHasOpen !== bHasOpen) return bHasOpen - aHasOpen;
  if (aOpen !== bOpen) return bOpen - aOpen;
  return entryNetherVortexTotal(b) - entryNetherVortexTotal(a);
}

const P2_DEMAND_DONE_ICON =
  '<svg class="p2-demand-status-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M6.2 11.2 3.4 8.4l1-1 2.8 2.8 5.4-5.4 1 1z"/></svg>';

function p2DemandDoneStatusHtml() {
  return `<span class="p2-demand-status is-done" title="Marked done by raid lead">${P2_DEMAND_DONE_ICON}<span>Done</span></span>`;
}

function renderP2DemandStats(total, done, open) {
  const el = document.getElementById("p2DemandStats");
  if (!el) return;
  if (total <= 0) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = `
    <div class="p2-demand-stat p2-demand-stat--total">
      <span class="p2-demand-stat-label">Guild need</span>
      <span class="p2-demand-stat-value">${total}<span class="p2-demand-stat-unit"> NV</span></span>
    </div>
    <div class="p2-demand-stat p2-demand-stat--open">
      <span class="p2-demand-stat-label">Open</span>
      <span class="p2-demand-stat-value">${open}<span class="p2-demand-stat-unit"> NV</span></span>
    </div>
    <div class="p2-demand-stat p2-demand-stat--done">
      <span class="p2-demand-stat-label">Done</span>
      <span class="p2-demand-stat-value">${done}<span class="p2-demand-stat-unit"> NV</span></span>
    </div>
  `;
}

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
              ? `<button type="button" class="auth-chip-btn vortex-chip-remove" data-remove-item="${idx}" aria-label="Remove ${esc(String(row.itemName || "item"))}">×</button>`
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
  if (String(row.requestCharacterName || "").toLowerCase().includes(s)) return true;
  for (const it of Array.isArray(row.items) ? row.items : []) {
    if (String(it.itemName || "").toLowerCase().includes(s)) return true;
    if (String(it.profession || "").toLowerCase().includes(s)) return true;
  }
  return false;
}

function requestCharacterRolePillHtml(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r !== "main" && r !== "alt") return "";
  const label = r === "main" ? "Main" : "Alt";
  return `<span class="p2-character-role-pill p2-character-role-pill--${r}">${label}</span>`;
}

function setCharacterRole(role, { syncButtons = true } = {}) {
  selectedCharacterRole = role === "alt" ? "alt" : "main";
  if (!syncButtons) return;
  document.getElementById("vortexRoleMain")?.classList.toggle("is-active", selectedCharacterRole === "main");
  document.getElementById("vortexRoleAlt")?.classList.toggle("is-active", selectedCharacterRole === "alt");
}

function syncCustomCharacterVisibility() {
  const select = document.getElementById("vortexCharacterSelect");
  const custom = document.getElementById("vortexCharacterCustom");
  if (!select || !custom) return;
  const isCustom = select.value === CUSTOM_CHARACTER_VALUE;
  custom.hidden = !isCustom;
  if (isCustom) custom.focus();
}

function roleForLinkedCharacter(name) {
  const main = String(profileMainCharacterName || "").trim().toLowerCase();
  const n = String(name || "").trim().toLowerCase();
  if (main && n && main === n) return "main";
  return "alt";
}

function populateCharacterSelect(preferredName = "") {
  const select = document.getElementById("vortexCharacterSelect");
  if (!select) return;
  const preferred = String(preferredName || "").trim();
  const options = ['<option value="">Select character…</option>'];
  for (const name of linkedCharacterNames) {
    const role = roleForLinkedCharacter(name);
    const label = `${name} (${role === "main" ? "Main" : "Alt"})`;
    const selected = preferred && preferred.toLowerCase() === name.toLowerCase() ? " selected" : "";
    options.push(`<option value="${esc(name)}"${selected}>${esc(label)}</option>`);
  }
  const preferredIsLinked = linkedCharacterNames.some(
    (n) => n.toLowerCase() === preferred.toLowerCase()
  );
  const customSelected = preferred && !preferredIsLinked ? " selected" : "";
  options.push(`<option value="${CUSTOM_CHARACTER_VALUE}"${customSelected}>Other name…</option>`);
  select.innerHTML = options.join("");
  const custom = document.getElementById("vortexCharacterCustom");
  if (custom) {
    if (preferred && !preferredIsLinked) {
      custom.value = preferred;
      custom.hidden = false;
    } else {
      custom.value = "";
      custom.hidden = select.value !== CUSTOM_CHARACTER_VALUE;
    }
  }
}

function getSelectedRequestCharacter() {
  const select = document.getElementById("vortexCharacterSelect");
  const custom = document.getElementById("vortexCharacterCustom");
  if (!select) return { name: "", role: selectedCharacterRole };
  if (select.value === CUSTOM_CHARACTER_VALUE) {
    return {
      name: String(custom?.value || "").trim(),
      role: selectedCharacterRole,
    };
  }
  const name = String(select.value || "").trim();
  return { name, role: selectedCharacterRole };
}

function applyCharacterPickerFromEntry(entry) {
  const savedName = String(entry?.requestCharacterName || "").trim();
  const savedRole = String(entry?.requestCharacterRole || "").trim().toLowerCase();
  populateCharacterSelect(savedName);
  if (savedRole === "main" || savedRole === "alt") {
    setCharacterRole(savedRole);
  } else if (savedName) {
    setCharacterRole(roleForLinkedCharacter(savedName));
  } else if (profileMainCharacterName) {
    populateCharacterSelect(profileMainCharacterName);
    setCharacterRole("main");
  } else if (linkedCharacterNames[0]) {
    populateCharacterSelect(linkedCharacterNames[0]);
    setCharacterRole(roleForLinkedCharacter(linkedCharacterNames[0]));
  } else {
    setCharacterRole("alt");
  }
  syncCustomCharacterVisibility();
}

async function loadLinkedCharactersForPicker() {
  linkedCharacterNames = [];
  profileMainCharacterName = "";
  try {
    const payload = await getJson("/api/profile/me");
    profileMainCharacterName = String(payload?.profile?.mainCharacterName || "").trim();
    const linked = Array.isArray(payload?.linkedCharacters) ? payload.linkedCharacters : [];
    linkedCharacterNames = linked.map((n) => String(n || "").trim()).filter(Boolean);
  } catch {
    /* not logged in or profile unavailable */
  }
}

function fmtDemandRaidsAttended(row) {
  const n = row?.wclEventCount;
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return String(Math.max(0, Math.floor(Number(n))));
}

function buildDemandRaidsCell(row, span = 1) {
  const label = fmtDemandRaidsAttended(row);
  const n = row?.wclEventCount;
  const tip =
    n == null
      ? "Raid attendance unavailable — link this Discord account in Admin → Identity."
      : "Distinct guild raid logs this character appeared in (Event Management scope, same as leaderboard Events).";
  const spanAttr = span > 1 ? ` rowspan="${span}"` : "";
  return `<td class="cell-num cell-raids"${spanAttr} title="${esc(tip)}">${esc(label)}</td>`;
}

/**
 * Renders the "Raider" cell. Always shows the WoW character name from the
 * Account Assignment table (`rh-wcl-character-links.json`). When a row has
 * no character link yet we still need to show *something*, so we keep the
 * Discord display name as a graceful fallback — but no Discord subtitle is
 * rendered when a character is linked.
 */
function buildDemandRaiderCell(row) {
  const discordName = String(row.displayName || "").trim();
  const requestName = String(row.requestCharacterName || "").trim();
  const linkedCharacter = String(row.characterName || "").trim();
  const display = requestName || linkedCharacter || discordName || "Unknown";
  const hasRequest = Boolean(requestName);
  const hasLink =
    !hasRequest && Boolean(linkedCharacter) && linkedCharacter.toLowerCase() !== discordName.toLowerCase();
  const rolePill = requestCharacterRolePillHtml(row.requestCharacterRole);

  const hint =
    !hasRequest && !hasLink && discordName
      ? `<span class="p2-demand-raider-sub" title="Add an Account Assignment row on /admin.html to show the WoW character.">unassigned</span>`
      : "";
  return `<div class="p2-demand-raider-name">${esc(display)}${rolePill}${hint}</div>`;
}

/**
 * Item cell content — keeps the `.loot-item-name` hook so the global tooltip
 * binder still wires up Wowhead lookups, then layers `.p2-demand-item*`
 * presentation on top.
 */
function renderDemandItemCell(itemId, itemName, isDone) {
  const id = canonicalItemId(itemName, itemId);
  const meta = itemMetaById.get(id);
  const iconUrl = normalizeItemIconUrl(meta?.icon || "");
  const icon = iconUrl
    ? `<img class="p2-demand-item-icon" src="${esc(iconUrl)}" alt="" width="28" height="28" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : `<span class="p2-demand-item-icon"></span>`;
  const doneCls = isDone ? " is-done" : "";
  return `<div class="loot-item-name p2-demand-item${doneCls}" data-loot-item-id="${id}" title="${esc(tooltipText(meta))}">${icon}<span class="p2-demand-item-name">${esc(itemName)}</span></div>`;
}

/**
 * Build the table rows for one raider as a single string. Multi-item raiders
 * use `rowspan` on the Raider / Total NV / Updated cells so the Item column
 * still gets a row per item without nesting a list inside a single cell.
 */
function buildDemandRowsForRaider(row) {
  const items =
    Array.isArray(row.items) && row.items.length ? sortDemandItemsOpenFirst(row, row.items) : [];
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
        ${buildDemandRaidsCell(row)}
        <td colspan="2"><span class="subtle">No items selected.</span></td>
        <td class="cell-num">0</td>
        <td class="cell-time">${timeMarkup}</td>
      </tr>
    `;
  }

  const span = items.length;
  const allItemsChecked =
    items.length > 0 &&
    items.every((it) => isDemandItemChecked(row, Math.max(0, Math.floor(Number(it.itemID) || 0))));
  return items
    .map((it, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === items.length - 1;
      const itemId = Math.max(0, Math.floor(Number(it.itemID) || 0));
      const checked = isDemandItemChecked(row, itemId);
      const trCls = [isLast ? "is-group-end" : "", checked ? "is-demand-checked" : ""].filter(Boolean).join(" ");
      const cells = [];
      if (isFirst) {
        cells.push(
          `<td class="cell-raider"${span > 1 ? ` rowspan="${span}"` : ""}>${raiderCell}</td>`
        );
        cells.push(buildDemandRaidsCell(row, span));
      }
      const itemHtml = renderDemandItemCell(canonicalItemId(it.itemName, itemId), it.itemName, checked);
      const statusHtml = checked ? p2DemandDoneStatusHtml() : "";
      cells.push(
        `<td class="cell-item"><div class="p2-demand-item-cell${checked ? " is-done" : ""}">${itemHtml}${statusHtml}</div></td>`
      );
      cells.push(
        `<td class="cell-prof${checked ? " is-done" : ""}">${it.profession ? esc(it.profession) : "—"}</td>`
      );
      if (isFirst) {
        const numCls = allItemsChecked ? " is-done" : "";
        cells.push(
          `<td class="cell-num${numCls}"${span > 1 ? ` rowspan="${span}"` : ""}>${totalNv}</td>`
        );
        cells.push(
          `<td class="cell-time"${span > 1 ? ` rowspan="${span}"` : ""}>${timeMarkup}</td>`
        );
      }
      return `<tr${trCls ? ` class="${trCls}"` : ""}>${cells.join("")}</tr>`;
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
    .sort(compareDemandRowsOpenFirst);

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
  let checkedNv = 0;
  for (const row of rows) {
    for (const it of row.items || []) {
      if (isDemandItemChecked(row, Math.max(0, Math.floor(Number(it.itemID) || 0)))) {
        checkedNv += vortexNeeded(it?.vortexNeeded);
      }
    }
  }
  const openNv = Math.max(0, grandTotal - checkedNv);
  renderP2DemandStats(grandTotal, checkedNv, openNv);
  const meta = document.getElementById("vortexMeta");
  if (meta) {
    meta.textContent = `Total guild need: ${grandTotal} Nether Vortex · Done: ${checkedNv} · Open: ${openNv}`;
    meta.classList.remove("animate-pulse", "opacity-80");
  }
  if (tfoot) {
    tfoot.hidden = false;
    tfoot.innerHTML = `
      <tr>
        <td colspan="4">${rows.length} ${rows.length === 1 ? "raider" : "raiders"}${
      rows.length !== all.length ? ` (of ${all.length})` : ""
    }</td>
        <td class="cell-num">${grandTotal}</td>
        <td class="cell-time"></td>
      </tr>
    `;
  }

  window.WowItemTooltip.bindLootTooltipHandlers(tbody, (id) => itemMetaById.get(Number(id)));
}

function renderList(entries, checkedKeys) {
  demandEntriesCache = Array.isArray(entries) ? entries : [];
  demandCheckedKeys = new Set(
    Array.isArray(checkedKeys) ? checkedKeys.map((k) => String(k || "").trim()).filter(Boolean) : []
  );
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

/** Normalize a saved entry's items into the shape `selectedItems` expects. */
function mapEntryItemsToSelected(entry) {
  if (!Array.isArray(entry?.items)) return [];
  return applyCraftableVortexCounts(
    entry.items.map((row) => {
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
  );
}

/**
 * Point `selectedItems` at the saved list for the character currently in the
 * picker. A character with no saved list (e.g. switching to a fresh Alt) starts
 * empty, so the same craftable can be added there without colliding with Main.
 */
function loadSelectedItemsForCurrentCharacter() {
  const { name } = getSelectedRequestCharacter();
  const entry = myEntriesByCharKey.get(charKeyOf(name)) || null;
  selectedItems = mapEntryItemsToSelected(entry);
  renderSelectedItems();
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
  const checkedNv = n(payload?.checkedNv);
  const openNv = n(payload?.openNv ?? Math.max(0, total - checkedNv));
  renderP2DemandStats(total, checkedNv, openNv);
  if (meta) {
    meta.textContent = `Total guild need: ${total} Nether Vortex · Done: ${checkedNv} · Open: ${openNv}`;
    meta.classList.remove("animate-pulse", "opacity-60");
  }
  renderList(payload?.entries, payload?.checkedKeys);

  if (canEdit) {
    await loadLinkedCharactersForPicker();
  } else {
    linkedCharacterNames = [];
    profileMainCharacterName = "";
    populateCharacterSelect("");
  }

  myEntries = Array.isArray(payload?.myEntries)
    ? payload.myEntries
    : payload?.myEntry
      ? [payload.myEntry]
      : [];
  myEntriesByCharKey = new Map();
  for (const entry of myEntries) {
    myEntriesByCharKey.set(charKeyOf(entry?.requestCharacterName), entry);
  }

  // Default the picker to the Main character's list when present, else the most
  // recent saved list, else an empty list for a fresh submission.
  const defaultEntry =
    myEntries.find((e) => charKeyOf(e?.requestCharacterName) === charKeyOf(profileMainCharacterName)) ||
    myEntries.find((e) => String(e?.requestCharacterRole || "").toLowerCase() === "main") ||
    myEntries[0] ||
    null;
  applyCharacterPickerFromEntry(defaultEntry);
  loadSelectedItemsForCurrentCharacter();

  const canUseCraftables = craftables.length > 0;
  if (saveBtn) saveBtn.disabled = !canEdit;
  /* Browse / pick craftables without login; save still requires Discord */
  if (search) search.disabled = !canUseCraftables;
  if (select) select.disabled = !canUseCraftables;
  if (addBtn) addBtn.disabled = !canUseCraftables;
  const charSelect = document.getElementById("vortexCharacterSelect");
  const charCustom = document.getElementById("vortexCharacterCustom");
  if (charSelect) charSelect.disabled = !canEdit;
  if (charCustom) charCustom.disabled = !canEdit;
  document.getElementById("vortexRoleMain")?.toggleAttribute("disabled", !canEdit);
  document.getElementById("vortexRoleAlt")?.toggleAttribute("disabled", !canEdit);
}

document.getElementById("vortexSaveBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("vortexSaveBtn");
  if (!btn) return;
  if (!vortexCanEdit) {
    window.alert("Login with Discord to save your need.");
    return;
  }
  const { name: requestCharacterName, role: requestCharacterRole } = getSelectedRequestCharacter();
  if (selectedItems.length && !requestCharacterName) {
    window.alert("Choose which character these craftables are for (Main or Alt), or type a name.");
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
        requestCharacterName,
        requestCharacterRole,
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

document.getElementById("vortexCharacterSelect")?.addEventListener("change", () => {
  const select = document.getElementById("vortexCharacterSelect");
  syncCustomCharacterVisibility();
  if (!select) return;
  if (select.value && select.value !== CUSTOM_CHARACTER_VALUE) {
    setCharacterRole(roleForLinkedCharacter(select.value));
  } else if (select.value === CUSTOM_CHARACTER_VALUE) {
    setCharacterRole("alt");
  }
  // Switching character loads *that* character's saved craftables (or empty).
  loadSelectedItemsForCurrentCharacter();
});

// For a typed "Other name…", only pull a saved list if one exists for that name;
// otherwise keep whatever items are in progress (a brand-new character list).
document.getElementById("vortexCharacterCustom")?.addEventListener("change", () => {
  const { name } = getSelectedRequestCharacter();
  if (myEntriesByCharKey.has(charKeyOf(name))) {
    loadSelectedItemsForCurrentCharacter();
  }
});

document.getElementById("vortexRoleMain")?.addEventListener("click", () => setCharacterRole("main"));
document.getElementById("vortexRoleAlt")?.addEventListener("click", () => setCharacterRole("alt"));

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
