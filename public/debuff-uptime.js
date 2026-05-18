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
let allRaidsState = [];
let selectedReportCodesState = new Set();

let wclDebuffOverviewCache = null;
let wclDebuffOverviewReportCode = "";
let wclDebuffSpellMetaById = new Map();

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
  const selected = selectedReportCodesState;
  return allRaidsState.filter((raid) => {
    const code = String(raid?.reportCode || "").trim();
    if (!code) return false;
    if (!selected.size) return true;
    return selected.has(code);
  });
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
    select.innerHTML = `<option value="">No raid reports in the Event Management selection</option>`;
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
      <div class="admin-table-wrap plb-debuff-table-wrap">
        <table class="admin-table plb-debuff-table plb-debuff-matrix">
          <thead><tr><th class="plb-debuff-sticky-col">Debuff</th>${matrixHead}</tr></thead>
          <tbody>${matrixRows}</tbody>
        </table>
      </div>
    </div>
    <div class="plb-debuff-pulls">${detailBlocks}</div>
  `;
  wclDebuffBindSpellTooltips(host);
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

async function initWclDebuffUptimePanel() {
  renderWclDebuffReportSelect();
  const select = document.getElementById("wclDebuffReportSelect");
  const code = String(select?.value || "").trim();
  if (code) {
    try {
      await loadWclDebuffOverview(code, { silent: true });
    } catch {
      /* status set in loader */
    }
  }
}
async function loadRaidLeadEventReports() {
  const payload = await getJson("/api/raid-lead/event-reports");
  allRaidsState = Array.isArray(payload?.allRaids) ? payload.allRaids : [];
  selectedReportCodesState = new Set(
    Array.isArray(payload?.selectedReportCodes) ? payload.selectedReportCodes : []
  );
}

async function bootDebuffUptimePage() {
  try {
    await loadRaidLeadEventReports();
    await initWclDebuffUptimePanel();
  } catch (error) {
    setWclDebuffStatusLine(error?.message || "Failed to load debuff uptime.");
  }
}

document.getElementById("wclDebuffReportSelect")?.addEventListener("change", async (event) => {
  const code = String(event.target?.value || "").trim();
  try {
    await loadWclDebuffOverview(code);
  } catch {
    /* status set in loader */
  }
});

document.getElementById("wclDebuffReloadBtn")?.addEventListener("click", (event) => {
  const code = String(document.getElementById("wclDebuffReportSelect")?.value || "").trim();
  loadWclDebuffOverview(code, { btn: event.currentTarget }).catch(() => {});
});

document.getElementById("wclDebuffResultsHost")?.addEventListener("click", (event) => {
  const drill = event.target.closest(".plb-debuff-encounter-drill");
  if (!drill) return;
  event.preventDefault();
  event.stopPropagation();
  const encounterId = drill.getAttribute("data-wcl-debuff-boss");
  const encounterName = drill.getAttribute("data-wcl-debuff-boss-name") || "";
  if (encounterId) openWclDebuffEncounterDetail(encounterId, encounterName).catch(() => {});
});

bootDebuffUptimePage();
