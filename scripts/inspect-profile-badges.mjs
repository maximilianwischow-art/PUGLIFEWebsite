// One-off: confirm Highbullet's profile + linkedCharacters resolution.
// Reproduces the badge endpoint's name-set without HTTP/auth.
import {
  openItemNeedsDb,
  profileGetByUserId,
  profileGetAllWithMainCharacter,
  profileGetAllWithPicture,
} from "../lib/item-needs-db.mjs";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname || ".", "..");
openItemNeedsDb(path.join(root, "data"));
const linksFile = path.join(root, "data", "rh-wcl-character-links.json");
let links = [];
try {
  const raw = JSON.parse(fs.readFileSync(linksFile, "utf8"));
  links = Array.isArray(raw?.links) ? raw.links : [];
} catch (e) {
  console.error("Could not read links file:", e?.message);
}

const HIGHBULLET_ID = process.argv[2];
if (!HIGHBULLET_ID) {
  console.log("Usage: node scripts/inspect-profile-badges.mjs <discordUserId>");
  console.log("\nProfiles WITH a picture:");
  for (const p of profileGetAllWithPicture()) {
    console.log(`  ${p.userId}  main=${p.mainCharacterName}  pic=${p.pictureFilename}`);
  }
  console.log("\nProfiles WITH a main character:");
  for (const p of profileGetAllWithMainCharacter()) {
    console.log(`  ${p.userId}  main=${p.mainCharacterName}`);
  }
  process.exit(0);
}

const profile = profileGetByUserId(HIGHBULLET_ID);
console.log("Profile:", profile);

const myLinks = links.filter((l) => String(l?.discordUserId || "") === HIGHBULLET_ID);
console.log("\nLinks for this user (from rh-wcl-character-links.json):");
for (const l of myLinks) {
  console.log(`  raidHelperName=${JSON.stringify(l.raidHelperName)}  wclCharacterNames=${JSON.stringify(l.wclCharacterNames || [])}  guildRole=${l.guildRole}`);
}

// Reproduce listLinkedWowCharactersForDiscordUserId.
const out = [];
const seen = new Set();
const push = (raw) => {
  const name = String(raw || "").trim();
  if (!name) return;
  const key = name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(name);
};
const main = String(profile?.mainCharacterName || "").trim();
if (main) push(main);
for (const link of myLinks) {
  for (const cn of Array.isArray(link?.wclCharacterNames) ? link.wclCharacterNames : []) push(cn);
  if (link?.raidHelperName) push(link.raidHelperName);
}
console.log("\nResolved linkedCharacters:", out);
