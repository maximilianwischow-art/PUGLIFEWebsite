// Loads public/events-roster-ui.js in a Node VM with minimal browser
// shims, then runs rosterPortraitChain(player) for the live roster JSON
// to see EXACTLY which URL each row produces.
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync("public/events-roster-ui.js", "utf8");
const roster = JSON.parse(fs.readFileSync(".tmp_roster.json", "utf8"));

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
  document: {
    getElementById: () => null,
  },
  window: {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const plb = sandbox.window.plbEventsRoster;
console.log("plb keys:", Object.keys(plb).slice(0, 5).join(", "), "...");

// Run chain on EVERY player and report which ones produce a question-mark
// fallback or class-icon fallback or some other URL.
let questionMarkCount = 0;
let classIconCount = 0;
let other = 0;
const Q = "inv_misc_questionmark";
for (const p of roster.players) {
  const slug = plb.effectiveRosterClassSlug(p);
  const chain = plb.rosterPortraitChain(p);
  const first = String(chain[0] || "");
  const tag = first.includes(Q) ? "QQ" : first.includes("classicon_") ? "CI" : "??";
  if (tag === "QQ") questionMarkCount++;
  else if (tag === "CI") classIconCount++;
  else other++;
  if (tag === "QQ") {
    console.log(`-- ${p.characterName || p.name} -> ${first}  (className=${p.className}, slug=${JSON.stringify(slug)})`);
  }
}
console.log(`\nTotal players: ${roster.players.length}  classIcon=${classIconCount}  questionMark=${questionMarkCount}  other=${other}`);
