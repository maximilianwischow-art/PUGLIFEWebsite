import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(
      process.env.USERPROFILE || "",
      ".cursor",
      "projects",
      "c-Users-Maxwi-Downloads-fallen-tacticians-api",
      "assets"
    );
const outDir = path.join(__dirname, "..", "public", "images", "wow-forever", "tavern");

const BODIES = [
  "dwarf-male",
  "dwarf-female",
  "human-male",
  "human-female",
  "gnome-male",
  "gnome-female",
  "nightelf-male",
  "nightelf-female",
  "skyborne-male",
  "skyborne-female",
  "orc-male",
  "orc-female",
  "undead-male",
  "undead-female",
  "tauren-male",
  "tauren-female",
  "troll-male",
  "troll-female",
];

const GEAR = [
  "paladin",
  "warrior",
  "hunter",
  "rogue",
  "priest",
  "shaman",
  "mage",
  "warlock",
  "druid",
];

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
      const a = data[(y * width + x) * 4 + 3];
      if (a < 18) continue;
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
  const right = Math.min(width, maxX + 1 + pad);
  const bottom = Math.min(height, maxY + 1 + pad);
  return { left, top, width: right - left, height: bottom - top };
}

async function processSprite(srcName, destRel, maxHeight) {
  const src = path.join(srcDir, `${srcName}.png`);
  const dest = path.join(outDir, destRel);
  await mkdir(path.dirname(dest), { recursive: true });
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  knockMagenta(data);
  const box = contentBox(data, info.width, info.height);
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(box)
    .resize({ height: maxHeight, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90, effort: 5 })
    .toFile(dest);
  console.log(`wrote ${destRel}`);
}

async function processBackground() {
  const src = path.join(srcDir, "tavern-bg.png");
  await mkdir(outDir, { recursive: true });
  await sharp(src)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 84, effort: 5 })
    .toFile(path.join(outDir, "tavern-bg.webp"));
  await sharp(src)
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(path.join(outDir, "tavern-bg.jpg"));
  console.log("wrote tavern-bg.webp / tavern-bg.jpg");
}

async function main() {
  await processBackground();
  for (const name of BODIES) {
    await processSprite(name, `bodies/${name}.webp`, 520);
  }
  for (const name of GEAR) {
    await processSprite(`gear-${name}`, `gear/${name}.webp`, 280);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
