#!/usr/bin/env node
/**
 * Offline heuristic matcher (same logic as admin “Run heuristic merge”).
 *
 *   RH_NAMES=Foo,Bar WCL_NAMES=Foo,Foodk node scripts/guess-rh-wcl-links.mjs
 *
 * Or pipe JSON (optional existing saved links):
 *   echo {"existing":[],"raidHelperNames":["A"],"wclCharacterNames":["Abank"]} | node scripts/guess-rh-wcl-links.mjs
 *
 * MIN_SCORE=72 (optional), ORPHAN_MIN_SCORE=62 (optional second pass)
 */
import "dotenv/config";
import { mergeRhWclGuess } from "../lib/rh-wcl-guess.mjs";

function splitCsv(s) {
  return String(s || "")
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

const rhEnv = splitCsv(process.env.RH_NAMES);
const wclEnv = splitCsv(process.env.WCL_NAMES);
let existing = [];
let raidHelperNames = rhEnv;
let wclCharacterNames = wclEnv;

const stdinText = process.stdin.isTTY ? "" : await readStdin();
if (stdinText) {
  try {
    const parsed = JSON.parse(stdinText);
    existing = Array.isArray(parsed.existing) ? parsed.existing : [];
    if (Array.isArray(parsed.raidHelperNames)) raidHelperNames = parsed.raidHelperNames;
    if (Array.isArray(parsed.wclCharacterNames)) wclCharacterNames = parsed.wclCharacterNames;
  } catch (e) {
    console.error("Invalid stdin JSON:", e.message);
    process.exit(1);
  }
}

if (!wclCharacterNames.length) {
  console.error("Need WCL_NAMES or JSON wclCharacterNames.");
  process.exit(1);
}

if (!raidHelperNames.length) {
  console.error("Need RH_NAMES or JSON raidHelperNames — Raid Helper signup names, not WCL-only.");
  process.exit(1);
}

const minScore = Number(process.env.MIN_SCORE || 68);
const orphanMinScore = Number(process.env.ORPHAN_MIN_SCORE || 62);
const { links, stats } = mergeRhWclGuess(existing, raidHelperNames, wclCharacterNames, {
  minScore,
  orphanMinScore,
  keepEmptyRaidHelperRows: true,
});

console.log(JSON.stringify({ links, stats }, null, 2));
