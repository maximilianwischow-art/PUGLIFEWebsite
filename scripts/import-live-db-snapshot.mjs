import path from "node:path";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";

function parseArgs(argv) {
  const out = { file: "", dataDir: path.resolve("data") };
  for (const arg of argv) {
    if (arg.startsWith("--file=")) out.file = arg.slice("--file=".length);
    else if (arg.startsWith("--data-dir=")) out.dataDir = arg.slice("--data-dir=".length);
  }
  return out;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) {
  console.error("Usage: npm run import-live-db -- --file=<downloaded item-needs-...sqlite> [--data-dir=./data]");
  process.exit(1);
}

const sourcePath = path.resolve(args.file);
const dataDir = path.resolve(args.dataDir);
const targetPath = path.join(dataDir, "item-needs.sqlite");
const backupDir = path.join(dataDir, "backups");
const localBackupPath = path.join(backupDir, `local-before-live-import-${stamp()}.sqlite`);
const tempPath = path.join(dataDir, `item-needs.import-${process.pid}.sqlite`);

await stat(sourcePath);
await mkdir(dataDir, { recursive: true });
await mkdir(backupDir, { recursive: true });

if (await exists(targetPath)) {
  await copyFile(targetPath, localBackupPath);
  console.log(`Backed up local DB to ${localBackupPath}`);
}

await copyFile(sourcePath, tempPath);
await rename(tempPath, targetPath);
await Promise.allSettled([
  rm(`${targetPath}-wal`, { force: true }),
  rm(`${targetPath}-shm`, { force: true }),
]);

console.log(`Imported live DB snapshot into ${targetPath}`);
console.log("Restart the local server before testing.");
