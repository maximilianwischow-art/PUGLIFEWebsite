import assert from "node:assert/strict";
import { mergeConsumablesUsageResults, applyLeaderboardUsageFilter } from "../lib/wcl/consumables-usage.mjs";

const merged = mergeConsumablesUsageResults([
  {
    fightsScanned: 5,
    totalEvents: 10,
    players: [
      {
        name: "Alice",
        counts: {
          "haste-potion": 3,
          "dark-rune": 1,
          "flask-pure-death": 9,
          "flame-cap": 2,
        },
        totalUses: 15,
      },
    ],
  },
]);

const filtered = applyLeaderboardUsageFilter(merged);
assert.equal(filtered.players[0].totalUses, 6);
assert.equal(filtered.players[0].counts["flame-cap"], 2);
assert.equal(filtered.players[0].counts["haste-potion"], 3);
assert.equal(filtered.players[0].counts["flask-pure-death"], undefined);
assert.equal(filtered.catalog.length, 9);

console.log("consumables usage merge test passed", {
  reportsScanned: merged.reportsScanned,
  top: merged.players.slice(0, 2).map((p) => `${p.name}:${p.totalUses}`),
  leaderboardTop: filtered.players.map((p) => `${p.name}:${p.totalUses}`),
});
