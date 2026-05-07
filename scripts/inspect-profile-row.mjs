import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("./data/item-needs.sqlite"), { readonly: true });
const id = String(process.argv[2] || "648969752810618910");
console.log("user_profiles:", db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(id));
console.log("users.picture:", db.prepare("SELECT id, discord_user_id, raid_helper_name, picture_filename, picture_mime, picture_size_bytes, picture_etag FROM users WHERE discord_user_id = ?").get(id));
