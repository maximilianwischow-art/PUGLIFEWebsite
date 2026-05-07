import Database from "better-sqlite3";
import path from "node:path";

const needle = String(process.argv[2] || "").toLowerCase();
if (!needle) {
  console.error("usage: node scripts/find-user.mjs <name>");
  process.exit(1);
}
const db = new Database(path.resolve("./data/item-needs.sqlite"), { readonly: true });
const users = db
  .prepare(
    `SELECT u.id, u.discord_user_id, u.raid_helper_name, u.display_name
       FROM users u
      WHERE LOWER(IFNULL(u.raid_helper_name,'')) LIKE ?
         OR LOWER(IFNULL(u.display_name,'')) LIKE ?
      ORDER BY u.id`
  )
  .all(`%${needle}%`, `%${needle}%`);
const chars = db
  .prepare(
    `SELECT c.id, c.user_id, c.character_name, c.wow_class, c.is_main, u.discord_user_id, u.raid_helper_name
       FROM user_characters c JOIN users u ON u.id = c.user_id
      WHERE LOWER(c.character_name) LIKE ?`
  )
  .all(`%${needle}%`);
console.log("users:", users);
console.log("characters:", chars);
