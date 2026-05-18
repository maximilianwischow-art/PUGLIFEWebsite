/**
 * Wowhead spell hover tooltips (TBC). Load before callers; use `ensureAndRefresh` after dynamic HTML.
 */
(function (global) {
  "use strict";

  const WH_DOMAIN = "tbc";
  let loadPromise = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadWowheadPower() {
    if (loadPromise) return loadPromise;
    if (global.$WowheadPower) {
      loadPromise = Promise.resolve();
      return loadPromise;
    }
    loadPromise = new Promise((resolve, reject) => {
      if (!document.getElementById("wowhead-power-config")) {
        const cfg = document.createElement("script");
        cfg.id = "wowhead-power-config";
        cfg.textContent =
          "const whTooltips = { colorLinks: true, iconizeLinks: true, renameLinks: true };";
        document.head.appendChild(cfg);
      }
      const s = document.createElement("script");
      s.src = "https://wow.zamimg.com/widgets/power.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Wowhead tooltips failed to load"));
      document.head.appendChild(s);
    });
    return loadPromise;
  }

  function wowheadSpellDataAttr(spellId) {
    const id = Math.floor(Number(spellId));
    if (!id) return "";
    return `spell=${id}&domain=${WH_DOMAIN}`;
  }

  function wowheadSpellUrl(spellId, name) {
    const id = Math.floor(Number(spellId));
    if (!id) return "#";
    const slug = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `https://www.wowhead.com/${WH_DOMAIN}/spell=${id}${slug ? `/${slug}` : ""}`;
  }

  function spellLinkHtml(spellId, label, opts = {}) {
    const id = Math.floor(Number(spellId));
    const text = String(label || "").trim() || (id ? `Spell ${id}` : "");
    if (!id) return escapeHtml(text);
    const cls = opts.className ? ` class="${escapeHtml(opts.className)}"` : "";
    const data = wowheadSpellDataAttr(id);
    return `<a href="${escapeHtml(wowheadSpellUrl(id, text))}" data-wowhead="${escapeHtml(
      data
    )}"${cls}>${escapeHtml(text)}</a>`;
  }

  function refreshWowheadTooltips(root) {
    if (global.$WowheadPower && typeof global.$WowheadPower.refreshLinks === "function") {
      global.$WowheadPower.refreshLinks(root || document);
    }
  }

  async function ensureAndRefresh(root) {
    try {
      await loadWowheadPower();
      refreshWowheadTooltips(root);
    } catch {
      /* tooltips optional */
    }
  }

  global.WowSpellTooltip = {
    loadWowheadPower,
    spellLinkHtml,
    wowheadSpellDataAttr,
    wowheadSpellUrl,
    refreshWowheadTooltips,
    ensureAndRefresh,
  };
})(window);
