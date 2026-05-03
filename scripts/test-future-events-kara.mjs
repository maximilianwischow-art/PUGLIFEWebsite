#!/usr/bin/env node
/**
 * Calls GET /api/raid-helper/future-events and prints Kara tanks + Highbullet,
 * including rioProfileLookupName (mapping-first canonical name for the signup — same as Events card label).
 *
 * Usage:
 *   npm run test:kara-roster
 *   node scripts/test-future-events-kara.mjs
 *   node scripts/test-future-events-kara.mjs http://127.0.0.1:8787
 *   node scripts/test-future-events-kara.mjs http://127.0.0.1:8787 --all   # full roster + Armory class fields
 *
 * Env: PUBLIC_BASE_URL or PORT (default http://localhost:8787)
 */
import process from "node:process";

const argvRest = process.argv.slice(2).filter((a) => a !== "--all");
const dumpAll = process.argv.includes("--all");
const argvBase = String(argvRest[0] || "").trim().replace(/\/$/, "");
const base =
  argvBase ||
  String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "") ||
  `http://localhost:${Number(process.env.PORT || 8787)}`;

const url = `${base}/api/raid-helper/future-events`;

const res = await fetch(url);
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(text);
} catch {
  console.error("Invalid JSON");
  process.exit(1);
}

const events = Array.isArray(data?.events) ? data.events : [];
const kara = events.find((e) => /kara/i.test(String(e?.title || "")));

if (!kara) {
  console.log("No event matching /kara/i in title.");
  console.log(
    "Available:",
    events.map((e) => e.title).join(", ") || "(none)"
  );
  process.exit(0);
}

console.log("Event:", kara.title, `(id ${kara.id})\n`);

const roster = Array.isArray(kara.confirmedRoster) ? kara.confirmedRoster : [];

function pick(nameFragment) {
  const low = nameFragment.toLowerCase();
  return roster.filter((p) => String(p?.name || "").toLowerCase().includes(low));
}

const tanks = roster.filter((p) => p.roleName === "Tanks");
const highbullet = pick("highbullet");

const subsetRows = [...tanks, ...highbullet.filter((h) => !tanks.some((t) => t.name === h.name))];

function line(p) {
  return {
    raidHelperDisplayName: p.name,
    characterName: p.characterName ?? "",
    // Name passed to Raider.io /characters/profile (+ Blizzard spec when configured).
    rioProfileLookupName:
      p.rioProfileLookupName ??
      "(not set — row skipped external enrich, or server predates rioProfileLookupName)",
    className: p.className || "",
    raiderIoClassName: p.raiderIoClassName ?? "",
    blizzardClassName: p.blizzardClassName ?? "",
    specName: p.specName || "",
    roleName: p.roleName || "",
  };
}

const rowsToPrint = dumpAll
  ? [...roster].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
  : subsetRows.length
    ? subsetRows
    : roster.slice(0, 15);

console.log(dumpAll ? "Full Kara roster:\n" : "Tanks + Highbullet (unique):\n");
for (const p of rowsToPrint) {
  console.log(JSON.stringify(line(p), null, 2));
  console.log("");
}

if (!dumpAll && !subsetRows.length) {
  console.log("(No matching roster rows.)");
}
