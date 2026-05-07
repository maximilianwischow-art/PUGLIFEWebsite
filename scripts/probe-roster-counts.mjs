import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("./data/item-needs.sqlite"), { readonly: true });
const q = (sql) => db.prepare(sql).get().n;
console.log("users total:", q("SELECT COUNT(*) AS n FROM users"));
console.log(
  "users with discord_user_id set:",
  q("SELECT COUNT(*) AS n FROM users WHERE discord_user_id IS NOT NULL AND discord_user_id != ''")
);
console.log(
  "users with raid_helper_name_key:",
  q("SELECT COUNT(*) AS n FROM users WHERE raid_helper_name_key IS NOT NULL AND raid_helper_name_key != ''")
);
console.log("user_characters total:", q("SELECT COUNT(*) AS n FROM user_characters"));
console.log(
  "distinct character_name_key:",
  q("SELECT COUNT(DISTINCT character_name_key) AS n FROM user_characters")
);
console.log("users with any character:", q("SELECT COUNT(DISTINCT user_id) AS n FROM user_characters"));
console.log("users with raid_appearances:", q("SELECT COUNT(DISTINCT user_id) AS n FROM raid_appearances"));
