import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(
  process.env.USERPROFILE || "",
  ".cursor",
  "projects",
  "c-Users-Maxwi-Downloads-fallen-tacticians-api",
  "assets"
);
const outDir = path.join(__dirname, "..", "public", "images", "wow-forever", "tavern", "gear");
const GEAR = ["paladin", "warrior", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];

function knockMagenta(data) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (!a) continue;
    const mag = (r + b) / 2;
    const chroma = mag - g;
    const isMagenta = chroma > 38 && g < 170 && r > 90 && b > 90;
    if (!isMagenta) {
      if (chroma > 18 && g < 200 && r > 70 && b > 70) {
        const t = Math.min(1, (chroma - 18) / 70);
        data[i] = Math.round(r * (1 - t * 0.55) + g * t * 0.55);
        data[i + 2] = Math.round(b * (1 - t * 0.55) + g * t * 0.55);
        data[i + 3] = Math.round(a * (1 - t * 0.35));
      }
      continue;
    }
    const t = Math.min(1, Math.max(0, (chroma - 28) / 140));
    data[i + 3] = Math.round(a * (1 - t));
    data[i] = Math.round(Math.min(r, g + 24));
    data[i + 2] = Math.round(Math.min(b, g + 24));
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

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const name of GEAR) {
    const src = path.join(srcDir, `gear-${name}.png`);
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    knockMagenta(data);
    const box = contentBox(data, info.width, info.height);
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract(box)
      .resize({ height: 480, withoutEnlargement: true })
      .webp({ quality: 84, alphaQuality: 92, effort: 5 })
      .toFile(path.join(outDir, `${name}.webp`));
    console.log(`wrote gear/${name}.webp`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
