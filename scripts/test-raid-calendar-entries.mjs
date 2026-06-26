import assert from "node:assert/strict";
import {
  TRACKED_RAIDS,
  buildMergedRaidCalendarEntries,
  isAmbiguousCombinedRaidZone,
  resolvedTrackedRaidForFight,
  resolveTrackedRaidZoneName,
} from "../lib/compute/raid-calendar-entries.mjs";

assert.equal(resolveTrackedRaidZoneName("SSC / TK"), null);
assert.equal(isAmbiguousCombinedRaidZone("SSC / TK"), true);
assert.equal(resolveTrackedRaidZoneName("Serpentshrine Cavern"), "Serpentshrine Cavern");
assert.equal(resolveTrackedRaidZoneName("The Eye"), "Tempest Keep");

const ambiguousReport = { zone: { name: "SSC / TK" }, code: "abc", title: "ssctk", startTime: 1_700_000_000_000 };
assert.equal(
  resolvedTrackedRaidForFight({ name: "Kael'thas Sunstrider", encounterID: 1, kill: true }, ambiguousReport),
  "Tempest Keep"
);
assert.equal(
  resolvedTrackedRaidForFight({ name: "Lady Vashj", encounterID: 2, kill: true }, ambiguousReport),
  "Serpentshrine Cavern"
);
assert.equal(
  resolvedTrackedRaidForFight(
    { name: "Void Reaver", encounterID: 3, kill: true, gameZone: { name: "The Eye" } },
    ambiguousReport
  ),
  "Tempest Keep"
);

const day = "2026-06-25";
const dayKeyFn = () => day;
const reportStartTimeMs = (raw) => Number(raw);

const splitTk = buildMergedRaidCalendarEntries(
  [
    {
      code: "tkA",
      title: "tk part 1",
      startTime: 1000,
      owner: { name: "u1" },
      zone: { name: "SSC / TK" },
      fights: [
        { id: 1, encounterID: 1, name: "Void Reaver", kill: true, startTime: 10, endTime: 100 },
        { id: 2, encounterID: 2, name: "High Astromancer Solarian", kill: true, startTime: 110, endTime: 200 },
      ],
    },
    {
      code: "tkB",
      title: "tk part 2",
      startTime: 1000,
      owner: { name: "u2" },
      zone: { name: "SSC / TK" },
      fights: [
        { id: 3, encounterID: 3, name: "Al'ar", kill: true, startTime: 300, endTime: 400 },
        { id: 4, encounterID: 4, name: "Kael'thas Sunstrider", kill: true, startTime: 410, endTime: 500 },
      ],
    },
  ],
  { trackedRaids: TRACKED_RAIDS, dayKeyFn, reportStartTimeMs }
);
assert.equal(splitTk.length, 1);
assert.equal(splitTk[0].raidName, "Tempest Keep");
assert.equal(splitTk[0].bossesKilled, 4);
assert.equal(splitTk[0].isFullClear, true);
assert.equal(splitTk[0].mergedFromMultipleReports, true);

const partialTk = buildMergedRaidCalendarEntries(
  [
    {
      code: "tkPartial",
      title: "ssctk0625",
      startTime: 1000,
      owner: { name: "u1" },
      zone: { name: "SSC / TK" },
      fights: [
        { id: 9, encounterID: 9, name: "Void Reaver", kill: true, gameZone: { name: "The Eye" }, startTime: 10, endTime: 100 },
        { id: 16, encounterID: 16, name: "High Astromancer Solarian", kill: true, gameZone: { name: "The Eye" }, startTime: 110, endTime: 200 },
        { id: 24, encounterID: 24, name: "Kael'thas Sunstrider", kill: true, gameZone: { name: "The Eye" }, startTime: 210, endTime: 300 },
      ],
    },
  ],
  { trackedRaids: TRACKED_RAIDS, dayKeyFn, reportStartTimeMs }
);
assert.equal(partialTk[0].bossesKilled, 3);
assert.equal(partialTk[0].isFullClear, false);

console.log("raid-calendar-entries tests passed");
