/**
 * Compact enchant + gem summary HTML for roster / composer cards.
 * Gems: colored counts only (epic purple, rare blue, uncommon green). Missing sockets in red.
 */
(function () {
  function buildGearAuditSummaryTitle(summary) {
    if (!summary || typeof summary !== "object") return "No Classic Armory gear data yet";
    const missingEnc = Number(summary.missingEnchants) || 0;
    const emptySock = Number(summary.emptySockets) || 0;
    const epic = Number(summary.gems?.epic) || 0;
    const rare = Number(summary.gems?.rare) || 0;
    const uncommon = Number(summary.gems?.uncommon) || 0;
    const unknown = Number(summary.gems?.unknown) || 0;
    return [
      missingEnc > 0 ? `${missingEnc} missing permanent enchant(s)` : "All required enchants present",
      emptySock > 0 ? `${emptySock} empty gem socket(s)` : "No empty gem sockets",
      epic || rare || uncommon || unknown
        ? `Gems equipped: ${[
            epic ? `${epic} epic` : "",
            rare ? `${rare} rare` : "",
            uncommon ? `${uncommon} uncommon` : "",
            unknown ? `${unknown} other` : "",
          ]
            .filter(Boolean)
            .join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function gemSpan(esc, cls, count, title) {
    const n = Number(count) || 0;
    if (!n) return "";
    return `<span class="gear-audit-gem gear-audit-gem--${cls}" title="${esc(title)}">${esc(String(n))}</span>`;
  }

  function buildGearAuditSummaryHtml(summary, esc) {
    const e = typeof esc === "function" ? esc : (s) => String(s ?? "");
    if (!summary || typeof summary !== "object") {
      return `<span class="gear-audit-compact gear-audit-compact--empty" title="${e(buildGearAuditSummaryTitle(summary))}">—</span>`;
    }

    const missingEnc = Number(summary.missingEnchants) || 0;
    const emptySock = Number(summary.emptySockets) || 0;
    const epic = Number(summary.gems?.epic) || 0;
    const rare = Number(summary.gems?.rare) || 0;
    const uncommon = Number(summary.gems?.uncommon) || 0;
    const unknown = Number(summary.gems?.unknown) || 0;
    const title = buildGearAuditSummaryTitle(summary);

    const encHtml =
      missingEnc > 0
        ? `<span class="gear-audit-enc gear-audit-enc--miss" title="${e(`${missingEnc} missing enchant${missingEnc === 1 ? "" : "s"}`)}">${e(String(missingEnc))}</span>`
        : `<span class="gear-audit-enc gear-audit-enc--ok" title="${e("All required enchants present")}">Enc</span>`;

    const gemBits = [
      emptySock > 0
        ? gemSpan(
            e,
            "missing",
            emptySock,
            `${emptySock} empty gem socket${emptySock === 1 ? "" : "s"}`
          )
        : "",
      gemSpan(e, "epic", epic, `${epic} epic gem${epic === 1 ? "" : "s"}`),
      gemSpan(e, "rare", rare, `${rare} rare gem${rare === 1 ? "" : "s"}`),
      gemSpan(e, "uncommon", uncommon, `${uncommon} uncommon gem${uncommon === 1 ? "" : "s"}`),
      gemSpan(e, "unknown", unknown, `${unknown} gem${unknown === 1 ? "" : "s"} of unknown quality`),
    ].filter(Boolean);

    const gemsHtml = gemBits.length
      ? `<span class="gear-audit-gems">${gemBits.join("")}</span>`
      : `<span class="gear-audit-gems gear-audit-gems--ok" title="${e("No empty gem sockets")}">✓</span>`;

    return `<span class="gear-audit-compact" title="${e(title)}">${encHtml}<span class="gear-audit-sep" aria-hidden="true">·</span>${gemsHtml}</span>`;
  }

  window.plbGearAuditDisplay = {
    buildGearAuditSummaryHtml,
    buildGearAuditSummaryTitle,
  };
})();
