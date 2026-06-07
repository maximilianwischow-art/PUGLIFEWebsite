/**
 * Normalize achievement badge PNGs for roster/leaderboard display.
 *
 * Each asset is trimmed to its visible art, scaled to the same content size
 * used by the working badges (~570px), centered on the standard 1024×935
 * canvas, and paired SVG wrappers are regenerated.
 *
 * Run `npm run audit:badges` afterward — all files should report status `ok`.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { writeSvgForBadgePng } from "../lib/badge-png-svg-sync.mjs";

const BADGE_DIR = path.resolve("public/images/achievements");
const TARGET_W = 1024;
const TARGET_H = 935;
const TARGET_CONTENT_MAX = 585;
const TRIM_THRESHOLD = 28;

async function repackAchievementPng(fileName) {
  const filePath = path.join(BADGE_DIR, fileName);
  const trimmedBuf = await sharp(filePath).trim({ threshold: TRIM_THRESHOLD }).png().toBuffer();
  const { width, height } = await sharp(trimmedBuf).metadata();
  if (!width || !height) {
    throw new Error(`No visible content in ${fileName}`);
  }

  const scale = TARGET_CONTENT_MAX / Math.max(width, height);
  const art = await sharp(trimmedBuf)
    .resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), {
      fit: "fill",
    })
    .png()
    .toBuffer();

  const tmpPath = `${filePath}.repack.tmp`;
  await sharp({
    create: {
      width: TARGET_W,
      height: TARGET_H,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([{ input: art, gravity: "center" }])
    .png({ compressionLevel: 9, effort: 10, palette: true })
    .toFile(tmpPath);

  fs.renameSync(tmpPath, filePath);
  await writeSvgForBadgePng(filePath);

  const artMeta = await sharp(art).metadata();
  return {
    fileName,
    artW: artMeta.width,
    artH: artMeta.height,
  };
}

const only = process.argv.slice(2).filter(Boolean);
const files = fs
  .readdirSync(BADGE_DIR)
  .filter((f) => f.toLowerCase().endsWith(".png"))
  .filter((f) => !only.length || only.includes(f))
  .sort();

if (!files.length) {
  console.error("No achievement PNGs matched.");
  process.exit(1);
}

const results = [];
for (const file of files) {
  results.push(await repackAchievementPng(file));
}

console.log(`Repacked ${results.length} badge(s) to ${TARGET_W}x${TARGET_H} canvas:`);
for (const row of results) {
  console.log(`  ${row.fileName} -> art ${row.artW}x${row.artH}`);
}
