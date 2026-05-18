import fs from "fs";

const path = "public/admin.js";
let lines = fs.readFileSync(path, "utf8").split("\n");

// 1-based line numbers to drop (inclusive ranges)
const dropRanges = [
  [5258, 6121],
  [9727, 9749],
];

for (const [start, end] of dropRanges.sort((a, b) => b[0] - a[0])) {
  lines.splice(start - 1, end - start + 1);
}

let text = lines.join("\n");
text = text.replace(
  'tools: ["sync-center", "wcl-phase-avgs", "wcl-debuff-uptime", "analytics"]',
  'tools: ["sync-center", "wcl-phase-avgs", "analytics"]'
);
text = text.replace(/\n  renderWclDebuffReportSelect\(\);\n/g, "\n");
text = text.replace(/\n  if \(panelId === "wcl-debuff-uptime"\) \{[\s\S]*?\n  \}\n/g, "\n");
text = text.replace(/\n  if \(id === "wcl-debuff-uptime"\) \{[\s\S]*?\n  \}\n/g, "\n");

fs.writeFileSync(path, text);
console.log("stripped admin debuff code");
