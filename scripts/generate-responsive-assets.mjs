import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const outDir = path.join(publicDir, "responsive");

const assets = [
  { source: "plb-hero-banner.png", widths: [480, 768, 960] },
  { source: "welcome-popup-hyjal.png", widths: [480, 960, 1440] },
  { source: "site-bg-fel.png", widths: [960, 1440, 1920] },
  { source: "raid-images/kara.png", widths: [320, 640, 960] },
  { source: "raid-images/gruul.png", widths: [320, 640, 960] },
  { source: "raid-images/magtheridon.png", widths: [320, 640, 960] },
  { source: "raid-images/ssc.png", widths: [320, 640, 960] },
  { source: "raid-images/tk.png", widths: [320, 640, 960] },
  { source: "raid-images/pb-header-kara.png", widths: [480, 960, 1440] },
  { source: "raid-images/pb-header-gruul.png", widths: [480, 960, 1440] },
  { source: "raid-images/pb-header-magtheridon.png", widths: [480, 960, 1440] },
  { source: "raid-images/pb-header-ssc.png", widths: [480, 960, 1440] },
  { source: "raid-images/pb-header-tk.png", widths: [480, 960, 1440] },
  { source: "raid-images/event-header-kara.png", widths: [480, 960, 1440] },
  { source: "raid-images/event-header-gruul.png", widths: [480, 960, 1440] },
  { source: "raid-images/event-header-magtheridon.png", widths: [480, 960, 1440] },
  { source: "raid-images/event-header-ssc.png", widths: [480, 960, 1440] },
  { source: "raid-images/event-header-tk.png", widths: [480, 960, 1440] },
];

function outputName(source, width) {
  const parsed = path.parse(source);
  return `${parsed.name}-${width}w.webp`;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  let written = 0;
  for (const asset of assets) {
    const sourcePath = path.join(publicDir, asset.source);
    const meta = await sharp(sourcePath).metadata();
    const sourceWidth = Number(meta.width || 0);
    for (const width of asset.widths) {
      if (!sourceWidth || width > sourceWidth) continue;
      const target = path.join(outDir, outputName(asset.source, width));
      await sharp(sourcePath)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82, effort: 5 })
        .toFile(target);
      written += 1;
      console.log(`wrote public/responsive/${outputName(asset.source, width)}`);
    }
  }
  console.log(`Generated ${written} responsive assets.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
