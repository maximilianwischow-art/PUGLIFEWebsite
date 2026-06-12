import fs from "node:fs";
import path from "node:path";

const version = "20260611plb-lb-badge-restructure-v2";
const dir = path.join(process.cwd(), "public");
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".html")) continue;
  const p = path.join(dir, f);
  const s = fs.readFileSync(p, "utf8");
  if (!s.includes("styles.min.css")) continue;
  const n = s.replace(/styles\.min\.css\?v=[^"']+/g, `styles.min.css?v=${version}`);
  if (n !== s) {
    fs.writeFileSync(p, n, "utf8");
    console.log("updated", f);
  }
}
