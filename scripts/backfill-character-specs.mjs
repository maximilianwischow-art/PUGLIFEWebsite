#!/usr/bin/env node
/**
 * scripts/backfill-character-specs.mjs
 *
 * One-shot CLI that fills `user_characters.wow_class` / `wow_spec`
 * for every row in the canonical identity table. Reuses the same
 * resolver the in-server `runSyncCharacterSpecs` worker uses (from
 * `lib/compute/character-specs.mjs`), so output is identical.
 *
 * Usage:
 *   node scripts/backfill-character-specs.mjs                  # missing rows only
 *   node scripts/backfill-character-specs.mjs --force          # re-resolve every row
 *   node scripts/backfill-character-specs.mjs --limit=50       # cap rows processed
 *   node scripts/backfill-character-specs.mjs --throttle-ms=150
 *   node scripts/backfill-character-specs.mjs --dry-run        # print, don't write
 *   node scripts/backfill-character-specs.mjs --data-dir=/abs/path
 *
 * Requires `BLIZZARD_CLIENT_ID` + `BLIZZARD_CLIENT_SECRET` in `.env`
 * (or the process environment) for Battle.net access. Without them
 * the script still runs and falls back to Raider.IO only.
 */

import path from "node:path";
import dotenv from "dotenv";
import {
  openItemNeedsDb,
  charactersListAll,
  characterUpsert,
} from "../lib/item-needs-db.mjs";
import { createCharacterSpecResolver } from "../lib/compute/character-specs.mjs";

dotenv.config({ override: true });

const BLIZZARD_TOKEN_URL = "https://oauth.battle.net/token";

function parseArgs(argv) {
  const args = {
    dataDir: null,
    force: false,
    dryRun: false,
    limit: 0,
    throttleMs: null,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--force") args.force = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--data-dir=")) args.dataDir = arg.slice("--data-dir=".length);
    else if (arg.startsWith("--limit=")) args.limit = Math.max(0, Math.floor(Number(arg.slice("--limit=".length)) || 0));
    else if (arg.startsWith("--throttle-ms=")) {
      const n = Number(arg.slice("--throttle-ms=".length));
      args.throttleMs = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    }
  }
  return args;
}

function blizzardApiBaseUrl(region) {
  return `https://${region}.api.blizzard.com`;
}

function resolveDataDir(explicit) {
  if (explicit) return path.resolve(explicit);
  return path.resolve("./data");
}

(async () => {
  const args = parseArgs(process.argv);
  const dataDir = resolveDataDir(args.dataDir);
  const throttleMs = args.throttleMs != null ? args.throttleMs : 300;

  console.log("== Character class+spec backfill ==");
  console.log(`data dir   : ${dataDir}`);
  console.log(`mode       : ${args.dryRun ? "dry-run" : "write"}`);
  console.log(`scope      : ${args.force ? "every row" : "rows missing class or spec"}`);
  console.log(`limit      : ${args.limit > 0 ? args.limit : "no cap"}`);
  console.log(`throttleMs : ${throttleMs}`);
  console.log("");

  openItemNeedsDb(dataDir);

  const region = String(process.env.BLIZZARD_REGION || "eu").trim().toLowerCase() || "eu";
  const locale = String(process.env.BLIZZARD_LOCALE || "en_GB").trim() || "en_GB";
  const defaultRealm = String(process.env.WOW_GUILD_REALM || process.env.WOW_DEFAULT_REALM || "").trim();
  const raiderIoRegion = String(process.env.WOW_PROFILE_REGION || process.env.BLIZZARD_REGION || "eu").trim().toLowerCase() || "eu";
  const raiderIoApiBase = String(process.env.RAIDER_IO_CLASSIC_API_BASE || "https://classic.raider.io/api/v1").replace(/\/$/, "");
  const blizzardClientId = String(process.env.BLIZZARD_CLIENT_ID || "").trim();
  const blizzardClientSecret = String(process.env.BLIZZARD_CLIENT_SECRET || "").trim();
  const namespaceOverride = String(process.env.BLIZZARD_PROFILE_NAMESPACE || "").trim();

  if (!defaultRealm) {
    console.error("Set WOW_GUILD_REALM (or WOW_DEFAULT_REALM) before running. Without a realm we have nothing to query.");
    process.exit(2);
  }
  if (!blizzardClientId || !blizzardClientSecret) {
    console.warn(
      "Battle.net credentials missing — falling back to Raider.IO only. Set BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET for richer results."
    );
  }

  const resolve = createCharacterSpecResolver({
    blizzardClientId,
    blizzardClientSecret,
    blizzardTokenUrl: BLIZZARD_TOKEN_URL,
    blizzardApiBaseUrl: blizzardApiBaseUrl(region),
    blizzardLocale: locale,
    blizzardRegion: region,
    blizzardNamespaceOverride: namespaceOverride,
    raiderIoApiBase,
    raiderIoRegion,
    defaultRealm,
  });

  let rows;
  try {
    rows = charactersListAll({ missingClassOrSpec: !args.force });
  } catch (error) {
    console.error("[backfill] charactersListAll failed:", error?.message || error);
    process.exit(2);
  }

  const queue = args.limit > 0 ? rows.slice(0, args.limit) : rows;
  console.log(`Rows to process: ${queue.length} (of ${rows.length} candidates)\n`);

  let scanned = 0;
  let resolved = 0;
  let skippedNoData = 0;
  let unchanged = 0;
  let written = 0;
  let failed = 0;

  for (const row of queue) {
    scanned += 1;
    const realm = row.realm || defaultRealm;
    let result = null;
    try {
      result = await resolve({ characterName: row.characterName, realm });
    } catch (error) {
      console.warn(`  [error] ${row.characterName}: ${error?.message || error}`);
      failed += 1;
      result = null;
    }
    const wowClass = result?.wowClass || null;
    const wowSpec = result?.wowSpec || null;

    const willChangeClass = wowClass && wowClass !== row.wowClass;
    const willChangeSpec = wowSpec && wowSpec !== row.wowSpec;
    const fromTag = result?.source ? `via ${result.source}` : "no data";

    if (!wowClass && !wowSpec) {
      skippedNoData += 1;
      console.log(`  [miss ] uid=${row.userId} ${row.characterName} (${fromTag})`);
    } else if (!willChangeClass && !willChangeSpec) {
      unchanged += 1;
      resolved += 1;
      console.log(
        `  [same ] uid=${row.userId} ${row.characterName} class=${wowClass || row.wowClass || "?"} spec=${wowSpec || row.wowSpec || "?"} (${fromTag})`
      );
    } else {
      resolved += 1;
      const action = args.dryRun ? "would" : "write";
      console.log(
        `  [${action}] uid=${row.userId} ${row.characterName} class=${row.wowClass || "?"}->${wowClass || row.wowClass || "?"} spec=${row.wowSpec || "?"}->${wowSpec || row.wowSpec || "?"} (${fromTag})`
      );
      if (!args.dryRun) {
        const update = {
          userId: row.userId,
          characterName: row.characterName,
          source: `cli:backfill-character-specs:${result?.source || "mixed"}`,
        };
        if (wowClass) update.wowClass = wowClass;
        if (wowSpec) update.wowSpec = wowSpec;
        try {
          characterUpsert(update);
          written += 1;
        } catch (error) {
          console.warn(`  [write-fail] ${row.characterName}: ${error?.message || error}`);
          failed += 1;
        }
      }
    }

    if (throttleMs > 0 && scanned < queue.length) {
      await new Promise((r) => setTimeout(r, throttleMs));
    }
  }

  console.log("");
  console.log("== Summary ==");
  console.log(`scanned       : ${scanned}`);
  console.log(`resolved      : ${resolved}`);
  console.log(`unchanged     : ${unchanged}`);
  console.log(`written       : ${written}${args.dryRun ? " (dry-run, nothing persisted)" : ""}`);
  console.log(`skippedNoData : ${skippedNoData}`);
  console.log(`failed        : ${failed}`);

  process.exit(failed > 0 && resolved === 0 ? 1 : 0);
})().catch((error) => {
  console.error("[backfill] unexpected error:", error?.stack || error);
  process.exit(2);
});
