/**
 * Unit tests for Hall of Fame player aggregation.
 * Run: node scripts/test-hall-of-fame-aggregate.mjs
 * Optional smoke: node scripts/test-hall-of-fame-aggregate.mjs http://localhost:8787
 */
import {
  aggregateHallOfFameByPlayer,
  defaultHallOfFamePlayerKey,
} from "../lib/hall-of-fame-aggregate.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function win(overrides) {
  return {
    roundKey: "r1",
    raidCode: "ABC12345",
    raidName: "Karazhan",
    raidStartTime: 1000,
    winnerName: "Alice",
    winnerVotes: 10,
    player: { characterName: "Alice", dbUserId: 42, className: "Mage" },
    ...overrides,
  };
}

function testSamePlayerMultipleWins() {
  const rows = [
    win({ roundKey: "r3", raidStartTime: 3000, raidName: "Tempest Keep" }),
    win({ roundKey: "r2", raidStartTime: 2000, raidName: "SSC" }),
    win({ roundKey: "r1", raidStartTime: 1000, raidName: "Karazhan" }),
  ];
  const out = aggregateHallOfFameByPlayer(rows);
  assert(out.players.length === 1, "expected one player card");
  assert(out.players[0].mvpCount === 3, "expected mvpCount 3");
  assert(out.players[0].wins.length === 3, "expected 3 wins");
  assert(out.latestChampion?.roundKey === "r3", "latest champion is newest round");
  assert(out.players[0].latestRaidName === "Tempest Keep", "latest raid name on card");
}

function testTwoPlayers() {
  const rows = [
    win({ roundKey: "r2", raidStartTime: 2000, winnerName: "Bob", player: { characterName: "Bob" } }),
    win({ roundKey: "r1", raidStartTime: 1000, winnerName: "Alice", player: { characterName: "Alice", dbUserId: 42 } }),
  ];
  const out = aggregateHallOfFameByPlayer(rows);
  assert(out.players.length === 2, "expected two player cards");
}

function testSortByMvpCountThenRecency() {
  const rows = [
    win({ roundKey: "a1", winnerName: "Alice", raidStartTime: 5000, player: { dbUserId: 1, characterName: "Alice" } }),
    win({ roundKey: "a2", winnerName: "Alice", raidStartTime: 4000, player: { dbUserId: 1, characterName: "Alice" } }),
    win({ roundKey: "b1", winnerName: "Bob", raidStartTime: 9000, player: { dbUserId: 2, characterName: "Bob" } }),
  ];
  const out = aggregateHallOfFameByPlayer(rows);
  assert(out.players[0].winnerName === "Alice", "Alice ranks first with 2 MVPs");
  assert(out.players[0].mvpCount === 2, "Alice mvpCount 2");
  assert(out.players[1].winnerName === "Bob", "Bob second with 1 MVP");
}

function testNameKeyFallback() {
  const rows = [
    win({ winnerName: "Scottie", player: { characterName: "Scottie" }, roundKey: "r1" }),
    win({ winnerName: "Scottie", player: { characterName: "Scottie" }, roundKey: "r2", raidStartTime: 2000 }),
  ];
  const out = aggregateHallOfFameByPlayer(rows);
  assert(out.players.length === 1, "same name merges without dbUserId");
  assert(defaultHallOfFamePlayerKey(rows[0]) === "name:scottie", "name key normalized");
}

function testEmpty() {
  const out = aggregateHallOfFameByPlayer([]);
  assert(out.players.length === 0, "empty players");
  assert(out.latestChampion === null, "no latest champion");
}

async function smokeApi(baseUrl) {
  const url = `${String(baseUrl).replace(/\/$/, "")}/api/voting/hall-of-fame`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  assert(res.ok && body?.ok !== false, `API failed: ${body?.error || res.status}`);
  assert(Array.isArray(body.hallOfFame), "hallOfFame array missing");
  assert(Array.isArray(body.players), "players array missing");
  if (body.hallOfFame.length) {
    assert(body.latestChampion, "latestChampion missing when hallOfFame non-empty");
  }
  console.log(`  smoke OK (${body.players.length} players, ${body.hallOfFame.length} wins)`);
}

const tests = [
  ["same player multiple wins", testSamePlayerMultipleWins],
  ["two players", testTwoPlayers],
  ["sort by mvp count", testSortByMvpCountThenRecency],
  ["name key fallback", testNameKeyFallback],
  ["empty input", testEmpty],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}: ${error?.message || error}`);
  }
}

const baseUrl = process.argv[2];
if (baseUrl) {
  try {
    await smokeApi(baseUrl);
    console.log("✓ API smoke");
  } catch (error) {
    failed += 1;
    console.error(`✗ API smoke: ${error?.message || error}`);
  }
}

if (failed) process.exit(1);
console.log(`\nAll ${tests.length + (baseUrl ? 1 : 0)} checks passed.`);
