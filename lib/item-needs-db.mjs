/**
 * Item Need Submissions database (SQLite via better-sqlite3).
 *
 * Stores the current state and full append-only history for:
 *   - Nether Vortex needs per Discord user (`nv_needs_*` tables)
 *   - Phase 2 raid materials (`p2_materials_*` tables)
 *
 * The first time the database is opened it migrates the legacy JSON files
 * (`data/nether-vortex-needs.json`, `data/p2-materials.json`) into the new
 * tables so existing submissions are preserved.
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "1";

/** @type {Database.Database | null} */
let dbInstance = null;
/** @type {string | null} */
let dbPath = null;

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ============================================================
-- Nether Vortex needs (per Discord user)
-- ============================================================
CREATE TABLE IF NOT EXISTS nv_needs_current (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  needed_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nv_needs_current_items (
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  item_id INTEGER NOT NULL DEFAULT 0,
  item_name TEXT NOT NULL DEFAULT '',
  profession TEXT NOT NULL DEFAULT '',
  vortex_needed INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, position),
  FOREIGN KEY (user_id) REFERENCES nv_needs_current(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nv_needs_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upsert', 'delete', 'migrate')),
  needed_count INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nv_history_user
  ON nv_needs_history(user_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_nv_history_time
  ON nv_needs_history(submitted_at DESC);

CREATE TABLE IF NOT EXISTS nv_needs_history_items (
  history_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  item_id INTEGER NOT NULL DEFAULT 0,
  item_name TEXT NOT NULL DEFAULT '',
  profession TEXT NOT NULL DEFAULT '',
  vortex_needed INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (history_id, position),
  FOREIGN KEY (history_id) REFERENCES nv_needs_history(id) ON DELETE CASCADE
);

-- ============================================================
-- Phase 2 raid materials
-- ============================================================
CREATE TABLE IF NOT EXISTS p2_materials_current (
  material_id TEXT PRIMARY KEY,
  current_value INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  updated_by_user_id TEXT,
  updated_by_display_name TEXT
);

CREATE TABLE IF NOT EXISTS p2_materials_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id TEXT NOT NULL,
  current_value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by_user_id TEXT,
  updated_by_display_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_p2_history_mat
  ON p2_materials_history(material_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_p2_history_time
  ON p2_materials_history(updated_at DESC);

-- ============================================================
-- User profiles (per Discord account)
-- One row per Discord user. Picture bytes live on disk under
-- data/profile-pictures/<userId>.<ext>; this table only stores
-- metadata + the chosen "main" character so we can render the
-- right portrait everywhere on the site.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  main_character_name TEXT,
  picture_filename TEXT,
  picture_mime TEXT,
  picture_size_bytes INTEGER,
  picture_etag TEXT,
  picture_updated_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profile_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK (action IN ('upsert', 'delete-picture', 'set-main', 'migrate')),
  main_character_name TEXT,
  picture_filename TEXT,
  picture_mime TEXT,
  picture_size_bytes INTEGER,
  picture_etag TEXT,
  submitted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_history_user
  ON user_profile_history(user_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_history_time
  ON user_profile_history(submitted_at DESC);
`;

/**
 * Open (and lazily initialize) the singleton item-needs database. Safe to call
 * many times — the schema is created with `IF NOT EXISTS`. Pass an explicit
 * `dataDir` so we share the same directory the JSON stores already use.
 *
 * @param {string} dataDir Absolute path to the persistent data directory.
 * @returns {Database.Database}
 */
export function openItemNeedsDb(dataDir) {
  if (dbInstance) return dbInstance;
  if (!dataDir || typeof dataDir !== "string") {
    throw new Error("openItemNeedsDb requires an absolute dataDir path");
  }
  mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, "item-needs.sqlite");
  const db = new Database(dbPath);
  db.exec(SCHEMA_SQL);
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SCHEMA_VERSION);
  dbInstance = db;

  try {
    migrateLegacyJson(dataDir);
  } catch (error) {
    console.warn("[item-needs-db] legacy JSON migration skipped:", error?.message || error);
  }

  return db;
}

/** @returns {Database.Database} */
function db() {
  if (!dbInstance) throw new Error("openItemNeedsDb has not been called yet");
  return dbInstance;
}

export function getItemNeedsDbPath() {
  return dbPath;
}

// ============================================================
// Sanitization helpers (mirror server-side rules)
// ============================================================

function sanitizeItemRow(row) {
  if (!row || typeof row !== "object") return null;
  const itemID = Number(row.itemID || row.itemId || 0);
  const itemName = String(row.itemName || row.name || "").trim();
  const profession = String(row.profession || "").trim();
  const vortexRaw = Number(row.vortexNeeded || row.vortexCount || row.count || 1);
  const vortexNeeded = Number.isFinite(vortexRaw)
    ? Math.max(1, Math.min(20, Math.floor(vortexRaw)))
    : 1;
  const safeId = Number.isFinite(itemID) ? Math.max(0, Math.floor(itemID)) : 0;
  if (!itemName && safeId <= 0) return null;
  return { itemID: safeId, itemName, profession, vortexNeeded };
}

function sanitizeItemsArray(items) {
  return (Array.isArray(items) ? items : []).map(sanitizeItemRow).filter(Boolean).slice(0, 30);
}

// ============================================================
// Nether Vortex needs — public API
// ============================================================

/**
 * Replace the user's current submission with the provided items, **and** append
 * a row to the audit history. Pass `items: []` to clear the user's submission.
 *
 * @param {{
 *   userId: string,
 *   displayName: string,
 *   items: Array<{ itemID?: number, itemName?: string, profession?: string, vortexNeeded?: number }>,
 *   neededCount?: number,
 *   updatedAt?: number,
 * }} input
 * @returns {{ historyId: number, action: 'upsert'|'delete', items: ReturnType<typeof sanitizeItemRow>[] }}
 */
export function nvUpsertCurrent({ userId, displayName, items, neededCount = 0, updatedAt }) {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("nvUpsertCurrent requires a non-empty userId");
  const dn = String(displayName || "").trim() || "Unknown";
  const now = Number.isFinite(Number(updatedAt)) ? Math.floor(Number(updatedAt)) : Date.now();
  const sanitized = sanitizeItemsArray(items);
  const action = sanitized.length === 0 ? "delete" : "upsert";

  const result = db().transaction(() => {
    db().prepare(`DELETE FROM nv_needs_current_items WHERE user_id = ?`).run(uid);
    if (action === "delete") {
      db().prepare(`DELETE FROM nv_needs_current WHERE user_id = ?`).run(uid);
    } else {
      db()
        .prepare(
          `INSERT INTO nv_needs_current (user_id, display_name, needed_count, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             display_name = excluded.display_name,
             needed_count = excluded.needed_count,
             updated_at = excluded.updated_at`
        )
        .run(uid, dn, Math.max(0, Math.floor(Number(neededCount) || 0)), now);
      const insertItem = db().prepare(
        `INSERT INTO nv_needs_current_items
           (user_id, position, item_id, item_name, profession, vortex_needed)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      sanitized.forEach((row, idx) => {
        insertItem.run(uid, idx, row.itemID, row.itemName, row.profession, row.vortexNeeded);
      });
    }

    const histInfo = db()
      .prepare(
        `INSERT INTO nv_needs_history (user_id, display_name, action, needed_count, submitted_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(uid, dn, action, Math.max(0, Math.floor(Number(neededCount) || 0)), now);
    const historyId = Number(histInfo.lastInsertRowid);
    if (sanitized.length) {
      const insertHistItem = db().prepare(
        `INSERT INTO nv_needs_history_items
           (history_id, position, item_id, item_name, profession, vortex_needed)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      sanitized.forEach((row, idx) => {
        insertHistItem.run(historyId, idx, row.itemID, row.itemName, row.profession, row.vortexNeeded);
      });
    }
    return { historyId, action, items: sanitized };
  })();

  return result;
}

/** Clear the user's current submission while still appending a `delete` history row. */
export function nvDeleteCurrent({ userId, displayName, updatedAt }) {
  return nvUpsertCurrent({ userId, displayName, items: [], updatedAt });
}

/**
 * Read all users' current submissions joined with their items, ordered most
 * recently updated first.
 */
export function nvGetAllCurrent() {
  const rows = db()
    .prepare(
      `SELECT user_id AS userId,
              display_name AS displayName,
              needed_count AS neededCount,
              updated_at AS updatedAt
       FROM nv_needs_current
       ORDER BY updated_at DESC`
    )
    .all();
  if (!rows.length) return [];
  const itemRows = db()
    .prepare(
      `SELECT user_id AS userId,
              position,
              item_id AS itemID,
              item_name AS itemName,
              profession,
              vortex_needed AS vortexNeeded
       FROM nv_needs_current_items
       ORDER BY user_id, position`
    )
    .all();
  const itemsByUser = new Map();
  for (const it of itemRows) {
    const arr = itemsByUser.get(it.userId) || [];
    arr.push({ itemID: it.itemID, itemName: it.itemName, profession: it.profession, vortexNeeded: it.vortexNeeded });
    itemsByUser.set(it.userId, arr);
  }
  return rows.map((r) => ({ ...r, items: itemsByUser.get(r.userId) || [] }));
}

/** Recent submissions across all users (audit feed). */
export function nvGetHistory({ limit = 200, userId } = {}) {
  const cap = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 200)));
  const rows = userId
    ? db()
        .prepare(
          `SELECT id, user_id AS userId, display_name AS displayName, action, needed_count AS neededCount, submitted_at AS submittedAt
           FROM nv_needs_history WHERE user_id = ?
           ORDER BY submitted_at DESC, id DESC LIMIT ?`
        )
        .all(String(userId), cap)
    : db()
        .prepare(
          `SELECT id, user_id AS userId, display_name AS displayName, action, needed_count AS neededCount, submitted_at AS submittedAt
           FROM nv_needs_history
           ORDER BY submitted_at DESC, id DESC LIMIT ?`
        )
        .all(cap);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const itemRows = db()
    .prepare(
      `SELECT history_id AS historyId, item_id AS itemID, item_name AS itemName, profession, vortex_needed AS vortexNeeded, position
       FROM nv_needs_history_items
       WHERE history_id IN (${placeholders})
       ORDER BY history_id, position`
    )
    .all(...ids);
  const itemsByHistory = new Map();
  for (const it of itemRows) {
    const arr = itemsByHistory.get(it.historyId) || [];
    arr.push({ itemID: it.itemID, itemName: it.itemName, profession: it.profession, vortexNeeded: it.vortexNeeded });
    itemsByHistory.set(it.historyId, arr);
  }
  return rows.map((r) => ({ ...r, items: itemsByHistory.get(r.id) || [] }));
}

// ============================================================
// Phase 2 materials — public API
// ============================================================

/**
 * Update one material's current count and append a history row.
 *
 * @param {{
 *   materialId: string,
 *   currentValue: number,
 *   updatedAt?: number,
 *   userId?: string | null,
 *   displayName?: string | null,
 * }} input
 */
export function p2UpsertMaterial({ materialId, currentValue, updatedAt, userId = null, displayName = null }) {
  const id = String(materialId || "").trim();
  if (!id) throw new Error("p2UpsertMaterial requires materialId");
  const value = Math.max(0, Math.floor(Number(currentValue) || 0));
  const now = Number.isFinite(Number(updatedAt)) ? Math.floor(Number(updatedAt)) : Date.now();
  const uid = userId ? String(userId) : null;
  const dn = displayName ? String(displayName) : null;

  return db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO p2_materials_current (material_id, current_value, updated_at, updated_by_user_id, updated_by_display_name)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(material_id) DO UPDATE SET
           current_value = excluded.current_value,
           updated_at = excluded.updated_at,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_by_display_name = excluded.updated_by_display_name`
      )
      .run(id, value, now, uid, dn);
    const info = db()
      .prepare(
        `INSERT INTO p2_materials_history (material_id, current_value, updated_at, updated_by_user_id, updated_by_display_name)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, value, now, uid, dn);
    return { historyId: Number(info.lastInsertRowid), materialId: id, currentValue: value, updatedAt: now };
  })();
}

/** Latest values for every tracked material as `{ [materialId]: currentValue }`. */
export function p2GetAllCurrent() {
  const rows = db()
    .prepare(
      `SELECT material_id AS materialId,
              current_value AS currentValue,
              updated_at AS updatedAt,
              updated_by_user_id AS updatedByUserId,
              updated_by_display_name AS updatedByDisplayName
       FROM p2_materials_current
       ORDER BY material_id`
    )
    .all();
  const currentById = {};
  for (const r of rows) currentById[r.materialId] = r.currentValue;
  return { rows, currentById };
}

export function p2GetHistory({ limit = 200, materialId } = {}) {
  const cap = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 200)));
  if (materialId) {
    return db()
      .prepare(
        `SELECT id, material_id AS materialId, current_value AS currentValue, updated_at AS updatedAt,
                updated_by_user_id AS updatedByUserId, updated_by_display_name AS updatedByDisplayName
         FROM p2_materials_history WHERE material_id = ?
         ORDER BY updated_at DESC, id DESC LIMIT ?`
      )
      .all(String(materialId), cap);
  }
  return db()
    .prepare(
      `SELECT id, material_id AS materialId, current_value AS currentValue, updated_at AS updatedAt,
              updated_by_user_id AS updatedByUserId, updated_by_display_name AS updatedByDisplayName
       FROM p2_materials_history
       ORDER BY updated_at DESC, id DESC LIMIT ?`
    )
    .all(cap);
}

// ============================================================
// User profiles — public API
// ============================================================

function profileRowToPublic(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    displayName: row.display_name || "",
    mainCharacterName: row.main_character_name || null,
    pictureFilename: row.picture_filename || null,
    pictureMime: row.picture_mime || null,
    pictureSizeBytes: row.picture_size_bytes != null ? Number(row.picture_size_bytes) : null,
    pictureEtag: row.picture_etag || null,
    pictureUpdatedAt: row.picture_updated_at != null ? Number(row.picture_updated_at) : null,
    updatedAt: Number(row.updated_at) || 0,
  };
}

/** Fetch one profile by Discord user id, or null when no row exists yet. */
export function profileGetByUserId(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const row = db().prepare(`SELECT * FROM user_profiles WHERE user_id = ?`).get(uid);
  return profileRowToPublic(row);
}

/** Fetch many profiles in one round trip (used by leaderboard / Hall of Fame). */
export function profileGetByUserIds(userIds) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db()
    .prepare(`SELECT * FROM user_profiles WHERE user_id IN (${placeholders})`)
    .all(...ids);
  return rows.map(profileRowToPublic);
}

/**
 * Every profile that has a non-empty `main_character_name`. Used by the
 * character-name fallback endpoint — the table is small (per-user, opt-in
 * upload) so loading the full list is cheap, and the caller normalises
 * names in JS to match the same rules as Raid Helper / WCL keys.
 */
export function profileGetAllWithMainCharacter() {
  const rows = db()
    .prepare(
      `SELECT * FROM user_profiles
       WHERE main_character_name IS NOT NULL AND TRIM(main_character_name) <> ''`
    )
    .all();
  return rows.map(profileRowToPublic);
}

/** Every profile that has an uploaded picture. Used to build a name-keyed
 *  fallback index for the leaderboard when a row has no Discord id yet. */
export function profileGetAllWithPicture() {
  const rows = db()
    .prepare(
      `SELECT * FROM user_profiles
       WHERE picture_filename IS NOT NULL AND TRIM(picture_filename) <> ''`
    )
    .all();
  return rows.map(profileRowToPublic);
}

/**
 * Update profile picture metadata. Pass `pictureFilename: null` to clear.
 * Bytes are written separately by the route handler (server.js owns disk I/O
 * so the DB module stays pure metadata).
 */
export function profileSetPicture({
  userId,
  displayName,
  pictureFilename,
  pictureMime,
  pictureSizeBytes,
  pictureEtag,
  updatedAt,
}) {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("profileSetPicture requires userId");
  const dn = String(displayName || "").trim();
  const now = Number.isFinite(Number(updatedAt)) ? Math.floor(Number(updatedAt)) : Date.now();
  const filename = pictureFilename ? String(pictureFilename) : null;
  const mime = pictureMime ? String(pictureMime) : null;
  const size = Number.isFinite(Number(pictureSizeBytes)) ? Math.floor(Number(pictureSizeBytes)) : null;
  const etag = pictureEtag ? String(pictureEtag) : null;
  const action = filename ? "upsert" : "delete-picture";

  return db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO user_profiles
           (user_id, display_name, main_character_name, picture_filename, picture_mime, picture_size_bytes, picture_etag, picture_updated_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           display_name = COALESCE(NULLIF(excluded.display_name, ''), user_profiles.display_name),
           picture_filename = excluded.picture_filename,
           picture_mime = excluded.picture_mime,
           picture_size_bytes = excluded.picture_size_bytes,
           picture_etag = excluded.picture_etag,
           picture_updated_at = excluded.picture_updated_at,
           updated_at = excluded.updated_at`
      )
      .run(uid, dn, filename, mime, size, etag, filename ? now : null, now);
    db()
      .prepare(
        `INSERT INTO user_profile_history
           (user_id, display_name, action, main_character_name, picture_filename, picture_mime, picture_size_bytes, picture_etag, submitted_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`
      )
      .run(uid, dn, action, filename, mime, size, etag, now);
    return profileGetByUserId(uid);
  })();
}

/** Persist the user's chosen "main" WoW character name. Pass null/'' to clear. */
export function profileSetMainCharacter({ userId, displayName, mainCharacterName, updatedAt }) {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("profileSetMainCharacter requires userId");
  const dn = String(displayName || "").trim();
  const main = mainCharacterName ? String(mainCharacterName).trim().slice(0, 64) : null;
  const now = Number.isFinite(Number(updatedAt)) ? Math.floor(Number(updatedAt)) : Date.now();

  return db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO user_profiles (user_id, display_name, main_character_name, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           display_name = COALESCE(NULLIF(excluded.display_name, ''), user_profiles.display_name),
           main_character_name = excluded.main_character_name,
           updated_at = excluded.updated_at`
      )
      .run(uid, dn, main, now);
    db()
      .prepare(
        `INSERT INTO user_profile_history
           (user_id, display_name, action, main_character_name, submitted_at)
         VALUES (?, ?, 'set-main', ?, ?)`
      )
      .run(uid, dn, main, now);
    return profileGetByUserId(uid);
  })();
}

export function profileGetHistory({ limit = 200, userId } = {}) {
  const cap = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 200)));
  if (userId) {
    return db()
      .prepare(
        `SELECT id, user_id AS userId, display_name AS displayName, action,
                main_character_name AS mainCharacterName, picture_filename AS pictureFilename,
                picture_mime AS pictureMime, picture_size_bytes AS pictureSizeBytes,
                picture_etag AS pictureEtag, submitted_at AS submittedAt
         FROM user_profile_history WHERE user_id = ?
         ORDER BY submitted_at DESC, id DESC LIMIT ?`
      )
      .all(String(userId), cap);
  }
  return db()
    .prepare(
      `SELECT id, user_id AS userId, display_name AS displayName, action,
              main_character_name AS mainCharacterName, picture_filename AS pictureFilename,
              picture_mime AS pictureMime, picture_size_bytes AS pictureSizeBytes,
              picture_etag AS pictureEtag, submitted_at AS submittedAt
       FROM user_profile_history
       ORDER BY submitted_at DESC, id DESC LIMIT ?`
    )
    .all(cap);
}

// ============================================================
// Migration from legacy JSON files (one-shot, idempotent)
// ============================================================

function migrateLegacyJson(dataDir) {
  const flagRow = db()
    .prepare(`SELECT value FROM schema_meta WHERE key = ?`)
    .get("legacy_json_migrated");
  if (flagRow?.value === "1") return;

  const nvJsonPath = path.join(dataDir, "nether-vortex-needs.json");
  if (existsSync(nvJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(nvJsonPath, "utf8"));
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      for (const entry of entries) {
        if (!entry?.userId) continue;
        nvUpsertCurrent({
          userId: String(entry.userId),
          displayName: String(entry.displayName || "Unknown"),
          items: entry.items,
          neededCount: Number(entry.neededCount) || 0,
          updatedAt: Number(entry.updatedAt) || Date.now(),
        });
        db()
          .prepare(`UPDATE nv_needs_history SET action = 'migrate' WHERE id = (SELECT MAX(id) FROM nv_needs_history WHERE user_id = ?)`)
          .run(String(entry.userId));
      }
    } catch (error) {
      console.warn("[item-needs-db] failed to migrate nether-vortex-needs.json:", error?.message || error);
    }
  }

  const p2JsonPath = path.join(dataDir, "p2-materials.json");
  if (existsSync(p2JsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(p2JsonPath, "utf8"));
      const map = parsed?.currentById && typeof parsed.currentById === "object" ? parsed.currentById : {};
      const entries = Object.entries(map);
      const now = Date.now();
      for (const [matId, val] of entries) {
        const v = Number(val);
        if (!matId || !Number.isFinite(v)) continue;
        p2UpsertMaterial({
          materialId: String(matId),
          currentValue: Math.max(0, Math.floor(v)),
          updatedAt: now,
        });
      }
    } catch (error) {
      console.warn("[item-needs-db] failed to migrate p2-materials.json:", error?.message || error);
    }
  }

  db()
    .prepare(`INSERT INTO schema_meta (key, value) VALUES ('legacy_json_migrated', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run();
}
