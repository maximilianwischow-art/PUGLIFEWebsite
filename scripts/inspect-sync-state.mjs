import Database from "better-sqlite3";
const db = new Database("./data/item-needs.sqlite", { readonly: true });
const rows = db.prepare("SELECT task_id, status, last_completed_at, last_duration_ms, last_error, rows_changed FROM sync_state ORDER BY task_id").all();
console.log(JSON.stringify(rows.map((r) => ({
  taskId: r.task_id,
  status: r.status,
  lastCompletedAt: r.last_completed_at ? new Date(r.last_completed_at).toISOString() : null,
  lastDurationMs: r.last_duration_ms,
  lastError: r.last_error,
  rowsChanged: r.rows_changed,
})), null, 2));
db.close();
