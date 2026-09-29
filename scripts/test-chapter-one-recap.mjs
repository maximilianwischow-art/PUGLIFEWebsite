import assert from "node:assert/strict";
import {
  CHAPTER_ONE,
  buildChapterOneRecap,
  hoursFromMs,
  wclFightUrl,
} from "../lib/compute/chapter-one-recap.mjs";

assert.equal(CHAPTER_ONE.title, "From Strangers to Community");
assert.equal(hoursFromMs(3_600_000), 1);
assert.equal(hoursFromMs(5_400_000), 1.5);
assert.equal(hoursFromMs(0), 0);
assert.equal(wclFightUrl("abc", 12), "https://fresh.warcraftlogs.com/reports/abc#fight=12");
assert.equal(wclFightUrl("abc"), "https://fresh.warcraftlogs.com/reports/abc");
assert.equal(wclFightUrl(""), null);

const karaFirstNight = {
  calendarDay: "2026-04-03",
  startTime: 0.5,
  raidName: "Karazhan",
  title: "kara first",
  reportCode: "karaFirst",
  reportCodes: ["karaFirst"],
  bossesKilled: 4,
  bossesTotal: 11,
  isFullClear: false,
  clearDurationMs: null,
};
const karaNight = {
  calendarDay: "2026-04-10",
  startTime: 1,
  raidName: "Karazhan",
  title: "kara",
  reportCode: "karaA",
  reportCodes: ["karaA"],
  bossesKilled: 11,
  bossesTotal: 11,
  isFullClear: true,
  clearDurationMs: 7_200_000,
  wclUrl: "https://fresh.warcraftlogs.com/reports/karaA",
  image: "/raid-images/kara.png",
};
const hyjalNight = {
  calendarDay: "2026-08-30",
  startTime: 2,
  raidName: "Hyjal Summit",
  title: "mh",
  reportCode: "b8d4KDATxjWnrfpJ",
  reportCodes: ["b8d4KDATxjWnrfpJ"],
  bossesKilled: 5,
  bossesTotal: 5,
  isFullClear: true,
  clearDurationMs: 3_600_000,
  wclUrl: "https://fresh.warcraftlogs.com/reports/b8d4KDATxjWnrfpJ",
};
const btNight = {
  calendarDay: "2026-09-20",
  startTime: 3,
  raidName: "Black Temple",
  title: "Illi & MH",
  reportCode: "TKZ6qwz3pncvAyXQ",
  reportCodes: ["TKZ6qwz3pncvAyXQ", "GN2Y1mgTDtMkLbCv"],
  bossesKilled: 9,
  bossesTotal: 9,
  isFullClear: true,
  clearDurationMs: 10_800_000,
  wclUrl: "https://fresh.warcraftlogs.com/reports/TKZ6qwz3pncvAyXQ",
};
const partialNight = {
  calendarDay: "2026-09-21",
  startTime: 4,
  raidName: "Black Temple",
  title: "bt wipe",
  reportCode: "partialBT",
  reportCodes: ["partialBT"],
  bossesKilled: 2,
  bossesTotal: 9,
  isFullClear: false,
  clearDurationMs: null,
};

const recap = buildChapterOneRecap({
  calendarEntries: [btNight, hyjalNight, karaNight, karaFirstNight, partialNight],
  appearancesByReport: {
    karaFirst: [1, 2],
    karaA: [1, 2],
    b8d4KDATxjWnrfpJ: [1],
    TKZ6qwz3pncvAyXQ: [1, 3],
    GN2Y1mgTDtMkLbCv: [3],
    partialBT: [2],
  },
  users: [
    { id: 1, displayName: "Highbullet", wowClass: "Hunter", guildRole: "Core" },
    { id: 2, displayName: "Ash", raidHelperName: "Ashveiled", wowClass: "Paladin", guildRole: "Grunt" },
    { id: 3, displayName: "Mooman", wowClass: "Warrior", guildRole: "Raidlead" },
  ],
  parseRowsByUser: {
    1: [
      { bestValue: 88, bestEncounter: "Prince Malchezaar", bestReportCode: "karaA", bestFightId: 11, bracket: "dps" },
      { bestValue: 99, bestEncounter: "Illidan Stormrage", bestReportCode: "TKZ6qwz3pncvAyXQ", bestFightId: 9, bracket: "dps" },
    ],
  },
  badgesByUser: {
    1: ["bt-first-illidan-kill", "hyjal-first-clear", "unknown-skip"],
    3: ["bt-first-illidan-kill"],
  },
  hallOfFame: {
    players: [
      {
        winnerName: "Highbullet",
        mvpCount: 4,
        latestRaidName: "Black Temple",
        customQuote: "For the Horde.",
        wins: [{ raidName: "Black Temple", raidStartTime: 3 }],
      },
    ],
  },
  kpi: { uniqueRaiderCount: 99, totalItemsDistributed: 412, wclReportsCovered: 8 },
});

assert.equal(recap.chapter.title, "From Strangers to Community");
assert.equal(recap.kpis.raidNights, 5);
assert.equal(recap.kpis.totalRaidHours, 6); // 2 + 1 + 3; partial / first Kara night skipped
assert.equal(recap.kpis.itemsDistributed, 412);
assert.equal(recap.kpis.uniqueRaiders, 3);

const highbullet = recap.raiders.find((r) => r.userId === 1);
assert.equal(highbullet.hours, 6);
assert.equal(highbullet.nights, 4);
assert.equal(highbullet.peakParse.value, 99);
assert.equal(highbullet.peakParse.encounter, "Illidan Stormrage");
assert.equal(
  highbullet.peakParse.wclUrl,
  "https://fresh.warcraftlogs.com/reports/TKZ6qwz3pncvAyXQ#fight=9"
);
assert.equal(highbullet.badges.length, 2);

assert.equal(recap.raiders.find((r) => r.userId === 2), undefined);

const mooman = recap.raiders.find((r) => r.userId === 3);
assert.equal(mooman.hours, 3);
assert.equal(mooman.nights, 1);

assert.equal(recap.timeline.some((beat) => beat.id === "kara-first-night"), true);
assert.equal(recap.timeline.some((beat) => beat.id === "kara-first-clear"), true);
assert.equal(recap.timeline.find((beat) => beat.id === "kara-first-night").calendarDay, "2026-04-03");
assert.equal(recap.timeline.find((beat) => beat.id === "kara-first-clear").calendarDay, "2026-04-10");
assert.deepEqual(
  recap.timeline.find((beat) => beat.id === "kara-first-clear").people.map((p) => p.name),
  ["Highbullet"]
);
assert.deepEqual(
  recap.timeline.find((beat) => beat.id === "bt-first-illidan").people.map((p) => p.name).sort(),
  ["Highbullet", "Mooman"]
);
// Badge fallback: Mooman earned bt-first-illidan-kill; Highbullet from night attendance.
assert.equal(
  recap.timeline.find((beat) => beat.id === "hyjal-first-clear").people.some((p) => p.name === "Highbullet"),
  true
);
assert.equal(recap.timeline.some((beat) => beat.id === "hyjal-first-clear"), true);
assert.equal(recap.timeline.find((beat) => beat.id === "hyjal-first-clear").sameNightAsFirstVisit, true);
assert.equal(recap.timeline.some((beat) => beat.id === "hyjal-first-night"), false);
assert.equal(recap.timeline.some((beat) => beat.id === "bt-first-illidan"), true);
assert.equal(recap.timeline.some((beat) => beat.reportCode === "partialBT"), false);
assert.ok(recap.timeline.every((beat, i, all) => i === 0 || Number(beat.startTime) >= Number(all[i - 1].startTime)));

const highJoin = recap.timeline.find((beat) => beat.kind === "core-join" && beat.people?.some((p) => p.userId === 1));
assert.equal(highJoin.calendarDay, "2026-04-03");
assert.equal(highJoin.label, "Highbullet joined");
assert.equal(highJoin.raidName, "Karazhan");
const mooJoin = recap.timeline.find((beat) => beat.kind === "core-join" && beat.people?.some((p) => p.userId === 3));
assert.equal(mooJoin.calendarDay, "2026-09-20");
assert.equal(mooJoin.label, "Mooman joined");
assert.equal(
  recap.timeline.some((beat) => beat.kind === "core-join" && beat.people?.some((p) => p.userId === 2)),
  false
);

assert.equal(recap.hallOfFame.latestChampion.winnerName, "Highbullet");
assert.equal(recap.raids.find((r) => r.raidName === "Black Temple").nights, 2);
assert.equal(recap.raids.find((r) => r.raidName === "Black Temple").fastestClearHours, 3);

console.log("ok chapter-one-recap");
