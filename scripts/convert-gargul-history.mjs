import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

function getHistorySection(lua) {
  const marker = '["history"]';
  const markerIdx = lua.indexOf(marker);
  if (markerIdx < 0) return "";
  const firstBrace = lua.indexOf("{", markerIdx);
  if (firstBrace < 0) return "";
  let depth = 0;
  for (let i = firstBrace; i < lua.length; i += 1) {
    const ch = lua[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return lua.slice(firstBrace, i + 1);
    }
  }
  return "";
}

function splitTopLevelEntryTables(historySection) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < historySection.length; i += 1) {
    const ch = historySection[i];
    if (ch === "{") {
      depth += 1;
      if (depth === 2) start = i;
    } else if (ch === "}") {
      if (depth === 2 && start >= 0) {
        out.push(historySection.slice(start, i + 1));
        start = -1;
      }
      depth -= 1;
    }
  }
  return out;
}

function extractString(block, key) {
  const rx = new RegExp(`\\["${key}"\\]\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = block.match(rx);
  if (!m?.[1]) return "";
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function extractNumber(block, key) {
  const rx = new RegExp(`\\["${key}"\\]\\s*=\\s*([0-9]+)`);
  const m = block.match(rx);
  const n = Number(m?.[1] || 0);
  return Number.isFinite(n) ? n : 0;
}

function toEntry(block) {
  const itemSectionMatch = block.match(/\["item"\]\s*=\s*\{([\s\S]*?)\}/);
  const itemSection = itemSectionMatch?.[1] || "";
  const itemID = Number(extractString(itemSection, "id") || 0);
  const itemName = extractString(itemSection, "name");
  const itemLink = extractString(block, "itemLink");
  const awardedTo = extractString(block, "awardedTo");
  const timestamp = extractNumber(block, "timestamp");
  const date = extractString(block, "date");
  return {
    awardedTo,
    itemID: Number.isFinite(itemID) ? itemID : 0,
    itemName,
    itemLink,
    timestamp,
    date,
    received: true,
    source: "gargul-history-lua",
  };
}

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.resolve(process.cwd(), "data", "gargul-history-converted.json");

if (!inputPath) {
  console.error("Usage: node scripts/convert-gargul-history.mjs <path-to-Gargul_History.lua> [output-json-path]");
  process.exit(1);
}

const raw = await readFile(path.resolve(inputPath), "utf8");
const historySection = getHistorySection(raw);
if (!historySection) {
  throw new Error('Could not find ["history"] section in Gargul history file.');
}

const blocks = splitTopLevelEntryTables(historySection);
const entries = blocks
  .map((block) => toEntry(block))
  .filter((row) => row.timestamp > 0 && (row.itemID > 0 || row.itemName || row.itemLink));

const payload = {
  entries,
  meta: {
    sourceFile: path.resolve(inputPath),
    convertedAt: new Date().toISOString(),
    count: entries.length,
  },
};

await writeFile(path.resolve(outputPath), JSON.stringify(payload, null, 2), "utf8");
console.log(`Converted ${entries.length} entries to ${path.resolve(outputPath)}`);
