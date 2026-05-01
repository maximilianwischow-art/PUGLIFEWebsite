/**
 * Fetches TBC spell pages on Wowhead and reads the official large icon URL
 * (`<link rel="image_src" href="https://wow.zamimg.com/.../icons/large/....jpg">`).
 * Run: node scripts/fetch-tbc-spec-icons.mjs
 * Output: public/tbc-spec-icons.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "public", "tbc-spec-icons.json");

const UA = "Mozilla/5.0 (compatible; fallen-tacticians-spec-icons/1.0; +local-build)";
const DELAY_MS = 280;

/**
 * Guild canonical textures — must match `ZAMIMG_PROT_SPEC_ICON_URL` in server.js.
 * Wowhead’s icon for Holy Shield (27179) differs from this seal; we standardize on one URL everywhere.
 */
const CANONICAL_PROT_ICON_URL = {
  warrior_protection: "https://wow.zamimg.com/images/wow/icons/large/ability_warrior_defensivestance.jpg",
  paladin_protection: "https://wow.zamimg.com/images/wow/icons/large/spell_holy_sealofprotection.jpg",
};

/** Representative TBC spells per spec (Wowhead TBC db). */
const ENTRIES = [
  { key: "warrior_arms", className: "Warrior", specName: "Arms", spellId: 12294 },
  { key: "warrior_fury", className: "Warrior", specName: "Fury", spellId: 23881 },
  { key: "warrior_protection", className: "Warrior", specName: "Protection", spellId: 71 },
  { key: "paladin_holy", className: "Paladin", specName: "Holy", spellId: 635 },
  /** Spell id for Wowhead traceability; icon URL overridden to CANONICAL_PROT_ICON_URL.paladin_protection */
  { key: "paladin_protection", className: "Paladin", specName: "Protection", spellId: 27179 },
  { key: "paladin_retribution", className: "Paladin", specName: "Retribution", spellId: 31884 },
  { key: "hunter_beastmastery", className: "Hunter", specName: "Beast Mastery", spellId: 1515 },
  { key: "hunter_marksmanship", className: "Hunter", specName: "Marksmanship", spellId: 19506 },
  { key: "hunter_survival", className: "Hunter", specName: "Survival", spellId: 1495 },
  { key: "rogue_assassination", className: "Rogue", specName: "Assassination", spellId: 2098 },
  { key: "rogue_combat", className: "Rogue", specName: "Combat", spellId: 53 },
  { key: "rogue_subtlety", className: "Rogue", specName: "Subtlety", spellId: 1784 },
  { key: "priest_discipline", className: "Priest", specName: "Discipline", spellId: 17 },
  { key: "priest_holy", className: "Priest", specName: "Holy", spellId: 6064 },
  { key: "priest_shadow", className: "Priest", specName: "Shadow", spellId: 589 },
  { key: "shaman_elemental", className: "Shaman", specName: "Elemental", spellId: 403 },
  { key: "shaman_enhancement", className: "Shaman", specName: "Enhancement", spellId: 324 },
  { key: "shaman_restoration", className: "Shaman", specName: "Restoration", spellId: 331 },
  { key: "mage_arcane", className: "Mage", specName: "Arcane", spellId: 1459 },
  { key: "mage_fire", className: "Mage", specName: "Fire", spellId: 133 },
  { key: "mage_frost", className: "Mage", specName: "Frost", spellId: 116 },
  { key: "warlock_affliction", className: "Warlock", specName: "Affliction", spellId: 6789 },
  { key: "warlock_demonology", className: "Warlock", specName: "Demonology", spellId: 30146 },
  { key: "warlock_destruction", className: "Warlock", specName: "Destruction", spellId: 5740 },
  { key: "druid_balance", className: "Druid", specName: "Balance", spellId: 24858 },
  { key: "druid_feralcombat", className: "Druid", specName: "Feral", spellId: 768 },
  { key: "druid_restoration", className: "Druid", specName: "Restoration", spellId: 5185 },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseWowheadSpellPage(html) {
  const iconM = String(html).match(
    /<link\s+rel="image_src"\s+href="(https:\/\/wow\.zamimg\.com\/images\/wow\/icons\/large\/[^"]+)"/i
  );
  const titleM = String(html).match(/<title>([^<]+)<\/title>/i);
  let spellName = "";
  if (titleM?.[1]) {
    spellName = titleM[1].replace(/\s*-\s*Spell\s*-\s*TBC Classic\s*$/i, "").trim();
  }
  return {
    iconUrl: iconM?.[1]?.trim() || "",
    spellName,
  };
}

async function fetchOne(spellId) {
  const url = `https://www.wowhead.com/tbc/spell=${spellId}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Wowhead ${spellId}: HTTP ${res.status}`);
  const html = await res.text();
  return { wowheadUrl: url, ...parseWowheadSpellPage(html) };
}

async function main() {
  const byKey = {};
  const list = [];
  for (let i = 0; i < ENTRIES.length; i += 1) {
    const e = ENTRIES[i];
    const row = await fetchOne(e.spellId);
    if (!row.iconUrl) {
      throw new Error(`No icon for ${e.key} spell ${e.spellId}`);
    }
    const canonical = CANONICAL_PROT_ICON_URL[e.key];
    const iconUrl = canonical || row.iconUrl;
    const iconFile = iconUrl.split("/").pop() || "";
    const entry = {
      key: e.key,
      className: e.className,
      specName: e.specName,
      spellId: e.spellId,
      spellName: canonical && e.key === "paladin_protection" ? "Protection" : row.spellName,
      wowheadUrl: row.wowheadUrl,
      icon: iconFile,
      iconUrl,
    };
    list.push(entry);
    byKey[e.key] = {
      className: e.className,
      specName: e.specName,
      spellId: e.spellId,
      spellName: entry.spellName,
      iconUrl,
    };
    if (i < ENTRIES.length - 1) await sleep(DELAY_MS);
  }

  const payload = {
    version: "20260511b",
    fetchedAt: new Date().toISOString(),
    note:
      "Mostly Wowhead TBC spell pages (rel=image_src). Prot Paladin + Prot Warrior use canonical zamimg URLs aligned with server.js (same texture everywhere).",
    entries: list,
    byKey,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUT} (${list.length} specs)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
