import fs from "fs";
import path from "path";

const ver = "20260518plb-nav-compact-v1";
for (const f of fs.readdirSync("public").filter((x) => x.endsWith(".html"))) {
  const p = path.join("public", f);
  let t = fs.readFileSync(p, "utf8");
  if (!t.includes("auth-ui.js")) continue;
  t = t.replace(/auth-ui\.js\?v=[^"'"]+/g, `auth-ui.js?v=${ver}`);
  fs.writeFileSync(p, t);
  console.log("updated", f);
}
