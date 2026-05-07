// Smoke-test the new identity layer against a throwaway SQLite file.
// Verifies tables exist, upserts work, character lookups work, and
// `userUpsertWithCharacters` correctly assigns is_main on the main row.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  openItemNeedsDb,
  userUpsert,
  userGetByDiscordId,
  userGetByCharacterName,
  characterUpsert,
  charactersGetByUserId,
  userUpsertWithCharacters,
  userListAll,
  rhNameKey,
} from "../lib/item-needs-db.mjs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ftapi-smoke-"));
console.log("temp data dir:", tmpDir);
openItemNeedsDb(tmpDir);

const u1 = userUpsert({
  discordUserId: "100",
  displayName: "Alice",
  raidHelperName: "Alice",
  source: "smoke-test",
});
console.log("created user 1:", u1);

const u2 = userUpsert({
  discordUserId: "100",
  displayName: "Alice2",
  isAuthenticated: true,
  source: "smoke-test",
});
console.log("updated user 1 (should be id=1):", u2);
if (u1.id !== u2.id) throw new Error("expected upsert to reuse id");

const c1 = characterUpsert({
  userId: u1.id,
  characterName: "Highbullet",
  wowClass: "Hunter",
  wowSpec: "Marksmanship",
  discoveredVia: "manual",
});
console.log("created character:", c1);

const lookup = userGetByCharacterName("highbullet");
console.log("lookup by lowercase character name:", lookup);
if (lookup?.id !== u1.id) throw new Error("expected character-name lookup to find user");

const u3 = userUpsertWithCharacters({
  discordUserId: "200",
  displayName: "Bob",
  raidHelperName: "Bob",
  characterNames: ["Boba", "Bobalt"],
  mainCharacterName: "Boba",
  source: "smoke-test",
});
console.log("user 2 with chars:", u3);
const u3chars = charactersGetByUserId(u3.id);
console.log("user 2 characters:", u3chars);
const main = u3chars.find((c) => c.isMain === 1);
if (!main || main.characterName !== "Boba") throw new Error("expected Boba to be main");

const u4 = userUpsert({
  raidHelperName: "Charlie",
  displayName: "Charlie (no Discord yet)",
  source: "smoke-test",
});
console.log("unlinked user:", u4);
if (u4.discordUserId) throw new Error("expected discordUserId to be null for unlinked");
const u4again = userUpsert({
  discordUserId: "300",
  raidHelperName: "Charlie",
  source: "smoke-test",
});
console.log("Charlie after Discord login:", u4again);
if (u4again.id !== u4.id) throw new Error("expected Charlie row to be reused once Discord id known");
if (u4again.discordUserId !== "300") throw new Error("expected discord_user_id to be set");

console.log("\nrhNameKey samples:");
for (const s of ["Highbullet", "Highbullet/Alt", "Highbullet-Thunderstrike", "  HIGH BULLET  "]) {
  console.log(`  ${JSON.stringify(s)} -> ${JSON.stringify(rhNameKey(s))}`);
}

console.log("\nAll users:", userListAll());
console.log("\nSmoke test passed.");
