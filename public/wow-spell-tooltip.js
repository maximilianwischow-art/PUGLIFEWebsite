/**
 * Shared WoW spell hover tooltip (Loot History / item tooltip parity).
 * Load before callers; bind with `WowSpellTooltip.bindSpellTooltipHandlers`.
 *
 * Trigger: `data-wow-spell-id="<spellId>"`
 * Metadata: `GET /api/wow-classic/spells` (`tooltipHtml`, `icon`, `name`, …)
 */
(function (global) {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tooltipText(meta) {
    const lines = [];
    if (meta?.name) lines.push(meta.name);
    if (meta?.appliedBy) lines.push(`Applied by: ${meta.appliedBy}`);
    if (meta?.description) lines.push(meta.description);
    const extra = Array.isArray(meta?.tooltip) ? meta.tooltip : [];
    for (const line of extra) {
      if (line && !lines.includes(line)) lines.push(line);
    }
    return lines.filter(Boolean).join("\n");
  }

  function buildFallbackTooltipHtml(meta) {
    const name = escapeHtml(meta?.name || "Unknown spell");
    const lines = [];
    if (meta?.appliedBy) lines.push(`Applied by: ${escapeHtml(meta.appliedBy)}`);
    if (meta?.description) lines.push(escapeHtml(meta.description));
    const extra = (Array.isArray(meta?.tooltip) ? meta.tooltip : []).map((line) => escapeHtml(line));
    lines.push(...extra.filter(Boolean));
    const body = lines.length
      ? lines.map((line) => `<div class="loot-tooltip-line">${line}</div>`).join("")
      : `<div class="loot-tooltip-line">${escapeHtml("No spell tooltip available.")}</div>`;
    const head = meta?.icon
      ? `<div class="vortex-tooltip-head"><img class="vortex-tooltip-icon" src="${escapeHtml(
          meta.icon
        )}" alt="" /><span class="vortex-tooltip-title">${name}</span></div>`
      : `<div class="vortex-tooltip-head"><span class="vortex-tooltip-title">${name}</span></div>`;
    return `${head}${body}`;
  }

  let spellTooltipEl = null;

  function ensureSpellTooltipEl() {
    if (spellTooltipEl) return spellTooltipEl;
    spellTooltipEl = document.createElement("div");
    spellTooltipEl.className = "loot-tooltip-panel";
    spellTooltipEl.hidden = true;
    document.body.appendChild(spellTooltipEl);
    return spellTooltipEl;
  }

  function positionSpellTooltip(event) {
    if (!spellTooltipEl || spellTooltipEl.hidden) return;
    const pad = 14;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = spellTooltipEl.getBoundingClientRect();
    let x = event.clientX + 14;
    let y = event.clientY + 16;
    if (x + rect.width + pad > vw) x = Math.max(pad, event.clientX - rect.width - 18);
    if (y + rect.height + pad > vh) y = Math.max(pad, event.clientY - rect.height - 18);
    spellTooltipEl.style.left = `${x}px`;
    spellTooltipEl.style.top = `${y}px`;
  }

  function showSpellTooltip(event, spellId, getSpellMeta) {
    const panel = ensureSpellTooltipEl();
    const meta = typeof getSpellMeta === "function" ? getSpellMeta(Number(spellId)) : null;
    const html = meta?.tooltipHtml
      ? `<div class="loot-tooltip-wowhead">${meta.tooltipHtml}</div>`
      : buildFallbackTooltipHtml(meta);
    panel.innerHTML = html;
    panel.hidden = false;
    positionSpellTooltip(event);
  }

  function hideSpellTooltip() {
    if (!spellTooltipEl) return;
    spellTooltipEl.hidden = true;
  }

  function bindSpellTooltipHandlers(root, getSpellMeta) {
    if (typeof getSpellMeta !== "function") {
      throw new Error("WowSpellTooltip.bindSpellTooltipHandlers(root, getSpellMeta): getSpellMeta is required");
    }
    const scope = root && root.querySelectorAll ? root : document;
    const triggers = scope.querySelectorAll("[data-wow-spell-id]");
    triggers.forEach((el) => {
      if (el.dataset.wowSpellTooltipBound === "1") return;
      el.dataset.wowSpellTooltipBound = "1";
      el.addEventListener("mouseenter", (event) => {
        const spellId = Number(el.getAttribute("data-wow-spell-id") || 0);
        showSpellTooltip(event, spellId, getSpellMeta);
      });
      el.addEventListener("mousemove", (event) => positionSpellTooltip(event));
      el.addEventListener("mouseleave", () => hideSpellTooltip());
    });
  }

  global.WowSpellTooltip = {
    escapeHtml,
    tooltipText,
    bindSpellTooltipHandlers,
    hideSpellTooltip,
    showSpellTooltip,
    positionSpellTooltip,
  };
})(typeof window !== "undefined" ? window : globalThis);
