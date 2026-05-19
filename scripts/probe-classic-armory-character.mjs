#!/usr/bin/env node
/**
 * Probe Classic Armory character + equipment APIs.
 * Usage: node scripts/probe-classic-armory-character.mjs [name] [realm]
 */
import { writeFileSync } from "node:fs";
import { parseClassicArmoryEquipmentAudit } from "../lib/classic-armory/equipment-audit.mjs";

const name = process.argv[2] || "Highbullet";
const realm = process.argv[3] || "thunderstrike";
const baseUrl = String(process.env.CLASSIC_ARMORY_API_BASE || "https://classic-armory.org").replace(
  /\/+$/,
  ""
);

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "fallen-tacticians-api/1.0 (+probe-classic-armory)",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: res.status, data };
}

const body = { region: "eu", flavor: "tbc-anniversary", realm, name };

const character = await postJson("/api/v1/character", body);
console.log("POST /api/v1/character", character.status, "keys:", Object.keys(character.data || {}));

const equipment = await postJson("/api/v1/character/equipment", body);
console.log("POST /api/v1/character/equipment", equipment.status, "keys:", Object.keys(equipment.data || {}));
const rows = Array.isArray(equipment.data?.equipment) ? equipment.data.equipment : [];
console.log("equipment slots:", rows.length);

function findPaths(obj, path = "", depth = 0, hits = []) {
  if (depth > 7 || hits.length > 60) return hits;
  if (!obj || typeof obj !== "object") return hits;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (/enchant|gem|socket|equip/i.test(k)) {
      hits.push(`${p}: ${Array.isArray(v) ? `array[${v.length}]` : typeof v}`);
    }
    if (v && typeof v === "object") findPaths(v, p, depth + 1, hits);
  }
  return hits;
}

console.log("\nInteresting JSON paths (equipment response):");
for (const line of findPaths(equipment.data)) console.log(" ", line);

const audit = parseClassicArmoryEquipmentAudit({
  character: character.data?.character,
  equipment: equipment.data?.equipment,
  region: "eu",
  flavor: "tbc-anniversary",
  realmSlug: realm,
  characterName: name,
});

console.log("\nParsed audit summary:", audit.summary);
console.log("Issues by slot:");
for (const slot of audit.slots) {
  if (!slot.issues?.length) continue;
  console.log(`  ${slot.slotLabel}: ${slot.issues.join(", ")}`);
}

const outPath = process.argv[4] || "";
if (outPath) {
  writeFileSync(outPath, JSON.stringify({ character: character.data, equipment: equipment.data, audit }, null, 2));
  console.log("\nWrote", outPath);
}
