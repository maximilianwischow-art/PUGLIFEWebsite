/**
 * Audit achievement badge PNGs for roster/leaderboard display.
 * Badges should use a 1024×935 canvas with art centered at ~1/zoom of width
 * so the default CSS crop fills the slot without clipping the frame or
 * showing black letterboxing.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const BADGE_DIR = path.resolve("public/images/achievements");
const ROSTER_ZOOM = 1.72;
const LEADERBOARD_ZOOM = 1.8;
const TARGET_W = 1024;
const TARGET_H = 935;
const TARGET_ART = Math.round(TARGET_W / ROSTER_ZOOM);
const LUMINANCE_THRESHOLD = 28;

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function contentBounds(filePath) {
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
    return { width, height, contentW: 0, contentH: 0, padX: 1, padY: 1, fillW: 0, fillH: 0 };
  }
  const contentW = maxX - minX + 1;
  const contentH = maxY - minY + 1;
  const padX = (width - contentW) / width;
  const padY = (height - contentH) / height;
  const visibleW = width / ROSTER_ZOOM;
  const visibleH = height / ROSTER_ZOOM;
  const fillW = contentW / visibleW;
  const fillH = contentH / visibleH;
  return { width, height, contentW, contentH, padX, padY, fillW, fillH };
}

function statusForMetrics(m) {
  const idealPad = 1 - 1 / ROSTER_ZOOM;
  const padOk = Math.abs(m.padX - idealPad) < 0.06 && Math.abs(m.padY - idealPad) < 0.08;
  const sizeOk = m.width === TARGET_W && m.height === TARGET_H;
  const fillOk = m.fillW >= 0.9 && m.fillW <= 1.08 && m.fillH >= 0.9 && m.fillH <= 1.08;
  if (padOk && sizeOk && fillOk) return "ok";
  if (m.fillW > 1.12 || m.fillH > 1.12) return "too_tight";
  if (m.fillW < 0.88 || m.fillH < 0.88) return "too_loose";
  if (!sizeOk) return "wrong_canvas";
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

console.log(`Target canvas ${TARGET_W}x${TARGET_H}, art ~${TARGET_ART}px, roster zoom ${ROSTER_ZOOM}, leaderboard ${LEADERBOARD_ZOOM}\n`);
console.log("file | canvas | content | pad% | fill@1.72 | status");
for (const r of rows) {
  console.log(
    [
      r.file.padEnd(32),
      `${r.width}x${r.height}`.padEnd(10),
      `${r.contentW}x${r.contentH}`.padEnd(10),
      `x${(r.padX * 100).toFixed(0)}/y${(r.padY * 100).toFixed(0)}`.padEnd(10),
      `${r.fillW.toFixed(2)}x${r.fillH.toFixed(2)}`.padEnd(10),
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
