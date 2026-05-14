/*
 * scripts/snapshot-legacy-json.mjs
 *
 * Phase 8 step: copy every legacy per-user JSON store into a timestamped
 * directory under `data/legacy-backups/<ISO>/` before any future deploy
 * removes the dual-write wrappers. This is the "rip cord" copy — once
 * dual-write is dropped, the snapshot is the only way to recover the
 * pre-cutover JSON state without going to a SQLite backup.
 *
 * The script is idempotent: re-running creates a new timestamped folder
 * each time. No source file is modified or deleted.
 *
 * Usage:
 *   node scripts/snapshot-legacy-json.mjs                     # uses ./data
 *   node scripts/snapshot-legacy-json.mjs --data-dir=/abs/path
 *   node scripts/snapshot-legacy-json.mjs --dry-run           # report only
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, basename } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEGACY_FILES = [
  "rh-wcl-character-links.json",
  "discord-id-rh-name-cache.json",
  "mvp-votes.json",
  "discord-dm-subscribers.json",
  "role-alert-dm-log.json",
  "hof-notes.json",
  "gargul-loot-history.json",
  "site-analytics.json",
  "discord-member-samples.json",
];

function parseArgs(argv) {
  const args = { dataDir: null, dryRun: false };
  for (const raw of argv.slice(2)) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--data-dir=")) args.dataDir = raw.slice("--data-dir=".length);
  }
  return args;
}

function isoStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function main() {
  const args = parseArgs(process.argv);
  const dataDir = resolve(args.dataDir || join(__dirname, "..", "data"));
  if (!existsSync(dataDir)) {
    console.error(`Data directory not found: ${dataDir}`);
    process.exit(1);
  }
  const targetDir = join(dataDir, "legacy-backups", isoStamp());
  if (args.dryRun) {
    console.log(`[dry-run] Would create ${targetDir} and copy:`);
  } else {
    mkdirSync(targetDir, { recursive: true });
    console.log(`Snapshotting legacy JSON to ${targetDir}`);
  }
  let copied = 0;
  let skipped = 0;
  for (const name of LEGACY_FILES) {
    const src = join(dataDir, name);
    if (!existsSync(src)) {
      console.log(`  - ${name} (missing, skipped)`);
      skipped += 1;
      continue;
    }
    const size = statSync(src).size;
    if (args.dryRun) {
      console.log(`  - ${name} (${size} bytes)`);
      continue;
    }
    const dst = join(targetDir, basename(src));
    writeFileSync(dst, readFileSync(src));
    console.log(`  - ${name} (${size} bytes copied)`);
    copied += 1;
  }
  if (!args.dryRun) {
    console.log(`Done. Copied ${copied} files, skipped ${skipped}.`);
  }
}

main();
