// Smoke-test Phase 2 SQL helpers against the real data dir. Compares the
// SQL-backed answers to the legacy heuristics for one known Discord id.
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  openItemNeedsDb,
  rhNameKey,
  identityListLinkedCharacterNames,
  identityResolveProfilesByCharacterNames,
  identityResolveDiscordIdsByRhKey,
  identityResolveCharacterByDiscordId,
  identityResolveRaidHelperNameByDiscordId,
} from "../lib/item-needs-db.mjs";

const dataDir = path.join(process.cwd(), "data");
openItemNeedsDb(dataDir);

const rhLinks = JSON.parse(await readFile(path.join(dataDir, "rh-wcl-character-links.json"), "utf8"));
const links = Array.isArray(rhLinks?.links) ? rhLinks.links : [];

console.log("\n=== identityResolveCharacterByDiscordId (Highbullet's Discord id) ===");
console.log(identityResolveCharacterByDiscordId("308667806633951243"));

console.log("\n=== identityResolveRaidHelperNameByDiscordId ===");
console.log(identityResolveRaidHelperNameByDiscordId("308667806633951243"));

console.log("\n=== identityListLinkedCharacterNames ===");
console.log(identityListLinkedCharacterNames({ discordUserId: "308667806633951243" }));

console.log("\n=== identityListLinkedCharacterNames (no Discord id, falls back to RH key) ===");
console.log(identityListLinkedCharacterNames({ displayName: "Highbullet" }));

console.log("\n=== identityResolveProfilesByCharacterNames(['Highbullet','NoSuchOne']) ===");
console.log(identityResolveProfilesByCharacterNames(["Highbullet", "NoSuchOne"]));

const discordIdMap = identityResolveDiscordIdsByRhKey();
console.log(`\n=== identityResolveDiscordIdsByRhKey: ${discordIdMap.size} entries ===`);
console.log("Sample:", [...discordIdMap.entries()].slice(0, 8));

const beforeIds = new Set();
for (const link of links) {
  const id = String(link?.discordUserId || "").trim();
  if (!id) continue;
  const rhKey = rhNameKey(String(link?.raidHelperName || ""));
  if (rhKey) beforeIds.add(`${rhKey}:${id}`);
  for (const cn of link?.wclCharacterNames || []) {
    const cnKey = rhNameKey(String(cn || ""));
    if (cnKey) beforeIds.add(`${cnKey}:${id}`);
  }
}
const afterIds = new Set();
for (const [key, id] of discordIdMap) afterIds.add(`${key}:${id}`);
const missing = [...beforeIds].filter((s) => !afterIds.has(s));
const extra = [...afterIds].filter((s) => !beforeIds.has(s));
console.log(`\nlegacy entries: ${beforeIds.size}, sql entries: ${afterIds.size}`);
console.log(`missing from sql (first 5):`, missing.slice(0, 5));
console.log(`extra in sql (first 5):`, extra.slice(0, 5));
