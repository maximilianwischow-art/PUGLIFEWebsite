/**
 * lib/compute/first-clears.mjs
 *
 * Pure-function extraction of the "first full-clear participants per raid"
 * reducer that previously lived inline in `server.js`. Same algorithm,
 * exposed so both the legacy live endpoint and the Phase 5 `syncBadges` /
 * `syncAttendance` workers call one implementation.
 *
 * Inputs are decoupled from server.js by passing the raid catalog and
 * helper functions as arguments — no circular imports.
 */

/**
 * @typedef {Object} TrackedRaidCatalog
 *  Map of raid display name -> ordered boss name list. A raid counts as
 *  "fully cleared" in one report when every boss in this list shows up
 *  as a `kill` fight.
 *
 * @typedef {Object} FirstClearReport
 *  Subset of the WCL report shape this reducer reads.
 * @property {string} code
 * @property {number} startTime
 * @property {Array<{ name?: string, kill?: boolean, gameZone?: { name?: string } }>} [fights]
 * @property {{ name?: string }} [zone]
 * @property {Array<{ name?: string }>} [rankedCharacters]
 *
 * @typedef {{
 *   reportCode: string,
 *   startTime: number,
 *   participants: string[],
 * } | null} FirstClearEntry
 */

/**
 * @param {FirstClearReport[]} reports
 * @param {Object} options
 * @param {TrackedRaidCatalog} options.trackedRaids
 * @param {(fight: any, report: any) => string | null} options.resolveRaidForFight
 * @param {(raw: any) => number} options.getStartTimeMs
 * @param {string[]} [options.raidNames] Restrict the result to these raid keys.
 * @returns {Record<string, FirstClearEntry>}
 */
export function firstClearParticipantsByRaidFromReports(reports, options) {
  if (!options || typeof options !== "object") {
    throw new Error("firstClearParticipantsByRaidFromReports: options is required");
  }
  const { trackedRaids, resolveRaidForFight, getStartTimeMs } = options;
  if (!trackedRaids || typeof trackedRaids !== "object") {
    throw new Error("firstClearParticipantsByRaidFromReports: trackedRaids required");
  }
  if (typeof resolveRaidForFight !== "function") {
    throw new Error("firstClearParticipantsByRaidFromReports: resolveRaidForFight required");
  }
  if (typeof getStartTimeMs !== "function") {
    throw new Error("firstClearParticipantsByRaidFromReports: getStartTimeMs required");
  }

  const targets = Array.isArray(options.raidNames) && options.raidNames.length
    ? options.raidNames
    : Object.keys(trackedRaids);
  const targetSet = new Set(targets.filter((r) => Object.prototype.hasOwnProperty.call(trackedRaids, r)));

  /** @type {Record<string, FirstClearEntry>} */
  const out = {};
  for (const raidName of targetSet) out[raidName] = null;
  const remaining = () => Object.values(out).some((v) => !v);

  const rows = [...(reports || [])].sort(
    (a, b) => getStartTimeMs(a?.startTime) - getStartTimeMs(b?.startTime)
  );
  for (const report of rows) {
    if (!remaining()) break;
    const fights = Array.isArray(report?.fights) ? report.fights : [];
    if (!fights.length) continue;
    for (const raidName of targetSet) {
      if (out[raidName]) continue;
      const raidFights = fights.filter((fight) => resolveRaidForFight(fight, report) === raidName);
      if (!raidFights.length) continue;
      const bosses = trackedRaids[raidName] || [];
      const kills = new Set(
        raidFights
          .filter((fight) => Boolean(fight?.kill))
          .map((fight) => String(fight?.name || "").trim())
          .filter(Boolean)
      );
      const isFullClear = bosses.length > 0 && bosses.every((boss) => kills.has(String(boss || "").trim()));
      if (!isFullClear) continue;
      const participants = Array.isArray(report?.rankedCharacters)
        ? report.rankedCharacters
            .map((c) => String(c?.name || "").trim())
            .filter(Boolean)
        : [];
      out[raidName] = {
        reportCode: String(report?.code || ""),
        startTime: Number(report?.startTime || 0),
        participants,
      };
    }
  }
  return out;
}
