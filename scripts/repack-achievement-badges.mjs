/**
 * Normalize achievement badge PNGs for roster/leaderboard display.
 *
 * Art is trimmed and scaled to fit inside the visible crop window for both
 * roster (1.72×) and leaderboard (1.72×) so frames are not clipped.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { writeSvgForBadgePng } from "../lib/badge-png-svg-sync.mjs";

export const BADGE_DIR = path.resolve("public/images/achievements");
export const TARGET_W = 1024;
export const TARGET_H = 935;
export const ROSTER_ZOOM = 1.72;
export const LEADERBOARD_ZOOM = 1.72;
export const MAX_ART_W = Math.min(
  Math.floor(TARGET_W / ROSTER_ZOOM),
  Math.floor(TARGET_W / LEADERBOARD_ZOOM)
);
export const MAX_ART_H = Math.min(
  Math.floor(TARGET_H / ROSTER_ZOOM),
  Math.floor(TARGET_H / LEADERBOARD_ZOOM)
);
export const TRIM_THRESHOLD = 28;

export function scaleForBadgeCrop(width, height) {
  if (!width || !height) return 1;
  return Math.min(MAX_ART_W / width, MAX_ART_H / height, 1);
}

export async function repackAchievementPng(fileName, badgeDir = BADGE_DIR) {
  const filePath = path.join(badgeDir, fileName);
  const trimmedBuf = await sharp(filePath).trim({ threshold: TRIM_THRESHOLD }).png().toBuffer();
  const { width, height } = await sharp(trimmedBuf).metadata();
  if (!width || !height) {
    throw new Error(`No visible content in ${fileName}`);
  }

  const scale = scaleForBadgeCrop(width, height);
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
    scale,
  };
}

const only = process.argv.slice(2).filter(Boolean);
const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
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

  console.log(
    `Repacked ${results.length} badge(s) to ${TARGET_W}x${TARGET_H} (max art ${MAX_ART_W}x${MAX_ART_H}):`
  );
  for (const row of results) {
    console.log(`  ${row.fileName} -> art ${row.artW}x${row.artH} (scale ${row.scale.toFixed(3)})`);
  }
}
