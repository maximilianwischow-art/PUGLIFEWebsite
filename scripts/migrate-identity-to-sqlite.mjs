/*
 * scripts/migrate-identity-to-sqlite.mjs
 *
 * One-shot importer for Phase 1 of the canonical-user database plan.
 * Reads three legacy sources and seeds the new `users` + `user_characters`
 * tables in `data/item-needs.sqlite`:
 *
 *   1. data/rh-wcl-character-links.json       — Account Assignment table
 *   2. data/discord-id-rh-name-cache.json     — Discord-id <-> RH-name cache
 *   3. user_profiles (already in SQLite)      — picture + main character
 *
 * Idempotent: running it a second time is a no-op for unchanged data,
 * upsert-merges any changes, and never deletes rows. Safe to run on every
 * deploy until Phase 2 cuts the reads over.
 *
 * Usage:
 *   node scripts/migrate-identity-to-sqlite.mjs                     # uses ./data
 *   node scripts/migrate-identity-to-sqlite.mjs --data-dir=/abs/path
 *   node scripts/migrate-identity-to-sqlite.mjs --dry-run           # report only
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  openItemNeedsDb,
  rhNameKey,
  userUpsert,
  characterUpsert,
  userSetMainCharacter,
  userListAll,
  charactersGetByUserId,
  userGetByDiscordId,
  userGetByRaidHelperKey,
} from "../lib/item-needs-db.mjs";

function parseArgs(argv) {
  const args = { dataDir: null, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--data-dir=")) args.dataDir = arg.slice("--data-dir=".length);
    else if (arg === "--dry-run") args.dryRun = true;
  }
  return args;
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`[migrate-identity] cannot read ${filePath}: ${error?.message || error}`);
    return null;
  }
}

function summariseStats(label, stats) {
  console.log(
    `  ${label.padEnd(28)} users(new=${stats.usersNew}, updated=${stats.usersUpdated}) ` +
      `chars(new=${stats.charsNew}, updated=${stats.charsUpdated})`
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const dataDir = path.resolve(args.dataDir || path.join(process.cwd(), "data"));
  console.log(`[migrate-identity] dataDir = ${dataDir}`);
  if (args.dryRun) console.log("[migrate-identity] DRY RUN — no writes will be committed.");

  const dryRunGuard = () => {
    if (args.dryRun) throw new Error("Dry run — write attempted");
  };

  openItemNeedsDb(dataDir);

  const beforeUsers = new Map(userListAll().map((u) => [u.id, u]));

  const rhLinksPath = path.join(dataDir, "rh-wcl-character-links.json");
  const discordCachePath = path.join(dataDir, "discord-id-rh-name-cache.json");

  const stats = {
    rhLinks: { usersNew: 0, usersUpdated: 0, charsNew: 0, charsUpdated: 0 },
    discordCache: { usersNew: 0, usersUpdated: 0, charsNew: 0, charsUpdated: 0 },
    userProfiles: { usersNew: 0, usersUpdated: 0, charsNew: 0, charsUpdated: 0 },
  };

  function trackUserChange(prevId, after, bucket) {
    if (!after) return;
    if (!beforeUsers.has(after.id)) {
      bucket.usersNew += 1;
      beforeUsers.set(after.id, after);
    } else {
      bucket.usersUpdated += 1;
    }
  }

  function trackCharChange(charId, isNew, bucket) {
    if (isNew) bucket.charsNew += 1;
    else bucket.charsUpdated += 1;
  }

  // ----------------------------------------------------------------
  // 1) rh-wcl-character-links.json — Account Assignment table
  // ----------------------------------------------------------------
  const rhLinks = readJson(rhLinksPath);
  const links = Array.isArray(rhLinks?.links) ? rhLinks.links : [];
  console.log(`\n[migrate-identity] Account Assignment links: ${links.length}`);
  for (const link of links) {
    const raidHelperName = String(link?.raidHelperName || "").trim();
    if (!raidHelperName) continue;
    const wclCharacterNames = Array.isArray(link?.wclCharacterNames)
      ? link.wclCharacterNames.map((n) => String(n || "").trim()).filter(Boolean)
      : [];
    const guildRole = link?.guildRole ? String(link.guildRole).trim() : null;
    const discordUserId = link?.discordUserId ? String(link.discordUserId).trim() : null;

    if (args.dryRun) continue;

    const before = discordUserId
      ? userGetByDiscordId(discordUserId)
      : userGetByRaidHelperKey(rhNameKey(raidHelperName));
    const after = userUpsert({
      discordUserId: discordUserId || null,
      raidHelperName,
      displayName: raidHelperName,
      guildRole,
      source: "migrate:rh-links",
    });
    trackUserChange(before?.id, after, stats.rhLinks);

    const existingCharIds = new Set(charactersGetByUserId(after.id).map((c) => c.id));
    for (const name of wclCharacterNames) {
      const character = characterUpsert({
        userId: after.id,
        characterName: name,
        discoveredVia: "wcl-roster",
        source: "migrate:rh-links",
      });
      trackCharChange(character.id, !existingCharIds.has(character.id), stats.rhLinks);
    }
  }
  summariseStats("rh-wcl-character-links", stats.rhLinks);

  // ----------------------------------------------------------------
  // 2) discord-id-rh-name-cache.json — Discord-id <-> last-seen RH-name
  // ----------------------------------------------------------------
  const discordCache = readJson(discordCachePath);
  const byUserId = discordCache?.byUserId && typeof discordCache.byUserId === "object" ? discordCache.byUserId : {};
  const cacheEntries = Object.entries(byUserId);
  console.log(`\n[migrate-identity] Discord-id -> RH-name cache entries: ${cacheEntries.length}`);
  for (const [discordUserId, entry] of cacheEntries) {
    const id = String(discordUserId || "").trim();
    if (!id) continue;
    const rhName = entry?.rhName ? String(entry.rhName).trim() : "";
    if (!rhName) continue;
    if (args.dryRun) continue;

    const before = userGetByDiscordId(id);
    const after = userUpsert({
      discordUserId: id,
      raidHelperName: rhName,
      displayName: before?.displayName || rhName,
      source: "migrate:discord-id-cache",
    });
    trackUserChange(before?.id, after, stats.discordCache);
  }
  summariseStats("discord-id-rh-name-cache", stats.discordCache);

  // ----------------------------------------------------------------
  // 3) user_profiles — picture metadata + main character
  //    (already in SQLite; we read it back through the same connection)
  // ----------------------------------------------------------------
  const profileRows = openItemNeedsDb(dataDir)
    .prepare(
      `SELECT user_id AS userId, display_name AS displayName,
              main_character_name AS mainCharacterName,
              picture_filename AS pictureFilename,
              picture_mime AS pictureMime,
              picture_size_bytes AS pictureSizeBytes,
              picture_etag AS pictureEtag,
              picture_updated_at AS pictureUpdatedAt
       FROM user_profiles`
    )
    .all();
  console.log(`\n[migrate-identity] user_profiles rows: ${profileRows.length}`);
  for (const profile of profileRows) {
    const id = String(profile?.userId || "").trim();
    if (!id) continue;
    if (args.dryRun) continue;

    const before = userGetByDiscordId(id);
    const after = userUpsert({
      discordUserId: id,
      displayName: profile.displayName || before?.displayName || null,
      source: "migrate:user-profiles",
    });
    trackUserChange(before?.id, after, stats.userProfiles);

    if (profile.pictureFilename) {
      openItemNeedsDb(dataDir)
        .prepare(
          `UPDATE users SET
             picture_filename = ?,
             picture_mime = ?,
             picture_size_bytes = ?,
             picture_etag = ?,
             picture_updated_at = ?,
             last_seen_at = ?
           WHERE id = ?`
        )
        .run(
          profile.pictureFilename,
          profile.pictureMime || null,
          profile.pictureSizeBytes != null ? Number(profile.pictureSizeBytes) : null,
          profile.pictureEtag || null,
          profile.pictureUpdatedAt != null ? Number(profile.pictureUpdatedAt) : null,
          Date.now(),
          after.id
        );
    }

    if (profile.mainCharacterName) {
      const existingCharIds = new Set(charactersGetByUserId(after.id).map((c) => c.id));
      const character = characterUpsert({
        userId: after.id,
        characterName: profile.mainCharacterName,
        discoveredVia: "profile-main",
        source: "migrate:user-profiles",
      });
      trackCharChange(character.id, !existingCharIds.has(character.id), stats.userProfiles);
      userSetMainCharacter({
        userId: after.id,
        characterId: character.id,
        source: "migrate:user-profiles",
      });
    }
  }
  summariseStats("user_profiles", stats.userProfiles);

  // ----------------------------------------------------------------
  // Done — print final state
  // ----------------------------------------------------------------
  const usersAfter = userListAll();
  console.log(`\n[migrate-identity] users after migration: ${usersAfter.length}`);
  console.log(`[migrate-identity] sample row:`, usersAfter[0] || "(none)");
  if (args.dryRun) {
    console.log("\n[migrate-identity] DRY RUN complete — nothing written.");
    return;
  }
  console.log("\n[migrate-identity] DONE.");
}

main().catch((error) => {
  console.error("[migrate-identity] FAILED:", error?.stack || error);
  process.exit(1);
});
