/**
 * Repack TK badge PNG to match other achievement assets: badge art centered at
 * ~1/1.72 of canvas so the default --achievement-badge-zoom crop fills the slot.
 */
import sharp from "sharp";
import { execSync } from "node:child_process";
import { writeSvgForBadgePng } from "../lib/badge-png-svg-sync.mjs";

const OUT = "public/images/achievements/tk-first-kael-kill.png";
const ZOOM = 1.72;
const CANVAS_W = 1024;
const CANVAS_H = 935;
const BADGE_SIZE = Math.round(CANVAS_W / ZOOM);

const sourceBuffer = execSync(
  "git show 5d2c20a:public/images/achievements/tk-first-kael-kill.png",
  { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 }
);

const badge = await sharp(sourceBuffer)
  .resize(BADGE_SIZE, BADGE_SIZE, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 1 },
  })
  .png()
  .toBuffer();

await sharp({
  create: {
    width: CANVAS_W,
    height: CANVAS_H,
    channels: 3,
    background: { r: 0, g: 0, b: 0 },
  },
})
  .composite([{ input: badge, gravity: "center" }])
  .png()
  .toFile(OUT);

await writeSvgForBadgePng(OUT);
const meta = await sharp(OUT).metadata();
console.log(`Wrote ${OUT} ${meta.width}x${meta.height}, badge art ${BADGE_SIZE}px for zoom ${ZOOM}`);
