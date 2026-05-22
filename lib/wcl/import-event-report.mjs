/** @typedef {(query: string, variables?: Record<string, unknown>) => Promise<unknown>} WclQueryFn */

export const EVENT_REPORT_META_QUERY = `
  query EventReportMeta($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
        owner { name }
        rankedCharacters { name }
        fights {
          id
          encounterID
          gameZone { name }
        }
      }
    }
  }
`;

export function reportStartTimeMs(raw) {
  const n = Number(raw || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 100_000_000_000) return Math.round(n * 1000);
  return n;
}

/**
 * Fetch WCL metadata for a single report code (URL slug).
 *
 * @param {{ reportCode: string, queryWcl: WclQueryFn }}
 */
export async function fetchEventReportMetaFromWcl({ reportCode, queryWcl }) {
  const code = String(reportCode || "").trim();
  if (!code) throw new Error("Report code is required");

  const data = await queryWcl(EVENT_REPORT_META_QUERY, { code });
  const report = data?.reportData?.report;
  if (!report) {
    throw new Error(`Warcraft Logs report not found: ${code}`);
  }

  const rankedNames = (report.rankedCharacters || [])
    .map((c) => String(c?.name || "").trim())
    .filter(Boolean);

  if (!rankedNames.length) {
    throw new Error("Report has no ranked roster — cannot import");
  }

  const startedAtMs = reportStartTimeMs(report.startTime) || null;
  const appearanceEntries = rankedNames.map((characterName) => ({
    characterName,
    reportCode: code,
    reportStartedAt: startedAtMs,
  }));

  return {
    reportCode: code,
    report,
    title: String(report.title || "").trim() || null,
    startTimeMs: startedAtMs,
    reportUploader: report.owner?.name ? String(report.owner.name) : null,
    rankedCount: rankedNames.length,
    appearanceEntries,
  };
}
