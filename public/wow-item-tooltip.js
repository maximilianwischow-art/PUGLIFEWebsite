/**
 * Shared WoW item hover tooltip (Loot History parity).
 * Load before any page script that calls `WowItemTooltip.bindLootTooltipHandlers`.
 *
 * Trigger markup: elements with `data-loot-item-id="<numeric id>"` (see `public/styles.css` `.loot-tooltip-*`).
 * Metadata: rows from `GET /api/wow-classic/items` (`tooltipHtml`, `tooltip`, `icon`, `name`, …).
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
    const lines = Array.isArray(meta?.tooltip) ? meta.tooltip : [];
    return lines.filter(Boolean).join("\n");
  }

  let lootTooltipEl = null;

  function ensureLootTooltipEl() {
    if (lootTooltipEl) return lootTooltipEl;
    lootTooltipEl = document.createElement("div");
    lootTooltipEl.className = "loot-tooltip-panel";
    lootTooltipEl.hidden = true;
    document.body.appendChild(lootTooltipEl);
    return lootTooltipEl;
  }

  function positionLootTooltip(event) {
    if (!lootTooltipEl || lootTooltipEl.hidden) return;
    const pad = 14;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = lootTooltipEl.getBoundingClientRect();
    let x = event.clientX + 14;
    let y = event.clientY + 16;
    if (x + rect.width + pad > vw) x = Math.max(pad, event.clientX - rect.width - 18);
    if (y + rect.height + pad > vh) y = Math.max(pad, event.clientY - rect.height - 18);
    lootTooltipEl.style.left = `${x}px`;
    lootTooltipEl.style.top = `${y}px`;
  }

  function showLootTooltip(event, itemId, getItemMeta) {
    const panel = ensureLootTooltipEl();
    const meta = typeof getItemMeta === "function" ? getItemMeta(Number(itemId)) : null;
    const fallback = `<div class="loot-tooltip-line">${escapeHtml("No item tooltip available.")}</div>`;
    const html = meta?.tooltipHtml
      ? `<div class="loot-tooltip-wowhead">${meta.tooltipHtml}</div>`
      : (Array.isArray(meta?.tooltip) ? meta.tooltip : [])
          .map((line) => `<div class="loot-tooltip-line">${escapeHtml(line)}</div>`)
          .join("") || fallback;
    panel.innerHTML = html;
    panel.hidden = false;
    positionLootTooltip(event);
  }

  function hideLootTooltip() {
    if (!lootTooltipEl) return;
    lootTooltipEl.hidden = true;
  }

  /**
   * @param {ParentNode | Document | null | undefined} root - Search within this node; omit or use `document` for full page.
   * @param {(itemId: number) => object | undefined | null} getItemMeta - Resolve metadata for numeric item id (e.g. `id => map.get(id)`).
   */
  function bindLootTooltipHandlers(root, getItemMeta) {
    if (typeof getItemMeta !== "function") {
      throw new Error("WowItemTooltip.bindLootTooltipHandlers(root, getItemMeta): getItemMeta is required");
    }
    const scope = root && root.querySelectorAll ? root : document;
    const triggers = scope.querySelectorAll("[data-loot-item-id]");
    triggers.forEach((el) => {
      el.addEventListener("mouseenter", (event) => {
        const itemId = Number(el.getAttribute("data-loot-item-id") || 0);
        showLootTooltip(event, itemId, getItemMeta);
      });
      el.addEventListener("mousemove", (event) => positionLootTooltip(event));
      el.addEventListener("mouseleave", () => hideLootTooltip());
    });
  }

  global.WowItemTooltip = {
    escapeHtml,
    tooltipText,
    bindLootTooltipHandlers,
    hideLootTooltip,
    showLootTooltip,
    positionLootTooltip,
  };
})(typeof window !== "undefined" ? window : globalThis);
