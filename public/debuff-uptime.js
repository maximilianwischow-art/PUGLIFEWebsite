function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtTs(sec) {
  const ms = num(sec) > 1e12 ? num(sec) : num(sec) * 1000;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? "-" : dt.toLocaleString();
}


async function getJson(url, opts) {
  const res = await fetch(url, { credentials: "include", ...(opts || {}) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${res.status})`);
  return payload;
}


function setButtonFeedback(btn, text, tone = "info") {
  if (!btn) return;
  btn.setAttribute("data-feedback-tone", tone);
  btn.setAttribute("data-feedback-active", "1");
  btn.textContent = text;
}

function resetButtonFeedback(btn, defaultText) {
  if (!btn) return;
  btn.removeAttribute("data-feedback-tone");
  btn.removeAttribute("data-feedback-active");
  btn.textContent = defaultText;
}


function raidLabel(raid) {
  const title = String(raid?.reportTitle || raid?.reportCode || "Raid");
  const dt = fmtTs(raid?.reportStartTime);
  return `${title} (${dt})`;
}

const WCL_DEBUFF_API = "/api/raid-lead/wcl-debuff-uptime";
const WCL_DEBUFF_TRENDS_API = "/api/raid-lead/wcl-debuff-trends";
const WCL_CONSUMABLES_API = "/api/raid-lead/wcl-consumables";
const WCL_GEAR_AUDIT_API = "/api/raid-lead/armory-gear-audit";
let allRaidsState = [];
let selectedReportCodesState = new Set();
let wclActivePanelTab = "debuffs";
let wclConsumablesOverviewCache = null;
let wclConsumablesOverviewReportCode = "";
let wclGearAuditOverviewCache = null;
let wclGearAuditOverviewReportCode = "";
let wclGearEnchantSpellMetaById = new Map();
let wclGearItemMetaById = new Map();
let wclGearExpandedPlayerIdx = -1;

const WCL_GEAR_ENCHANT_SLOT_ORDER = [
  "HEAD",
  "SHOULDER",
  "CHEST",
  "WRIST",
  "HANDS",
  "LEGS",
  "FEET",
  "BACK",
  "MAIN_HAND",
  "RANGED",
];
const WCL_GEAR_ENCHANTABLE = new Set(WCL_GEAR_ENCHANT_SLOT_ORDER);

function wclGearIsHunterClass(className, classId) {
  const id = Number(classId);
  if (id === 3) return true;
  return /\bhunter\b/i.test(String(className || "").trim());
}

function wclGearEnchantRequiredForPlayer(player, slotId) {
  const slot = String(slotId || "").toUpperCase();
  if (!WCL_GEAR_ENCHANTABLE.has(slot)) return false;
  if (slot === "RANGED") return wclGearIsHunterClass(player?.className, player?.classId);
  return true;
}
let wclDetailMode = "debuffs";

let wclDebuffOverviewCache = null;
let wclDebuffOverviewReportCode = "";
let wclDebuffSpellMetaById = new Map();
let wclProgressCache = null;
let wclProgressRaidFilter = "all";
let wclProgressLoaded = false;

const WCL_PROGRESS_RAID_LABEL = {
  ssc: "SSC",
  tk: "TK",
  kara: "Kara",
  gruul: "Gruul",
  mag: "Mag",
};

const WCL_DEBUFF_OR_GROUP_LABELS = {
  "armor-major": "Sunder or Expose",
  demo: "Demo Shout or Roar",
};

const WCL_DEBUFF_COL_SHORT = {
  "sunder-armor": "Sunder",
  "expose-armor": "Expose",
  "faerie-fire": "FF",
  "expose-weakness": "Exp. Weak.",
  "curse-of-recklessness": "CoR",
  "curse-of-the-elements": "CotE",
  "judgment-of-the-crusader": "JoC",
  "judgment-of-wisdom": "JoW",
  "improved-scorch": "Scorch",
  "shadow-weaving": "SW",
  misery: "Misery",
  "improved-hunters-mark": "IHM",
  "thunder-clap": "TC",
  "demoralizing-shout": "Demo",
  "demoralizing-roar": "Roar",
};

function wclDebuffReportRaidOptions() {
  // Raid-lead debuff/consumables: list every WCL report we know about (same pool as Event Management).
  // Do not filter by saved Event Management checkboxes — stale codes there hid the whole dropdown.
  return allRaidsState.filter((raid) => String(raid?.reportCode || "").trim());
}

function wclDebuffArchiveNote(archiveStatus) {
  if (!archiveStatus || typeof archiveStatus !== "object") return "";
  if (archiveStatus.isArchived && archiveStatus.isAccessible === false) {
    return " Report is archived and not accessible — debuff tables may be blocked without WCL archive access.";
  }
  if (archiveStatus.isArchived) {
    const when = archiveStatus.archiveDate ? ` (${archiveStatus.archiveDate})` : "";
    return ` Report is archived${when}.`;
  }
  return "";
}

const WCL_DEBUFF_TIER_LABEL = Object.freeze({
  excellent: "Excellent",
  good: "Good",
  average: "Average",
  poor: "Poor",
  critical: "Critical",
  none: "—",
});

function wclDebuffUptimeTier(uptimePct) {
  const n = Number(uptimePct);
  if (!Number.isFinite(n)) return "none";
  if (n >= 95) return "excellent";
  if (n >= 85) return "good";
  if (n >= 70) return "average";
  if (n >= 50) return "poor";
  return "critical";
}

function wclDebuffTierLabel(tier) {
  return WCL_DEBUFF_TIER_LABEL[tier] || WCL_DEBUFF_TIER_LABEL.none;
}

function wclDebuffEncounterOverallTier(debuffs, catalog) {
  const values = [];
  const seenOr = new Set();
  for (const def of Array.isArray(catalog) ? catalog : []) {
    const og = String(def?.orGroup || "").trim();
    if (og) {
      if (seenOr.has(og)) continue;
      seenOr.add(og);
      const combined = wclDebuffCombineOrGroupUptime(
        debuffs,
        wclDebuffCatalogDefsForOrGroup(catalog, og)
      );
      if (combined != null && Number.isFinite(combined)) values.push(combined);
      continue;
    }
    const row = wclFindDebuff(debuffs, def);
    if (row?.uptimePct != null && Number.isFinite(Number(row.uptimePct))) {
      values.push(Number(row.uptimePct));
    }
  }
  if (!values.length) return "none";
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return wclDebuffUptimeTier(avg);
}

function wclDebuffUptimeBarHtml(uptimePct, { compact = false } = {}) {
  const tier = wclDebuffUptimeTier(uptimePct);
  const n = Number(uptimePct);
  const hasValue = Number.isFinite(n);
  const width = hasValue ? Math.min(100, Math.max(0, n)) : 0;
  const text = hasValue ? `${n.toFixed(compact ? 0 : 1)}%` : "—";
  const aria = hasValue
    ? ` role="progressbar" aria-valuenow="${width}" aria-valuemin="0" aria-valuemax="100" aria-label="Uptime ${esc(text)}"`
    : "";
  return `<div class="plb-debuff-uptime-bar plb-debuff-uptime-bar--${tier}${
    compact ? " plb-debuff-uptime-bar--compact" : ""
  }"${aria}>
    <span class="plb-debuff-uptime-bar-track"><span class="plb-debuff-uptime-bar-fill" style="width:${width}%"></span></span>
    <span class="plb-debuff-uptime-bar-label">${esc(text)}</span>
  </div>`;
}

function wclFindDebuff(debuffs, def) {
  const list = Array.isArray(debuffs) ? debuffs : [];
  return (
    list.find(
      (row) =>
        (def?.key && row?.key === def.key) || Number(row?.spellId) === Number(def?.spellId)
    ) || null
  );
}

function wclDebuffCatalogDefsForOrGroup(catalog, orGroupId) {
  const id = String(orGroupId || "").trim();
  if (!id) return [];
  return (Array.isArray(catalog) ? catalog : []).filter((row) => row.orGroup === id);
}

function wclDebuffOrGroupLabel(orGroupId, memberDefs) {
  const preset = WCL_DEBUFF_OR_GROUP_LABELS[String(orGroupId || "").trim()];
  if (preset) return preset;
  const names = (memberDefs || []).map((d) => d?.name).filter(Boolean);
  return names.length ? names.join(" or ") : String(orGroupId || "Combined");
}

/** Either/or debuffs: sum individual uptimes capped at 100% (they do not stack). */
function wclDebuffCombineOrGroupUptime(debuffs, memberDefs) {
  const pcts = [];
  for (const def of Array.isArray(memberDefs) ? memberDefs : []) {
    const row = wclFindDebuff(debuffs, def);
    const n = Number(row?.uptimePct);
    if (Number.isFinite(n) && n >= 0) pcts.push(n);
  }
  if (!pcts.length) return null;
  if (pcts.every((n) => n === 0)) return 0;
  return Math.min(100, pcts.reduce((sum, n) => sum + n, 0));
}

/** Expand category defs with a combined row after each orGroup block. */
function wclDebuffExpandCategoryDisplayItems(defs, catalog) {
  const out = [];
  const seenOr = new Set();
  for (const def of Array.isArray(defs) ? defs : []) {
    const og = String(def?.orGroup || "").trim();
    if (!og) {
      out.push({ kind: "debuff", def });
      continue;
    }
    if (seenOr.has(og)) continue;
    seenOr.add(og);
    const members = wclDebuffCatalogDefsForOrGroup(catalog, og);
    for (const m of members) out.push({ kind: "debuff", def: m });
    out.push({ kind: "orCombined", orGroupId: og, members });
  }
  return out;
}

function wclDebuffOrCombinedAppliersHtml(debuffs, memberDefs) {
  const parts = [];
  for (const def of memberDefs || []) {
    const row = wclFindDebuff(debuffs, def);
    if (!row?.appliedByPlayer) continue;
    const label = `${row.appliedByPlayer}${def?.name ? ` (${def.name})` : ""}`;
    parts.push(esc(label));
  }
  if (!parts.length) return `<span class="plb-debuff-row-applier-empty">—</span>`;
  return parts.join('<span class="plb-debuff-or-applier-sep"> · </span>');
}

function wclDebuffRenderDisplayItemsHtml(items, debuffs) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (item?.kind === "orCombined") {
        return wclDebuffOrCombinedRowHtml(item.orGroupId, item.members, debuffs);
      }
      return wclDebuffDebuffRowHtml(item.def, wclFindDebuff(debuffs, item.def));
    })
    .join("");
}

function wclDebuffOrCombinedMatrixRowHtml(orGroupId, members, fights) {
  const label = wclDebuffOrGroupLabel(orGroupId, members);
  const memberNames = (members || []).map((m) => m?.name).filter(Boolean).join(", ");
  const title = [
    `Combined (${label})`,
    "Either/or — uptimes summed (max 100%).",
    memberNames ? `Includes: ${memberNames}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const cells = fights.map((fight) => {
    const combined = wclDebuffCombineOrGroupUptime(fight.debuffs, members);
    return `<td class="plb-debuff-matrix-cell plb-debuff-matrix-cell--or-combined" title="${esc(title)}">
      ${wclDebuffUptimeBarHtml(combined, { compact: true })}
    </td>`;
  });
  return `<tr class="plb-debuff-matrix-row--or-combined">
    <th title="${esc(title)}"><strong>Combined</strong> <span class="plb-debuff-or-note">${esc(label)}</span></th>
    ${cells.join("")}
  </tr>`;
}

function wclDebuffOrCombinedCellHtml(orGroupId, members, debuffs) {
  const combined = wclDebuffCombineOrGroupUptime(debuffs, members);
  const label = wclDebuffOrGroupLabel(orGroupId, members);
  const applier = wclDebuffOrCombinedAppliersHtml(debuffs, members);
  const title = esc(
    [
      `Combined (${label})`,
      "Either/or — uptimes summed (max 100%).",
    ].join(" · ")
  );
  return `<tr class="plb-debuff-detail-row--or-combined">
    <td title="${title}"><strong>Combined</strong> <span class="plb-debuff-or-note">${esc(label)}</span></td>
    <td class="plb-debuff-bar-cell">${wclDebuffUptimeBarHtml(combined)}</td>
    <td class="plb-debuff-applier-cell">${applier}</td>
  </tr>`;
}

function wclDebuffOrCombinedRowHtml(orGroupId, members, debuffs) {
  const combined = wclDebuffCombineOrGroupUptime(debuffs, members);
  const label = wclDebuffOrGroupLabel(orGroupId, members);
  const memberNames = (members || []).map((m) => m?.name).filter(Boolean).join(", ");
  const title = [
    `Combined uptime (${label})`,
    "Either/or debuffs — uptimes are added (max 100%), not stacked.",
    memberNames ? `Includes: ${memberNames}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `<div class="plb-debuff-row plb-debuff-row--or-combined" title="${esc(title)}">
    <div class="plb-debuff-row-name"><strong>Combined</strong> <span class="plb-debuff-or-note">${esc(label)}</span></div>
    <div class="plb-debuff-row-bar">${wclDebuffUptimeBarHtml(combined)}</div>
    <div class="plb-debuff-row-applier" title="Applied by">${wclDebuffOrCombinedAppliersHtml(debuffs, members)}</div>
  </div>`;
}

function wclDebuffColLabel(def) {
  return WCL_DEBUFF_COL_SHORT[def?.key] || String(def?.name || "").split(" ")[0];
}

function getWclDebuffSpellMeta(spellId) {
  const id = Math.floor(Number(spellId));
  if (!id) return null;
  return wclDebuffSpellMetaById.get(id) || null;
}

function wclDebuffSpellTriggerHtml(spellId, label) {
  const id = Math.floor(Number(spellId));
  const meta = getWclDebuffSpellMeta(id);
  const text = esc(label || meta?.name || (id ? `Spell ${id}` : ""));
  if (!id) return text;
  const title = window.WowSpellTooltip?.tooltipText
    ? window.WowSpellTooltip.tooltipText(meta)
    : String(meta?.description || "").trim();
  const icon = meta?.icon
    ? `<img class="admin-debuff-spell-icon" src="${esc(meta.icon)}" alt="" loading="lazy" decoding="async" />`
    : `<span class="admin-debuff-spell-icon admin-debuff-spell-icon--fallback" aria-hidden="true"></span>`;
  return `<span class="admin-debuff-spell-trigger" data-wow-spell-id="${id}"${
    title ? ` title="${esc(title)}"` : ""
  }>${icon}<span class="admin-debuff-spell-label">${text}</span></span>`;
}

function wclDebuffBindSpellTooltips(root) {
  if (!window.WowSpellTooltip?.bindSpellTooltipHandlers) return;
  window.WowSpellTooltip.bindSpellTooltipHandlers(root, getWclDebuffSpellMeta);
}

function wclDebuffTuneMatrixTable(root) {
  const wrap = root?.querySelector?.(".plb-debuff-table-wrap--matrix");
  const table = wrap?.querySelector(".plb-debuff-matrix");
  if (!table) return;
  const pullCols = Math.max(0, table.querySelectorAll("thead th").length - 1);
  const minW = Math.max(300, 116 + pullCols * 76);
  table.style.minWidth = `${minW}px`;
}

async function loadWclDebuffSpellMeta(catalog) {
  const ids = new Set();
  for (const row of Array.isArray(catalog) ? catalog : []) {
    const spellIds = Array.isArray(row.spellIds) ? row.spellIds : [row.spellId];
    for (const id of spellIds) {
      const n = Math.floor(Number(id));
      if (n > 0) ids.add(n);
    }
  }
  const list = [...ids];
  if (!list.length) {
    wclDebuffSpellMetaById = new Map();
    return;
  }
  const next = new Map();
  const chunkSize = 80;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const payload = await getJson(
      `/api/wow-classic/spells?ids=${encodeURIComponent(chunk.join(","))}`
    );
    for (const row of Array.isArray(payload?.spells) ? payload.spells : []) {
      const sid = Math.floor(Number(row?.spellId));
      if (sid > 0) next.set(sid, row);
    }
  }
  for (const def of Array.isArray(catalog) ? catalog : []) {
    const sid = Math.floor(Number(def.spellId));
    if (!sid) continue;
    const fetched = next.get(sid) || {};
    next.set(sid, {
      ...fetched,
      spellId: sid,
      name: fetched.name || def.name,
      appliedBy: def.appliedBy || def.appliedByClass || null,
      description: def.description || null,
      catalogKey: def.key,
    });
  }
  wclDebuffSpellMetaById = next;
}

function wclDebuffDebuffRowHtml(def, debuff) {
  const row = debuff || {};
  const applier = row.appliedByPlayer
    ? esc(row.appliedByPlayer)
    : `<span class="plb-debuff-row-applier-empty">—</span>`;
  const title = [
    def?.name,
    def?.appliedBy ? `Expected: ${def.appliedBy}` : "",
    def?.description,
    row.appliedByPlayer ? `Applied by: ${row.appliedByPlayer}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const orNote = def?.orNote ? ` <span class="plb-debuff-or-note">(${esc(def.orNote)})</span>` : "";
  return `<div class="plb-debuff-row" title="${esc(title)}">
    <div class="plb-debuff-row-name">${wclDebuffSpellTriggerHtml(def.spellId, def.name)}${orNote}</div>
    <div class="plb-debuff-row-bar">${wclDebuffUptimeBarHtml(row.uptimePct)}</div>
    <div class="plb-debuff-row-applier" title="Applied by">${applier}</div>
  </div>`;
}

function wclDebuffUptimeCellHtml(debuff) {
  const applier = debuff?.appliedByPlayer
    ? `${esc(debuff.appliedByPlayer)} (${esc(debuff.appliedBy || debuff.appliedByClass || "?")})`
    : `<span class="plb-debuff-row-applier-empty">—</span>`;
  const title = esc(String(debuff?.description || "").trim());
  const orNote = debuff?.orNote ? ` · ${esc(debuff.orNote)}` : "";
  return `<tr>
    <td title="${title}"><strong>${wclDebuffSpellTriggerHtml(debuff?.spellId, debuff?.name)}</strong>${orNote}</td>
    <td class="plb-debuff-bar-cell">${wclDebuffUptimeBarHtml(debuff?.uptimePct)}</td>
    <td class="plb-debuff-applier-cell">${applier}</td>
  </tr>`;
}

function renderWclDebuffReportSelect() {
  const select = document.getElementById("wclDebuffReportSelect");
  if (!select) return;
  const prev = String(select.value || "");
  const raids = wclDebuffReportRaidOptions();
  if (!raids.length) {
    select.innerHTML = `<option value="">No raid reports available — check Warcraft Logs uploads or try Reload</option>`;
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = [
    `<option value="">Select a report…</option>`,
    ...raids.map(
      (raid) =>
        `<option value="${esc(raid.reportCode)}">${esc(raidLabel(raid))} · ${esc(String(raid.reportCode || ""))}</option>`
    ),
  ].join("");
  if (prev && raids.some((r) => String(r.reportCode) === prev)) select.value = prev;
}

function wclDebuffCatalogByCategory(catalog, categories) {
  const catOrder = Array.isArray(categories) ? categories.map((c) => c.id) : [];
  const groups = new Map();
  for (const def of Array.isArray(catalog) ? catalog : []) {
    const cat = def.category || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(def);
  }
  const ordered = [];
  for (const catId of catOrder) {
    if (groups.has(catId)) ordered.push({ id: catId, defs: groups.get(catId) });
  }
  for (const [catId, defs] of groups) {
    if (!catOrder.includes(catId)) ordered.push({ id: catId, defs });
  }
  return ordered;
}

function renderWclDebuffOverview(payload) {
  const host = document.getElementById("wclDebuffResultsHost");
  if (!host) return;
  if (!payload?.ok) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Overview failed.")}</p>`;
    return;
  }
  const catalog = Array.isArray(payload.catalog) ? payload.catalog : [];
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const bossRows = Array.isArray(payload.bossRows) ? payload.bossRows : [];
  if (!bossRows.length) {
    host.innerHTML = `<p class="subtle">No boss encounters in this report.</p>`;
    return;
  }
  const grouped = wclDebuffCatalogByCategory(catalog, categories);
  const catLabel = (id) => esc(categories.find((c) => c.id === id)?.label || id);
  const encounterCards = bossRows
    .map((boss, idx) => {
      const name = esc(boss.name || "Boss");
      if (boss.noKills) {
        return `<article class="plb-debuff-encounter plb-debuff-encounter--nokill">
          <div class="plb-debuff-encounter-static">
            <h4 class="plb-debuff-encounter-name">${name}</h4>
            <span class="plb-debuff-encounter-grade plb-debuff-tier-badge plb-debuff-tier-badge--none">No kill</span>
          </div>
        </article>`;
      }
      const overallTier = wclDebuffEncounterOverallTier(boss.debuffs, catalog);
      const killNote =
        boss.killCount > 1
          ? `<span class="plb-debuff-encounter-note">${boss.killCount} kills · latest pull</span>`
          : "";
      const categoryBlocks = grouped
        .map((g) => {
          const rows = wclDebuffRenderDisplayItemsHtml(
            wclDebuffExpandCategoryDisplayItems(g.defs, catalog),
            boss.debuffs
          );
          return `<section class="plb-debuff-cat-block plb-debuff-cat-block--${esc(g.id)}">
            <h5 class="plb-debuff-cat-block-title">${catLabel(g.id)}</h5>
            <div class="plb-debuff-cat-rows">${rows}</div>
          </section>`;
        })
        .join("");
      return `<details class="plb-debuff-encounter" ${idx === 0 ? "open" : ""}>
        <summary class="plb-debuff-encounter-summary">
          <span class="plb-debuff-encounter-summary-main">
            <span class="plb-debuff-encounter-name">${name}</span>
            ${killNote}
            <span class="plb-debuff-encounter-grade plb-debuff-tier-badge plb-debuff-tier-badge--${overallTier}">${esc(
              wclDebuffTierLabel(overallTier)
            )}</span>
          </span>
          <button
            type="button"
            class="plb-debuff-encounter-drill event-signup-btn event-signup-btn--softres"
            data-wcl-debuff-boss="${esc(String(boss.encounterId))}"
            data-wcl-debuff-boss-name="${esc(boss.name || "")}"
          >All kill pulls</button>
        </summary>
        <div class="plb-debuff-encounter-body">${categoryBlocks}</div>
      </details>`;
    })
    .join("");
  host.innerHTML = `
    <p class="plb-debuff-hint">Expand an encounter for debuff uptime bars (latest kill). <strong>Combined</strong> rows sum either/or debuffs (e.g. Sunder + Expose) capped at 100%. Use <strong>All kill pulls</strong> for every attempt.</p>
    <div class="plb-debuff-encounters">${encounterCards}</div>
  `;
  wclDebuffBindSpellTooltips(host);
}

function renderWclDebuffDetailInto(host, payload) {
  if (!host) return;
  if (!payload?.ok) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Detail failed.")}</p>`;
    return;
  }
  const fights = Array.isArray(payload.fights) ? payload.fights : [];
  if (!fights.length) {
    host.innerHTML = `<p class="subtle">No kill pulls found for this boss (up to 12 per request).</p>`;
    return;
  }
  const catalog = Array.isArray(payload.catalog) ? payload.catalog : [];
  const grouped = wclDebuffCatalogByCategory(catalog, payload.categories || []);
  const matrixHead = fights
    .map(
      (fight, idx) =>
        `<th title="Fight ${esc(String(fight.fightId))}">${esc(String(fight.name || `Pull ${idx + 1}`))}</th>`
    )
    .join("");
  const matrixRows = grouped
    .flatMap((g) =>
      wclDebuffExpandCategoryDisplayItems(g.defs, catalog).map((item) => {
        if (item.kind === "orCombined") {
          return wclDebuffOrCombinedMatrixRowHtml(item.orGroupId, item.members, fights);
        }
        const def = item.def;
        const cells = fights.map((fight) => {
          const debuff = wclFindDebuff(fight.debuffs, def) || def;
          const applier = debuff?.appliedByPlayer ? esc(debuff.appliedByPlayer) : "—";
          const title = esc(String(def.description || "").trim());
          return `<td class="plb-debuff-matrix-cell" title="${title}">
            ${wclDebuffUptimeBarHtml(debuff?.uptimePct, { compact: true })}
            <span class="plb-debuff-matrix-applier">${applier}</span>
          </td>`;
        });
        const orNote = def.orNote ? ` <span class="subtle">(${esc(def.orNote)})</span>` : "";
        return `<tr><th title="${esc(String(def.description || ""))}">${wclDebuffSpellTriggerHtml(
          def.spellId,
          def.name
        )}${orNote}</th>${cells.join("")}</tr>`;
      })
    )
    .join("");
  const catalogDisplayItems = grouped.flatMap((g) =>
    wclDebuffExpandCategoryDisplayItems(g.defs, catalog)
  );
  const detailBlocks = fights
    .map((fight, idx) => {
      const debuffRows = catalogDisplayItems
        .map((item) => {
          if (item.kind === "orCombined") {
            return wclDebuffOrCombinedCellHtml(item.orGroupId, item.members, fight.debuffs);
          }
          const def = item.def;
          const row = wclFindDebuff(fight.debuffs, def);
          return wclDebuffUptimeCellHtml({
            ...(row || {}),
            spellId: def.spellId,
            name: def.name,
            appliedBy: def.appliedBy,
            description: def.description,
            orNote: def.orNote,
            uptimePct: row?.uptimePct,
          });
        })
        .join("");
      const wclLink = fight.wclUrl
        ? `<a href="${esc(fight.wclUrl)}" target="_blank" rel="noopener noreferrer">WCL fight</a>`
        : "";
      return `<details class="plb-debuff-pull" ${idx === 0 ? "open" : ""}>
        <summary class="plb-debuff-pull-summary">${esc(String(fight.name || `Pull ${idx + 1}`))} · fight ${esc(String(fight.fightId))} ${
        fight.kill ? "kill" : "wipe"
      } ${wclLink}</summary>
        <div class="admin-table-wrap plb-debuff-table-wrap">
          <table class="admin-table plb-debuff-table plb-debuff-detail-table">
            <thead><tr><th>Debuff</th><th>Uptime</th><th>Applied by</th></tr></thead>
            <tbody>${debuffRows}</tbody>
          </table>
        </div>
      </details>`;
    })
    .join("");
  host.innerHTML = `
    <div class="plb-debuff-surface plb-debuff-surface--matrix">
      <h5 class="plb-debuff-section-title">Pull comparison</h5>
      <p class="plb-debuff-scroll-hint" role="note">Swipe sideways to compare debuffs across kill pulls.</p>
      <div class="admin-table-wrap plb-debuff-table-wrap plb-debuff-table-wrap--matrix">
        <table class="admin-table plb-debuff-table plb-debuff-matrix">
          <thead><tr><th class="plb-debuff-sticky-col">Debuff</th>${matrixHead}</tr></thead>
          <tbody>${matrixRows}</tbody>
        </table>
      </div>
    </div>
    <div class="plb-debuff-pulls">${detailBlocks}</div>
  `;
  wclDebuffBindSpellTooltips(host);
  wclDebuffTuneMatrixTable(host);
}

function setWclDebuffStatusLine(text) {
  const line = document.getElementById("wclDebuffStatusLine");
  if (line) line.textContent = String(text || "");
}

async function loadWclDebuffOverview(reportCode, { silent = false, btn = null } = {}) {
  const code = String(reportCode || "").trim();
  const reloadBtn = document.getElementById("wclDebuffReloadBtn");
  if (!code) {
    wclDebuffOverviewCache = null;
    wclDebuffOverviewReportCode = "";
    const host = document.getElementById("wclDebuffResultsHost");
    if (host) host.innerHTML = "";
    setWclDebuffStatusLine("Select a raid event to load the boss overview.");
    if (reloadBtn) reloadBtn.disabled = true;
    return null;
  }
  if (reloadBtn) reloadBtn.disabled = false;
  try {
    if (btn) setButtonFeedback(btn, "Loading…", "loading");
    if (!silent) {
      setWclDebuffStatusLine("Loading debuff overview from WCL (first load may take a minute)…");
      const host = document.getElementById("wclDebuffResultsHost");
      if (host) host.innerHTML = `<p class="subtle">Querying WCL for each boss…</p>`;
    }
    const payload = await getJson(
      `${WCL_DEBUFF_API}?reportCode=${encodeURIComponent(code)}&overview=1`
    );
    if (!payload?.ok) throw new Error(payload?.error || "Overview failed");
    wclDebuffOverviewCache = payload;
    wclDebuffOverviewReportCode = code;
    await loadWclDebuffSpellMeta(payload.catalog || []);
    renderWclDebuffOverview(payload);
    const killBosses = (payload.bossRows || []).filter((b) => !b.noKills).length;
    const archiveNote = wclDebuffArchiveNote(payload.archiveStatus);
    setWclDebuffStatusLine(
      `${payload.reportTitle || code}: ${killBosses} boss(es) with kills (latest pull each).${archiveNote}`
    );
    return payload;
  } catch (error) {
    const host = document.getElementById("wclDebuffResultsHost");
    if (host) host.innerHTML = `<p class="subtle">${esc(error?.message || "Overview failed")}</p>`;
    setWclDebuffStatusLine(error?.message || "Overview failed");
    if (/rate limit|429|points/i.test(String(error?.message || ""))) {
    } else {
    }
    throw error;
  } finally {
    if (btn) resetButtonFeedback(btn, "Reload overview");
  }
}

async function openWclDebuffEncounterDetail(encounterId, encounterName) {
  const reportCode = String(wclDebuffOverviewReportCode || document.getElementById("wclDebuffReportSelect")?.value || "").trim();
  const eid = String(encounterId || "").trim();
  if (!reportCode || !eid) return;
  wclDetailMode = "debuffs";
  const dialog = document.getElementById("wclDebuffDetailDialog");
  const host = document.getElementById("wclDebuffDetailHost");
  const title = document.getElementById("wclDebuffDetailTitle");
  const statusLine = document.getElementById("wclDebuffDetailStatus");
  if (title) title.textContent = encounterName || "Encounter";
  if (statusLine) statusLine.textContent = "Loading all kill pulls…";
  if (host) host.innerHTML = `<p class="subtle">Loading…</p>`;
  if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  try {
    const payload = await getJson(
      `${WCL_DEBUFF_API}?reportCode=${encodeURIComponent(reportCode)}&encounterId=${encodeURIComponent(eid)}`
    );
    if (!payload?.ok) throw new Error(payload?.error || "Detail failed");
    const fightCount = Array.isArray(payload.fights) ? payload.fights.length : 0;
    if (statusLine) {
      statusLine.textContent = `${fightCount} kill pull(s) · ${payload.reportTitle || reportCode}`;
    }
    await loadWclDebuffSpellMeta(payload.catalog || []);
    renderWclDebuffDetailInto(host, payload);
    wclDebuffBindSpellTooltips(host);
  } catch (error) {
    if (host) host.innerHTML = `<p class="subtle">${esc(error?.message || "Detail failed")}</p>`;
    if (statusLine) statusLine.textContent = error?.message || "Detail failed";
  }
}

function wclProgressRaidLabel(raidKey) {
  const key = String(raidKey || "").trim();
  return WCL_PROGRESS_RAID_LABEL[key] || key || "—";
}

function fmtProgressDate(startTime) {
  const ms = num(startTime) > 1e12 ? num(startTime) : num(startTime) * 1000;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime())
    ? "—"
    : dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function wclDebuffProgressBarHtml(uptimePct, { compact = false, label = "" } = {}) {
  const tier = wclDebuffUptimeTier(uptimePct);
  const n = Number(uptimePct);
  const hasValue = Number.isFinite(n);
  const width = hasValue ? Math.min(100, Math.max(0, n)) : 0;
  const text = hasValue ? `${n.toFixed(compact ? 0 : 1)}%` : "—";
  const aria = hasValue
    ? ` role="progressbar" aria-valuenow="${width}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(label || "Uptime")} ${esc(text)}"`
    : "";
  return `<div class="plb-debuff-uptime-bar plb-debuff-uptime-bar--${tier}${
    compact ? " plb-debuff-uptime-bar--compact" : ""
  }"${aria}>
    <span class="plb-debuff-uptime-bar-track"><span class="plb-debuff-uptime-bar-fill" style="width:${width}%"></span></span>
    <span class="plb-debuff-uptime-bar-label">${esc(text)}</span>
  </div>`;
}

function wclDebuffProgressDeltaHtml(delta) {
  const n = Number(delta);
  if (!Number.isFinite(n)) return `<span class="plb-debuff-progress-delta plb-debuff-progress-delta--none">—</span>`;
  const sign = n > 0 ? "+" : "";
  const tone = n > 0 ? "up" : n < 0 ? "down" : "flat";
  return `<span class="plb-debuff-progress-delta plb-debuff-progress-delta--${tone}">${sign}${n.toFixed(1)}%</span>`;
}

function wclDebuffProgressChartSvg(points) {
  const vals = (Array.isArray(points) ? points : [])
    .map((p) => Number(p?.overallPct))
    .filter((n) => Number.isFinite(n));
  if (vals.length < 2) {
    return `<p class="subtle plb-debuff-progress-chart-empty">Need at least two scored raids to draw a trend line.</p>`;
  }
  const w = 640;
  const h = 160;
  const padX = 28;
  const padY = 18;
  const minY = Math.max(0, Math.min(...vals) - 8);
  const maxY = Math.min(100, Math.max(...vals) + 8);
  const spanY = Math.max(12, maxY - minY);
  const coords = vals.map((v, i) => {
    const x = padX + (i / (vals.length - 1)) * (w - padX * 2);
    const y = padY + (1 - (v - minY) / spanY) * (h - padY * 2);
    return { x, y, v };
  });
  const poly = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const dots = coords
    .map(
      (c, i) =>
        `<circle class="plb-debuff-progress-chart-dot" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(
          1
        )}" r="4" data-wcl-progress-idx="${i}" aria-hidden="true" />`
    )
    .join("");
  const yLabels = [maxY, minY + spanY / 2, minY]
    .map((v, i) => {
      const y = padY + (i / 2) * (h - padY * 2);
      return `<text class="plb-debuff-progress-chart-ylabel" x="4" y="${(y + 4).toFixed(1)}">${Math.round(v)}%</text>`;
    })
    .join("");
  return `<svg class="plb-debuff-progress-chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Debuff coverage trend across raids">
    ${yLabels}
    <polyline class="plb-debuff-progress-chart-line" points="${poly}" fill="none" />
    ${dots}
  </svg>`;
}

function renderWclDebuffProgress(payload) {
  const host = document.getElementById("wclProgressResultsHost");
  if (!host) return;
  if (!payload?.ok) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Trends failed.")}</p>`;
    return;
  }
  const points = Array.isArray(payload.points) ? payload.points : [];
  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  const tableRows = [...points].reverse();
  const latest = tableRows[0] || null;
  const warmBtn = document.getElementById("wclProgressWarmBtn");
  if (warmBtn) warmBtn.hidden = pending.length === 0;

  if (!points.length && !pending.length) {
    host.innerHTML = `<p class="subtle">No curated reports in Event Management yet. Select WCL reports in Admin → Event Management, then open each raid’s debuff overview or use <strong>Build missing snapshots</strong>.</p>`;
    return;
  }

  const summaryHtml = latest
    ? `<div class="plb-debuff-progress-summary">
        <div class="plb-debuff-progress-summary-main">
          <span class="plb-debuff-progress-summary-label">Latest raid</span>
          <strong class="plb-debuff-progress-summary-pct">${esc(Number(latest.overallPct).toFixed(1))}%</strong>
          <span class="plb-debuff-encounter-grade plb-debuff-tier-badge plb-debuff-tier-badge--${esc(
            latest.overallTier || "none"
          )}">${esc(wclDebuffTierLabel(latest.overallTier))}</span>
        </div>
        <div class="plb-debuff-progress-summary-meta">
          <span>${esc(latest.reportTitle || latest.reportCode || "")}</span>
          <span class="plb-debuff-progress-summary-delta">vs previous: ${wclDebuffProgressDeltaHtml(
            latest.deltaOverallPct
          )}</span>
        </div>
      </div>`
    : `<p class="subtle">No scored raids yet for this filter. ${pending.length ? "Build snapshots below." : ""}</p>`;

  const chartHtml = `<div class="plb-debuff-progress-chart">${wclDebuffProgressChartSvg(points)}</div>`;

  const tableHtml = tableRows.length
    ? `<div class="plb-debuff-progress-table-wrap">
        <table class="plb-debuff-progress-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Raid</th>
              <th scope="col">Overall</th>
              <th scope="col">Armor</th>
              <th scope="col">Spell</th>
              <th scope="col">Attack</th>
              <th scope="col">Δ</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            ${tableRows
              .map(
                (row) => `<tr>
              <td>${esc(fmtProgressDate(row.startTime))}</td>
              <td>${esc(wclProgressRaidLabel(row.raidKey))}</td>
              <td>${wclDebuffProgressBarHtml(row.overallPct, { compact: true, label: "Overall" })}</td>
              <td>${wclDebuffProgressBarHtml(row.categoryPct?.armor, { compact: true, label: "Armor" })}</td>
              <td>${wclDebuffProgressBarHtml(row.categoryPct?.spell, { compact: true, label: "Spell" })}</td>
              <td>${wclDebuffProgressBarHtml(row.categoryPct?.attack, { compact: true, label: "Attack" })}</td>
              <td>${wclDebuffProgressDeltaHtml(row.deltaOverallPct)}</td>
              <td><button type="button" class="event-signup-btn event-signup-btn--softres plb-debuff-progress-view" data-wcl-progress-view="${esc(
                row.reportCode
              )}">View report</button></td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : "";

  const pendingHtml = pending.length
    ? `<p class="plb-debuff-progress-pending subtle">${pending.length} curated raid(s) still need a debuff overview snapshot.</p>`
    : "";

  host.innerHTML = `
    <p class="plb-debuff-hint">Curated Event Management reports only. Scores average important debuff uptime per boss (latest kill), same tiers as the overview.</p>
    ${summaryHtml}
    ${chartHtml}
    ${tableHtml}
    ${pendingHtml}
  `;
}

async function loadWclDebuffProgress({ refresh = false, raid = wclProgressRaidFilter } = {}) {
  const host = document.getElementById("wclProgressResultsHost");
  if (host && !wclProgressLoaded) {
    host.innerHTML = `<p class="subtle">Loading progress…</p>`;
  }
  const params = new URLSearchParams();
  if (raid && raid !== "all") params.set("raid", raid);
  if (refresh) params.set("refresh", "1");
  const payload = await getJson(`${WCL_DEBUFF_TRENDS_API}?${params.toString()}`);
  wclProgressCache = payload;
  wclProgressLoaded = true;
  renderWclDebuffProgress(payload);
  const scored = Number(payload?.meta?.scoredCount ?? payload?.points?.length ?? 0);
  const curated = Number(payload?.meta?.curatedCount ?? 0);
  const pending = Array.isArray(payload?.pending) ? payload.pending.length : 0;
  setWclDebuffStatusLine(
    `Progress: ${scored}/${curated} curated raid(s) scored${pending ? ` · ${pending} pending snapshot(s)` : ""}.`
  );
  return payload;
}

async function warmWclDebuffProgressPending() {
  const pending = Array.isArray(wclProgressCache?.pending) ? wclProgressCache.pending : [];
  if (!pending.length) return loadWclDebuffProgress({ raid: wclProgressRaidFilter });
  const btn = document.getElementById("wclProgressWarmBtn");
  const defaultText = "Build missing snapshots";
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    const code = String(row?.reportCode || "").trim();
    if (!code) continue;
    if (btn) setButtonFeedback(btn, `Building ${i + 1}/${pending.length}…`, "info");
    setWclDebuffStatusLine(`Building snapshot ${i + 1}/${pending.length}: ${row.reportTitle || code}…`);
    await getJson(`${WCL_DEBUFF_API}?reportCode=${encodeURIComponent(code)}&overview=1`);
  }
  if (btn) resetButtonFeedback(btn, defaultText);
  return loadWclDebuffProgress({ raid: wclProgressRaidFilter });
}

function wclEnsureReportOptionInSelect(reportCode, reportTitle) {
  const select = document.getElementById("wclDebuffReportSelect");
  if (!select) return;
  const code = String(reportCode || "").trim();
  if (!code) return;
  if ([...select.options].some((o) => o.value === code)) {
    select.value = code;
    return;
  }
  const opt = document.createElement("option");
  opt.value = code;
  opt.textContent = reportTitle || code;
  select.appendChild(opt);
  select.value = code;
}

async function wclViewDebuffReport(reportCode) {
  const code = String(reportCode || "").trim();
  if (!code) return;
  const row =
    (wclProgressCache?.points || []).find((p) => p.reportCode === code) ||
    (wclProgressCache?.pending || []).find((p) => p.reportCode === code);
  wclEnsureReportOptionInSelect(code, row?.reportTitle);
  wclSetActivePanelTab("debuffs");
  await loadWclDebuffOverview(code);
}

function wclSetProgressRaidFilter(raid) {
  wclProgressRaidFilter = String(raid || "all").trim().toLowerCase() || "all";
  document.querySelectorAll("[data-wcl-progress-raid]").forEach((btn) => {
    const on = btn.getAttribute("data-wcl-progress-raid") === wclProgressRaidFilter;
    btn.classList.toggle("plb-debuff-progress-chip--active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function wclSetActivePanelTab(tab) {
  const next =
    tab === "consumables"
      ? "consumables"
      : tab === "gear"
        ? "gear"
        : tab === "progress"
          ? "progress"
          : "debuffs";
  wclActivePanelTab = next;
  document.querySelectorAll("[data-wcl-panel-tab]").forEach((btn) => {
    const on = btn.getAttribute("data-wcl-panel-tab") === next;
    btn.classList.toggle("plb-debuff-tab--active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const debuffHost = document.getElementById("wclDebuffResultsHost");
  const consumeHost = document.getElementById("wclConsumablesResultsHost");
  const gearHost = document.getElementById("wclGearAuditResultsHost");
  const progressHost = document.getElementById("wclProgressResultsHost");
  const debuffLegend = document.getElementById("wclDebuffLegend");
  const consumeLegend = document.getElementById("wclConsumablesLegend");
  const gearLegend = document.getElementById("wclGearLegend");
  const reportToolbar = document.getElementById("wclDebuffReportToolbar");
  const progressToolbar = document.getElementById("wclProgressToolbar");
  if (debuffHost) debuffHost.hidden = next !== "debuffs";
  if (consumeHost) consumeHost.hidden = next !== "consumables";
  if (gearHost) gearHost.hidden = next !== "gear";
  if (progressHost) progressHost.hidden = next !== "progress";
  if (debuffLegend) debuffLegend.hidden = next !== "debuffs";
  if (consumeLegend) consumeLegend.hidden = next !== "consumables";
  if (gearLegend) gearLegend.hidden = next !== "gear";
  if (reportToolbar) reportToolbar.hidden = next === "progress";
  if (progressToolbar) progressToolbar.hidden = next !== "progress";
}

function wclConsumeChip(slot, label) {
  const ok = Boolean(slot?.ok);
  const text = ok ? esc(slot.label || label) : "—";
  const title = ok && slot?.viaFlask ? `${text} (via flask)` : text;
  return `<span class="plb-consume-chip plb-consume-chip--${ok ? "ok" : "miss"}" title="${esc(title)}">${text}</span>`;
}

function wclConsumePlayerRowHtml(player) {
  const missing = Array.isArray(player?.missing) ? player.missing : [];
  const missNote = missing.length ? `Missing: ${missing.join(", ")}` : "All consumables present";
  return `<tr class="${missing.length ? "plb-consume-row--miss" : "plb-consume-row--ok"}" title="${esc(missNote)}">
    <th scope="row">${esc(player?.name || "?")}</th>
    <td>${wclConsumeChip(player?.flask, "Flask")}</td>
    <td>${wclConsumeChip(player?.battleElixir, "Battle")}</td>
    <td>${wclConsumeChip(player?.guardianElixir, "Guardian")}</td>
    <td>${wclConsumeChip(player?.food, "Food")}</td>
  </tr>`;
}

function wclConsumeSummaryLine(summary) {
  if (!summary) return "—";
  const ready = Number(summary.fullyBuffedCount ?? 0);
  const total = Number(summary.rosterCount ?? 0);
  return `${ready}/${total} ready`;
}

function renderWclConsumablesOverview(payload) {
  const host = document.getElementById("wclConsumablesResultsHost");
  if (!host) return;
  if (!payload?.ok) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Overview failed.")}</p>`;
    return;
  }
  const bossRows = Array.isArray(payload.bossRows) ? payload.bossRows : [];
  if (!bossRows.length) {
    host.innerHTML = `<p class="subtle">No boss encounters in this report.</p>`;
    return;
  }
  const cards = bossRows
    .map((boss, idx) => {
      const name = esc(boss.name || "Boss");
      if (boss.noKills) {
        return `<article class="plb-debuff-encounter plb-debuff-encounter--nokill">
          <div class="plb-debuff-encounter-static">
            <h4 class="plb-debuff-encounter-name">${name}</h4>
            <span class="plb-debuff-encounter-grade plb-debuff-tier-badge plb-debuff-tier-badge--none">No kill</span>
          </div>
        </article>`;
      }
      const s = boss.summary || {};
      const missParts = [];
      if (Number(s.missingFlask) > 0) missParts.push(`${s.missingFlask} missing flask`);
      if (Number(s.missingFood) > 0) missParts.push(`${s.missingFood} missing food`);
      if (Number(s.missingBattle) > 0) missParts.push(`${s.missingBattle} missing battle`);
      if (Number(s.missingGuardian) > 0) missParts.push(`${s.missingGuardian} missing guard`);
      const missNote = missParts.length ? missParts.join(" · ") : "Everyone ready";
      const players = (Array.isArray(boss.players) ? boss.players : [])
        .slice()
        .sort((a, b) => (a.missing?.length || 0) - (b.missing?.length || 0));
      const tableRows = players.map((p) => wclConsumePlayerRowHtml(p)).join("");
      return `<details class="plb-debuff-encounter plb-consumables-encounter" ${idx === 0 ? "open" : ""}>
        <summary class="plb-debuff-encounter-summary">
          <span class="plb-debuff-encounter-summary-main">
            <span class="plb-debuff-encounter-name">${name}</span>
            <span class="plb-consume-ready-badge">${esc(wclConsumeSummaryLine(s))}</span>
            <span class="subtle plb-consume-miss-note">${esc(missNote)}</span>
          </span>
          <button type="button" class="plb-debuff-encounter-drill event-signup-btn event-signup-btn--softres"
            data-wcl-consumables-boss="${esc(String(boss.encounterId))}"
            data-wcl-consumables-boss-name="${esc(boss.name || "")}">All kill pulls</button>
        </summary>
        <div class="admin-table-wrap plb-debuff-table-wrap">
          <table class="admin-table plb-debuff-table plb-consumables-table">
            <thead><tr><th>Player</th><th>Flask</th><th>Battle</th><th>Guardian</th><th>Food</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </details>`;
    })
    .join("");
  host.innerHTML = `
    <p class="plb-debuff-hint">Auras on each player at boss pull (WCL combatant snapshot). Flask satisfies battle + guardian elixir slots in TBC.</p>
    <div class="plb-debuff-encounters">${cards}</div>`;
}

function renderWclConsumablesDetailInto(host, payload) {
  if (!host) return;
  if (!payload?.ok) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Detail failed.")}</p>`;
    return;
  }
  const fights = Array.isArray(payload.fights) ? payload.fights : [];
  if (!fights.length) {
    host.innerHTML = `<p class="subtle">No kill pulls found for this boss.</p>`;
    return;
  }
  const blocks = fights
    .map((fight, idx) => {
      const players = (Array.isArray(fight.players) ? fight.players : [])
        .slice()
        .sort((a, b) => (a.missing?.length || 0) - (b.missing?.length || 0));
      const rows = players.map((p) => wclConsumePlayerRowHtml(p)).join("");
      const wclLink = fight.wclUrl
        ? `<a href="${esc(fight.wclUrl)}" target="_blank" rel="noopener noreferrer">WCL fight</a>`
        : "";
      const summary = wclConsumeSummaryLine(fight.summary);
      return `<details class="plb-debuff-pull" ${idx === 0 ? "open" : ""}>
        <summary class="plb-debuff-pull-summary">${esc(String(fight.name || `Pull ${idx + 1}`))} · ${esc(summary)} ${wclLink}</summary>
        <div class="admin-table-wrap plb-debuff-table-wrap">
          <table class="admin-table plb-debuff-table plb-consumables-table">
            <thead><tr><th>Player</th><th>Flask</th><th>Battle</th><th>Guardian</th><th>Food</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>`;
    })
    .join("");
  host.innerHTML = `<div class="plb-debuff-pulls">${blocks}</div>`;
}

function wclGearIssueSlots(player) {
  const slots = Array.isArray(player?.slots) ? player.slots : [];
  return slots.filter((s) => Array.isArray(s?.issues) && s.issues.length);
}

function wclGearEnchantSlotsForPlayer(player) {
  const fromSummary = player?.summary?.enchantSlots;
  if (Array.isArray(fromSummary) && fromSummary.length) {
    return fromSummary.filter((row) => wclGearEnchantRequiredForPlayer(player, row?.slotId));
  }
  const byId = new Map();
  for (const row of Array.isArray(player?.slots) ? player.slots : []) {
    const slotId = String(row?.slotId || "").toUpperCase();
    if (!wclGearEnchantRequiredForPlayer(player, slotId)) continue;
    if (!row?.itemId && !row?.itemName) continue;
    byId.set(slotId, row);
  }
  return WCL_GEAR_ENCHANT_SLOT_ORDER.filter((slotId) => byId.has(slotId)).map((slotId) => {
    const row = byId.get(slotId);
    const enchant = row?.enchant && typeof row.enchant === "object" ? row.enchant : null;
    return {
      slotId,
      slotLabel: row?.slotLabel || slotId.replace(/_/g, " "),
      missing: !enchant,
      enchant,
    };
  });
}

function getWclGearEnchantSpellMeta(spellId) {
  const id = Math.floor(Number(spellId));
  if (!id) return null;
  return wclGearEnchantSpellMetaById.get(id) || getWclDebuffSpellMeta(id) || null;
}

function getWclGearItemMeta(itemId) {
  const id = Math.floor(Number(itemId));
  if (!id) return null;
  return wclGearItemMetaById.get(id) || null;
}

function wclGearEnchantSpellTriggerHtml(spellId, label) {
  const id = Math.floor(Number(spellId));
  const meta = getWclGearEnchantSpellMeta(id);
  const text = esc(label || meta?.name || (id ? `Spell ${id}` : ""));
  if (!id) return text;
  const title = window.WowSpellTooltip?.tooltipText
    ? window.WowSpellTooltip.tooltipText(meta)
    : String(meta?.name || "").trim();
  const icon = meta?.icon
    ? `<img class="admin-debuff-spell-icon" src="${esc(meta.icon)}" alt="" loading="lazy" decoding="async" />`
    : `<span class="admin-debuff-spell-icon admin-debuff-spell-icon--fallback" aria-hidden="true"></span>`;
  return `<span class="admin-debuff-spell-trigger plb-gear-enchant-spell" data-wow-spell-id="${id}"${
    title ? ` title="${esc(title)}"` : ""
  }>${icon}<span class="admin-debuff-spell-label">${text}</span></span>`;
}

function wclGearEnchantTriggerHtml(enc) {
  const itemId = Math.floor(Number(enc?.itemId));
  const spellId = Math.floor(Number(enc?.spellId));
  const name = String(enc?.name || "").trim() || "Enchant";
  if (itemId > 0) {
    const meta = getWclGearItemMeta(itemId);
    const icon = meta?.icon
      ? `<img class="loot-item-icon plb-gear-enchant-item-icon" src="${esc(meta.icon)}" alt="" width="18" height="18" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
      : `<span class="loot-item-icon loot-item-icon--fallback plb-gear-enchant-item-icon" aria-hidden="true"></span>`;
    const tip = meta?.name || name;
    return `<span class="plb-gear-enchant-trigger loot-item-name" data-loot-item-id="${itemId}" title="${esc(tip)}">${icon}<span class="plb-gear-enchant-trigger-label">${esc(name)}</span></span>`;
  }
  if (spellId > 0) return wclGearEnchantSpellTriggerHtml(spellId, name);
  return `<span class="plb-gear-enchant-name">${esc(name)}</span>`;
}

function wclGearInstallTooltipDelegation(host) {
  if (!host || host.dataset.gearTooltipDelegation === "1") return;
  host.dataset.gearTooltipDelegation = "1";

  host.addEventListener("mouseover", (event) => {
    const itemEl = event.target.closest?.("[data-loot-item-id]");
    if (itemEl && host.contains(itemEl) && window.WowItemTooltip?.showLootTooltip) {
      host._gearHoverItem = itemEl;
      host._gearHoverSpell = null;
      window.WowSpellTooltip?.hideSpellTooltip?.();
      window.WowItemTooltip.showLootTooltip(
        event,
        Number(itemEl.getAttribute("data-loot-item-id") || 0),
        getWclGearItemMeta
      );
      return;
    }
    const spellEl = event.target.closest?.("[data-wow-spell-id]");
    if (spellEl && host.contains(spellEl) && window.WowSpellTooltip?.showSpellTooltip) {
      host._gearHoverSpell = spellEl;
      host._gearHoverItem = null;
      window.WowItemTooltip?.hideLootTooltip?.();
      window.WowSpellTooltip.showSpellTooltip(
        event,
        Number(spellEl.getAttribute("data-wow-spell-id") || 0),
        getWclGearEnchantSpellMeta
      );
    }
  });

  host.addEventListener("mousemove", (event) => {
    if (host._gearHoverItem && window.WowItemTooltip?.positionLootTooltip) {
      window.WowItemTooltip.positionLootTooltip(event);
    } else if (host._gearHoverSpell && window.WowSpellTooltip?.positionSpellTooltip) {
      window.WowSpellTooltip.positionSpellTooltip(event);
    }
  });

  host.addEventListener("mouseout", (event) => {
    const itemEl = event.target.closest?.("[data-loot-item-id]");
    const spellEl = event.target.closest?.("[data-wow-spell-id]");
    if (!itemEl && !spellEl) return;
    const next = event.relatedTarget;
    if (itemEl && next && itemEl.contains(next)) return;
    if (spellEl && next && spellEl.contains(next)) return;
    if (next?.closest?.("[data-loot-item-id]") && host.contains(next.closest("[data-loot-item-id]"))) return;
    if (next?.closest?.("[data-wow-spell-id]") && host.contains(next.closest("[data-wow-spell-id]"))) return;
    host._gearHoverItem = null;
    host._gearHoverSpell = null;
    window.WowItemTooltip?.hideLootTooltip?.();
    window.WowSpellTooltip?.hideSpellTooltip?.();
  });
}

async function loadWclGearEnchantSpellMeta(players) {
  const ids = new Set();
  for (const player of Array.isArray(players) ? players : []) {
    for (const row of wclGearEnchantSlotsForPlayer(player)) {
      const spellId = Math.floor(Number(row?.enchant?.spellId));
      if (spellId > 0) ids.add(spellId);
    }
  }
  const list = [...ids];
  if (!list.length) {
    wclGearEnchantSpellMetaById = new Map();
    return;
  }
  const next = new Map();
  const chunkSize = 80;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const payload = await getJson(
      `/api/wow-classic/spells?ids=${encodeURIComponent(chunk.join(","))}`
    );
    for (const row of Array.isArray(payload?.spells) ? payload.spells : []) {
      const sid = Math.floor(Number(row?.spellId));
      if (sid > 0) next.set(sid, row);
    }
  }
  wclGearEnchantSpellMetaById = next;
}

async function loadWclGearEnchantItemMeta(players) {
  const ids = new Set();
  for (const player of Array.isArray(players) ? players : []) {
    for (const row of wclGearEnchantSlotsForPlayer(player)) {
      const itemId = Math.floor(Number(row?.enchant?.itemId));
      if (itemId > 0) ids.add(itemId);
    }
  }
  const list = [...ids];
  if (!list.length) {
    wclGearItemMetaById = new Map();
    return;
  }
  const next = new Map();
  const chunkSize = 80;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const payload = await getJson(`/api/wow-classic/items?ids=${encodeURIComponent(chunk.join(","))}`);
    for (const row of Array.isArray(payload?.items) ? payload.items : []) {
      const iid = Math.floor(Number(row?.itemId));
      if (iid > 0) next.set(iid, row);
    }
  }
  wclGearItemMetaById = next;
}

function wclGearEnchantChipsHtml(slots) {
  if (!slots.length) return `<span class="plb-gear-ok">—</span>`;
  const chips = slots.map((row) => {
    const slot = esc(row?.slotLabel || row?.slotId || "Slot");
    if (row?.missing) {
      return `<span class="plb-gear-enchant-chip plb-gear-enchant-chip--miss" title="${slot}: missing enchant"><span class="plb-gear-enchant-slot">${slot}</span><span class="plb-gear-enchant-miss">Missing</span></span>`;
    }
    const enc = row.enchant || {};
    const enchantHtml = wclGearEnchantTriggerHtml(enc);
    return `<span class="plb-gear-enchant-chip plb-gear-enchant-chip--ok" title="${slot}"><span class="plb-gear-enchant-slot">${slot}</span>${enchantHtml}</span>`;
  });
  return `<span class="plb-gear-enchants-row">${chips.join("")}</span>`;
}

function wclGearMissingEnchantsCell(player) {
  const missing = wclGearEnchantSlotsForPlayer(player).filter((row) => row?.missing);
  return wclGearEnchantChipsHtml(missing);
}

function wclGearFullEnchantsCell(player) {
  return wclGearEnchantChipsHtml(wclGearEnchantSlotsForPlayer(player));
}

function wclGearQualityPill(quality, count) {
  const q = String(quality || "").toLowerCase();
  const n = Number(count) || 0;
  if (!n) return "";
  const labels = { green: "Uncommon", blue: "Rare", purple: "Epic" };
  const label = labels[q] || "?";
  return `<span class="plb-gem-q plb-gem-q--${esc(q)}" title="${esc(`${n}× ${label} (${q}) gem${n === 1 ? "" : "s"}`)}">${n}× ${label}</span>`;
}

function wclGearGemsCell(summary) {
  const counts = summary?.gemQualityCounts && typeof summary.gemQualityCounts === "object"
    ? summary.gemQualityCounts
    : {};
  const empty = Number(counts.empty || 0);
  const parts = [
    wclGearQualityPill("purple", counts.purple),
    wclGearQualityPill("blue", counts.blue),
    wclGearQualityPill("green", counts.green),
    wclGearQualityPill("unknown", counts.unknown),
  ].filter(Boolean);
  if (empty > 0) parts.push(`<span class="plb-gem-q plb-gem-q--empty" title="${esc(`${empty} empty socket${empty === 1 ? "" : "s"}`)}">${empty}× empty</span>`);
  if (!parts.length) return `<span class="plb-gear-ok">—</span>`;
  return `<span class="plb-gem-q-row">${parts.join(" ")}</span>`;
}

function wclGearPlayerRowsHtml(player, playerIdx, expandedIdx) {
  const summary = player?.summary || {};
  const ok = Boolean(summary.ok) && !player?.error;
  const issueSlots = wclGearIssueSlots(player);
  const detail =
    issueSlots.length > 0
      ? issueSlots
          .map((s) => {
            const parts = [];
            if (s.issues.includes("missing_enchant")) parts.push("no enchant");
            if (s.issues.includes("empty_socket")) parts.push("empty gem");
            const gemList = (s.gems || [])
              .map((g) => `${g.name || "?"} (${g.quality || "?"})`)
              .join(", ");
            if (gemList) parts.push(`gems: ${gemList}`);
            return `${s.slotLabel}: ${parts.join("; ")}`;
          })
          .join(" · ")
      : player?.error || "All enchants and gems OK";
  const armoryLink = player?.armoryUrl
    ? `<a href="${esc(player.armoryUrl)}" target="_blank" rel="noopener noreferrer">Armory</a>`
    : "—";
  const isOpen = expandedIdx === playerIdx;
  const rowClass = [
    ok ? "plb-gear-row--ok" : "plb-gear-row--miss",
    "plb-gear-row--clickable",
    isOpen ? "plb-gear-row--expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<tr class="${rowClass}" data-gear-idx="${playerIdx}" aria-expanded="${isOpen ? "true" : "false"}" title="${esc(detail)}">
    <th scope="row">${esc(player?.name || "?")}<span class="plb-gear-row-expand-hint subtle">${isOpen ? " ▾" : " ▸"}</span></th>
    <td class="plb-gear-cell-enchants">${wclGearMissingEnchantsCell(player)}</td>
    <td class="plb-gear-cell-gems">${wclGearGemsCell(summary)}</td>
    <td>${armoryLink}</td>
  </tr>
  <tr class="plb-gear-row-detail" data-gear-idx="${playerIdx}"${isOpen ? "" : " hidden"}>
    <td colspan="4" class="plb-gear-detail-cell">
      <p class="plb-gear-detail-label subtle">All enchants · ${esc(player?.name || "?")}</p>
      ${wclGearFullEnchantsCell(player)}
    </td>
  </tr>`;
}

function wclGearApplyExpandedState(host) {
  if (!host) return;
  host.querySelectorAll("tr.plb-gear-row--clickable").forEach((row) => {
    const idx = Number(row.getAttribute("data-gear-idx"));
    const open = idx === wclGearExpandedPlayerIdx;
    row.setAttribute("aria-expanded", open ? "true" : "false");
    row.classList.toggle("plb-gear-row--expanded", open);
    const hint = row.querySelector(".plb-gear-row-expand-hint");
    if (hint) hint.textContent = open ? " ▾" : " ▸";
  });
  host.querySelectorAll("tr.plb-gear-row-detail").forEach((row) => {
    const idx = Number(row.getAttribute("data-gear-idx"));
    row.hidden = idx !== wclGearExpandedPlayerIdx;
  });
}

function wclGearSetupTableHandlers(host) {
  if (!host || host.dataset.gearTableBound === "1") return;
  host.dataset.gearTableBound = "1";
  host.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    const row = event.target.closest("tr.plb-gear-row--clickable");
    if (!row || !host.contains(row)) return;
    const idx = Number(row.getAttribute("data-gear-idx"));
    if (!Number.isInteger(idx) || idx < 0) return;
    wclGearExpandedPlayerIdx = wclGearExpandedPlayerIdx === idx ? -1 : idx;
    wclGearApplyExpandedState(host);
  });
}

async function renderWclGearAuditOverview(payload) {
  const host = document.getElementById("wclGearAuditResultsHost");
  if (!host) return;
  if (!payload?.ok) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Gear audit failed.")}</p>`;
    return;
  }
  const players = (Array.isArray(payload.players) ? payload.players : [])
    .slice()
    .sort((a, b) => {
      const am = Number(a?.summary?.missingEnchants || 0) + Number(a?.summary?.emptySockets || 0);
      const bm = Number(b?.summary?.missingEnchants || 0) + Number(b?.summary?.emptySockets || 0);
      if (bm !== am) return bm - am;
      return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" });
    });
  if (!players.length) {
    host.innerHTML = `<p class="subtle">No roster players found in this report.</p>`;
    return;
  }
  await Promise.all([
    loadWclGearEnchantSpellMeta(players),
    loadWclGearEnchantItemMeta(players),
  ]);
  const s = payload.summary || {};
  const rows = players.map((p, i) => wclGearPlayerRowsHtml(p, i, wclGearExpandedPlayerIdx)).join("");
  host.innerHTML = `
    <p class="plb-debuff-hint">Enchant and gem status from Classic Armory. Table shows missing enchants only — click a player for the full list (hover enchants for Wowhead tooltips). Gem rarity: Green = Uncommon, Blue = Rare, Purple = Epic.</p>
    <p class="subtle plb-gear-summary-line">${esc(String(s.fullyReadyCount ?? 0))}/${esc(String(s.rosterCount ?? players.length))} ready · ${esc(String(s.missingEnchants ?? 0))} missing enchants · ${esc(String(s.emptySockets ?? 0))} empty gem sockets</p>
    <div class="admin-table-wrap plb-debuff-table-wrap plb-gear-audit-table-wrap">
      <table class="admin-table plb-debuff-table plb-gear-audit-table">
        <thead><tr><th>Player</th><th>Missing enchants</th><th>Gem rarity</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  wclGearSetupTableHandlers(host);
  wclGearInstallTooltipDelegation(host);
}

async function loadWclGearAuditOverview(reportCode, { silent = false, btn = null, refresh = false } = {}) {
  const code = String(reportCode || "").trim();
  const reloadBtn = document.getElementById("wclDebuffReloadBtn");
  if (!code) {
    wclGearAuditOverviewCache = null;
    wclGearAuditOverviewReportCode = "";
    const host = document.getElementById("wclGearAuditResultsHost");
    if (host) host.innerHTML = "";
    if (wclActivePanelTab === "gear") {
      setWclDebuffStatusLine("Select a raid event to load gear audit.");
    }
    if (reloadBtn) reloadBtn.disabled = true;
    return null;
  }
  if (reloadBtn) reloadBtn.disabled = false;
  try {
    if (btn) setButtonFeedback(btn, "Loading…", "loading");
    if (!silent && wclActivePanelTab === "gear") {
      setWclDebuffStatusLine("Fetching enchants and gems from Classic Armory…");
      const host = document.getElementById("wclGearAuditResultsHost");
      if (host) host.innerHTML = `<p class="subtle">Loading armory data for roster (first load may take a minute)…</p>`;
    }
    const refreshQ = refresh ? "&refresh=1" : "";
    const payload = await getJson(
      `${WCL_GEAR_AUDIT_API}?reportCode=${encodeURIComponent(code)}${refreshQ}`
    );
    if (!payload?.ok) throw new Error(payload?.error || "Gear audit failed");
    wclGearAuditOverviewCache = payload;
    wclGearAuditOverviewReportCode = code;
    wclGearExpandedPlayerIdx = -1;
    await renderWclGearAuditOverview(payload);
    if (wclActivePanelTab === "gear") {
      const ready = Number(payload.summary?.fullyReadyCount ?? 0);
      const total = Number(payload.summary?.rosterCount ?? 0);
      setWclDebuffStatusLine(
        `${payload.reportTitle || code}: gear audit ${ready}/${total} ready (Classic Armory).`
      );
    }
    return payload;
  } catch (error) {
    const host = document.getElementById("wclGearAuditResultsHost");
    if (host) host.innerHTML = `<p class="subtle">${esc(error?.message || "Gear audit failed")}</p>`;
    if (wclActivePanelTab === "gear") {
      setWclDebuffStatusLine(error?.message || "Gear audit failed");
    }
    throw error;
  } finally {
    if (btn) resetButtonFeedback(btn, "Reload overview");
  }
}

async function loadWclConsumablesOverview(reportCode, { silent = false, btn = null } = {}) {
  const code = String(reportCode || "").trim();
  const reloadBtn = document.getElementById("wclDebuffReloadBtn");
  if (!code) {
    wclConsumablesOverviewCache = null;
    wclConsumablesOverviewReportCode = "";
    const host = document.getElementById("wclConsumablesResultsHost");
    if (host) host.innerHTML = "";
    if (wclActivePanelTab === "consumables") {
      setWclDebuffStatusLine("Select a raid event to load consumables at pull.");
    }
    if (reloadBtn) reloadBtn.disabled = true;
    return null;
  }
  if (reloadBtn) reloadBtn.disabled = false;
  try {
    if (btn) setButtonFeedback(btn, "Loading…", "loading");
    if (!silent && wclActivePanelTab === "consumables") {
      setWclDebuffStatusLine("Loading consumables at boss pull from WCL…");
      const host = document.getElementById("wclConsumablesResultsHost");
      if (host) host.innerHTML = `<p class="subtle">Checking flask, elixirs, and food per player…</p>`;
    }
    const payload = await getJson(
      `${WCL_CONSUMABLES_API}?reportCode=${encodeURIComponent(code)}&overview=1`
    );
    if (!payload?.ok) throw new Error(payload?.error || "Overview failed");
    wclConsumablesOverviewCache = payload;
    wclConsumablesOverviewReportCode = code;
    renderWclConsumablesOverview(payload);
    if (wclActivePanelTab === "consumables") {
      const killBosses = (payload.bossRows || []).filter((b) => !b.noKills).length;
      const archiveNote = wclDebuffArchiveNote(payload.archiveStatus);
      setWclDebuffStatusLine(
        `${payload.reportTitle || code}: consumables at pull for ${killBosses} boss kill(s).${archiveNote}`
      );
    }
    return payload;
  } catch (error) {
    const host = document.getElementById("wclConsumablesResultsHost");
    if (host) host.innerHTML = `<p class="subtle">${esc(error?.message || "Overview failed")}</p>`;
    if (wclActivePanelTab === "consumables") {
      setWclDebuffStatusLine(error?.message || "Consumables overview failed");
    }
    throw error;
  } finally {
    if (btn) resetButtonFeedback(btn, "Reload overview");
  }
}

async function openWclConsumablesEncounterDetail(encounterId, encounterName) {
  const reportCode = String(
    wclConsumablesOverviewReportCode || document.getElementById("wclDebuffReportSelect")?.value || ""
  ).trim();
  const eid = String(encounterId || "").trim();
  if (!reportCode || !eid) return;
  wclDetailMode = "consumables";
  const dialog = document.getElementById("wclDebuffDetailDialog");
  const host = document.getElementById("wclDebuffDetailHost");
  const title = document.getElementById("wclDebuffDetailTitle");
  const statusLine = document.getElementById("wclDebuffDetailStatus");
  if (title) title.textContent = encounterName || "Encounter";
  if (statusLine) statusLine.textContent = "Loading consumables for all kill pulls…";
  if (host) host.innerHTML = `<p class="subtle">Loading…</p>`;
  if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  try {
    const payload = await getJson(
      `${WCL_CONSUMABLES_API}?reportCode=${encodeURIComponent(reportCode)}&encounterId=${encodeURIComponent(eid)}`
    );
    if (!payload?.ok) throw new Error(payload?.error || "Detail failed");
    const fightCount = Array.isArray(payload.fights) ? payload.fights.length : 0;
    if (statusLine) {
      statusLine.textContent = `${fightCount} kill pull(s) · consumables · ${payload.reportTitle || reportCode}`;
    }
    renderWclConsumablesDetailInto(host, payload);
  } catch (error) {
    if (host) host.innerHTML = `<p class="subtle">${esc(error?.message || "Detail failed")}</p>`;
    if (statusLine) statusLine.textContent = error?.message || "Detail failed";
  }
}

async function initWclDebuffUptimePanel() {
  wclSetActivePanelTab("debuffs");
  renderWclDebuffReportSelect();
  const select = document.getElementById("wclDebuffReportSelect");
  const code = String(select?.value || "").trim();
  if (code) {
    try {
      await Promise.all([
        loadWclDebuffOverview(code, { silent: true }),
        loadWclConsumablesOverview(code, { silent: true }),
        loadWclGearAuditOverview(code, { silent: true }),
      ]);
    } catch {
      /* status set in loader */
    }
  }
}

async function loadWclActiveOverview(reportCode, opts = {}) {
  const code = String(reportCode || "").trim();
  if (!code) return;
  if (wclActivePanelTab === "consumables") {
    await loadWclConsumablesOverview(code, opts);
    return;
  }
  if (wclActivePanelTab === "gear") {
    await loadWclGearAuditOverview(code, { ...opts, refresh: Boolean(opts.refresh) });
    return;
  }
  await loadWclDebuffOverview(code, opts);
}

async function loadRaidLeadEventReports({ refresh = false } = {}) {
  const q = refresh ? "?refresh=1" : "";
  const payload = await getJson(`/api/raid-lead/event-reports${q}`);
  allRaidsState = Array.isArray(payload?.allRaids) ? payload.allRaids : [];
  selectedReportCodesState = new Set(
    Array.isArray(payload?.selectedReportCodes) ? payload.selectedReportCodes : []
  );
}

async function bootDebuffUptimePage() {
  try {
    await loadRaidLeadEventReports();
    await initWclDebuffUptimePanel();
    if (!allRaidsState.length) {
      await loadRaidLeadEventReports({ refresh: true });
      renderWclDebuffReportSelect();
    }
  } catch (error) {
    setWclDebuffStatusLine(error?.message || "Failed to load debuff uptime.");
  }
}

document.querySelectorAll("[data-wcl-panel-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.getAttribute("data-wcl-panel-tab") || "debuffs";
    wclSetActivePanelTab(tab);
    if (tab === "progress") {
      loadWclDebuffProgress({ raid: wclProgressRaidFilter }).catch((error) => {
        setWclDebuffStatusLine(error?.message || "Failed to load progress.");
      });
      return;
    }
    const code = String(document.getElementById("wclDebuffReportSelect")?.value || "").trim();
    if (!code) return;
    if (tab === "consumables" && wclConsumablesOverviewReportCode === code && wclConsumablesOverviewCache) {
      renderWclConsumablesOverview(wclConsumablesOverviewCache);
      const killBosses = (wclConsumablesOverviewCache.bossRows || []).filter((b) => !b.noKills).length;
      setWclDebuffStatusLine(
        `${wclConsumablesOverviewCache.reportTitle || code}: consumables at pull for ${killBosses} boss kill(s).`
      );
    } else if (tab === "gear" && wclGearAuditOverviewReportCode === code && wclGearAuditOverviewCache) {
      void renderWclGearAuditOverview(wclGearAuditOverviewCache);
      const ready = Number(wclGearAuditOverviewCache.summary?.fullyReadyCount ?? 0);
      const total = Number(wclGearAuditOverviewCache.summary?.rosterCount ?? 0);
      setWclDebuffStatusLine(
        `${wclGearAuditOverviewCache.reportTitle || code}: gear audit ${ready}/${total} ready.`
      );
    } else if (tab === "debuffs" && wclDebuffOverviewReportCode === code && wclDebuffOverviewCache) {
      renderWclDebuffOverview(wclDebuffOverviewCache);
      const killBosses = (wclDebuffOverviewCache.bossRows || []).filter((b) => !b.noKills).length;
      setWclDebuffStatusLine(`${wclDebuffOverviewCache.reportTitle || code}: ${killBosses} boss(es) with kills.`);
    } else {
      loadWclActiveOverview(code).catch(() => {});
    }
  });
});

document.getElementById("wclDebuffReportSelect")?.addEventListener("change", async (event) => {
  const code = String(event.target?.value || "").trim();
  try {
    await Promise.all([
      loadWclDebuffOverview(code),
      loadWclConsumablesOverview(code),
      loadWclGearAuditOverview(code, { silent: true }),
    ]);
    if (wclActivePanelTab === "consumables") {
      const killBosses = (wclConsumablesOverviewCache?.bossRows || []).filter((b) => !b.noKills).length;
      setWclDebuffStatusLine(
        `${wclConsumablesOverviewCache?.reportTitle || code}: consumables at pull for ${killBosses} boss kill(s).`
      );
    }
  } catch {
    /* status set in loader */
  }
});

document.getElementById("wclDebuffReloadBtn")?.addEventListener("click", (event) => {
  const code = String(document.getElementById("wclDebuffReportSelect")?.value || "").trim();
  const refresh = wclActivePanelTab === "gear";
  loadWclActiveOverview(code, { btn: event.currentTarget, refresh }).catch(() => {});
});

document.querySelectorAll("[data-wcl-progress-raid]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const raid = btn.getAttribute("data-wcl-progress-raid") || "all";
    wclSetProgressRaidFilter(raid);
    wclProgressLoaded = false;
    loadWclDebuffProgress({ raid }).catch((error) => {
      setWclDebuffStatusLine(error?.message || "Failed to load progress.");
    });
  });
});

document.getElementById("wclProgressRefreshBtn")?.addEventListener("click", (event) => {
  const btn = event.currentTarget;
  setButtonFeedback(btn, "Refreshing…", "info");
  loadWclDebuffProgress({ refresh: true, raid: wclProgressRaidFilter })
    .catch((error) => setWclDebuffStatusLine(error?.message || "Refresh failed."))
    .finally(() => resetButtonFeedback(btn, "Refresh trends"));
});

document.getElementById("wclProgressWarmBtn")?.addEventListener("click", (event) => {
  warmWclDebuffProgressPending().catch((error) => {
    setWclDebuffStatusLine(error?.message || "Build snapshots failed.");
    resetButtonFeedback(event.currentTarget, "Build missing snapshots");
  });
});

document.getElementById("wclProgressResultsHost")?.addEventListener("click", (event) => {
  const view = event.target.closest("[data-wcl-progress-view]");
  if (!view) return;
  const code = view.getAttribute("data-wcl-progress-view");
  wclViewDebuffReport(code).catch((error) => {
    setWclDebuffStatusLine(error?.message || "Failed to open report.");
  });
});

document.getElementById("wclDebuffResultsHost")?.addEventListener("click", (event) => {
  const drill = event.target.closest("[data-wcl-debuff-boss]");
  if (!drill) return;
  event.preventDefault();
  event.stopPropagation();
  const encounterId = drill.getAttribute("data-wcl-debuff-boss");
  const encounterName = drill.getAttribute("data-wcl-debuff-boss-name") || "";
  if (encounterId) openWclDebuffEncounterDetail(encounterId, encounterName).catch(() => {});
});

document.getElementById("wclConsumablesResultsHost")?.addEventListener("click", (event) => {
  const drill = event.target.closest("[data-wcl-consumables-boss]");
  if (!drill) return;
  event.preventDefault();
  event.stopPropagation();
  const encounterId = drill.getAttribute("data-wcl-consumables-boss");
  const encounterName = drill.getAttribute("data-wcl-consumables-boss-name") || "";
  if (encounterId) openWclConsumablesEncounterDetail(encounterId, encounterName).catch(() => {});
});

bootDebuffUptimePage();
