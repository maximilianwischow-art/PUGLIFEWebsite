import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "images", "achievements");
const svgPath = process.argv[2];
const outPath = process.argv[3] || path.join(outDir, "test-icon-embedded.png");

if (!svgPath) {
  console.error("Usage: node scripts/extract-svg-png.mjs <source.svg> [out.png]");
  process.exit(1);
}

const s = fs.readFileSync(svgPath, "utf8");
const m = s.match(/xlink:href="data:image\/png;base64,([^"]+)"/);
if (!m) {
  console.error("No embedded PNG found in SVG");
  process.exit(1);
}
const b = Buffer.from(m[1], "base64");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, b);
console.log("Wrote", outPath, "bytes:", b.length);
