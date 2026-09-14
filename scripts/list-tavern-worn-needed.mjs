/** Print Alliance worn sprite filenames still missing from tavern/worn. */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FOREVER_CLASSES_BY_RACE, CLASS_ROLES } from "../lib/wow-forever-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wornDir = path.join(__dirname, "..", "public", "images", "wow-forever", "tavern", "worn");
const FORM = new Set(["feral-bear", "feral-cat"]);
const races = ["human", "dwarf", "nightelf", "gnome", "skyborne"];
const genders = ["male", "female"];

function allNeeded() {
  const out = [];
  for (const race of races) {
    const key = race === "skyborne" ? "skyborne:alliance" : race;
    for (const gender of genders) {
      for (const classId of FOREVER_CLASSES_BY_RACE[key] || []) {
        for (const specs of Object.values(CLASS_ROLES[classId] || {})) {
          for (const s of specs) {
            if (FORM.has(s.id)) continue;
            out.push(`${race}-${gender}-${classId}-${s.id}`);
          }
        }
      }
    }
  }
  return out;
}

const needed = allNeeded();
const have = new Set(
  (await readdir(wornDir).catch(() => []))
    .filter((f) => f.endsWith(".webp"))
    .map((f) => f.replace(/\.webp$/i, ""))
);
const missing = needed.filter((n) => !have.has(n));
console.log(JSON.stringify({ needed: needed.length, have: have.size, missing: missing.length, files: missing }, null, 2));
