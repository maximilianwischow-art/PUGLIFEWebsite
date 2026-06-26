/** Boss lists aligned with server `TRACKED_RAIDS` (TBC progression). */
export const TRACKED_RAIDS = {
  Karazhan: [
    "Attumen the Huntsman",
    "Moroes",
    "Maiden of Virtue",
    "Opera Hall",
    "The Curator",
    "Terestian Illhoof",
    "Shade of Aran",
    "Netherspite",
    "Chess Event",
    "Prince Malchezaar",
    "Nightbane",
  ],
  "Gruul's Lair": ["High King Maulgar", "Gruul the Dragonkiller"],
  "Magtheridon's Lair": ["Magtheridon"],
  "Serpentshrine Cavern": [
    "Hydross the Unstable",
    "The Lurker Below",
    "Leotheras the Blind",
    "Fathom-Lord Karathress",
    "Morogrim Tidewalker",
    "Lady Vashj",
  ],
  "Tempest Keep": ["Al'ar", "Void Reaver", "High Astromancer Solarian", "Kael'thas Sunstrider"],
};

function normalizeWclLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u2019|\u2018/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function bossListMatchesFightName(bossNames, fightName) {
  const fn = normalizeWclLabel(fightName);
  return bossNames.some((b) => normalizeWclLabel(b) === fn);
}

export function resolveBossCanonicalName(bossNames, fightName) {
  const fn = normalizeWclLabel(fightName);
  const match = bossNames.find((b) => normalizeWclLabel(b) === fn);
  return match || fightName;
}

/** True when a WCL zone label refers to more than one tracked raid tier. */
export function isAmbiguousCombinedRaidZone(zoneRaw) {
  const z = normalizeWclLabel(zoneRaw);
  if (!z) return false;
  const hasSsc = z.includes("serpentshrine") || /\bssc\b/.test(z);
  const hasTk = z.includes("tempest") || z.includes("the eye") || /\btk\b/.test(z);
  if (hasSsc && hasTk) return true;
  const hasGruul = z.includes("gruul");
  const hasMag = z.includes("magtheridon") || (/\bmag\b/.test(z) && !z.includes("magtheridon"));
  if (hasGruul && hasMag) return true;
  return false;
}

/** Map a WCL zone label to a TRACKED_RAIDS key, or null if not tracked / ambiguous. */
export function resolveTrackedRaidZoneName(zoneRaw) {
  const z = normalizeWclLabel(zoneRaw).replace(/\s+/g, " ").trim();
  if (!z) return null;
  if (isAmbiguousCombinedRaidZone(zoneRaw)) return null;
  for (const key of Object.keys(TRACKED_RAIDS)) {
    if (normalizeWclLabel(key) === z) return key;
  }
  if (z.includes("karazhan") || /\bkara\b/.test(z)) return "Karazhan";
  if (z.includes("gruul") && z.includes("lair")) return "Gruul's Lair";
  if (z.includes("magtheridon")) return "Magtheridon's Lair";
  if (z.includes("serpentshrine") || /\bssc\b/.test(z)) return "Serpentshrine Cavern";
  if (z.includes("tempest") || z.includes("the eye") || z === "tk") return "Tempest Keep";
  return null;
}

/** Resolve tracked raid from boss name when zone metadata is missing or ambiguous. */
export function resolveTrackedRaidFromBossName(fightName) {
  const fn = normalizeWclLabel(fightName);
  if (!fn) return null;
  for (const [raidName, bosses] of Object.entries(TRACKED_RAIDS)) {
    if (bosses.some((b) => normalizeWclLabel(b) === fn)) return raidName;
  }
  return null;
}

/** Which tracked raid tier a boss fight belongs to (handles combined SSC/TK logs). */
export function resolvedTrackedRaidForFight(fight, report) {
  const fromFightZone = resolveTrackedRaidZoneName(fight?.gameZone?.name);
  if (fromFightZone) return fromFightZone;
  const fromBoss = resolveTrackedRaidFromBossName(fight?.name);
  if (fromBoss) return fromBoss;
  const fromReportZone = resolveTrackedRaidZoneName(report?.zone?.name);
  if (fromReportZone) return fromReportZone;
  return null;
}

function normalizeUploader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function choosePrimaryReport(reportMap, killRecords, { priorityList, selectedRankByCode, reportStartTimeMs }) {
  const scores = [...reportMap.values()].map((report) => {
    const code = String(report.code || "");
    const rank = selectedRankByCode?.get(code) ?? Number.POSITIVE_INFINITY;
    const killCount = killRecords.filter((k) => k.report === report).length;
    const uploadedBy = report.owner?.name || "";
    const pIdx = priorityList.findIndex((p) => p === normalizeUploader(uploadedBy));
    return {
      report,
      rank,
      killCount,
      pIdx: pIdx === -1 ? priorityList.length : pIdx,
      startTime: reportStartTimeMs(report.startTime),
    };
  });
  scores.sort((a, b) => {
    if (a.killCount !== b.killCount) return b.killCount - a.killCount;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.pIdx !== b.pIdx) return a.pIdx - b.pIdx;
    return b.startTime - a.startTime;
  });
  return scores[0]?.report || null;
}

/**
 * Build raid calendar rows, merging boss kills across multiple WCL reports on the
 * same calendar day and raid tier (e.g. split SSC / TK uploads or a missing boss in one log).
 */
export function buildMergedRaidCalendarEntries(reports, options = {}) {
  const trackedRaids = options.trackedRaids || TRACKED_RAIDS;
  const reportStartTimeMs =
    typeof options.reportStartTimeMs === "function"
      ? options.reportStartTimeMs
      : (raw) => {
          const n = Number(raw || 0);
          if (!Number.isFinite(n) || n <= 0) return 0;
          if (n < 100_000_000_000) return Math.round(n * 1000);
          return n;
        };
  const dayKeyFn =
    typeof options.dayKeyFn === "function"
      ? options.dayKeyFn
      : (ms) => {
          if (!ms) return "";
          return new Date(ms).toISOString().slice(0, 10);
        };
  const priorityList = Array.isArray(options.priorityUploaders) ? options.priorityUploaders : [];
  const selectedRankByCode =
    options.selectedRankByCode instanceof Map ? options.selectedRankByCode : null;
  const wclUrlForCode =
    typeof options.wclUrlForCode === "function"
      ? options.wclUrlForCode
      : (code) => `https://fresh.warcraftlogs.com/reports/${code}`;
  const imageForRaid =
    typeof options.imageForRaid === "function" ? options.imageForRaid : () => null;

  /** @type {Map<string, { raidName: string, dayKey: string, kills: Map<string, { fight: object, report: object }>, reports: Map<string, object> }>} */
  const groups = new Map();

  for (const report of Array.isArray(reports) ? reports : []) {
    const dayKey = dayKeyFn(reportStartTimeMs(report.startTime));
    if (!dayKey) continue;
    for (const fight of report.fights || []) {
      if (Number(fight?.encounterID || 0) <= 0 || !fight?.kill) continue;
      const raidName = resolvedTrackedRaidForFight(fight, report);
      if (!raidName || !trackedRaids[raidName]) continue;
      const bosses = trackedRaids[raidName];
      if (!bossListMatchesFightName(bosses, fight.name)) continue;
      const canonical = resolveBossCanonicalName(bosses, fight.name);
      const k = `${dayKey}::${raidName}`;
      if (!groups.has(k)) {
        groups.set(k, { raidName, dayKey, kills: new Map(), reports: new Map() });
      }
      const g = groups.get(k);
      const code = String(report.code || "").trim();
      if (code) g.reports.set(code, report);
      const prev = g.kills.get(canonical);
      if (!prev) {
        g.kills.set(canonical, { fight, report });
        continue;
      }
      const durPrev = Number(prev.fight.endTime || 0) - Number(prev.fight.startTime || 0);
      const durNew = Number(fight.endTime || 0) - Number(fight.startTime || 0);
      if (Number.isFinite(durNew) && durNew > 0 && (!Number.isFinite(durPrev) || durPrev <= 0 || durNew < durPrev)) {
        g.kills.set(canonical, { fight, report });
      }
    }
  }

  const entries = [];
  for (const g of groups.values()) {
    const { raidName, dayKey, kills, reports: reportMap } = g;
    const bosses = trackedRaids[raidName];
    const bossesTotal = bosses.length;
    const bossesKilled = kills.size;
    const killRecords = [...kills.values()];
    const primary = choosePrimaryReport(reportMap, killRecords, {
      priorityList,
      selectedRankByCode,
      reportStartTimeMs,
    });
    if (!primary) continue;

    let clearDurationMs = null;
    let isFullClear = false;
    if (bossesKilled === bossesTotal && killRecords.length) {
      const clearStart = Math.min(...killRecords.map(({ fight }) => Number(fight.startTime || 0)));
      const clearEnd = Math.max(...killRecords.map(({ fight }) => Number(fight.endTime || 0)));
      const clearMs = clearEnd - clearStart;
      if (Number.isFinite(clearMs) && clearMs > 0) {
        clearDurationMs = clearMs;
        isFullClear = true;
      }
    }

    const reportCodes = [...reportMap.keys()];
    entries.push({
      reportCode: primary.code,
      reportCodes,
      mergedFromMultipleReports: reportCodes.length > 1,
      title: primary.title || primary.code,
      startTime: reportStartTimeMs(primary.startTime),
      uploadedBy: primary.owner?.name || null,
      raidName,
      clearDurationMs,
      isFullClear,
      bossesKilled,
      bossesTotal,
      wclUrl: wclUrlForCode(String(primary.code || "")),
      image: imageForRaid(raidName),
      calendarDay: dayKey,
    });
  }

  entries.sort((a, b) => b.startTime - a.startTime);
  return entries;
}
