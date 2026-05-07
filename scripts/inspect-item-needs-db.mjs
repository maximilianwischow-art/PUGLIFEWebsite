/**
 * Quick read-only inspection of the Item Need Submissions database.
 * Run with: `node scripts/inspect-item-needs-db.mjs`.
 */
import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.resolve(process.argv[2] || "data/item-needs.sqlite");
const db = new Database(dbPath, { readonly: true });
const log = (label, rows) => {
  console.log(`\n--- ${label} ---`);
  console.dir(rows, { depth: 4 });
};

log(
  "tables",
  db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all()
);
log("schema_meta", db.prepare(`SELECT * FROM schema_meta`).all());
log("nv_needs_current", db.prepare(`SELECT * FROM nv_needs_current`).all());
log("nv_needs_current_items", db.prepare(`SELECT * FROM nv_needs_current_items`).all());
log(
  "nv_needs_history (last 10)",
  db
    .prepare(
      `SELECT id, user_id, display_name, action, needed_count, submitted_at FROM nv_needs_history ORDER BY id DESC LIMIT 10`
    )
    .all()
);
log("p2_materials_current", db.prepare(`SELECT * FROM p2_materials_current`).all());
log(
  "p2_materials_history (last 10)",
  db.prepare(`SELECT * FROM p2_materials_history ORDER BY id DESC LIMIT 10`).all()
);
db.close();
