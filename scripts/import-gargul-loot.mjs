import { readFile } from "node:fs/promises";

const filePath = process.argv[2];
const apiBase = process.argv[3] || "http://localhost:8787";

if (!filePath) {
  console.error("Usage: node scripts/import-gargul-loot.mjs <path-to-json> [api-base-url]");
  process.exit(1);
}

const raw = await readFile(filePath, "utf8");
const payload = JSON.parse(raw);
const entries = Array.isArray(payload) ? payload : payload?.entries;
if (!Array.isArray(entries)) {
  throw new Error("Input JSON must be an array or { entries: [...] }");
}

const res = await fetch(`${apiBase.replace(/\/+$/, "")}/api/loot-history/gargul/import`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(entries),
});

const out = await res.json().catch(() => ({}));
if (!res.ok || out?.ok === false) {
  throw new Error(out?.error || `Import failed (${res.status})`);
}

console.log(`Imported ${out.imported} Gargul loot entries.`);
