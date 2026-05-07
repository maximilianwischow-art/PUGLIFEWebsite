import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";

const db = new Database("./data/item-needs.sqlite", { readonly: true });

const schema = db.prepare("SELECT value FROM schema_meta WHERE key='version'").get();
const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='raid_appearances'").get();
const rows = db.prepare("SELECT COUNT(*) AS n FROM raid_appearances").get();
const distinctReports = db.prepare("SELECT COUNT(DISTINCT report_code) AS n FROM raid_appearances").get();
const distinctUsers = db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM raid_appearances").get();
const top = db
  .prepare(
    `SELECT u.discord_user_id AS discordUserId, u.display_name AS displayName,
            COUNT(DISTINCT a.report_code) AS events
       FROM raid_appearances a
       INNER JOIN users u ON u.id = a.user_id
       GROUP BY u.id
       ORDER BY events DESC
       LIMIT 10`
  )
  .all();

let selectedReportCodes = [];
if (existsSync("./data/gargul-loot-history.json")) {
  try {
    const parsed = JSON.parse(readFileSync("./data/gargul-loot-history.json", "utf8"));
    selectedReportCodes = Array.isArray(parsed?.selectedReportCodes) ? parsed.selectedReportCodes : [];
  } catch {}
}

console.log(JSON.stringify(
  {
    schemaVersion: schema?.value || null,
    tableCreated: !!tableInfo,
    totalRows: rows?.n || 0,
    distinctReportCodes: distinctReports?.n || 0,
    distinctUsers: distinctUsers?.n || 0,
    eventManagementSelectedReportCodes: selectedReportCodes.length,
    topUsers: top,
  },
  null,
  2
));

db.close();
