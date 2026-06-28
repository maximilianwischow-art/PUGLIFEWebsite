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
const WCL_CORE_PARSE_API = "/api/raid-lead/core-parse-development";
const WCL_CONSUMABLES_API = "/api/raid-lead/wcl-consumables";
const WCL_CONSUMABLES_USAGE_API = "/api/raid-lead/wcl-consumables-usage";
const WCL_LEADERBOARD_LAST_RAIDS = 6;
const WCL_GEAR_AUDIT_API = "/api/raid-lead/armory-gear-audit";
let allRaidsState = [];
let selectedReportCodesState = new Set();
let wclActivePanelTab = "debuffs";
let wclConsumablesOverviewCache = null;
let wclConsumablesOverviewReportCode = "";
let wclConsumablesUsageCache = null;
let wclConsumablesUsageReportCode = "";
let wclConsumablesLeaderboardCache = null;
let wclLeaderboardScope = "all";
const wclConsumablesLeaderboardCacheByScope = { all: null, last6: null };
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
let wclProgressViewMode = "raid";
let wclProgressLoaded = false;
let wclCoreParseCache = null;
let wclCoreParseRaidFilter = "all";
let wclCoreParseLoaded = false;
/** @type {Set<string>|null} null = all Core members selected */
let wclCoreParseSelectedMembers = null;
let wclCoreParseMemberMenuOpen = false;
/** @type {Set<string>} */
let wclCoreParseExpandedKeys = new Set();

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

function wclDebuffCollectCatalogUptimeValues(debuffs, catalog, { categoryId = null } = {}) {
  const values = [];
  const seenOr = new Set();
  const catFilter = categoryId != null ? String(categoryId) : null;
  for (const def of Array.isArray(catalog) ? catalog : []) {
    if (catFilter && String(def?.category || "") !== catFilter) continue;
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
  return values;
}

function wclDebuffAveragePct(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

function wclDebuffEncounterOverallPct(debuffs, catalog) {
  return wclDebuffAveragePct(wclDebuffCollectCatalogUptimeValues(debuffs, catalog));
}

function wclDebuffEncounterOverallTier(debuffs, catalog) {
  const avg = wclDebuffEncounterOverallPct(debuffs, catalog);
  if (avg == null) return "none";
  return wclDebuffUptimeTier(avg);
}

function wclDebuffComputeRaidScore(payload) {
  if (payload?.raidScore && payload.raidScore.overallPct != null) {
    return payload.raidScore;
  }
  const catalog = Array.isArray(payload?.catalog) ? payload.catalog : [];
  const bossRows = Array.isArray(payload?.bossRows) ? payload.bossRows : [];
  const categoryIds = ["armor", "spell", "attack"];
  const bossPcts = [];
  const categorySums = Object.fromEntries(categoryIds.map((id) => [id, []]));
  for (const boss of bossRows) {
    if (boss?.noKills || !boss?.killCount) continue;
    const overallPct = wclDebuffEncounterOverallPct(boss.debuffs, catalog);
    if (overallPct == null) continue;
    bossPcts.push(overallPct);
    for (const catId of categoryIds) {
      const catPct = wclDebuffAveragePct(
        wclDebuffCollectCatalogUptimeValues(boss.debuffs, catalog, { categoryId: catId })
      );
      if (catPct != null) categorySums[catId].push(catPct);
    }
  }
  const overallPct = wclDebuffAveragePct(bossPcts);
  const categoryPct = {};
  for (const catId of categoryIds) {
    categoryPct[catId] = wclDebuffAveragePct(categorySums[catId]);
  }
  return {
    overallPct,
    overallTier: overallPct == null ? "none" : wclDebuffUptimeTier(overallPct),
    categoryPct,
    bossesScored: bossPcts.length,
    bossesTotal: bossRows.length,
  };
}

function wclDebuffMostCommonApplier(appliers) {
  const counts = new Map();
  for (const name of Array.isArray(appliers) ? appliers : []) {
    const key = String(name || "").trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best || null;
}

function wclDebuffBuildRaidAggregateDebuffs(bossRows, catalog) {
  const bosses = (Array.isArray(bossRows) ? bossRows : []).filter((b) => !b?.noKills && b?.killCount);
  const out = [];
  for (const def of Array.isArray(catalog) ? catalog : []) {
    const values = [];
    const appliers = [];
    for (const boss of bosses) {
      const row = wclFindDebuff(boss.debuffs, def);
      if (row?.uptimePct != null && Number.isFinite(Number(row.uptimePct))) {
        values.push(Number(row.uptimePct));
      }
      if (row?.appliedByPlayer) appliers.push(String(row.appliedByPlayer));
    }
    out.push({
      key: def.key,
      spellId: def.spellId,
      name: def.name,
      appliedBy: def.appliedBy,
      category: def.category,
      orNote: def.orNote,
      description: def.description,
      uptimePct: wclDebuffAveragePct(values),
      appliedByPlayer: wclDebuffMostCommonApplier(appliers),
      present: values.length > 0,
    });
  }
  return out;
}

function wclDebuffRaidDrillIdForItem(item) {
  if (item?.kind === "orCombined") {
    const og = String(item.orGroupId || "").trim();
    return og ? `or:${og}` : "";
  }
  const key = String(item?.def?.key || "").trim();
  return key ? `key:${key}` : "";
}

function wclDebuffParseRaidDrillId(drillId) {
  const raw = String(drillId || "").trim();
  if (!raw) return null;
  if (raw.startsWith("or:")) {
    const orGroupId = raw.slice(3).trim();
    return orGroupId ? { kind: "or", orGroupId } : null;
  }
  if (raw.startsWith("key:")) {
    const key = raw.slice(4).trim();
    return key ? { kind: "key", key } : null;
  }
  return null;
}

function wclDebuffCatalogDefForDrill(drillSpec, catalog) {
  if (!drillSpec || drillSpec.kind !== "key") return null;
  const key = String(drillSpec.key || "").trim();
  return (Array.isArray(catalog) ? catalog : []).find((d) => d?.key === key) || null;
}

function wclDebuffRaidDrillTitle(drillSpec, catalog) {
  if (!drillSpec) return "Debuff";
  if (drillSpec.kind === "or") {
    const members = wclDebuffCatalogDefsForOrGroup(catalog, drillSpec.orGroupId);
    const label = wclDebuffOrGroupLabel(drillSpec.orGroupId, members);
    return `Combined (${label})`;
  }
  const def = wclDebuffCatalogDefForDrill(drillSpec, catalog);
  return def?.name || drillSpec.key || "Debuff";
}

function wclDebuffRaidDrillUptimePct(boss, drillSpec, catalog) {
  if (!boss || boss.noKills) return null;
  if (drillSpec.kind === "or") {
    const members = wclDebuffCatalogDefsForOrGroup(catalog, drillSpec.orGroupId);
    return wclDebuffCombineOrGroupUptime(boss.debuffs, members);
  }
  const def = wclDebuffCatalogDefForDrill(drillSpec, catalog);
  if (!def) return null;
  const row = wclFindDebuff(boss.debuffs, def);
  if (row?.uptimePct == null || !Number.isFinite(Number(row.uptimePct))) return null;
  return Number(row.uptimePct);
}

function wclDebuffRaidDrillApplierHtml(boss, drillSpec, catalog) {
  if (!boss || boss.noKills) {
    return `<span class="plb-debuff-row-applier-empty">—</span>`;
  }
  if (drillSpec.kind === "or") {
    const members = wclDebuffCatalogDefsForOrGroup(catalog, drillSpec.orGroupId);
    return wclDebuffOrCombinedAppliersHtml(boss.debuffs, members);
  }
  const def = wclDebuffCatalogDefForDrill(drillSpec, catalog);
  const row = wclFindDebuff(boss.debuffs, def);
  return row?.appliedByPlayer
    ? esc(row.appliedByPlayer)
    : `<span class="plb-debuff-row-applier-empty">—</span>`;
}

function wclDebuffRenderRaidDisplayItemsHtml(items, debuffs) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const drillId = wclDebuffRaidDrillIdForItem(item);
      const drillOpts = drillId ? { drillId } : {};
      if (item?.kind === "orCombined") {
        return wclDebuffOrCombinedRowHtml(item.orGroupId, item.members, debuffs, drillOpts);
      }
      return wclDebuffDebuffRowHtml(item.def, wclFindDebuff(debuffs, item.def), drillOpts);
    })
    .join("");
}

function wclDebuffEncounterSummaryHeader({ name, noteHtml = "", overallPct, overallTier }) {
  const pct =
    overallPct != null && Number.isFinite(Number(overallPct))
      ? `<span class="plb-debuff-encounter-pct">${esc(Number(overallPct).toFixed(1))}%</span>`
      : "";
  const tier = overallTier || "none";
  return `<span class="plb-debuff-encounter-summary-main">
    <span class="plb-debuff-encounter-name">${esc(name)}</span>
    ${noteHtml}
    ${pct}
    <span class="plb-debuff-encounter-grade plb-debuff-tier-badge plb-debuff-tier-badge--${esc(tier)}">${esc(
      wclDebuffTierLabel(tier)
    )}</span>
  </span>`;
}

function wclDebuffRaidOverviewDetailsHtml(payload, catalog, categories, grouped, catLabel) {
  const raidScore = wclDebuffComputeRaidScore(payload);
  const bossRows = Array.isArray(payload?.bossRows) ? payload.bossRows : [];
  const scored = Number(raidScore.bossesScored || 0);
  const total = Number(raidScore.bossesTotal || 0);
  if (!scored || raidScore.overallPct == null) {
    return `<p class="subtle plb-debuff-raid-overview-empty">Raid average unavailable — no boss kills with debuff data.</p>`;
  }
  const aggregateDebuffs = wclDebuffBuildRaidAggregateDebuffs(bossRows, catalog);
  const bossNote = `${scored} boss${scored === 1 ? "" : "es"} with kills${
    total > scored ? ` · ${total - scored} skipped` : ""
  } · click bar for per-boss`;
  const categoryBlocks = grouped
    .map((g) => {
      const rows = wclDebuffRenderRaidDisplayItemsHtml(
        wclDebuffExpandCategoryDisplayItems(g.defs, catalog),
        aggregateDebuffs
      );
      return `<section class="plb-debuff-cat-block plb-debuff-cat-block--${esc(g.id)}">
        <h5 class="plb-debuff-cat-block-title">${catLabel(g.id)}</h5>
        <div class="plb-debuff-cat-rows">${rows}</div>
      </section>`;
    })
    .join("");
  const raidStatsHtml = wclDebuffRaidStatsMetaHtml(payload?.raidStats);
  return `<details class="plb-debuff-encounter plb-debuff-encounter--raid" open>
    <summary class="plb-debuff-encounter-summary">
      ${wclDebuffEncounterSummaryHeader({
        name: "Raid average",
        noteHtml: `<span class="plb-debuff-encounter-note">${esc(bossNote)}</span>`,
        overallPct: raidScore.overallPct,
        overallTier: raidScore.overallTier,
      })}
    </summary>
    <div class="plb-debuff-encounter-body">${raidStatsHtml}${categoryBlocks}</div>
  </details>`;
}

function renderWclDebuffRaidDrillInto(host, payload, drillSpec) {
  if (!host || !drillSpec) return;
  const catalog = Array.isArray(payload?.catalog) ? payload.catalog : [];
  const bossRows = (Array.isArray(payload?.bossRows) ? payload.bossRows : []).filter(
    (b) => !b?.noKills && b?.killCount
  );
  if (!bossRows.length) {
    host.innerHTML = `<p class="subtle">No boss kills in this report.</p>`;
    return;
  }
  const rows = bossRows
    .map((boss) => {
      const pct = wclDebuffRaidDrillUptimePct(boss, drillSpec, catalog);
      return `<tr>
        <th scope="row">${esc(boss.name || "Boss")}</th>
        <td class="plb-debuff-bar-cell">${wclDebuffUptimeBarHtml(pct)}</td>
        <td class="plb-debuff-applier-cell">${wclDebuffRaidDrillApplierHtml(boss, drillSpec, catalog)}</td>
      </tr>`;
    })
    .join("");
  host.innerHTML = `<table class="plb-debuff-detail-table plb-debuff-raid-drill-table">
    <thead>
      <tr>
        <th scope="col">Encounter</th>
        <th scope="col">Uptime</th>
        <th scope="col">Applied by</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function openWclDebuffRaidDebuffDrill(drillId) {
  const drillSpec = wclDebuffParseRaidDrillId(drillId);
  if (!drillSpec) return;
  const payload = wclDebuffOverviewCache;
  if (!payload?.ok) return;
  const catalog = Array.isArray(payload.catalog) ? payload.catalog : [];
  const reportCode = String(
    wclDebuffOverviewReportCode || document.getElementById("wclDebuffReportSelect")?.value || ""
  ).trim();
  const debuffTitle = wclDebuffRaidDrillTitle(drillSpec, catalog);
  const dialog = document.getElementById("wclDebuffDetailDialog");
  const host = document.getElementById("wclDebuffDetailHost");
  const title = document.getElementById("wclDebuffDetailTitle");
  const statusLine = document.getElementById("wclDebuffDetailStatus");
  if (title) title.textContent = debuffTitle;
  if (statusLine) {
    const scored = (payload.bossRows || []).filter((b) => !b?.noKills && b?.killCount).length;
    statusLine.textContent = `${payload.reportTitle || reportCode || "Report"} · ${scored} encounter(s) with kills`;
  }
  renderWclDebuffRaidDrillInto(host, payload, drillSpec);
  wclDebuffBindSpellTooltips(host);
  if (dialog && typeof dialog.showModal === "function") dialog.showModal();
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

function wclDebuffOrCombinedRowHtml(orGroupId, members, debuffs, { drillId = null } = {}) {
  const combined = wclDebuffCombineOrGroupUptime(debuffs, members);
  const label = wclDebuffOrGroupLabel(orGroupId, members);
  const memberNames = (members || []).map((m) => m?.name).filter(Boolean).join(", ");
  const title = [
    `Combined uptime (${label})`,
    "Either/or debuffs — uptimes are added (max 100%), not stacked.",
    memberNames ? `Includes: ${memberNames}` : "",
    drillId ? "Click bar for per-encounter breakdown" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `<div class="plb-debuff-row plb-debuff-row--or-combined" title="${esc(title)}">
    <div class="plb-debuff-row-name"><strong>Combined</strong> <span class="plb-debuff-or-note">${esc(label)}</span></div>
    ${wclDebuffRowBarHtml(combined, { drillId })}
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

function wclDebuffRowBarHtml(uptimePct, { compact = false, drillId = null } = {}) {
  const bar = wclDebuffUptimeBarHtml(uptimePct, { compact });
  if (!drillId) return `<div class="plb-debuff-row-bar">${bar}</div>`;
  return `<div class="plb-debuff-row-bar plb-debuff-row-bar--drill" data-wcl-debuff-raid-drill="${esc(
    drillId
  )}" role="button" tabindex="0" title="Per-encounter breakdown">${bar}</div>`;
}

function wclDebuffDebuffRowHtml(def, debuff, { drillId = null } = {}) {
  const row = debuff || {};
  const applier = row.appliedByPlayer
    ? esc(row.appliedByPlayer)
    : `<span class="plb-debuff-row-applier-empty">—</span>`;
  const title = [
    def?.name,
    def?.appliedBy ? `Expected: ${def.appliedBy}` : "",
    def?.description,
    row.appliedByPlayer ? `Applied by: ${row.appliedByPlayer}` : "",
    drillId ? "Click bar for per-encounter breakdown" : "",
  ]
    .filter(Boolean)
    .join("\n");
  const orNote = def?.orNote ? ` <span class="plb-debuff-or-note">(${esc(def.orNote)})</span>` : "";
  return `<div class="plb-debuff-row" title="${esc(title)}">
    <div class="plb-debuff-row-name">${wclDebuffSpellTriggerHtml(def.spellId, def.name)}${orNote}</div>
    ${wclDebuffRowBarHtml(row.uptimePct, { drillId })}
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

function renderWclDebuffUptimePanel(payload) {
  const host = document.getElementById("wclDebuffUptimeHost");
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
  const raidDetailsHtml = wclDebuffRaidOverviewDetailsHtml(payload, catalog, categories, grouped, catLabel);
  const encounterCards = bossRows
    .map((boss) => {
      const name = boss.name || "Boss";
      if (boss.noKills) {
        return `<article class="plb-debuff-encounter plb-debuff-encounter--nokill">
          <div class="plb-debuff-encounter-static plb-debuff-encounter-summary">
            <span class="plb-debuff-encounter-summary-main">
              <span class="plb-debuff-encounter-name">${esc(name)}</span>
              <span class="plb-debuff-encounter-grade plb-debuff-tier-badge plb-debuff-tier-badge--none">No kill</span>
            </span>
          </div>
        </article>`;
      }
      const overallPct = wclDebuffEncounterOverallPct(boss.debuffs, catalog);
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
      return `<details class="plb-debuff-encounter">
        <summary class="plb-debuff-encounter-summary">
          ${wclDebuffEncounterSummaryHeader({
            name,
            noteHtml: killNote,
            overallPct,
            overallTier,
          })}
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
    <p class="plb-debuff-hint"><strong>Raid average</strong> is mean uptime per debuff across bosses. Click a raid-average bar for per-encounter breakdown. Expand a boss for latest-kill bars; <strong>Combined</strong> rows sum either/or debuffs capped at 100%.</p>
    <div class="plb-debuff-encounters">
      ${raidDetailsHtml}
      ${encounterCards}
    </div>
  `;
  wclDebuffBindSpellTooltips(host);
}

function renderWclDebuffOverview(payload) {
  renderWclDebuffUptimePanel(payload);
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

async function loadWclDebuffOverview(reportCode, { silent = false, btn = null, refresh = false } = {}) {
  const code = String(reportCode || "").trim();
  const reloadBtn = document.getElementById("wclDebuffReloadBtn");
  if (!code) {
    wclDebuffOverviewCache = null;
    wclDebuffOverviewReportCode = "";
    const uptimeHost = document.getElementById("wclDebuffUptimeHost");
    if (uptimeHost) uptimeHost.innerHTML = "";
    setWclDebuffStatusLine("Select a raid event to load the boss overview.");
    if (reloadBtn) reloadBtn.disabled = true;
    return null;
  }
  if (reloadBtn) reloadBtn.disabled = false;
  try {
    if (btn) setButtonFeedback(btn, "Loading…", "loading");
    if (!silent) {
      setWclDebuffStatusLine("Loading debuff overview from WCL (first load may take a minute)…");
      const uptimeHost = document.getElementById("wclDebuffUptimeHost");
      if (uptimeHost) uptimeHost.innerHTML = `<p class="subtle">Querying WCL for each boss…</p>`;
    }
    const [payload] = await Promise.all([
      getJson(`${WCL_DEBUFF_API}?reportCode=${encodeURIComponent(code)}&overview=1${refresh ? "&refresh=1" : ""}`),
    ]);
    if (!payload?.ok) throw new Error(payload?.error || "Overview failed");
    wclDebuffOverviewCache = payload;
    wclDebuffOverviewReportCode = code;
    await loadWclDebuffSpellMeta(payload.catalog || []);
    renderWclDebuffOverview(payload);
    const raidScore = wclDebuffComputeRaidScore(payload);
    const killBosses = (payload.bossRows || []).filter((b) => !b.noKills).length;
    const archiveNote = wclDebuffArchiveNote(payload.archiveStatus);
    const raidNote =
      raidScore?.overallPct != null
        ? ` · raid debuff uptime ${Number(raidScore.overallPct).toFixed(1)}% (${wclDebuffTierLabel(raidScore.overallTier)})`
        : "";
    setWclDebuffStatusLine(
      `${payload.reportTitle || code}: ${killBosses} boss(es) with kills (latest pull each)${raidNote}.${archiveNote}`
    );
    return payload;
  } catch (error) {
    const uptimeHost = document.getElementById("wclDebuffUptimeHost");
    const errHtml = `<p class="subtle">${esc(error?.message || "Overview failed")}</p>`;
    if (uptimeHost) uptimeHost.innerHTML = errHtml;
    setWclDebuffStatusLine(error?.message || "Overview failed");
    if (/rate limit|429|points/i.test(String(error?.message || ""))) {
    } else {
    }
    throw error;
  } finally {
    if (btn) resetButtonFeedback(btn, "Reload overview");
  }
}

async function openWclDebuffEncounterDetail(encounterId, encounterName, { refresh = false } = {}) {
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
    const refreshQ = refresh ? "&refresh=1" : "";
    const payload = await getJson(
      `${WCL_DEBUFF_API}?reportCode=${encodeURIComponent(reportCode)}&encounterId=${encodeURIComponent(eid)}${refreshQ}`
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

function fmtProgressChartDate(startTime) {
  const ms = num(startTime) > 1e12 ? num(startTime) : num(startTime) * 1000;
  const dt = new Date(ms);
  return Number.isNaN(dt.getTime()) ? "?" : dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtProgressDuration(ms) {
  const totalSeconds = Math.floor(Number(ms || 0) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function fmtProgressDps(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return String(Math.round(n));
}

function wclDebuffRaidStatsMetaHtml(raidStats, { compact = false, missing = false } = {}) {
  const stats = raidStats && typeof raidStats === "object" ? raidStats : null;
  const clearMs = stats ? Number(stats.clearDurationMs) : NaN;
  const hasClear = Number.isFinite(clearMs) && clearMs > 0;
  const clearLabel = hasClear
    ? stats.isFullClear
      ? "Full clear"
      : "Boss span"
    : "Clear";
  const clearVal = hasClear ? fmtProgressDuration(clearMs) : "—";
  const dpsVal = stats ? fmtProgressDps(stats.totalDps) : "—";
  const progressNote =
    stats && !stats.isFullClear && Number(stats.bossesTotal) > 0
      ? ` · ${Number(stats.bossesKilled || 0)}/${Number(stats.bossesTotal)} bosses`
      : "";
  const cls = compact
    ? "plb-debuff-raid-stats plb-debuff-raid-stats--compact"
    : "plb-debuff-raid-stats";
  const pendingHint = missing
    ? `<span class="plb-debuff-raid-stat plb-debuff-raid-stat--hint subtle">Refresh trends for clear &amp; DPS</span>`
    : "";
  return `<div class="${cls}">
    <span class="plb-debuff-raid-stat"><span class="plb-debuff-raid-stat-label">${esc(clearLabel)}</span> <strong>${esc(clearVal)}</strong>${esc(progressNote)}</span>
    <span class="plb-debuff-raid-stat"><span class="plb-debuff-raid-stat-label">Total DPS</span> <strong>${esc(dpsVal)}</strong></span>
    ${pendingHint}
  </div>`;
}

function wclProgressRaidFilterHeading(raidFilter) {
  const key = String(raidFilter || "all").trim().toLowerCase() || "all";
  if (key === "all") return "Latest raid";
  return `Latest ${wclProgressRaidLabel(key)} raid`;
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

function wclDebuffProgressCategoryBarsHtml(categoryPct) {
  const cats = [
    ["armor", "Armor"],
    ["spell", "Spell"],
    ["attack", "Attack"],
  ];
  return `<div class="plb-debuff-progress-cell-cats">${cats
    .map(
      ([key, label]) =>
        `<div class="plb-debuff-progress-cell-cat"><span class="plb-debuff-progress-cell-cat-label">${esc(
          label
        )}</span>${wclDebuffProgressBarHtml(categoryPct?.[key], { compact: true, label })}</div>`
    )
    .join("")}</div>`;
}

function wclDebuffProgressBossTableRowHtml(boss) {
  const name = String(boss?.name || "Boss").trim() || "Boss";
  if (boss?.noKills) {
    return `<tr class="plb-debuff-progress-boss-row plb-debuff-progress-boss-row--empty">
      <th scope="row">${esc(name)}</th>
      <td colspan="4" class="subtle">No kill</td>
    </tr>`;
  }
  return `<tr class="plb-debuff-progress-boss-row">
    <th scope="row">${esc(name)}</th>
    <td>${wclDebuffProgressBarHtml(boss.overallPct, { compact: true, label: "Overall" })}</td>
    <td>${wclDebuffProgressBarHtml(boss.categoryPct?.armor, { compact: true, label: "Armor" })}</td>
    <td>${wclDebuffProgressBarHtml(boss.categoryPct?.spell, { compact: true, label: "Spell" })}</td>
    <td>${wclDebuffProgressBarHtml(boss.categoryPct?.attack, { compact: true, label: "Attack" })}</td>
  </tr>`;
}

function renderWclDebuffProgressRaidCard(row) {
  const bosses = Array.isArray(row.bosses) ? row.bosses : [];
  const bossRows = bosses.length
    ? bosses.map(wclDebuffProgressBossTableRowHtml).join("")
    : `<tr><td colspan="5" class="subtle">No boss breakdown in snapshot — rebuild snapshots.</td></tr>`;
  const tier = row.overallTier || "none";
  return `<article class="plb-debuff-progress-raid-card">
    <header class="plb-debuff-progress-raid-card-head">
      <div class="plb-debuff-progress-raid-card-meta">
        <time class="plb-debuff-progress-raid-card-date" datetime="">${esc(fmtProgressDate(row.startTime))}</time>
        <h3 class="plb-debuff-progress-raid-card-title">${esc(row.reportTitle || row.reportCode || "")}</h3>
        <span class="plb-debuff-progress-raid-card-tier">${esc(wclProgressRaidLabel(row.raidKey))}</span>
      </div>
      <div class="plb-debuff-progress-raid-card-score">
        <strong class="plb-debuff-progress-raid-card-pct">${esc(Number(row.overallPct).toFixed(1))}%</strong>
        <span class="plb-debuff-encounter-grade plb-debuff-tier-badge plb-debuff-tier-badge--${esc(tier)}">${esc(
          wclDebuffTierLabel(tier)
        )}</span>
        <span class="plb-debuff-progress-raid-card-delta">vs previous: ${wclDebuffProgressDeltaHtml(row.deltaOverallPct)}</span>
        ${wclDebuffRaidStatsMetaHtml(row.raidStats, {
          compact: true,
          missing: !row.raidStats,
        })}
      </div>
      <button type="button" class="event-signup-btn event-signup-btn--softres plb-debuff-progress-view" data-wcl-progress-view="${esc(
        row.reportCode
      )}">View report</button>
    </header>
    <div class="plb-debuff-progress-raid-card-body">
      <table class="plb-debuff-progress-boss-table">
        <thead>
          <tr>
            <th scope="col">Boss</th>
            <th scope="col">Overall</th>
            <th scope="col">Armor</th>
            <th scope="col">Spell</th>
            <th scope="col">Attack</th>
          </tr>
        </thead>
        <tbody>${bossRows}</tbody>
      </table>
    </div>
  </article>`;
}

function renderWclDebuffProgressByRaidNight(points) {
  const cards = [...(Array.isArray(points) ? points : [])].reverse();
  if (!cards.length) {
    return `<p class="subtle">No scored raid nights for this filter yet.</p>`;
  }
  return `<div class="plb-debuff-progress-raid-list">${cards.map(renderWclDebuffProgressRaidCard).join("")}</div>`;
}

function renderWclDebuffProgressByBoss(encounterSeries, columnReports) {
  const columns = Array.isArray(columnReports) ? columnReports : [];
  const series = Array.isArray(encounterSeries) ? encounterSeries : [];
  if (!columns.length) {
    return `<p class="subtle">No scored raid nights for this filter yet.</p>`;
  }
  if (!series.length) {
    return `<p class="subtle">No boss encounter data in snapshots — use <strong>Build missing snapshots</strong> to backfill.</p>`;
  }
  const colHeads = columns
    .map(
      (col) =>
        `<th scope="col" class="plb-debuff-progress-matrix-col" title="${esc(col.reportTitle || col.reportCode || "")}">${esc(
          fmtProgressChartDate(col.startTime)
        )}</th>`
    )
    .join("");
  const body = series
    .map((enc) => {
      const cellByCode = new Map(
        (Array.isArray(enc.points) ? enc.points : []).map((pt) => [String(pt.reportCode || ""), pt])
      );
      const cells = columns
        .map((col) => {
          const pt = cellByCode.get(String(col.reportCode || ""));
          if (!pt || pt.noKills) {
            return `<td class="plb-debuff-progress-cell plb-debuff-progress-cell--empty"><span class="subtle">—</span></td>`;
          }
          const tier = pt.overallTier || wclDebuffUptimeTier(pt.overallPct);
          return `<td class="plb-debuff-progress-cell plb-debuff-progress-cell--${esc(tier)}">
            <div class="plb-debuff-progress-cell-stack">
              ${wclDebuffProgressBarHtml(pt.overallPct, { compact: true, label: "Overall" })}
              ${wclDebuffProgressCategoryBarsHtml(pt.categoryPct)}
            </div>
          </td>`;
        })
        .join("");
      return `<tr>
        <th scope="row" class="plb-debuff-progress-matrix-boss">${esc(enc.name || "Boss")}</th>
        ${cells}
        <td class="plb-debuff-progress-matrix-trend">${wclDebuffProgressDeltaHtml(enc.trendDelta)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="plb-debuff-progress-boss-matrix-wrap">
    <table class="plb-debuff-progress-boss-matrix">
      <thead>
        <tr>
          <th scope="col" class="plb-debuff-progress-matrix-sticky">Boss</th>
          ${colHeads}
          <th scope="col">Trend</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

function renderWclDebuffProgress(payload) {
  const host = document.getElementById("wclProgressResultsHost");
  if (!host) return;
  if (!payload?.ok) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Trends failed.")}</p>`;
    return;
  }
  const points = Array.isArray(payload.points) ? payload.points : [];
  const encounterSeries = Array.isArray(payload.encounterSeries) ? payload.encounterSeries : [];
  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  const warmBtn = document.getElementById("wclProgressWarmBtn");
  if (warmBtn) warmBtn.hidden = pending.length === 0;

  if (!points.length && !pending.length) {
    host.innerHTML = `<p class="subtle">No curated reports in Event Management yet. Select WCL reports in Admin → Event Management, then open each raid’s debuff overview or use <strong>Build missing snapshots</strong>.</p>`;
    return;
  }

  const raidFilter = String(payload?.meta?.raidFilter || wclProgressRaidFilter || "all");
  const filterNote =
    raidFilter !== "all"
      ? `<span class="plb-debuff-progress-filter-note">Showing ${esc(wclProgressRaidLabel(raidFilter))} only</span>`
      : "";

  const viewMode = wclProgressViewMode === "boss" ? "boss" : "raid";
  const mainHtml =
    viewMode === "boss"
      ? renderWclDebuffProgressByBoss(encounterSeries, points)
      : renderWclDebuffProgressByRaidNight(points);

  const pendingHtml = pending.length
    ? `<p class="plb-debuff-progress-pending subtle">${pending.length} curated raid(s) still need snapshots (debuff scores and/or clear time &amp; DPS). Use <strong>Build missing snapshots</strong> or <strong>Refresh trends</strong>.</p>`
    : "";

  host.innerHTML = `
    <p class="plb-debuff-hint">Curated Event Management reports only. Scores average important debuff uptime per boss (latest kill), same tiers as the overview. ${filterNote}</p>
    ${mainHtml}
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
  const filterLabel =
    raid && raid !== "all" ? ` · ${wclProgressRaidLabel(raid)} filter` : "";
  setWclDebuffStatusLine(
    `Progress: ${scored}/${curated} curated raid(s) scored${filterLabel}${pending ? ` · ${pending} pending snapshot(s)` : ""}.`
  );
  return payload;
}

async function warmWclDebuffProgressPending() {
  const pending = Array.isArray(wclProgressCache?.pending) ? wclProgressCache.pending : [];
  if (!pending.length) return loadWclDebuffProgress({ raid: wclProgressRaidFilter });
  const btn = document.getElementById("wclProgressWarmBtn");
  const defaultText = "Build missing snapshots";
  if (btn) setButtonFeedback(btn, "Building…", "info");
  setWclDebuffStatusLine(`Building ${pending.length} snapshot(s) (debuff + clear/DPS)…`);
  try {
    return await loadWclDebuffProgress({ refresh: true, raid: wclProgressRaidFilter });
  } finally {
    if (btn) resetButtonFeedback(btn, defaultText);
  }
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

function wclSetProgressViewMode(mode) {
  wclProgressViewMode = String(mode || "raid").trim().toLowerCase() === "boss" ? "boss" : "raid";
  document.querySelectorAll("[data-wcl-progress-view-mode]").forEach((btn) => {
    const on = btn.getAttribute("data-wcl-progress-view-mode") === wclProgressViewMode;
    btn.classList.toggle("plb-debuff-progress-chip--active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function wclParseTierClass(parsePct) {
  const n = Number(parsePct);
  if (!Number.isFinite(n)) return "leaderboard-peak-parse--wcl0";
  if (n >= 100) return "leaderboard-peak-parse--wcl100";
  if (n >= 99) return "leaderboard-peak-parse--wcl99";
  if (n >= 95) return "leaderboard-peak-parse--wcl95";
  if (n >= 75) return "leaderboard-peak-parse--wcl75";
  if (n >= 50) return "leaderboard-peak-parse--wcl50";
  if (n >= 25) return "leaderboard-peak-parse--wcl25";
  return "leaderboard-peak-parse--wcl0";
}

function wclParseBracketLabel(bracket) {
  const b = String(bracket || "").trim().toLowerCase();
  if (b === "heal") return "Heal";
  if (b === "tank") return "Tank";
  return "DPS";
}

function wclCoreParseGuildRoleLabel(guildRole) {
  const role = String(guildRole || "Core").trim();
  return role || "Core";
}

function wclCoreParseSparklineSvg(points) {
  const scored = (Array.isArray(points) ? points : []).filter((p) => Number.isFinite(Number(p?.parsePct)));
  if (scored.length < 2) {
    return `<p class="subtle plb-core-parse-chart-empty">Not enough events for a trend line.</p>`;
  }
  const w = 320;
  const h = 72;
  const padX = 8;
  const padY = 8;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const coords = scored.map((p, i) => {
    const x = padX + (scored.length === 1 ? innerW / 2 : (i / (scored.length - 1)) * innerW);
    const y = padY + innerH - (Math.min(100, Math.max(0, Number(p.parsePct))) / 100) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const dots = scored
    .map((p, i) => {
      const x = padX + (scored.length === 1 ? innerW / 2 : (i / (scored.length - 1)) * innerW);
      const y = padY + innerH - (Math.min(100, Math.max(0, Number(p.parsePct))) / 100) * innerH;
      return `<circle class="plb-debuff-progress-chart-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" />`;
    })
    .join("");
  return `<div class="plb-debuff-progress-chart plb-core-parse-chart">
    <svg class="plb-debuff-progress-chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Parse trend across events">
      <text class="plb-debuff-progress-chart-ylabel" x="2" y="10">100</text>
      <text class="plb-debuff-progress-chart-ylabel" x="2" y="${h - 4}">0</text>
      <polyline class="plb-debuff-progress-chart-line" fill="none" points="${coords.join(" ")}" />
      ${dots}
    </svg>
  </div>`;
}

function wclCoreParseEventRowHtml(point) {
  const pct = Number(point?.parsePct);
  const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : "—";
  const tier = wclParseTierClass(pct);
  const code = String(point?.reportCode || "").trim();
  const fid = point?.fightId != null ? String(point.fightId) : "";
  const href =
    code && fid
      ? `https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}#fight=${encodeURIComponent(fid)}`
      : code
        ? `https://www.warcraftlogs.com/reports/${encodeURIComponent(code)}`
        : "";
  const link = href
    ? `<a class="plb-core-parse-report-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(code || "WCL")}</a>`
    : `<span class="subtle">—</span>`;
  return `<tr>
    <td><time datetime="">${esc(fmtProgressDate(point?.reportStartTime))}</time></td>
    <td>${esc(wclProgressRaidLabel(point?.raidKey) || point?.raidName || "—")}</td>
    <td><span class="leaderboard-peak-parse ${tier}">${esc(pctText)}</span></td>
    <td>${esc(point?.encounterName || "—")}</td>
    <td>${esc(wclParseBracketLabel(point?.bracket))}</td>
    <td>${link}</td>
  </tr>`;
}

function wclCoreParsePlayerCardHtml(player, cardIdx = 0) {
  const name = esc(player?.displayName || player?.raidHelperName || "?");
  const delta = wclDebuffProgressDeltaHtml(player?.trendDelta);
  const bracket = esc(wclParseBracketLabel(player?.bracket));
  const guildRole = esc(wclCoreParseGuildRoleLabel(player?.guildRole));
  const wclList = Array.isArray(player?.wclCharacters) ? player.wclCharacters : [];
  if (!player?.hasWclMapping) {
    return `<article class="plb-core-parse-card plb-core-parse-card--empty">
      <header class="plb-core-parse-card-head">
        <h3 class="plb-core-parse-card-name">${name}</h3>
        <span class="plb-core-parse-role">${guildRole}</span>
      </header>
      <p class="subtle">No WCL mapping — link characters in Account Assignment.</p>
    </article>`;
  }
  const points = Array.isArray(player?.points) ? player.points : [];
  if (!points.length) {
    return `<article class="plb-core-parse-card plb-core-parse-card--empty">
      <header class="plb-core-parse-card-head">
        <h3 class="plb-core-parse-card-name">${name}</h3>
        <span class="plb-core-parse-role">${guildRole} · ${bracket}</span>
        <span class="plb-core-parse-trend">Trend: ${delta}</span>
      </header>
      <p class="subtle">No parse data for this raid window.</p>
      <p class="subtle plb-core-parse-wcl-names">WCL: ${esc(wclList.join(", ") || "—")}</p>
    </article>`;
  }
  const rawKey = wclCoreParseMemberKey(player);
  const playerKey = esc(rawKey);
  const domId = `wcl-core-parse-details-${Number(cardIdx) || 0}`;
  const expanded = wclCoreParseExpandedKeys.has(rawKey);
  const tableRows = points.map(wclCoreParseEventRowHtml).join("");
  return `<article class="plb-core-parse-card plb-core-parse-card--expandable${expanded ? " plb-core-parse-card--expanded" : ""}" data-wcl-core-parse-key="${playerKey}">
    <button type="button" class="plb-core-parse-card-summary" aria-expanded="${expanded ? "true" : "false"}" aria-controls="${domId}">
      <header class="plb-core-parse-card-head">
        <div class="plb-core-parse-card-meta">
          <h3 class="plb-core-parse-card-name">${name}</h3>
          <span class="plb-core-parse-role">${guildRole} · ${bracket}</span>
          <span class="plb-core-parse-wcl-names subtle">${esc(wclList.join(", "))}</span>
        </div>
        <div class="plb-core-parse-card-trend">
          <span class="plb-core-parse-trend-label">Since first event</span>
          ${delta}
        </div>
      </header>
      ${wclCoreParseSparklineSvg(points)}
      <span class="plb-core-parse-expand-cue">${expanded ? "Hide event details" : `Show ${points.length} event(s)`}</span>
    </button>
    <div class="plb-core-parse-card-details" id="${domId}" ${expanded ? "" : "hidden"}>
      <div class="plb-debuff-progress-table-wrap plb-core-parse-table-wrap">
        <table class="plb-debuff-progress-table plb-core-parse-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Raid</th>
              <th scope="col">Parse</th>
              <th scope="col">Boss</th>
              <th scope="col">Bracket</th>
              <th scope="col">Report</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  </article>`;
}

function wclToggleCoreParseCardExpanded(key) {
  const id = String(key || "").trim();
  if (!id) return;
  if (wclCoreParseExpandedKeys.has(id)) wclCoreParseExpandedKeys.delete(id);
  else wclCoreParseExpandedKeys.add(id);
  if (wclCoreParseCache?.ok) renderWclCoreParse(wclCoreParseCache);
}

function wclCoreParseMemberKey(player) {
  return String(player?.raidHelperName || player?.displayName || "").trim();
}

function wclCoreParsePlayersFromPayload(payload) {
  return Array.isArray(payload?.players) ? payload.players : [];
}

function wclEnsureCoreParseMemberSelection(players) {
  const keys = players.map(wclCoreParseMemberKey).filter(Boolean);
  if (!keys.length) {
    wclCoreParseSelectedMembers = null;
    return;
  }
  if (wclCoreParseSelectedMembers == null) return;
  const keySet = new Set(keys);
  const next = new Set();
  for (const key of wclCoreParseSelectedMembers) {
    if (keySet.has(key)) next.add(key);
  }
  if (next.size === keys.length) {
    wclCoreParseSelectedMembers = null;
    return;
  }
  wclCoreParseSelectedMembers = next;
}

function wclCoreParseMemberIsSelected(key) {
  if (!key) return false;
  if (wclCoreParseSelectedMembers == null) return true;
  return wclCoreParseSelectedMembers.has(key);
}

function wclFilterCoreParsePlayers(players) {
  const list = Array.isArray(players) ? players : [];
  if (wclCoreParseSelectedMembers == null) return list;
  return list.filter((p) => wclCoreParseMemberIsSelected(wclCoreParseMemberKey(p)));
}

function wclCoreParsePointCount(player) {
  return Array.isArray(player?.points) ? player.points.length : 0;
}

/** Roster filter, then hide raiders with no events when a raid chip is active. */
function wclFilterCoreParsePlayersForView(players, raidFilter) {
  const rosterFiltered = wclFilterCoreParsePlayers(players);
  const raid = String(raidFilter || "all").trim().toLowerCase() || "all";
  if (raid === "all") return rosterFiltered;
  return rosterFiltered.filter((p) => wclCoreParsePointCount(p) > 0);
}

function wclShowCoreParseLoadError(error) {
  const host = document.getElementById("wclCoreParseHost");
  const msg = String(error?.message || "Failed to load Core parses.").trim();
  if (host) {
    if (/login required/i.test(msg)) {
      host.innerHTML = `<p class="subtle">Sign in with a raid-lead account to view Core parse trends.</p>`;
    } else {
      host.innerHTML = `<p class="subtle">${esc(msg)}</p>`;
    }
  }
  setWclDebuffStatusLine(msg);
}

function wclUpdateCoreParseMemberToggleLabel(players) {
  const btn = document.getElementById("wclCoreParseMemberToggle");
  if (!btn) return;
  const total = players.length;
  if (!total) {
    btn.textContent = "No raiders";
    return;
  }
  if (wclCoreParseSelectedMembers == null) {
    btn.textContent = `All raiders (${total})`;
    return;
  }
  if (wclCoreParseSelectedMembers.size === 0) {
    btn.textContent = `0 of ${total} raiders`;
    return;
  }
  const selected = players.filter((p) => wclCoreParseMemberIsSelected(wclCoreParseMemberKey(p))).length;
  btn.textContent = `${selected} of ${total} raiders`;
}

function wclRenderCoreParseMemberDropdown(players) {
  const listHost = document.getElementById("wclCoreParseMemberList");
  if (!listHost) return;
  wclEnsureCoreParseMemberSelection(players);
  if (!players.length) {
    listHost.innerHTML = `<p class="subtle plb-core-parse-member-empty">No Core or lead raiders assigned.</p>`;
    wclUpdateCoreParseMemberToggleLabel(players);
    return;
  }
  listHost.innerHTML = players
    .map((player) => {
      const key = wclCoreParseMemberKey(player);
      const name = esc(player?.displayName || player?.raidHelperName || key);
      const checked = wclCoreParseMemberIsSelected(key);
      const roleTag = esc(wclCoreParseGuildRoleLabel(player?.guildRole));
      const mapNote = player?.hasWclMapping ? "" : `<span class="plb-core-parse-member-option-meta subtle">no WCL map</span>`;
      return `<label class="plb-core-parse-member-option" role="option" aria-selected="${checked ? "true" : "false"}">
        <input type="checkbox" class="plb-core-parse-member-checkbox" data-wcl-core-parse-member="${esc(key)}" ${checked ? "checked" : ""} />
        <span class="plb-core-parse-member-option-name">${name} <span class="plb-core-parse-member-option-role">${roleTag}</span></span>
        ${mapNote}
      </label>`;
    })
    .join("");
  wclUpdateCoreParseMemberToggleLabel(players);
}

function wclSetCoreParseMemberMenuOpen(open) {
  wclCoreParseMemberMenuOpen = Boolean(open);
  const menu = document.getElementById("wclCoreParseMemberMenu");
  const toggle = document.getElementById("wclCoreParseMemberToggle");
  if (menu) menu.hidden = !wclCoreParseMemberMenuOpen;
  if (toggle) toggle.setAttribute("aria-expanded", wclCoreParseMemberMenuOpen ? "true" : "false");
}

function wclApplyCoreParseMemberSelectionFromDom() {
  const players = wclCoreParsePlayersFromPayload(wclCoreParseCache);
  const boxes = document.querySelectorAll(".plb-core-parse-member-checkbox");
  if (!boxes.length) return;
  const selected = new Set();
  boxes.forEach((box) => {
    if (!box.checked) return;
    const key = String(box.getAttribute("data-wcl-core-parse-member") || "").trim();
    if (key) selected.add(key);
  });
  if (selected.size === 0) {
    wclCoreParseSelectedMembers = new Set();
  } else if (selected.size === players.length) {
    wclCoreParseSelectedMembers = null;
  } else {
    wclCoreParseSelectedMembers = selected;
  }
  wclUpdateCoreParseMemberToggleLabel(players);
  if (wclCoreParseCache?.ok) renderWclCoreParse(wclCoreParseCache);
}

function renderWclCoreParse(payload) {
  const host = document.getElementById("wclCoreParseHost");
  if (!host) return;
  if (!payload?.ok) {
    host.innerHTML = `<p class="subtle">${esc(payload?.error || "Core parse data failed.")}</p>`;
    return;
  }
  const players = wclCoreParsePlayersFromPayload(payload);
  if (!players.length) {
    host.innerHTML = `<p class="subtle">No eligible raiders yet. Assign <strong>Core</strong> or a lead role (Raid lead, Heal lead, DPS lead, Pug lead) in Admin → Account Assignment.</p>`;
    wclRenderCoreParseMemberDropdown([]);
    return;
  }
  wclRenderCoreParseMemberDropdown(players);
  const raidFilter = String(payload?.raidFilter || wclCoreParseRaidFilter || "all");
  const rosterFiltered = wclFilterCoreParsePlayers(players);
  const visible = wclFilterCoreParsePlayersForView(players, raidFilter);
  const filterNote =
    raidFilter !== "all"
      ? `<span class="plb-debuff-progress-filter-note">Showing ${esc(wclProgressRaidLabel(raidFilter))} only</span>`
      : "";
  const memberNote =
    wclCoreParseSelectedMembers != null
      ? `<span class="plb-debuff-progress-filter-note">Showing ${rosterFiltered.length} of ${players.length} raiders</span>`
      : "";
  const raidHiddenCount =
    raidFilter !== "all" ? Math.max(0, rosterFiltered.length - visible.length) : 0;
  const raidHiddenNote =
    raidHiddenCount > 0
      ? `<span class="plb-debuff-progress-filter-note">${raidHiddenCount} raider(s) hidden — no ${esc(wclProgressRaidLabel(raidFilter))} parses in this window</span>`
      : "";
  if (!visible.length) {
    const emptyCopy =
      wclCoreParseSelectedMembers != null && wclCoreParseSelectedMembers.size === 0
        ? `No raiders selected. Use the <strong>Roster filter</strong> dropdown to choose who appears in this view.`
        : raidFilter !== "all"
          ? `No raiders with ${esc(wclProgressRaidLabel(raidFilter))} parse data in this window. Try <strong>All raids</strong> or another raid filter.`
          : `No raiders selected. Use the <strong>Roster filter</strong> dropdown to choose who appears in this view.`;
    host.innerHTML = `
      <p class="plb-debuff-hint">Best single-boss WCL percentile per curated event night for Core and lead raiders with mapped log names. Parse bracket follows guild role and Raid Helper signup — not incidental off-role parses. ${filterNote} ${memberNote} ${raidHiddenNote}</p>
      <p class="subtle">${emptyCopy}</p>
    `;
    return;
  }
  const cards = visible.map((player, idx) => wclCoreParsePlayerCardHtml(player, idx)).join("");
  host.innerHTML = `
    <p class="plb-debuff-hint">Best single-boss WCL percentile per curated event night for Core and lead raiders with mapped log names. Parse bracket follows guild role and Raid Helper signup — not incidental off-role parses. ${filterNote} ${memberNote} ${raidHiddenNote}</p>
    <div class="plb-core-parse-grid">${cards}</div>
  `;
}

async function loadWclCoreParse({ refresh = false, raid = wclCoreParseRaidFilter } = {}) {
  const host = document.getElementById("wclCoreParseHost");
  if (host && !wclCoreParseLoaded) {
    host.innerHTML = `<p class="subtle">Loading Core parse trends…</p>`;
  }
  try {
    const params = new URLSearchParams();
    if (raid && raid !== "all") params.set("raid", raid);
    params.set("limit", "40");
    if (refresh) params.set("refresh", "1");
    const payload = await getJson(`${WCL_CORE_PARSE_API}?${params.toString()}`);
    wclCoreParseCache = payload;
    wclCoreParseLoaded = true;
    renderWclCoreParse(payload);
    const players = wclCoreParsePlayersFromPayload(payload);
    const coreCount = Number(payload?.meta?.coreRaiderCount ?? players.length ?? 0);
    const visibleCount = wclFilterCoreParsePlayersForView(players, raid).length;
    const reportCount = Number(payload?.meta?.reportCount ?? 0);
    const filterLabel = raid && raid !== "all" ? ` · ${wclProgressRaidLabel(raid)} filter` : "";
    const memberLabel =
      wclCoreParseSelectedMembers != null && wclFilterCoreParsePlayers(players).length !== coreCount
        ? ` · ${wclFilterCoreParsePlayers(players).length}/${coreCount} roster`
        : "";
    const viewLabel =
      raid && raid !== "all" && visibleCount !== wclFilterCoreParsePlayers(players).length
        ? ` · ${visibleCount} with ${wclProgressRaidLabel(raid)} data`
        : "";
    setWclDebuffStatusLine(
      `Core parses: ${coreCount} Core raider(s) across ${reportCount} event report(s)${filterLabel}${memberLabel}${viewLabel}.`
    );
    return payload;
  } catch (error) {
    wclShowCoreParseLoadError(error);
    throw error;
  }
}

function wclSetCoreParseRaidFilter(raid) {
  wclCoreParseRaidFilter = String(raid || "all").trim().toLowerCase() || "all";
  document.querySelectorAll("[data-wcl-core-parse-raid]").forEach((btn) => {
    const on = btn.getAttribute("data-wcl-core-parse-raid") === wclCoreParseRaidFilter;
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
          : tab === "core-parse"
            ? "core-parse"
            : tab === "leaderboard"
              ? "leaderboard"
              : "debuffs";
  wclActivePanelTab = next;
  document.querySelectorAll("[data-wcl-panel-tab]").forEach((btn) => {
    const on = btn.getAttribute("data-wcl-panel-tab") === next;
    btn.classList.toggle("plb-debuff-tab--active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const debuffHost = document.getElementById("wclDebuffResultsHost");
  const leaderboardHost = document.getElementById("wclLeaderboardResultsHost");
  const consumeHost = document.getElementById("wclConsumablesResultsHost");
  const gearHost = document.getElementById("wclGearAuditResultsHost");
  const progressHost = document.getElementById("wclProgressResultsHost");
  const coreParseHost = document.getElementById("wclCoreParseHost");
  const debuffLegend = document.getElementById("wclDebuffLegend");
  const consumeLeaderboardLegend = document.getElementById("wclConsumeLeaderboardLegend");
  const progressLegend = document.getElementById("wclProgressLegend");
  const coreParseLegend = document.getElementById("wclCoreParseLegend");
  const consumeLegend = document.getElementById("wclConsumablesLegend");
  const gearLegend = document.getElementById("wclGearLegend");
  const reportToolbar = document.getElementById("wclDebuffReportToolbar");
  const leaderboardToolbar = document.getElementById("wclLeaderboardToolbar");
  const progressToolbar = document.getElementById("wclProgressToolbar");
  const coreParseToolbar = document.getElementById("wclCoreParseToolbar");
  if (debuffHost) debuffHost.hidden = next !== "debuffs";
  if (leaderboardHost) leaderboardHost.hidden = next !== "leaderboard";
  if (consumeHost) consumeHost.hidden = next !== "consumables";
  if (gearHost) gearHost.hidden = next !== "gear";
  if (progressHost) progressHost.hidden = next !== "progress";
  if (coreParseHost) coreParseHost.hidden = next !== "core-parse";
  if (progressLegend) progressLegend.hidden = next !== "progress";
  if (coreParseLegend) coreParseLegend.hidden = next !== "core-parse";
  if (consumeLegend) consumeLegend.hidden = next !== "consumables";
  if (gearLegend) gearLegend.hidden = next !== "gear";
  if (reportToolbar) {
    reportToolbar.hidden = next === "progress" || next === "core-parse" || next === "leaderboard";
  }
  if (leaderboardToolbar) leaderboardToolbar.hidden = next !== "leaderboard";
  if (progressToolbar) progressToolbar.hidden = next !== "progress";
  if (coreParseToolbar) coreParseToolbar.hidden = next !== "core-parse";
  if (debuffLegend) debuffLegend.hidden = next !== "debuffs";
  if (consumeLeaderboardLegend) consumeLeaderboardLegend.hidden = next !== "leaderboard";
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

const WCL_USAGE_COL_SHORT = {
  "haste-potion": "Haste",
  "destruction-potion": "Destr",
  "fel-mana-potion": "Fel Mana",
  "scroll-agility-v": "Scr Agi",
  "scroll-strength-v": "Scr Str",
  "scroll-spirit-v": "Scr Spi",
  "flask-pure-death": "Pure Death",
  "flask-relentless-assault": "Relentless",
  "flask-blinding-light": "Blinding",
  "dark-rune": "Dark",
  "demonic-rune": "Demonic",
  "flame-cap": "Flame",
};

async function loadWclConsumablesUsage(reportCode, { refresh = false } = {}) {
  const code = String(reportCode || "").trim();
  if (!code) {
    wclConsumablesUsageCache = null;
    wclConsumablesUsageReportCode = "";
    return null;
  }
  if (!refresh && wclConsumablesUsageReportCode === code && wclConsumablesUsageCache?.ok) {
    return wclConsumablesUsageCache;
  }
  const usagePayload = await getJson(
    `${WCL_CONSUMABLES_USAGE_API}?reportCode=${encodeURIComponent(code)}${refresh ? "&refresh=1" : ""}`
  ).catch(() => ({ ok: false, error: "Usage load failed" }));
  wclConsumablesUsageCache = usagePayload;
  wclConsumablesUsageReportCode = code;
  return usagePayload;
}

function wclLeaderboardScopeLastRaids(scope = wclLeaderboardScope) {
  return scope === "last6" ? WCL_LEADERBOARD_LAST_RAIDS : 0;
}

function wclLeaderboardApiUrl({ scope = wclLeaderboardScope, refresh = false } = {}) {
  const lastRaids = wclLeaderboardScopeLastRaids(scope);
  const params = new URLSearchParams({ leaderboard: "1" });
  if (lastRaids > 0) params.set("lastRaids", String(lastRaids));
  if (refresh) params.set("refresh", "1");
  return `${WCL_CONSUMABLES_USAGE_API}?${params.toString()}`;
}

function wclLeaderboardScopeHintText(scope = wclLeaderboardScope) {
  return scope === "last6"
    ? `Totals across the ${WCL_LEADERBOARD_LAST_RAIDS} most recent logged 25-man raids in Event Management (Karazhan & Zul'Aman excluded).`
    : "Totals across all logged 25-man raids in Event Management (Karazhan & Zul'Aman excluded).";
}

function wclLeaderboardStatusLine(usagePayload) {
  const reports = Number(usagePayload?.reportsScanned || 0);
  const eligible = Number(usagePayload?.reportsEligible ?? reports);
  const fights = Number(usagePayload?.fightsScanned || 0);
  const lastRaids = Number(usagePayload?.lastRaids || 0);
  const top = (usagePayload?.players || []).find((p) => Number(p.totalUses || 0) > 0);
  const scopeLabel =
    lastRaids > 0
      ? `${reports} of last ${Math.min(lastRaids, eligible)} logged 25-man raid(s)`
      : `${reports} logged 25-man raid(s)`;
  return `Consumables leaderboard · ${scopeLabel} · ${fights} boss kill(s) scanned${
    top ? ` · top ${top.name} (${top.totalUses})` : ""
  }.`;
}

function wclSetLeaderboardScope(scope) {
  const next = scope === "last6" ? "last6" : "all";
  wclLeaderboardScope = next;
  document.querySelectorAll("[data-wcl-leaderboard-scope]").forEach((btn) => {
    const on = btn.getAttribute("data-wcl-leaderboard-scope") === next;
    btn.classList.toggle("plb-debuff-progress-chip--active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const note = document.getElementById("wclLeaderboardToolbarNote");
  if (note) note.textContent = wclLeaderboardScopeHintText(next);
}

function wclLeaderboardScopeTitle(scope = wclLeaderboardScope) {
  return scope === "last6" ? "Consumables leaderboard · last 6 raids" : "Consumables leaderboard";
}

async function loadWclConsumablesUsageLeaderboard({
  silent = false,
  btn = null,
  refresh = false,
  scope = wclLeaderboardScope,
} = {}) {
  const host = document.getElementById("wclLeaderboardResultsHost");
  const scopeKey = scope === "last6" ? "last6" : "all";
  try {
    if (btn) setButtonFeedback(btn, "Loading…", "loading");
    if (!silent && !refresh) {
      setWclDebuffStatusLine(
        scopeKey === "last6"
          ? `Building consumables leaderboard for the last ${WCL_LEADERBOARD_LAST_RAIDS} logged 25-man raids…`
          : "Building consumables leaderboard across logged 25-man raids…"
      );
    } else if (!silent) {
      setWclDebuffStatusLine("Refreshing consumables leaderboard from WCL…");
    }
    if (!silent && host) {
      host.innerHTML = `<p class="subtle">Scanning Warcraft Logs reports (first load may take several minutes)…</p>`;
    }
    const usagePayload = await getJson(wclLeaderboardApiUrl({ scope, refresh }));
    wclConsumablesLeaderboardCacheByScope[scopeKey] = usagePayload;
    wclConsumablesLeaderboardCache = usagePayload;
    if (host) host.innerHTML = renderWclConsumablesUsageLeaderboard(usagePayload, { scope: scopeKey });
    setWclDebuffStatusLine(wclLeaderboardStatusLine(usagePayload));
    return usagePayload;
  } catch (error) {
    if (host) host.innerHTML = `<p class="subtle">${esc(error?.message || "Leaderboard failed")}</p>`;
    setWclDebuffStatusLine(error?.message || "Leaderboard failed");
    throw error;
  } finally {
    if (btn) resetButtonFeedback(btn, "Refresh leaderboard");
  }
}

function topConsumableLabelsForPlayer(counts, catalog, limit = 4) {
  return (Array.isArray(catalog) ? catalog : [])
    .map((c) => ({
      key: c.key,
      label: WCL_USAGE_COL_SHORT[c.key] || c.name,
      n: Number(counts?.[c.key] || 0),
    }))
    .filter((row) => row.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, Math.max(1, limit));
}

function renderWclConsumablesUsageLeaderboard(usagePayload, { limit = 20, scope = wclLeaderboardScope } = {}) {
  if (!usagePayload?.ok) {
    return `<section class="plb-consume-leaderboard" aria-label="Consumables leaderboard">
      <p class="subtle">${esc(usagePayload?.error || "Consumables usage unavailable for this log.")}</p>
    </section>`;
  }
  const catalog = Array.isArray(usagePayload.catalog) ? usagePayload.catalog : [];
  const ranked = (Array.isArray(usagePayload.players) ? usagePayload.players : [])
    .filter((p) => Number(p.totalUses || 0) > 0)
    .slice(0, Math.max(1, limit));
  const fights = Number(usagePayload.fightsScanned || 0);
  const reports = Number(usagePayload.reportsScanned || 0);
  const eligible = Number(usagePayload.reportsEligible ?? reports);
  const lastRaids = Number(usagePayload.lastRaids || 0);
  const aggregate = usagePayload.mode === "usage-leaderboard" || reports > 0;
  const scopeHint =
    reports === 0 && aggregate
      ? "no logged 25-man raids in Event Management"
      : lastRaids > 0
        ? `last ${Math.min(lastRaids, reports)} of ${eligible} logged 25-man raid(s) · ${fights} boss kill(s)`
        : aggregate
          ? `${reports} logged 25-man raid(s) · ${fights} boss kill(s)`
          : `${fights} boss kill(s) for this log`;
  const title = wclLeaderboardScopeTitle(scope === "last6" || lastRaids > 0 ? "last6" : "all");
  if (!ranked.length) {
    return `<section class="plb-consume-leaderboard" aria-label="Consumables leaderboard">
      <header class="plb-consume-leaderboard-head">
        <h3 class="plb-consume-leaderboard-title">${esc(title)}</h3>
        <p class="subtle plb-consume-leaderboard-hint">No tracked consumable uses across ${scopeHint}.</p>
      </header>
    </section>`;
  }
  const maxTotal = Math.max(...ranked.map((p) => Number(p.totalUses || 0)), 1);
  const rows = ranked
    .map((p, idx) => {
      const rank = idx + 1;
      const total = Number(p.totalUses || 0);
      const rankClass =
        rank === 1 ? " plb-consume-leaderboard-row--gold" : rank === 2 ? " plb-consume-leaderboard-row--silver" : rank === 3 ? " plb-consume-leaderboard-row--bronze" : "";
      const barPct = Math.round((total / maxTotal) * 100);
      const topItems = topConsumableLabelsForPlayer(p.counts, catalog, 5)
        .map((row) => `<span class="plb-consume-leaderboard-chip">${esc(row.label)} <strong>${row.n}</strong></span>`)
        .join("");
      return `<li class="plb-consume-leaderboard-row${rankClass}">
        <span class="plb-consume-leaderboard-rank" aria-label="Rank ${rank}">${rank}</span>
        <div class="plb-consume-leaderboard-main">
          <div class="plb-consume-leaderboard-name-row">
            <span class="plb-consume-leaderboard-name">${esc(p.name || "?")}</span>
            <span class="plb-consume-leaderboard-total" title="Total tracked consumable uses">${total}</span>
          </div>
          <div class="plb-consume-leaderboard-bar" aria-hidden="true"><span style="width:${barPct}%"></span></div>
          <div class="plb-consume-leaderboard-chips">${topItems}</div>
        </div>
      </li>`;
    })
    .join("");
  return `<section class="plb-consume-leaderboard" aria-label="Consumables leaderboard">
    <header class="plb-consume-leaderboard-head">
      <h3 class="plb-consume-leaderboard-title">${esc(title)}</h3>
      <p class="subtle plb-consume-leaderboard-hint">Raiders ranked by total uses (haste/destruction/fel mana potions, scrolls, dark &amp; demonic runes, flame cap) across ${scopeHint}.</p>
    </header>
    <ol class="plb-consume-leaderboard-list">${rows}</ol>
  </section>`;
}

function renderWclConsumablesUsageSection(usagePayload) {
  if (!usagePayload?.ok) {
    return `<section class="plb-consumables-usage"><p class="subtle">${esc(usagePayload?.error || "Usage data unavailable.")}</p></section>`;
  }
  const catalog = Array.isArray(usagePayload.catalog) ? usagePayload.catalog : [];
  const players = Array.isArray(usagePayload.players) ? usagePayload.players : [];
  if (!catalog.length) return "";
  const head = catalog
    .map((c) => {
      const short = WCL_USAGE_COL_SHORT[c.key] || c.name;
      return `<th scope="col" class="is-num" title="${esc(c.name)}">${esc(short)}</th>`;
    })
    .join("");
  const rows = players
    .map((p) => {
      const cells = catalog
        .map((c) => {
          const n = Number(p.counts?.[c.key] || 0);
          return `<td class="is-num${n > 0 ? " plb-consume-usage--used" : ""}">${n > 0 ? n : "—"}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${esc(p.name || "?")}</th>${cells}<td class="is-num plb-consume-usage-total">${Number(p.totalUses || 0)}</td></tr>`;
    })
    .join("");
  const fights = Number(usagePayload.fightsScanned || 0);
  return `<section class="plb-consumables-usage">
    <h3 class="plb-consumables-usage-title">Consumable usage per raider</h3>
    <p class="subtle plb-consumables-usage-hint">Cast counts (potions, runes, scrolls, flame cap) and flask buff applies across ${fights} boss kill(s) in this log. Data from Warcraft Logs events.</p>
    <div class="admin-table-wrap plb-debuff-table-wrap plb-consumables-usage-wrap">
      <table class="admin-table plb-debuff-table plb-consumables-table plb-consumables-usage-table">
        <thead><tr><th scope="col">Raider</th>${head}<th scope="col" class="is-num">Total</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${catalog.length + 2}" class="subtle">No raiders in damage meter.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderWclConsumablesOverview(payload, usagePayload = null) {
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
    <div class="plb-debuff-encounters">${cards}</div>
    ${renderWclConsumablesUsageSection(usagePayload || wclConsumablesUsageCache)}`;
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
    const [payload, usagePayload] = await Promise.all([
      getJson(`${WCL_CONSUMABLES_API}?reportCode=${encodeURIComponent(code)}&overview=1`),
      loadWclConsumablesUsage(code),
    ]);
    if (!payload?.ok) throw new Error(payload?.error || "Overview failed");
    wclConsumablesOverviewCache = payload;
    wclConsumablesOverviewReportCode = code;
    renderWclConsumablesOverview(payload, usagePayload);
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
  if (wclActivePanelTab === "leaderboard") {
    await loadWclConsumablesUsageLeaderboard({ ...opts, refresh: Boolean(opts.refresh) });
    return;
  }
  if (!code) return;
  if (wclActivePanelTab === "consumables") {
    await loadWclConsumablesOverview(code, opts);
    return;
  }
  if (wclActivePanelTab === "gear") {
    await loadWclGearAuditOverview(code, { ...opts, refresh: Boolean(opts.refresh) });
    return;
  }
  await loadWclDebuffOverview(code, { ...opts, refresh: Boolean(opts.refresh) });
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
    if (tab === "leaderboard") {
      wclSetLeaderboardScope(wclLeaderboardScope);
      const scopeKey = wclLeaderboardScope === "last6" ? "last6" : "all";
      const cached = wclConsumablesLeaderboardCacheByScope[scopeKey];
      if (cached?.ok) {
        const host = document.getElementById("wclLeaderboardResultsHost");
        if (host) host.innerHTML = renderWclConsumablesUsageLeaderboard(cached, { scope: scopeKey });
        setWclDebuffStatusLine(wclLeaderboardStatusLine(cached));
      } else {
        loadWclConsumablesUsageLeaderboard({ scope: scopeKey }).catch(() => {});
      }
      return;
    }
    if (tab === "core-parse") {
      loadWclCoreParse({ raid: wclCoreParseRaidFilter }).catch(() => {});
      return;
    }
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

document.getElementById("wclLeaderboardRefreshBtn")?.addEventListener("click", (event) => {
  loadWclConsumablesUsageLeaderboard({ btn: event.currentTarget, refresh: true, scope: wclLeaderboardScope }).catch(
    () => {}
  );
});

document.querySelectorAll("[data-wcl-leaderboard-scope]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const scope = btn.getAttribute("data-wcl-leaderboard-scope") || "all";
    if (scope === wclLeaderboardScope) return;
    wclSetLeaderboardScope(scope);
    const scopeKey = scope === "last6" ? "last6" : "all";
    const cached = wclConsumablesLeaderboardCacheByScope[scopeKey];
    if (cached?.ok) {
      const host = document.getElementById("wclLeaderboardResultsHost");
      if (host) host.innerHTML = renderWclConsumablesUsageLeaderboard(cached, { scope: scopeKey });
      setWclDebuffStatusLine(wclLeaderboardStatusLine(cached));
      return;
    }
    loadWclConsumablesUsageLeaderboard({ scope: scopeKey }).catch(() => {});
  });
});

wclSetLeaderboardScope(wclLeaderboardScope);

document.getElementById("wclDebuffReloadBtn")?.addEventListener("click", (event) => {
  const code = String(document.getElementById("wclDebuffReportSelect")?.value || "").trim();
  loadWclActiveOverview(code, { btn: event.currentTarget, refresh: true }).catch(() => {});
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

document.querySelectorAll("[data-wcl-progress-view-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.getAttribute("data-wcl-progress-view-mode") || "raid";
    wclSetProgressViewMode(mode);
    if (wclProgressCache?.ok) renderWclDebuffProgress(wclProgressCache);
    else loadWclDebuffProgress({ raid: wclProgressRaidFilter }).catch((error) => {
      setWclDebuffStatusLine(error?.message || "Failed to load progress.");
    });
  });
});

wclSetProgressViewMode(wclProgressViewMode);

document.querySelectorAll("[data-wcl-core-parse-raid]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const raid = btn.getAttribute("data-wcl-core-parse-raid") || "all";
    wclSetCoreParseRaidFilter(raid);
    loadWclCoreParse({ raid }).catch(() => {});
  });
});

wclSetCoreParseRaidFilter(wclCoreParseRaidFilter);

document.getElementById("wclCoreParseMemberToggle")?.addEventListener("click", (event) => {
  event.stopPropagation();
  wclSetCoreParseMemberMenuOpen(!wclCoreParseMemberMenuOpen);
});

document.getElementById("wclCoreParseMemberMenu")?.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.getElementById("wclCoreParseMemberList")?.addEventListener("change", (event) => {
  const box = event.target.closest(".plb-core-parse-member-checkbox");
  if (!box) return;
  wclApplyCoreParseMemberSelectionFromDom();
});

document.querySelector("[data-wcl-core-parse-member-all]")?.addEventListener("click", () => {
  wclCoreParseSelectedMembers = null;
  const players = wclCoreParsePlayersFromPayload(wclCoreParseCache);
  wclRenderCoreParseMemberDropdown(players);
  if (wclCoreParseCache?.ok) renderWclCoreParse(wclCoreParseCache);
});

document.querySelector("[data-wcl-core-parse-member-none]")?.addEventListener("click", () => {
  wclCoreParseSelectedMembers = new Set();
  const players = wclCoreParsePlayersFromPayload(wclCoreParseCache);
  wclRenderCoreParseMemberDropdown(players);
  if (wclCoreParseCache?.ok) renderWclCoreParse(wclCoreParseCache);
});

document.addEventListener("click", (event) => {
  if (!wclCoreParseMemberMenuOpen) return;
  const dropdown = document.getElementById("wclCoreParseMemberDropdown");
  if (dropdown?.contains(event.target)) return;
  wclSetCoreParseMemberMenuOpen(false);
});

document.getElementById("wclCoreParseHost")?.addEventListener("click", (event) => {
  if (event.target.closest(".plb-core-parse-report-link")) return;
  const summary = event.target.closest(".plb-core-parse-card-summary");
  if (!summary) return;
  const card = summary.closest("[data-wcl-core-parse-key]");
  const key = card?.getAttribute("data-wcl-core-parse-key");
  if (key) wclToggleCoreParseCardExpanded(key);
});

document.getElementById("wclCoreParseHost")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const summary = event.target.closest(".plb-core-parse-card-summary");
  if (!summary) return;
  event.preventDefault();
  const card = summary.closest("[data-wcl-core-parse-key]");
  const key = card?.getAttribute("data-wcl-core-parse-key");
  if (key) wclToggleCoreParseCardExpanded(key);
});

document.getElementById("wclCoreParseRefreshBtn")?.addEventListener("click", (event) => {
  const btn = event.currentTarget;
  setButtonFeedback(btn, "Refreshing…", "info");
  loadWclCoreParse({ refresh: true, raid: wclCoreParseRaidFilter })
    .catch(() => {})
    .finally(() => resetButtonFeedback(btn, "Refresh parses"));
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
  const raidDrill = event.target.closest("[data-wcl-debuff-raid-drill]");
  if (raidDrill) {
    event.preventDefault();
    event.stopPropagation();
    const drillId = raidDrill.getAttribute("data-wcl-debuff-raid-drill");
    if (drillId) openWclDebuffRaidDebuffDrill(drillId);
    return;
  }
  const drill = event.target.closest("[data-wcl-debuff-boss]");
  if (!drill) return;
  event.preventDefault();
  event.stopPropagation();
  const encounterId = drill.getAttribute("data-wcl-debuff-boss");
  const encounterName = drill.getAttribute("data-wcl-debuff-boss-name") || "";
  if (encounterId) openWclDebuffEncounterDetail(encounterId, encounterName).catch(() => {});
});

document.getElementById("wclDebuffResultsHost")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const raidDrill = event.target.closest("[data-wcl-debuff-raid-drill]");
  if (!raidDrill) return;
  event.preventDefault();
  const drillId = raidDrill.getAttribute("data-wcl-debuff-raid-drill");
  if (drillId) openWclDebuffRaidDebuffDrill(drillId);
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
