/**
 * Set a profile picture for a canonical user directly against the local SQLite
 * file + profile-pictures directory. Use for one-shot dev-side edits or when
 * Render's persistent disk needs to be primed via SSH/console.
 *
 * Usage: node scripts/admin-set-profile-picture.mjs <userIdOrName> <imagePath>
 *
 * `<userIdOrName>` matches users.id, users.discord_user_id, users.raid_helper_name,
 * or users.display_name (case-insensitive).
 */
import { copyFile, readFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  openItemNeedsDb,
  userGetById,
  userListAll,
  profileSetPicture,
  profileGetByUserId,
} from "../lib/item-needs-db.mjs";

function detectMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ["image/jpeg", "jpg"];
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ["image/png", "png"];
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return ["image/gif", "gif"];
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return ["image/webp", "webp"];
  return null;
}

async function main() {
  const arg = String(process.argv[2] || "").trim();
  const imgArg = String(process.argv[3] || "").trim();
  if (!arg || !imgArg) {
    console.error("usage: node scripts/admin-set-profile-picture.mjs <userIdOrName> <imagePath>");
    process.exit(1);
  }
  const dataDir = path.resolve("./data");
  openItemNeedsDb(dataDir);
  const all = userListAll();
  const lc = arg.toLowerCase();
  const user =
    (Number.isInteger(Number(arg)) && userGetById(Number(arg))) ||
    all.find((u) => String(u.discordUserId || "") === arg) ||
    all.find((u) => String(u.raidHelperName || "").toLowerCase() === lc) ||
    all.find((u) => String(u.displayName || "").toLowerCase() === lc) ||
    all.find((u) => String(u.raidHelperName || "").toLowerCase().includes(lc));
  if (!user) {
    console.error(`No user matched '${arg}'.`);
    process.exit(2);
  }
  const discordId = String(user.discordUserId || "").trim();
  if (!discordId) {
    console.error(`User #${user.id} has no discord_user_id; cannot key a profile picture.`);
    process.exit(3);
  }
  if (!existsSync(imgArg)) {
    console.error(`Image not found: ${imgArg}`);
    process.exit(4);
  }
  const buf = await readFile(imgArg);
  const detected = detectMime(buf);
  if (!detected) {
    console.error("Image must be PNG, JPEG, WebP, or GIF.");
    process.exit(5);
  }
  const [mime, ext] = detected;
  const picturesDir = path.join(dataDir, "profile-pictures");
  await mkdir(picturesDir, { recursive: true });
  const filename = `${discordId.replace(/[^0-9]/g, "")}.${ext}`;
  const destPath = path.join(picturesDir, filename);
  await copyFile(imgArg, destPath);
  const size = statSync(destPath).size;
  const etag = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const before = profileGetByUserId(discordId);
  if (before?.pictureFilename && before.pictureFilename !== filename) {
    /* leave the old file on disk; the route handler unlinks but for a
       script we keep it to avoid losing state when re-running with the
       wrong extension. */
  }
  profileSetPicture({
    userId: discordId,
    displayName: String(user.displayName || user.raidHelperName || ""),
    pictureFilename: filename,
    pictureMime: mime,
    pictureSizeBytes: size,
    pictureEtag: etag,
  });
  console.log(`OK — ${user.displayName || user.raidHelperName || user.id} (#${user.id}, ${discordId})`);
  console.log(`     wrote ${destPath} (${size} bytes, ${mime})`);
  console.log(`     etag=${etag}`);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(99);
});
