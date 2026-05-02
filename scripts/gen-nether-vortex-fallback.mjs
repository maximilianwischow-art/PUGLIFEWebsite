/**
 * Regenerate data/nether-vortex-craftables-fallback.json when Wowhead markup changes.
 * Usage:
 *   curl -sS -A "Mozilla/5.0" "https://www.wowhead.com/tbc/item=30183/nether-vortex#reagent-for" -o tmp-nv.html
 *   node scripts/gen-nether-vortex-fallback.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const NETHER_VORTEX_WOW_ITEM_ID = 30183;

function extractWowheadListviewDataArray(html, listId) {
  const text = String(html || "");
  const needles = [`id:'${listId}'`, `id:"${listId}"`, `id: '${listId}'`, `id: "${listId}"`];
  let pos = -1;
  for (const n of needles) {
    const i = text.indexOf(n);
    if (i >= 0) {
      pos = i;
      break;
    }
  }
  if (pos < 0) return null;
  const dataPos = text.indexOf("data:", pos);
  if (dataPos < 0) return null;
  const start = text.indexOf("[", dataPos);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function netherVortexCountFromWowheadReagents(reagents) {
  const pairs = Array.isArray(reagents) ? reagents : [];
  for (const p of pairs) {
    if (Array.isArray(p) && p.length >= 2 && Number(p[0]) === NETHER_VORTEX_WOW_ITEM_ID) {
      const n = Number(p[1]);
      if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(20, Math.floor(n)));
    }
  }
  return 1;
}

const WOWHEAD_SPELL_SKILL_TO_PROFESSION = {
  164: "Blacksmithing",
  165: "Leatherworking",
  171: "Alchemy",
  197: "Tailoring",
};

function professionFromWowheadSpellRow(row) {
  const sk = Array.isArray(row?.skill) ? row.skill : [];
  for (const sid of sk) {
    const id = Number(sid);
    if (WOWHEAD_SPELL_SKILL_TO_PROFESSION[id]) return WOWHEAD_SPELL_SKILL_TO_PROFESSION[id];
  }
  return String(row?.reqskill || "").trim();
}

function parseHtml(html) {
  const spellRows = extractWowheadListviewDataArray(html, "reagent-for");
  if (!Array.isArray(spellRows) || !spellRows.length) return [];
  return spellRows
    .map((row) => {
      const itemName = String(row?.name || "").trim();
      const creates = row?.creates;
      const createdItemId = Array.isArray(creates) && creates.length ? Number(creates[0]) : 0;
      const itemID = createdItemId > 0 ? createdItemId : 0;
      const vortexNeeded = netherVortexCountFromWowheadReagents(row?.reagents);
      const profession = professionFromWowheadSpellRow(row);
      return { itemID, itemName, profession, vortexNeeded };
    })
    .filter((row) => row.itemID > 0 && row.itemName)
    .sort((a, b) => a.itemName.localeCompare(b.itemName));
}

const html = readFileSync(join(root, "tmp-nv.html"), "utf8");
const items = parseHtml(html);
const outPath = join(root, "data", "nether-vortex-craftables-fallback.json");
writeFileSync(outPath, JSON.stringify({ generatedAt: Date.now(), source: "wowhead-tbc-item-30183", items }, null, 2));
console.log(`Wrote ${items.length} rows to ${outPath}`);
