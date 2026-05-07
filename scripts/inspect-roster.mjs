import fs from "node:fs";
const raw = JSON.parse(fs.readFileSync(".tmp_roster.json", "utf8"));
const players = Array.isArray(raw?.players) ? raw.players : [];
const target = process.argv[2] || "Glutelf";
const lc = (s) => String(s || "").trim().toLowerCase();
const row = players.find(
  (p) => lc(p.characterName) === lc(target) || lc(p.name) === lc(target)
);
if (!row) {
  console.log(`${target} not found`);
} else {
  console.log(JSON.stringify(row, null, 2));
}
