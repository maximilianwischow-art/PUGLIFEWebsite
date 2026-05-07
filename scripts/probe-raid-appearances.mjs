import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("./data/item-needs.sqlite"), { readonly: true });

console.log("total rows:", db.prepare("SELECT COUNT(*) AS n FROM raid_appearances").get().n);

const sample = db
  .prepare(`SELECT report_code, report_started_at FROM raid_appearances LIMIT 5`)
  .all();
console.log("\nSample raw started_at values:");
for (const r of sample) {
  console.log(`  ${r.report_code}  raw=${r.report_started_at}`);
}

const max = db
  .prepare(`SELECT MAX(report_started_at) AS m, MIN(report_started_at) AS mn FROM raid_appearances`)
  .get();
console.log("\nrange raw:", max);
console.log("max as ms->Date:", max.m ? new Date(max.m).toISOString() : null);
console.log("max as sec->Date:", max.m ? new Date(max.m * 1000).toISOString() : null);

const rows = db
  .prepare(
    `SELECT report_code, MIN(report_started_at) AS started, COUNT(*) AS n
       FROM raid_appearances
       GROUP BY report_code
       ORDER BY (CASE WHEN started IS NULL THEN 0 ELSE started END) DESC
       LIMIT 20`
  )
  .all();
for (const r of rows) {
  const ms = Number(r.started);
  const dateMs = ms ? new Date(ms).toISOString() : "(null)";
  const dateSec = ms ? new Date(ms * 1000).toISOString() : "(null)";
  console.log(`  ${r.report_code}  raw=${r.started}  asMs=${dateMs}  asSec=${dateSec}  rows=${r.n}`);
}
