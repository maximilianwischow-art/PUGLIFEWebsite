const SSC_RAID = "Serpentshrine Cavern";
const TK_RAID = "Tempest Keep";

/**
 * Pair SSC full clears with TK full clears on the same calendar evening (SSC before TK).
 * @param {Array<{ raidName?: string, isFullClear?: boolean, calendarDay?: string, reportCode?: string, startTime?: number, clearDurationMs?: number, title?: string, wclUrl?: string }>} calendarEntries
 */
export function t5OneNightSessionsFromCalendarEntries(calendarEntries) {
  /** @type {Map<string, { ssc: object[], tk: object[] }>} */
  const byDay = new Map();
  for (const entry of Array.isArray(calendarEntries) ? calendarEntries : []) {
    if (!entry?.isFullClear || !entry?.calendarDay) continue;
    const raid = String(entry.raidName || "").trim();
    if (raid !== SSC_RAID && raid !== TK_RAID) continue;
    const day = String(entry.calendarDay);
    if (!byDay.has(day)) byDay.set(day, { ssc: [], tk: [] });
    const row = byDay.get(day);
    if (raid === SSC_RAID) row.ssc.push(entry);
    else row.tk.push(entry);
  }

  /** @type {Array<object>} */
  const sessions = [];
  for (const [calendarDay, { ssc, tk }] of byDay) {
    if (!ssc.length || !tk.length) continue;
    const sscSorted = [...ssc].sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0));
    const tkSorted = [...tk].sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0));

    let bestPair = null;
    for (const sscEntry of sscSorted) {
      const sscStart = Number(sscEntry.startTime || 0);
      const sscDur = Number(sscEntry.clearDurationMs || 0);
      if (!sscStart || !sscDur) continue;
      for (const tkEntry of tkSorted) {
        const tkStart = Number(tkEntry.startTime || 0);
        const tkDur = Number(tkEntry.clearDurationMs || 0);
        if (!tkStart || !tkDur) continue;
        if (tkStart < sscStart) continue;
        const totalClearMs = sscDur + tkDur;
        if (!bestPair || totalClearMs < bestPair.totalClearMs) {
          bestPair = { sscEntry, tkEntry, totalClearMs };
        }
      }
    }
    if (!bestPair) continue;

    const { sscEntry, tkEntry, totalClearMs } = bestPair;
    sessions.push({
      calendarDay,
      startTime: Number(sscEntry.startTime || 0),
      totalClearMs,
      ssc: {
        reportCode: String(sscEntry.reportCode || "").trim(),
        title: String(sscEntry.title || "").trim(),
        wclUrl: sscEntry.wclUrl || null,
        clearDurationMs: Number(sscEntry.clearDurationMs || 0),
        startTime: Number(sscEntry.startTime || 0),
      },
      tk: {
        reportCode: String(tkEntry.reportCode || "").trim(),
        title: String(tkEntry.title || "").trim(),
        wclUrl: tkEntry.wclUrl || null,
        clearDurationMs: Number(tkEntry.clearDurationMs || 0),
        startTime: Number(tkEntry.startTime || 0),
      },
    });
  }

  sessions.sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));
  return sessions;
}

/** Aggregate stats for the Phase 2 overview card. */
export function t5OneNightOverviewFromSessions(sessions) {
  const rows = Array.isArray(sessions) ? sessions : [];
  if (!rows.length) return null;
  const best = rows.reduce((a, b) =>
    Number(a.totalClearMs) < Number(b.totalClearMs) ? a : b
  );
  const latest = rows[0];
  return {
    totalClears: rows.length,
    bestTimeMs: Number(best.totalClearMs || 0),
    bestSession: best,
    lastClearMs: Number(latest.startTime || 0) || null,
    sessions: rows,
  };
}
