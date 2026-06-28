import assert from "node:assert/strict";
import { normalizeRaidHelperDisplayKey } from "../lib/rh-wcl-guess.mjs";
import {
  consumablesLeaderboardBadgeIdsForLinkedKeys,
  topThreeConsumablesRankKeys,
} from "../lib/compute/consumables-leaderboard-badges.mjs";

const players = [
  { name: "Alice", totalUses: 40 },
  { name: "Bob", totalUses: 40 },
  { name: "Carol", totalUses: 25 },
  { name: "Dave", totalUses: 10 },
];

const ranks = topThreeConsumablesRankKeys(players, normalizeRaidHelperDisplayKey);
assert.equal(ranks.rank1.size, 2);
assert.equal(ranks.rank2.size, 1);
assert.equal(ranks.rank3.size, 1);

const alice = consumablesLeaderboardBadgeIdsForLinkedKeys(
  new Set([normalizeRaidHelperDisplayKey("Alice")]),
  ranks
);
assert.ok(alice.has("consumables-last6-1st"));

const carol = consumablesLeaderboardBadgeIdsForLinkedKeys(
  new Set([normalizeRaidHelperDisplayKey("Carol")]),
  ranks
);
assert.ok(carol.has("consumables-last6-2nd"));

console.log("consumables leaderboard badge test passed");
