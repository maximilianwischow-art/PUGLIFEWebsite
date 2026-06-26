import {
  t5OneNightOverviewFromSessions,
  t5OneNightSessionsFromCalendarEntries,
} from "../lib/compute/t5-one-night-sessions.mjs";

const entries = [
  {
    raidName: "Serpentshrine Cavern",
    isFullClear: true,
    calendarDay: "2026-06-18",
    reportCode: "sscA",
    startTime: 3_000_000,
    clearDurationMs: 68 * 60 * 1000,
    wclUrl: "https://fresh.warcraftlogs.com/reports/sscA",
  },
  {
    raidName: "Tempest Keep",
    isFullClear: true,
    calendarDay: "2026-06-18",
    reportCode: "tkA",
    startTime: 3_100_000,
    clearDurationMs: 60 * 60 * 1000,
    wclUrl: "https://fresh.warcraftlogs.com/reports/tkA",
  },
  {
    raidName: "Serpentshrine Cavern",
    isFullClear: true,
    calendarDay: "2026-06-10",
    reportCode: "sscB",
    startTime: 2_000_000,
    clearDurationMs: 72 * 60 * 1000,
    wclUrl: "https://fresh.warcraftlogs.com/reports/sscB",
  },
  {
    raidName: "Tempest Keep",
    isFullClear: true,
    calendarDay: "2026-06-10",
    reportCode: "tkB",
    startTime: 2_100_000,
    clearDurationMs: 65 * 60 * 1000,
    wclUrl: "https://fresh.warcraftlogs.com/reports/tkB",
  },
];

const sessions = t5OneNightSessionsFromCalendarEntries(entries);
console.assert(sessions.length === 2, "two evenings");
console.assert(sessions[0].calendarDay === "2026-06-18", "newest first");
const overview = t5OneNightOverviewFromSessions(sessions);
console.assert(overview.totalClears === 2, "clear count");
console.assert(overview.bestTimeMs === 68 * 60 * 1000 + 60 * 60 * 1000, "fastest evening total");
console.log("ok", { sessions: sessions.length, bestMs: overview.bestTimeMs });
