/**
 * Process generated worn character PNGs into tavern WebPs.
 *
 * Expects PNGs named: {race}-{gender}-{class}-{spec}.png
 * Writes: public/images/wow-forever/tavern/worn/{same}.webp
 *
 * Usage:
 *   node scripts/process-tavern-worn.mjs [srcDir]
 */
import { mkdir, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSrc = path.join(
  process.env.USERPROFILE || "",
  ".cursor",
  "projects",
  "c-Users-Maxwi-Downloads-fallen-tacticians-api",
  "assets"
);
const srcDir = path.resolve(process.argv[2] || defaultSrc);
const outDir = path.join(__dirname, "..", "public", "images", "wow-forever", "tavern", "worn");
const MAX_H = 520;

const NAME_RE =
  /^(human|dwarf|nightelf|gnome|skyborne|orc|undead|tauren|troll)-(male|female)-(warrior|paladin|hunter|rogue|priest|shaman|mage|warlock|druid)-([a-z0-9-]+)\.png$/i;

function knockNearBlack(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    if (data[i] < 18 && data[i + 1] < 18 && data[i + 2] < 18) data[i + 3] = 0;
  }
}

function knockMagenta(data) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (!a) continue;
    const mag = (r + b) / 2;
    const chroma = mag - g;
    if (chroma > 38 && g < 170 && r > 90 && b > 90) {
      const t = Math.min(1, Math.max(0, (chroma - 28) / 140));
      data[i + 3] = Math.round(a * (1 - t));
      data[i] = Math.round(Math.min(r, g + 24));
      data[i + 2] = Math.round(Math.min(b, g + 24));
    }
  }
}

function contentBox(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 18) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width, height };
  const pad = Math.max(4, Math.round(Math.min(width, height) * 0.02));
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  return {
    left,
    top,
    width: Math.min(width, maxX + 1 + pad) - left,
    height: Math.min(height, maxY + 1 + pad) - top,
  };
}

async function processOne(file) {
  const m = file.match(NAME_RE);
  if (!m) return null;
  const base = file.replace(/\.png$/i, "").toLowerCase();
  const src = path.join(srcDir, file);
  const img = sharp(src).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  knockNearBlack(data);
  knockMagenta(data);
  const box = contentBox(data, info.width, info.height);
  const cropped = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extract(box)
    .resize({ height: MAX_H, fit: "inside", withoutEnlargement: false })
    .webp({ quality: 88, alphaQuality: 100 })
    .toBuffer();
  const out = path.join(outDir, `${base}.webp`);
  await sharp(cropped).toFile(out);
  return out;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const files = (await readdir(srcDir)).filter((f) => NAME_RE.test(f));
  console.log(`src=${srcDir}`);
  console.log(`found ${files.length} worn PNG(s)`);
  let ok = 0;
  for (const file of files) {
    try {
      const out = await processOne(file);
      if (out) {
        ok += 1;
        console.log("ok", path.basename(out));
      }
    } catch (err) {
      console.error("fail", file, err?.message || err);
    }
  }
  // Also accept PNGs already dropped into worn/
  const wornPngs = (await readdir(outDir).catch(() => [])).filter((f) => NAME_RE.test(f));
  for (const file of wornPngs) {
    const tmp = path.join(srcDir, file);
    try {
      await copyFile(path.join(outDir, file), tmp);
      const out = await processOne(file);
      if (out) {
        ok += 1;
        console.log("ok-local", path.basename(out));
      }
    } catch (err) {
      console.error("fail-local", file, err?.message || err);
    }
  }
  console.log(`done ${ok}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
