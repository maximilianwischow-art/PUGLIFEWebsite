/** WCL public report codes are alphanumeric (~16 chars). Skip Gargul import placeholders. */
export function isFetchableWclReportCode(reportCode) {
  const code = String(reportCode || "").trim();
  if (!code || code.startsWith("gargul-")) return false;
  return /^[a-zA-Z0-9]{10,24}$/.test(code);
}

/**
 * Resolve 25-man WCL report codes for the consumables leaderboard.
 * When Event Management has a selection, those fetchable codes are used directly
 * (they do not need to appear in materialised `allRaids`). Kara/ZA rows are
 * dropped when raid metadata is available.
 *
 * @param {{ allRaids?: object[], selectedReportCodes?: string[] }} eventPayload
 * @param {{ isTenPlayerRow?: (row: object | null | undefined) => boolean, maxReports?: number }} [options]
 */
export function leaderboardReportRowsFromEventPayload(
  eventPayload,
  { isTenPlayerRow = () => false, maxReports = 0 } = {}
) {
  const selectedReportCodes = Array.from(
    new Set(
      (Array.isArray(eventPayload?.selectedReportCodes) ? eventPayload.selectedReportCodes : [])
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );
  const allRaids = Array.isArray(eventPayload?.allRaids) ? eventPayload.allRaids : [];
  /** @type {Map<string, object>} */
  const raidByCode = new Map();
  for (const raid of allRaids) {
    const code = String(raid?.reportCode || "").trim();
    if (code) raidByCode.set(code, raid);
  }

  const sourceCodes = selectedReportCodes.length
    ? selectedReportCodes
    : allRaids.map((raid) => String(raid?.reportCode || "").trim()).filter(Boolean);

  /** @type {Map<string, { reportCode: string, reportTitle: string | null, reportStartTime: number }>} */
  const byCode = new Map();
  for (const raw of sourceCodes) {
    const code = String(raw || "").trim();
    if (!isFetchableWclReportCode(code)) continue;
    const raid = raidByCode.get(code);
    if (raid && isTenPlayerRow(raid)) continue;
    const start = Number(raid?.reportStartTime || 0);
    const prev = byCode.get(code);
    if (!prev || start > Number(prev.reportStartTime || 0)) {
      byCode.set(code, {
        reportCode: code,
        reportTitle: raid?.reportTitle ? String(raid.reportTitle) : null,
        reportStartTime: start,
      });
    }
  }

  const rows = [...byCode.values()].sort(
    (a, b) => Number(b.reportStartTime || 0) - Number(a.reportStartTime || 0)
  );
  const limit = Math.floor(Number(maxReports || 0));
  if (limit > 0) return rows.slice(0, limit);
  return rows;
}
