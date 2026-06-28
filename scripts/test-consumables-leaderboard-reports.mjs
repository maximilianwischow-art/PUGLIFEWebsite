import assert from "node:assert/strict";
import {
  isFetchableWclReportCode,
  leaderboardReportRowsFromEventPayload,
} from "../lib/wcl/leaderboard-report-codes.mjs";

assert.equal(isFetchableWclReportCode("c8dgnLmWCZ7xyvzG"), true);
assert.equal(isFetchableWclReportCode("gargul-2026-04-02"), false);

const isKara = (row) => String(row?.reportRaidName || "").trim() === "Karazhan";

const withSelectionEmptyAllRaids = leaderboardReportRowsFromEventPayload(
  {
    allRaids: [],
    selectedReportCodes: ["c8dgnLmWCZ7xyvzG", "gargul-2026-04-02", "wV2PBqg1aK3jfYnA"],
  },
  { isTenPlayerRow: isKara }
);
assert.equal(withSelectionEmptyAllRaids.length, 2);
assert.deepEqual(
  withSelectionEmptyAllRaids.map((row) => row.reportCode).sort(),
  ["c8dgnLmWCZ7xyvzG", "wV2PBqg1aK3jfYnA"].sort()
);

const withoutSelection = leaderboardReportRowsFromEventPayload(
  {
    allRaids: [
      { reportCode: "abc1234567890123", reportRaidName: "Karazhan", reportStartTime: 100 },
      { reportCode: "def1234567890123", reportRaidName: "Serpentshrine Cavern", reportStartTime: 200 },
    ],
    selectedReportCodes: [],
  },
  { isTenPlayerRow: isKara }
);
assert.equal(withoutSelection.length, 1);
assert.equal(withoutSelection[0].reportCode, "def1234567890123");

console.log("consumables leaderboard report resolution test passed");
