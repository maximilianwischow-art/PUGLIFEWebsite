/**
 * Audit achievement badge PNGs for roster (1.72×) and leaderboard (1.8×) display.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  BADGE_DIR,
  LEADERBOARD_ZOOM,
  ROSTER_ZOOM,
  TARGET_H,
  TARGET_W,
  TRIM_THRESHOLD,
} from "./repack-achievement-badges.mjs";

const LUMINANCE_THRESHOLD = TRIM_THRESHOLD;

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export async function contentBounds(filePath) {
  const img = sharp(filePath);
  const { width, height } = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * info.channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 8) continue;
      if (luminance(r, g, b) <= LUMINANCE_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) {
    return { width, height, contentW: 0, contentH: 0, fills: {} };
  }
  const contentW = maxX - minX + 1;
  const contentH = maxY - minY + 1;
  const fills = {
    rosterW: contentW / (TARGET_W / ROSTER_ZOOM),
    rosterH: contentH / (TARGET_H / ROSTER_ZOOM),
    leaderboardW: contentW / (TARGET_W / LEADERBOARD_ZOOM),
    leaderboardH: contentH / (TARGET_H / LEADERBOARD_ZOOM),
  };
  return { width, height, contentW, contentH, fills };
}

export function statusForMetrics(m) {
  const sizeOk = m.width === TARGET_W && m.height === TARGET_H;
  if (!sizeOk) return "wrong_canvas";
  const vals = Object.values(m.fills || {});
  if (!vals.length) return "empty";
  const ok = vals.every((f) => f >= 0.9 && f <= 1.05);
  if (ok) return "ok";
  if (vals.some((f) => f > 1.05)) return "too_tight";
  if (vals.some((f) => f < 0.9)) return "too_loose";
  return "needs_repack";
}

const files = fs
  .readdirSync(BADGE_DIR)
  .filter((f) => f.toLowerCase().endsWith(".png"))
  .sort();

const rows = [];
for (const file of files) {
  const full = path.join(BADGE_DIR, file);
  const m = await contentBounds(full);
  rows.push({ file, ...m, status: statusForMetrics(m) });
}

console.log(
  `Canvas ${TARGET_W}x${TARGET_H} · roster ${ROSTER_ZOOM}× · leaderboard ${LEADERBOARD_ZOOM}×\n`
);
console.log("file | canvas | content | roster fill | lb fill | status");
for (const r of rows) {
  const f = r.fills || {};
  console.log(
    [
      r.file.padEnd(32),
      `${r.width}x${r.height}`.padEnd(10),
      `${r.contentW}x${r.contentH}`.padEnd(10),
      `${(f.rosterW || 0).toFixed(2)}x${(f.rosterH || 0).toFixed(2)}`.padEnd(11),
      `${(f.leaderboardW || 0).toFixed(2)}x${(f.leaderboardH || 0).toFixed(2)}`.padEnd(11),
      r.status,
    ].join(" | ")
  );
}

const bad = rows.filter((r) => r.status !== "ok");
if (bad.length) {
  console.log(`\n${bad.length} badge(s) need repack.`);
  process.exitCode = 1;
} else {
  console.log("\nAll badges OK.");
}
