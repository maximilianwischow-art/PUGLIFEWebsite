import Database from "better-sqlite3";
const db = new Database("./data/item-needs.sqlite");
const before = db.prepare("SELECT task_id, status FROM sync_state ORDER BY task_id").all();
console.log("before:", before);
const result = db
  .prepare("UPDATE sync_state SET status='idle' WHERE status='running'")
  .run();
console.log("rows updated:", result.changes);
const after = db.prepare("SELECT task_id, status FROM sync_state ORDER BY task_id").all();
console.log("after:", after);
db.close();
