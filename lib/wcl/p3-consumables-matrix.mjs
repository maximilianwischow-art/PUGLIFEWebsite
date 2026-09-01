import {
  TBC_P3_MARKS_USAGE_KEYS,
  p3MarksUsageConsumableCatalogForApi,
} from "./tbc-usage-consumables.mjs";

export const PHASE_3_RAID_KEYS = Object.freeze(["Hyjal Summit", "Black Temple"]);
const phase3RaidKeySet = new Set(PHASE_3_RAID_KEYS);

export function isPhase3RaidKey(raidKey) {
  return phase3RaidKeySet.has(String(raidKey || "").trim());
}

export function filterCountsToP3Marks(counts) {
  return Object.fromEntries(
    TBC_P3_MARKS_USAGE_KEYS.map((key) => [key, Number(counts?.[key] || 0)])
  );
}

/** Compact per-raider / per-raid cell for Illidari mark decisions. */
export function summarizeP3MarksCell(counts) {
  const filtered = filterCountsToP3Marks(counts);
  const catalog = p3MarksUsageConsumableCatalogForApi();
  const lines = [];
  for (const row of catalog) {
    const count = Number(filtered[row.key] || 0);
    if (count > 0) {
      lines.push({
        key: row.key,
        label: row.shortLabel || row.name,
        name: row.name,
        count,
        kind: row.kind,
      });
    }
  }
  const totalUses = lines.reduce((sum, line) => sum + line.count, 0);
  return { counts: filtered, lines, totalUses };
}

/**
 * Build raiders × raids matrix from per-report usage payloads.
 *
 * @param {Array<{ reportCode: string, raidKey: string, reportTitle?: string | null, reportStartTime?: number, players?: object[] }>} reportParts
 * @param {{ formatRaidLabel?: (part: object) => string }} [options]
 */
export function buildP3ConsumablesMatrixFromReports(reportParts, { formatRaidLabel } = {}) {
  const catalog = p3MarksUsageConsumableCatalogForApi();
  const parts = (Array.isArray(reportParts) ? reportParts : []).filter(
    (part) => part && isPhase3RaidKey(part.raidKey) && String(part.reportCode || "").trim()
  );

  const reports = parts.map((part) => ({
    reportCode: String(part.reportCode || "").trim(),
    raidKey: String(part.raidKey || "").trim(),
    reportTitle: part.reportTitle ? String(part.reportTitle) : null,
    reportStartTime: Number(part.reportStartTime || 0) || null,
    label:
      typeof formatRaidLabel === "function"
        ? formatRaidLabel(part)
        : String(part.reportTitle || part.reportCode || "").trim(),
  }));

  const nameSet = new Set();
  for (const part of parts) {
    for (const player of Array.isArray(part.players) ? part.players : []) {
      const name = String(player?.name || "").trim();
      if (name) nameSet.add(name);
    }
  }

  const matrix = [...nameSet]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      /** @type {Record<string, ReturnType<typeof summarizeP3MarksCell>>} */
      const cells = {};
      let totalUses = 0;
      for (const part of parts) {
        const code = String(part.reportCode || "").trim();
        const player = (Array.isArray(part.players) ? part.players : []).find(
          (row) => String(row?.name || "").trim() === name
        );
        const summary = summarizeP3MarksCell(player?.counts || {});
        cells[code] = summary;
        totalUses += summary.totalUses;
      }
      return { name, cells, totalUses };
    });

  return {
    catalog,
    reports,
    matrix,
    reportsScanned: parts.length,
  };
}
