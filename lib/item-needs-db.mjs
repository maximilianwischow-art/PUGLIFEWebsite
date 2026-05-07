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
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "4";

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

-- ============================================================
-- Canonical identity layer (Phase 1 of the canonical-user DB plan).
--
-- One row per raider we have ever seen, keyed by an internal
-- autoincrement id. discord_user_id is nullable so raiders we
-- only know via Raid Helper / Warcraft Logs get a stable row from
-- day one; when they log in via Discord, we just set their
-- discord_user_id and every existing FK keeps working.
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT UNIQUE,
  raid_helper_name TEXT,
  raid_helper_name_key TEXT,
  display_name TEXT,
  guild_role TEXT,
  main_character_id INTEGER,
  picture_filename TEXT,
  picture_mime TEXT,
  picture_size_bytes INTEGER,
  picture_etag TEXT,
  picture_updated_at INTEGER,
  is_authenticated INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_discord
  ON users(discord_user_id) WHERE discord_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_rh_key
  ON users(raid_helper_name_key) WHERE raid_helper_name_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS users_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'create',
    'update',
    'set-main',
    'set-picture',
    'clear-picture',
    'set-guild-role',
    'set-discord-id',
    'set-rh-name',
    'merge'
  )),
  discord_user_id TEXT,
  raid_helper_name TEXT,
  display_name TEXT,
  guild_role TEXT,
  main_character_id INTEGER,
  picture_filename TEXT,
  picture_etag TEXT,
  is_authenticated INTEGER,
  submitted_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_users_history_user
  ON users_history(user_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_history_time
  ON users_history(submitted_at DESC);

-- One row per (user, character). character_name_key is the
-- normalised lookup key (rhNameKey, mirror of server.js
-- normalizeRaidHelperDisplayKey) so name-based lookups are
-- O(1) instead of O(N) heuristics.
CREATE TABLE IF NOT EXISTS user_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_name TEXT NOT NULL,
  character_name_key TEXT NOT NULL,
  wow_class TEXT,
  wow_spec TEXT,
  realm TEXT,
  is_main INTEGER NOT NULL DEFAULT 0,
  discovered_via TEXT NOT NULL DEFAULT 'manual',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (user_id, character_name_key)
);

CREATE INDEX IF NOT EXISTS idx_chars_name_key
  ON user_characters(character_name_key);

CREATE INDEX IF NOT EXISTS idx_chars_user
  ON user_characters(user_id);

CREATE TABLE IF NOT EXISTS user_characters_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'create',
    'update',
    'set-main',
    'unset-main',
    'set-class-spec',
    'remove'
  )),
  character_name TEXT,
  wow_class TEXT,
  wow_spec TEXT,
  realm TEXT,
  is_main INTEGER,
  discovered_via TEXT,
  submitted_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_chars_history_char
  ON user_characters_history(character_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_chars_history_user
  ON user_characters_history(user_id, submitted_at DESC);

-- ============================================================
-- Phase 3 — small JSON stores migrated to SQLite
-- ============================================================

-- MVP votes (one row per round + voter; the candidate is the voted-for name).
CREATE TABLE IF NOT EXISTS mvp_votes (
  round_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  raid_code TEXT NOT NULL DEFAULT '',
  raid_start_time INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (round_key, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mvp_votes_round ON mvp_votes(round_key);
CREATE INDEX IF NOT EXISTS idx_mvp_votes_candidate ON mvp_votes(candidate_name);

-- Discord DM subscribers (per-user opt-in row).
CREATE TABLE IF NOT EXISTS dm_subscribers (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  global_name TEXT NOT NULL DEFAULT '',
  subscribed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Notified-events log (dedupe so we don't DM the same person twice for the
-- same event reminder).
CREATE TABLE IF NOT EXISTS dm_notified_events (
  event_id TEXT PRIMARY KEY,
  notified_at INTEGER NOT NULL
);

-- Role-alert DM send log: one row per (event, user) recording the send time.
CREATE TABLE IF NOT EXISTS role_alert_log (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_role_alert_event ON role_alert_log(event_id);
CREATE INDEX IF NOT EXISTS idx_role_alert_user ON role_alert_log(user_id);

-- Hall of Fame editorial notes.
CREATE TABLE IF NOT EXISTS hof_notes (
  winner_raid_key TEXT PRIMARY KEY,
  quote TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

-- ============================================================
-- Phase 4 — sync framework + materialized stat tables
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_state (
  task_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'failed')),
  last_started_at INTEGER,
  last_completed_at INTEGER,
  last_duration_ms INTEGER,
  last_error TEXT,
  next_due_at INTEGER,
  rows_changed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS raid_attendance (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_label TEXT NOT NULL,
  raids_attended INTEGER NOT NULL DEFAULT 0,
  raids_considered INTEGER NOT NULL DEFAULT 0,
  attendance_rate REAL NOT NULL DEFAULT 0,
  attendance_history TEXT NOT NULL DEFAULT '[]',
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, window_label)
);

CREATE TABLE IF NOT EXISTS death_totals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_label TEXT NOT NULL,
  death_count INTEGER NOT NULL DEFAULT 0,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, window_label)
);

CREATE TABLE IF NOT EXISTS first_clear_participants (
  raid_name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  character_id INTEGER REFERENCES user_characters(id) ON DELETE SET NULL,
  character_name TEXT NOT NULL,
  report_code TEXT,
  fight_id INTEGER,
  cleared_at INTEGER,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (raid_name, character_name)
);
CREATE INDEX IF NOT EXISTS idx_fc_user ON first_clear_participants(user_id);

CREATE TABLE IF NOT EXISTS best_time_roster (
  encounter_id INTEGER NOT NULL,
  encounter_name TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  character_id INTEGER REFERENCES user_characters(id) ON DELETE SET NULL,
  character_name TEXT NOT NULL,
  report_code TEXT,
  fight_id INTEGER,
  duration_ms INTEGER,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (encounter_id, character_name)
);

CREATE TABLE IF NOT EXISTS parse_summary (
  character_id INTEGER NOT NULL REFERENCES user_characters(id) ON DELETE CASCADE,
  bracket TEXT NOT NULL,
  best_value REAL,
  best_encounter TEXT,
  best_report_code TEXT,
  best_fight_id INTEGER,
  best_metric TEXT,
  best_at INTEGER,
  raids_in_bracket INTEGER NOT NULL DEFAULT 0,
  encounter_top_in_bracket INTEGER NOT NULL DEFAULT 0,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, bracket)
);

CREATE TABLE IF NOT EXISTS encounter_top_parse (
  character_id INTEGER NOT NULL REFERENCES user_characters(id) ON DELETE CASCADE,
  encounter_id INTEGER NOT NULL,
  bracket TEXT NOT NULL,
  best_value REAL,
  best_report_code TEXT,
  best_fight_id INTEGER,
  best_at INTEGER,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, encounter_id, bracket)
);

CREATE TABLE IF NOT EXISTS badge_state (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL,
  earned INTEGER NOT NULL DEFAULT 0,
  first_earned_at INTEGER,
  last_verified_at INTEGER NOT NULL,
  evidence_json TEXT,
  PRIMARY KEY (user_id, badge_id)
);

-- Per-(canonical-user, WCL report) appearance log. Counts the number of
-- distinct admin-curated guild raid events a user has actually shown up
-- to according to Warcraft Logs. The leaderboard "Events" KPI and the
-- 5/10/25/50/100 raid milestone badges read from this table; Attendance %
-- still uses the rolling raid_attendance window.
CREATE TABLE IF NOT EXISTS raid_appearances (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_code TEXT NOT NULL,
  report_started_at INTEGER,
  character_name TEXT NOT NULL DEFAULT '',
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, report_code)
);
CREATE INDEX IF NOT EXISTS idx_raid_appearances_report ON raid_appearances(report_code);
CREATE INDEX IF NOT EXISTS idx_raid_appearances_user ON raid_appearances(user_id);

CREATE TABLE IF NOT EXISTS loot_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  character_id INTEGER REFERENCES user_characters(id) ON DELETE SET NULL,
  character_name TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  item_name TEXT,
  awarded_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  report_code TEXT,
  report_title TEXT,
  report_raid_name TEXT,
  report_uploader TEXT,
  raw_type TEXT,
  UNIQUE (source, source_ref, item_id, character_name)
);
CREATE INDEX IF NOT EXISTS idx_loot_user ON loot_awards(user_id);
CREATE INDEX IF NOT EXISTS idx_loot_char ON loot_awards(character_id);
CREATE INDEX IF NOT EXISTS idx_loot_awarded_at ON loot_awards(awarded_at);
-- idx_loot_report_code is created by applyAdditiveColumnMigrations after the
-- column ALTER lands; doing it here would crash on old DBs that don't yet
-- have the report_code column.
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
  applyAdditiveColumnMigrations(db);
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

/**
 * Idempotent additive column migrations. SQLite's `CREATE TABLE IF NOT EXISTS`
 * leaves an existing table's columns alone, so any column we add to a table
 * after the first deploy needs an explicit `ALTER TABLE … ADD COLUMN`. We
 * scan `PRAGMA table_info(<table>)` and only run the ALTER when the column
 * is missing, so re-running on an already-migrated DB is a no-op.
 */
function applyAdditiveColumnMigrations(db) {
  const additions = [
    { table: "loot_awards", column: "item_name", type: "TEXT" },
    { table: "loot_awards", column: "report_code", type: "TEXT" },
    { table: "loot_awards", column: "report_title", type: "TEXT" },
    { table: "loot_awards", column: "report_raid_name", type: "TEXT" },
    { table: "loot_awards", column: "report_uploader", type: "TEXT" },
    { table: "loot_awards", column: "raw_type", type: "TEXT" },
  ];
  for (const { table, column, type } of additions) {
    try {
      const existing = db.prepare(`PRAGMA table_info(${table})`).all();
      if (existing.some((r) => String(r?.name) === column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (error) {
      console.warn(
        `[item-needs-db] additive migration failed for ${table}.${column}:`,
        error?.message || error
      );
    }
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_loot_report_code ON loot_awards(report_code)`);
  } catch (error) {
    console.warn("[item-needs-db] idx_loot_report_code create failed:", error?.message || error);
  }
}

/** @returns {Database.Database} */
function db() {
  if (!dbInstance) throw new Error("openItemNeedsDb has not been called yet");
  return dbInstance;
}

export function getItemNeedsDbPath() {
  return dbPath;
}

/**
 * Take a point-in-time copy of the SQLite database to `targetPath` using
 * `VACUUM INTO`. Atomic on success, leaves `targetPath` absent on failure.
 * Returns `{ targetPath, sizeBytes }`.
 */
export function backupItemNeedsDb(targetPath) {
  const dest = String(targetPath || "").trim();
  if (!dest) throw new Error("backupItemNeedsDb requires a targetPath");
  const file = db();
  const escaped = dest.replace(/'/g, "''");
  file.exec(`VACUUM INTO '${escaped}'`);
  let sizeBytes = 0;
  try {
    sizeBytes = Number(statSync(dest).size) || 0;
  } catch {
    /* size is informational only */
  }
  return { targetPath: dest, sizeBytes };
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
    // Dual-write to the canonical identity layer so users.picture_filename
    // stays fresh between migration script runs. Only updates a row that
    // already exists — we don't create canonical users from a profile-only
    // event (no RH name available here).
    db()
      .prepare(
        `UPDATE users SET
           picture_filename = ?,
           picture_mime = ?,
           picture_size_bytes = ?,
           picture_etag = ?,
           picture_updated_at = ?,
           display_name = COALESCE(NULLIF(?, ''), display_name),
           is_authenticated = 1,
           last_seen_at = ?
         WHERE discord_user_id = ?`
      )
      .run(filename, mime, size, etag, filename ? now : null, dn, now, uid);
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
    // Dual-write to the canonical identity layer when we already have a
    // matching user row. Idempotent — re-runs against the same target
    // produce the same is_main flags.
    const canonical = db()
      .prepare(`SELECT id FROM users WHERE discord_user_id = ?`)
      .get(uid);
    if (canonical?.id) {
      const userId = Number(canonical.id);
      let mainCharacterId = null;
      if (main) {
        const character = characterUpsert({
          userId,
          characterName: main,
          discoveredVia: "profile-main",
          source: "dualwrite:profile-set-main",
          updatedAt: now,
        });
        mainCharacterId = character.id;
      }
      userSetMainCharacter({
        userId,
        characterId: mainCharacterId,
        source: "dualwrite:profile-set-main",
        updatedAt: now,
      });
    }
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
// Canonical identity layer — public API (Phase 1 of canonical-user DB)
// ============================================================

/**
 * Mirror of `server.js#normalizeRaidHelperDisplayKey` — strips "Name/Alt"
 * and a trailing "-Realm" suffix, then lowercases. Kept here so the DB
 * module is self-contained and we can index against this key without
 * importing from server.js.
 */
export function rhNameKey(name) {
  let s = String(name || "")
    .trim()
    .replace(/\u00a0/g, " ");
  const slash = s.indexOf("/");
  if (slash > 0) s = s.slice(0, slash).trim();
  return s
    .replace(/\s*[-–—]\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-\s]*$/u, "")
    .toLowerCase();
}

function userRowToPublic(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    discordUserId: row.discord_user_id || null,
    raidHelperName: row.raid_helper_name || null,
    raidHelperNameKey: row.raid_helper_name_key || null,
    displayName: row.display_name || null,
    guildRole: row.guild_role || null,
    mainCharacterId: row.main_character_id != null ? Number(row.main_character_id) : null,
    pictureFilename: row.picture_filename || null,
    pictureMime: row.picture_mime || null,
    pictureSizeBytes: row.picture_size_bytes != null ? Number(row.picture_size_bytes) : null,
    pictureEtag: row.picture_etag || null,
    pictureUpdatedAt: row.picture_updated_at != null ? Number(row.picture_updated_at) : null,
    isAuthenticated: row.is_authenticated ? 1 : 0,
    firstSeenAt: Number(row.first_seen_at) || 0,
    lastSeenAt: Number(row.last_seen_at) || 0,
  };
}

function characterRowToPublic(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    characterName: row.character_name || "",
    characterNameKey: row.character_name_key || "",
    wowClass: row.wow_class || null,
    wowSpec: row.wow_spec || null,
    realm: row.realm || null,
    isMain: row.is_main ? 1 : 0,
    discoveredVia: row.discovered_via || "manual",
    firstSeenAt: Number(row.first_seen_at) || 0,
    lastSeenAt: Number(row.last_seen_at) || 0,
  };
}

function appendUserHistory({ userId, action, source = "", row, when }) {
  const at = Number.isFinite(Number(when)) ? Math.floor(Number(when)) : Date.now();
  db()
    .prepare(
      `INSERT INTO users_history
         (user_id, action, discord_user_id, raid_helper_name, display_name, guild_role,
          main_character_id, picture_filename, picture_etag, is_authenticated,
          submitted_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(userId),
      String(action),
      row?.discord_user_id ?? null,
      row?.raid_helper_name ?? null,
      row?.display_name ?? null,
      row?.guild_role ?? null,
      row?.main_character_id != null ? Number(row.main_character_id) : null,
      row?.picture_filename ?? null,
      row?.picture_etag ?? null,
      row?.is_authenticated != null ? (row.is_authenticated ? 1 : 0) : null,
      at,
      String(source || "")
    );
}

function appendCharacterHistory({ characterId, userId, action, source = "", row, when }) {
  const at = Number.isFinite(Number(when)) ? Math.floor(Number(when)) : Date.now();
  db()
    .prepare(
      `INSERT INTO user_characters_history
         (character_id, user_id, action, character_name, wow_class, wow_spec, realm,
          is_main, discovered_via, submitted_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(characterId),
      Number(userId),
      String(action),
      row?.character_name ?? null,
      row?.wow_class ?? null,
      row?.wow_spec ?? null,
      row?.realm ?? null,
      row?.is_main != null ? (row.is_main ? 1 : 0) : null,
      row?.discovered_via ?? null,
      at,
      String(source || "")
    );
}

/**
 * Look up a user row by Discord id. Returns `null` when there is no row,
 * which is the canonical "this Discord id has never logged in or been seen
 * by an admin sync".
 */
export function userGetByDiscordId(discordUserId) {
  const id = String(discordUserId || "").trim();
  if (!id) return null;
  const row = db().prepare(`SELECT * FROM users WHERE discord_user_id = ?`).get(id);
  return userRowToPublic(row);
}

/** Look up a user row by internal id. */
export function userGetById(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = db().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  return userRowToPublic(row);
}

/** Look up a user row by normalised Raid Helper name key (`rhNameKey`). */
export function userGetByRaidHelperKey(rhKey) {
  const key = String(rhKey || "").trim().toLowerCase();
  if (!key) return null;
  const row = db().prepare(`SELECT * FROM users WHERE raid_helper_name_key = ?`).get(key);
  return userRowToPublic(row);
}

/**
 * Find the user that owns a given WoW character by character name. Match
 * order:
 *   1. Exact `character_name_key` match in `user_characters`.
 *   2. `raid_helper_name_key` on `users`.
 * Returns the joined user row, or `null` if nothing claims this name.
 */
export function userGetByCharacterName(characterName) {
  const raw = String(characterName || "").trim();
  if (!raw) return null;
  const key = rhNameKey(raw);
  if (!key) return null;
  const charHit = db()
    .prepare(
      `SELECT u.* FROM users u
       INNER JOIN user_characters c ON c.user_id = u.id
       WHERE c.character_name_key = ?
       ORDER BY c.is_main DESC, c.last_seen_at DESC
       LIMIT 1`
    )
    .get(key);
  if (charHit) return userRowToPublic(charHit);
  const userHit = db()
    .prepare(`SELECT * FROM users WHERE raid_helper_name_key = ? LIMIT 1`)
    .get(key);
  return userRowToPublic(userHit);
}

/** All users (small table; iterating is cheap for backfills / admin diff). */
export function userListAll() {
  const rows = db().prepare(`SELECT * FROM users ORDER BY id`).all();
  return rows.map(userRowToPublic);
}

/**
 * Count canonical users in the `users` table. This is the authoritative
 * "unique raiders in our database" KPI surfaced on the Raid Performance
 * card — every Discord identity we have on file (discord_user_id and/or
 * raid_helper_name_key set), regardless of whether they have a linked
 * WoW character or a WCL appearance yet.
 */
export function userCount() {
  const row = db().prepare(`SELECT COUNT(*) AS n FROM users`).get();
  return Number(row?.n || 0);
}

/**
 * Upsert a user row. Identity match preference:
 *   1. `discordUserId` (canonical).
 *   2. Existing row keyed by `raidHelperName` if Discord id is unset.
 *   3. Otherwise create a new row.
 *
 * Pass any subset of fields — only provided fields are updated. Returns the
 * post-write row.
 */
export function userUpsert(input) {
  const now = Number.isFinite(Number(input?.updatedAt)) ? Math.floor(Number(input.updatedAt)) : Date.now();
  const discordId = input?.discordUserId ? String(input.discordUserId).trim() : null;
  const rhName = input?.raidHelperName != null ? String(input.raidHelperName) : null;
  const rhKey = rhName != null ? rhNameKey(rhName) || null : null;
  const displayName = input?.displayName != null ? String(input.displayName) : null;
  const guildRole = input?.guildRole != null ? String(input.guildRole) : null;
  const isAuth = input?.isAuthenticated ? 1 : input?.isAuthenticated === false ? 0 : null;
  const source = String(input?.source || "");

  return db().transaction(() => {
    let row = null;
    if (discordId) {
      row = db().prepare(`SELECT * FROM users WHERE discord_user_id = ?`).get(discordId);
    }
    // Adopt an unlinked RH-only row when its name matches and we now know
    // the Discord id. Covers the "Charlie logs in for the first time"
    // case: row(id=3, rh=Charlie, discord=null) becomes row(id=3,
    // rh=Charlie, discord=300) instead of a new id=4.
    if (!row && rhKey) {
      row = db()
        .prepare(`SELECT * FROM users WHERE raid_helper_name_key = ? AND discord_user_id IS NULL LIMIT 1`)
        .get(rhKey);
    }
    if (!row) {
      const info = db()
        .prepare(
          `INSERT INTO users
             (discord_user_id, raid_helper_name, raid_helper_name_key, display_name,
              guild_role, is_authenticated, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(discordId, rhName, rhKey, displayName, guildRole, isAuth ? 1 : 0, now, now);
      const id = Number(info.lastInsertRowid);
      const newRow = db().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
      appendUserHistory({ userId: id, action: "create", source, row: newRow, when: now });
      return userRowToPublic(newRow);
    }
    const updates = [];
    const params = [];
    if (discordId && row.discord_user_id !== discordId) {
      updates.push("discord_user_id = ?");
      params.push(discordId);
    }
    if (rhName != null && row.raid_helper_name !== rhName) {
      updates.push("raid_helper_name = ?");
      params.push(rhName);
      updates.push("raid_helper_name_key = ?");
      params.push(rhKey);
    }
    if (displayName != null && row.display_name !== displayName) {
      updates.push("display_name = ?");
      params.push(displayName);
    }
    if (guildRole != null && row.guild_role !== guildRole) {
      updates.push("guild_role = ?");
      params.push(guildRole);
    }
    if (isAuth != null && (row.is_authenticated ? 1 : 0) !== isAuth) {
      updates.push("is_authenticated = ?");
      params.push(isAuth);
    }
    updates.push("last_seen_at = ?");
    params.push(now);
    params.push(Number(row.id));
    db().prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    const updated = db().prepare(`SELECT * FROM users WHERE id = ?`).get(Number(row.id));
    appendUserHistory({ userId: Number(row.id), action: "update", source, row: updated, when: now });
    return userRowToPublic(updated);
  })();
}

/**
 * Add or refresh a (user, character) row. Matched by `(user_id,
 * character_name_key)`; the visible casing in `character_name` is whatever
 * the most recent caller passed. Returns the post-write row.
 */
export function characterUpsert(input) {
  const userId = Number(input?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("characterUpsert requires a positive integer userId");
  }
  const characterName = String(input?.characterName || "").trim();
  if (!characterName) throw new Error("characterUpsert requires characterName");
  const key = rhNameKey(characterName);
  if (!key) throw new Error("characterUpsert: characterName normalised to empty key");
  const wowClass = input?.wowClass != null ? String(input.wowClass).trim() || null : null;
  const wowSpec = input?.wowSpec != null ? String(input.wowSpec).trim() || null : null;
  const realm = input?.realm != null ? String(input.realm).trim() || null : null;
  const discoveredVia = String(input?.discoveredVia || "manual");
  const isMain = input?.isMain ? 1 : input?.isMain === false ? 0 : null;
  const now = Number.isFinite(Number(input?.updatedAt)) ? Math.floor(Number(input.updatedAt)) : Date.now();
  const source = String(input?.source || "");

  return db().transaction(() => {
    const existing = db()
      .prepare(`SELECT * FROM user_characters WHERE user_id = ? AND character_name_key = ?`)
      .get(userId, key);
    if (!existing) {
      const info = db()
        .prepare(
          `INSERT INTO user_characters
             (user_id, character_name, character_name_key, wow_class, wow_spec, realm,
              is_main, discovered_via, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(userId, characterName, key, wowClass, wowSpec, realm, isMain ? 1 : 0, discoveredVia, now, now);
      const id = Number(info.lastInsertRowid);
      const newRow = db().prepare(`SELECT * FROM user_characters WHERE id = ?`).get(id);
      appendCharacterHistory({
        characterId: id,
        userId,
        action: "create",
        source,
        row: newRow,
        when: now,
      });
      return characterRowToPublic(newRow);
    }
    const updates = [];
    const params = [];
    if (existing.character_name !== characterName) {
      updates.push("character_name = ?");
      params.push(characterName);
    }
    if (wowClass != null && existing.wow_class !== wowClass) {
      updates.push("wow_class = ?");
      params.push(wowClass);
    }
    if (wowSpec != null && existing.wow_spec !== wowSpec) {
      updates.push("wow_spec = ?");
      params.push(wowSpec);
    }
    if (realm != null && existing.realm !== realm) {
      updates.push("realm = ?");
      params.push(realm);
    }
    if (isMain != null && (existing.is_main ? 1 : 0) !== isMain) {
      updates.push("is_main = ?");
      params.push(isMain);
    }
    updates.push("last_seen_at = ?");
    params.push(now);
    params.push(Number(existing.id));
    db().prepare(`UPDATE user_characters SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    const updated = db().prepare(`SELECT * FROM user_characters WHERE id = ?`).get(Number(existing.id));
    appendCharacterHistory({
      characterId: Number(existing.id),
      userId,
      action: "update",
      source,
      row: updated,
      when: now,
    });
    return characterRowToPublic(updated);
  })();
}

/** Set / clear the main character for a user. Updates the `is_main` flag on
 *  every linked character so only one is marked main at a time. */
export function userSetMainCharacter({ userId, characterId, source = "", updatedAt }) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error("userSetMainCharacter: bad userId");
  const cid = characterId == null ? null : Number(characterId);
  if (cid != null && (!Number.isInteger(cid) || cid <= 0)) {
    throw new Error("userSetMainCharacter: bad characterId");
  }
  const now = Number.isFinite(Number(updatedAt)) ? Math.floor(Number(updatedAt)) : Date.now();
  return db().transaction(() => {
    db().prepare(`UPDATE user_characters SET is_main = 0, last_seen_at = ? WHERE user_id = ?`).run(now, uid);
    if (cid != null) {
      db()
        .prepare(`UPDATE user_characters SET is_main = 1, last_seen_at = ? WHERE id = ? AND user_id = ?`)
        .run(now, cid, uid);
    }
    db().prepare(`UPDATE users SET main_character_id = ?, last_seen_at = ? WHERE id = ?`).run(cid, now, uid);
    const userRow = db().prepare(`SELECT * FROM users WHERE id = ?`).get(uid);
    appendUserHistory({ userId: uid, action: "set-main", source, row: userRow, when: now });
    if (cid != null) {
      const charRow = db().prepare(`SELECT * FROM user_characters WHERE id = ?`).get(cid);
      if (charRow) {
        appendCharacterHistory({
          characterId: cid,
          userId: uid,
          action: "set-main",
          source,
          row: charRow,
          when: now,
        });
      }
    }
    return userRowToPublic(userRow);
  })();
}

/** All characters belonging to one user, ordered main first then most recently seen. */
export function charactersGetByUserId(userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return [];
  const rows = db()
    .prepare(
      `SELECT * FROM user_characters
       WHERE user_id = ?
       ORDER BY is_main DESC, last_seen_at DESC`
    )
    .all(uid);
  return rows.map(characterRowToPublic);
}

/** Reverse lookup: every character matching `name_key` (small N — usually 1). */
export function charactersGetByNameKey(nameKey) {
  const key = String(nameKey || "").trim().toLowerCase();
  if (!key) return [];
  const rows = db()
    .prepare(
      `SELECT * FROM user_characters WHERE character_name_key = ? ORDER BY is_main DESC, last_seen_at DESC`
    )
    .all(key);
  return rows.map(characterRowToPublic);
}

/** Update profile picture metadata + history on the canonical `users` row.
 *  Mirrors `profileSetPicture` for the legacy `user_profiles` table — kept
 *  separate while both tables coexist during the migration. */
export function userSetPicture(input) {
  const userId = Number(input?.userId);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("userSetPicture: bad userId");
  const filename = input?.pictureFilename ? String(input.pictureFilename) : null;
  const mime = input?.pictureMime ? String(input.pictureMime) : null;
  const size = Number.isFinite(Number(input?.pictureSizeBytes))
    ? Math.floor(Number(input.pictureSizeBytes))
    : null;
  const etag = input?.pictureEtag ? String(input.pictureEtag) : null;
  const now = Number.isFinite(Number(input?.updatedAt)) ? Math.floor(Number(input.updatedAt)) : Date.now();
  const source = String(input?.source || "");
  return db().transaction(() => {
    db()
      .prepare(
        `UPDATE users SET
           picture_filename = ?,
           picture_mime = ?,
           picture_size_bytes = ?,
           picture_etag = ?,
           picture_updated_at = ?,
           last_seen_at = ?
         WHERE id = ?`
      )
      .run(filename, mime, size, etag, filename ? now : null, now, userId);
    const userRow = db().prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    appendUserHistory({
      userId,
      action: filename ? "set-picture" : "clear-picture",
      source,
      row: userRow,
      when: now,
    });
    return userRowToPublic(userRow);
  })();
}

/** Recent identity history (audit feed). */
export function userGetHistory({ limit = 200, userId } = {}) {
  const cap = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 200)));
  if (userId) {
    return db()
      .prepare(
        `SELECT id, user_id AS userId, action, discord_user_id AS discordUserId,
                raid_helper_name AS raidHelperName, display_name AS displayName,
                guild_role AS guildRole, main_character_id AS mainCharacterId,
                picture_filename AS pictureFilename, picture_etag AS pictureEtag,
                is_authenticated AS isAuthenticated, submitted_at AS submittedAt,
                source
         FROM users_history WHERE user_id = ?
         ORDER BY submitted_at DESC, id DESC LIMIT ?`
      )
      .all(Number(userId), cap);
  }
  return db()
    .prepare(
      `SELECT id, user_id AS userId, action, discord_user_id AS discordUserId,
              raid_helper_name AS raidHelperName, display_name AS displayName,
              guild_role AS guildRole, main_character_id AS mainCharacterId,
              picture_filename AS pictureFilename, picture_etag AS pictureEtag,
              is_authenticated AS isAuthenticated, submitted_at AS submittedAt,
              source
       FROM users_history
       ORDER BY submitted_at DESC, id DESC LIMIT ?`
    )
    .all(cap);
}

/**
 * One-shot helper for the migration script + sync workers. Upserts the
 * user, then upserts every character name in `characterNames`, then sets
 * `mainCharacterName` as main if provided. All in a single transaction.
 */
export function userUpsertWithCharacters(input) {
  const characterNames = Array.isArray(input?.characterNames) ? input.characterNames : [];
  const mainCharacterName = input?.mainCharacterName ? String(input.mainCharacterName).trim() : "";
  const source = String(input?.source || "");
  const now = Number.isFinite(Number(input?.updatedAt)) ? Math.floor(Number(input.updatedAt)) : Date.now();
  return db().transaction(() => {
    const user = userUpsert({ ...input, updatedAt: now });
    let mainCharacterId = null;
    for (const raw of characterNames) {
      const name = String(raw || "").trim();
      if (!name) continue;
      const isMain = mainCharacterName ? rhNameKey(name) === rhNameKey(mainCharacterName) : false;
      const character = characterUpsert({
        userId: user.id,
        characterName: name,
        discoveredVia: input?.discoveredVia || "rh-signup",
        source,
        updatedAt: now,
      });
      if (isMain) mainCharacterId = character.id;
    }
    if (mainCharacterName && !mainCharacterId) {
      const character = characterUpsert({
        userId: user.id,
        characterName: mainCharacterName,
        discoveredVia: input?.discoveredVia || "profile-main",
        source,
        updatedAt: now,
      });
      mainCharacterId = character.id;
    }
    if (mainCharacterId) {
      userSetMainCharacter({ userId: user.id, characterId: mainCharacterId, source, updatedAt: now });
    }
    return userGetById(user.id);
  })();
}

// ============================================================
// Phase 2 — SQL-backed name-resolution replacements
// ============================================================

/**
 * Replacement for the legacy `listLinkedWowCharactersForDiscordUserId`.
 * Returns an ordered, de-duplicated list of WoW character names belonging
 * to a Discord user. Order priority (matches the legacy heuristic):
 *   1. Main character (`is_main = 1`)
 *   2. Other linked characters in `user_characters`, most-recently-seen first
 *   3. The user's `raid_helper_name` if not already in the list
 *   4. (Fallback) names linked under any `users` row matching by RH key
 *      derived from `displayName`, when the Discord id has no row yet.
 */
export function identityListLinkedCharacterNames({ discordUserId, displayName } = {}) {
  const id = String(discordUserId || "").trim();
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const name = String(raw || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  let user = null;
  if (id) user = userGetByDiscordId(id);
  if (user) {
    const characters = charactersGetByUserId(user.id);
    for (const c of characters) {
      if (c.isMain) push(c.characterName);
    }
    for (const c of characters) push(c.characterName);
    if (user.raidHelperName) push(user.raidHelperName);
  }

  if (!out.length) {
    const dnKey = rhNameKey(String(displayName || ""));
    if (dnKey) {
      const fallbackUser = userGetByRaidHelperKey(dnKey);
      if (fallbackUser) {
        const characters = charactersGetByUserId(fallbackUser.id);
        for (const c of characters) {
          if (c.isMain) push(c.characterName);
        }
        for (const c of characters) push(c.characterName);
        if (fallbackUser.raidHelperName) push(fallbackUser.raidHelperName);
      }
      // Also match against any character-name-key (e.g. user logged in with
      // a Discord nick that happens to equal a known WoW character name).
      const charHits = charactersGetByNameKey(dnKey);
      for (const ch of charHits) {
        const owner = userGetById(ch.userId);
        if (!owner) continue;
        const allChars = charactersGetByUserId(owner.id);
        for (const c of allChars) push(c.characterName);
        if (owner.raidHelperName) push(owner.raidHelperName);
      }
    }
  }

  return out;
}

/**
 * Resolve profile-picture metadata for a list of WoW character names. Used
 * by `/api/profiles/by-character-names` so the leaderboard can show portrait
 * overrides for raiders we know via WCL but who haven't logged in via
 * Discord yet (and therefore have no `discordUserId` on their row).
 *
 * Returns an object keyed by the *original* requested name with the same
 * shape as the legacy endpoint: `{ userId, mainCharacterName, pictureUrl }`
 * plus an extra `dbUserId` (canonical `users.id`) so callers can switch off
 * Discord-id lookups in Phase 2.2.
 */
export function identityResolveProfilesByCharacterNames(names) {
  const namesIn = (Array.isArray(names) ? names : [])
    .map((n) => String(n || "").trim())
    .filter(Boolean)
    .slice(0, 200);
  if (!namesIn.length) return {};

  // Build wanted key -> first original name (so we can return the same
  // casing the caller asked about, like the legacy endpoint did).
  const wantedKeys = new Map();
  for (const name of namesIn) {
    const key = rhNameKey(name);
    if (!key || wantedKeys.has(key)) continue;
    wantedKeys.set(key, name);
  }
  if (!wantedKeys.size) return {};

  const placeholders = [...wantedKeys.keys()].map(() => "?").join(",");
  const wantedKeyArr = [...wantedKeys.keys()];

  // One query: every (character_name_key, picture_filename) pair where the
  // owning user has a picture. Picks main character first when multiple
  // characters of the same user could match (rare but possible).
  const rows = db()
    .prepare(
      `SELECT
         u.id              AS userId,
         u.discord_user_id AS discordUserId,
         u.picture_filename AS pictureFilename,
         u.picture_etag     AS pictureEtag,
         u.picture_updated_at AS pictureUpdatedAt,
         c.character_name   AS characterName,
         c.character_name_key AS characterNameKey,
         c.is_main          AS isMain
       FROM user_characters c
       INNER JOIN users u ON u.id = c.user_id
       WHERE u.picture_filename IS NOT NULL
         AND TRIM(u.picture_filename) <> ''
         AND c.character_name_key IN (${placeholders})

       UNION ALL

       SELECT
         u.id              AS userId,
         u.discord_user_id AS discordUserId,
         u.picture_filename AS pictureFilename,
         u.picture_etag     AS pictureEtag,
         u.picture_updated_at AS pictureUpdatedAt,
         u.raid_helper_name AS characterName,
         u.raid_helper_name_key AS characterNameKey,
         0                  AS isMain
       FROM users u
       WHERE u.picture_filename IS NOT NULL
         AND TRIM(u.picture_filename) <> ''
         AND u.raid_helper_name_key IN (${placeholders})`
    )
    .all(...wantedKeyArr, ...wantedKeyArr);

  // Pick the best row per wanted key — main character beats alt, alt beats
  // RH-name match. Stable ordering for equal scores.
  const scoreOf = (r) => (r.isMain ? 2 : r.characterName && r.characterNameKey === r.characterName.toLowerCase() ? 1 : 1);
  const bestByKey = new Map();
  for (const r of rows) {
    const k = String(r.characterNameKey || "").toLowerCase();
    if (!k) continue;
    const prev = bestByKey.get(k);
    if (!prev || scoreOf(r) > scoreOf(prev)) bestByKey.set(k, r);
  }

  const out = {};
  for (const [key, originalName] of wantedKeys.entries()) {
    const row = bestByKey.get(key);
    if (!row?.pictureFilename) continue;
    out[originalName] = {
      userId: row.discordUserId || null,
      dbUserId: Number(row.userId),
      mainCharacterName: row.isMain ? row.characterName : null,
      pictureUrl: row.discordUserId
        ? `/api/profile/picture/${encodeURIComponent(row.discordUserId)}?v=${row.pictureEtag || row.pictureUpdatedAt || 0}`
        : `/api/profile/picture/by-user/${row.userId}?v=${row.pictureEtag || row.pictureUpdatedAt || 0}`,
    };
  }
  return out;
}

/**
 * Build the full RH-key -> Discord-id map used by
 * `buildActiveRosterPlayersForGuild` to attach `discordUserId` onto roster
 * rows. Single SQL query; one row per `(character_name_key, discord_user_id)`
 * and `(raid_helper_name_key, discord_user_id)` pair.
 */
export function identityResolveDiscordIdsByRhKey() {
  const out = new Map();
  const remember = (key, id) => {
    if (!key || !id) return;
    if (!out.has(key)) out.set(key, id);
  };
  const charRows = db()
    .prepare(
      `SELECT u.discord_user_id AS discordUserId, c.character_name_key AS key
       FROM user_characters c
       INNER JOIN users u ON u.id = c.user_id
       WHERE u.discord_user_id IS NOT NULL`
    )
    .all();
  for (const r of charRows) remember(r.key, r.discordUserId);
  const userRows = db()
    .prepare(
      `SELECT discord_user_id AS discordUserId, raid_helper_name_key AS key
       FROM users
       WHERE discord_user_id IS NOT NULL AND raid_helper_name_key IS NOT NULL`
    )
    .all();
  for (const r of userRows) remember(r.key, r.discordUserId);
  return out;
}

/**
 * Resolve a single canonical character name for one Discord user. Mirror of
 * the legacy `resolveLinkedWowCharacterByDiscordUserId`. Picks the main
 * character if set, else the most-recently-seen linked character, else the
 * RH name. Returns `null` when nothing is known.
 */
export function identityResolveCharacterByDiscordId(discordUserId) {
  const id = String(discordUserId || "").trim();
  if (!id) return null;
  const user = userGetByDiscordId(id);
  if (!user) return null;
  const characters = charactersGetByUserId(user.id);
  const main = characters.find((c) => c.isMain);
  if (main?.characterName) return main.characterName;
  if (characters[0]?.characterName) return characters[0].characterName;
  if (user.raidHelperName) return user.raidHelperName;
  return null;
}

/**
 * Resolve the most-recently-known Raid Helper signup name for a Discord
 * user. Mirror of the legacy `resolveRaidHelperNameByDiscordUserId` (sync
 * variant). Returns `""` when nothing is known.
 */
export function identityResolveRaidHelperNameByDiscordId(discordUserId) {
  const id = String(discordUserId || "").trim();
  if (!id) return "";
  const user = userGetByDiscordId(id);
  return user?.raidHelperName || "";
}

// ============================================================
// Phase 3 — small JSON stores: helpers + bulk replace-from-state
// ============================================================
//
// Every helper here is designed to dual-write the in-memory state owned by
// `server.js` into SQLite without changing the JSON contract. Each
// `replaceXxxFromState` is called from the matching `persistXxx()` JSON
// writer and rebuilds the table from scratch in one transaction. Tables
// are small (votes / opt-ins / send logs) so a full replace per persist
// is the simplest correctness story; if traffic ever grew we'd switch to
// per-row upserts.

/** Replace `mvp_votes` from an in-memory `{ votes: Array<row> }` snapshot. */
export function mvpVotesReplaceFromState(state) {
  const votes = Array.isArray(state?.votes) ? state.votes : [];
  return db().transaction(() => {
    db().prepare(`DELETE FROM mvp_votes`).run();
    if (!votes.length) return { rows: 0 };
    const stmt = db().prepare(
      `INSERT INTO mvp_votes (round_key, user_id, candidate_name, raid_code, raid_start_time, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(round_key, user_id) DO UPDATE SET
         candidate_name = excluded.candidate_name,
         raid_code = excluded.raid_code,
         raid_start_time = excluded.raid_start_time,
         updated_at = excluded.updated_at`
    );
    let rows = 0;
    for (const v of votes) {
      const roundKey = String(v?.roundKey || "").trim();
      const userId = String(v?.userId || "").trim();
      const candidateName = String(v?.candidateName || "").trim();
      if (!roundKey || !userId || !candidateName) continue;
      stmt.run(
        roundKey,
        userId,
        candidateName,
        String(v?.raidCode || ""),
        Number(v?.raidStartTime || 0),
        Number(v?.createdAt || Date.now()),
        Number(v?.updatedAt || Date.now())
      );
      rows += 1;
    }
    return { rows };
  })();
}

/** Read every MVP vote — used by the hall-of-fame computation. */
export function mvpVotesGetAll() {
  return db()
    .prepare(
      `SELECT round_key AS roundKey, user_id AS userId, candidate_name AS candidateName,
              raid_code AS raidCode, raid_start_time AS raidStartTime,
              created_at AS createdAt, updated_at AS updatedAt
       FROM mvp_votes`
    )
    .all();
}

/**
 * Replace `dm_subscribers` + `dm_notified_events` from the in-memory
 * `{ subscribersByUserId, notifiedEventIds }` snapshot.
 */
export function dmSubscribersReplaceFromState(state) {
  const subsIn = state?.subscribersByUserId && typeof state.subscribersByUserId === "object" ? state.subscribersByUserId : {};
  const notifiedIn = Array.isArray(state?.notifiedEventIds) ? state.notifiedEventIds : [];
  return db().transaction(() => {
    db().prepare(`DELETE FROM dm_subscribers`).run();
    db().prepare(`DELETE FROM dm_notified_events`).run();
    let subRows = 0;
    const subStmt = db().prepare(
      `INSERT INTO dm_subscribers (user_id, username, global_name, subscribed, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         username = excluded.username,
         global_name = excluded.global_name,
         subscribed = excluded.subscribed,
         updated_at = excluded.updated_at`
    );
    for (const [userIdRaw, row] of Object.entries(subsIn)) {
      const userId = String(userIdRaw || row?.userId || "").trim();
      if (!userId) continue;
      subStmt.run(
        userId,
        String(row?.username || ""),
        String(row?.globalName || ""),
        row?.subscribed ? 1 : 0,
        Number(row?.updatedAt || Date.now())
      );
      subRows += 1;
    }
    let notifiedRows = 0;
    const notifStmt = db().prepare(
      `INSERT INTO dm_notified_events (event_id, notified_at)
       VALUES (?, ?)
       ON CONFLICT(event_id) DO UPDATE SET notified_at = MAX(dm_notified_events.notified_at, excluded.notified_at)`
    );
    const seen = new Set();
    for (const evRaw of notifiedIn) {
      const ev = String(evRaw || "").trim();
      if (!ev || seen.has(ev)) continue;
      seen.add(ev);
      notifStmt.run(ev, Date.now());
      notifiedRows += 1;
    }
    return { subRows, notifiedRows };
  })();
}

/** Read every DM subscriber row. */
export function dmSubscribersGetAll() {
  return db()
    .prepare(
      `SELECT user_id AS userId, username, global_name AS globalName,
              subscribed, updated_at AS updatedAt
       FROM dm_subscribers
       ORDER BY user_id`
    )
    .all();
}

/** Read every notified event id. */
export function dmNotifiedEventIdsGetAll() {
  return db()
    .prepare(`SELECT event_id AS eventId, notified_at AS notifiedAt FROM dm_notified_events ORDER BY notified_at DESC`)
    .all();
}

/**
 * Replace `role_alert_log` from the legacy
 * `{ byEventId: { [eventId]: { byUserId: { [userId]: sentAt } } } }` shape.
 */
export function roleAlertLogReplaceFromState(state) {
  const byEventId = state?.byEventId && typeof state.byEventId === "object" ? state.byEventId : {};
  return db().transaction(() => {
    db().prepare(`DELETE FROM role_alert_log`).run();
    const stmt = db().prepare(
      `INSERT INTO role_alert_log (event_id, user_id, sent_at)
       VALUES (?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET
         sent_at = MAX(role_alert_log.sent_at, excluded.sent_at)`
    );
    let rows = 0;
    for (const [eventIdRaw, eventRow] of Object.entries(byEventId)) {
      const eventId = String(eventIdRaw || "").trim();
      if (!eventId) continue;
      const byUser = eventRow?.byUserId && typeof eventRow.byUserId === "object" ? eventRow.byUserId : {};
      for (const [userIdRaw, sentAtRaw] of Object.entries(byUser)) {
        const userId = String(userIdRaw || "").trim();
        const sentAt = Number(sentAtRaw);
        if (!userId || !Number.isFinite(sentAt) || sentAt <= 0) continue;
        stmt.run(eventId, userId, sentAt);
        rows += 1;
      }
    }
    return { rows };
  })();
}

/** Read every role-alert send row. */
export function roleAlertLogGetAll() {
  return db()
    .prepare(
      `SELECT event_id AS eventId, user_id AS userId, sent_at AS sentAt
       FROM role_alert_log
       ORDER BY sent_at DESC`
    )
    .all();
}

/** Replace `hof_notes` from the in-memory `{ byWinnerRaidKey: { ... } }` snapshot. */
export function hofNotesReplaceFromState(state) {
  const byKey = state?.byWinnerRaidKey && typeof state.byWinnerRaidKey === "object" ? state.byWinnerRaidKey : {};
  return db().transaction(() => {
    db().prepare(`DELETE FROM hof_notes`).run();
    const stmt = db().prepare(
      `INSERT INTO hof_notes (winner_raid_key, quote, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(winner_raid_key) DO UPDATE SET
         quote = excluded.quote,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    );
    let rows = 0;
    for (const [keyRaw, row] of Object.entries(byKey)) {
      const key = String(keyRaw || "").trim();
      if (!key) continue;
      stmt.run(
        key,
        String(row?.quote || ""),
        Number(row?.updatedAt || Date.now()),
        String(row?.updatedBy || "")
      );
      rows += 1;
    }
    return { rows };
  })();
}

/** Read every Hall of Fame note. */
export function hofNotesGetAll() {
  return db()
    .prepare(
      `SELECT winner_raid_key AS winnerRaidKey, quote, updated_at AS updatedAt, updated_by AS updatedBy
       FROM hof_notes`
    )
    .all();
}

// ============================================================
// Phase 4 — sync_state + badge_state helpers
// ============================================================

/** Mark a sync task as currently running. Returns the row state pre-update
 *  so callers can decide whether to skip when it was already running. */
export function syncStateMarkRunning(taskId) {
  const id = String(taskId || "").trim();
  if (!id) throw new Error("syncStateMarkRunning requires taskId");
  const now = Date.now();
  return db().transaction(() => {
    const prev = db().prepare(`SELECT * FROM sync_state WHERE task_id = ?`).get(id);
    db()
      .prepare(
        `INSERT INTO sync_state (task_id, status, last_started_at)
         VALUES (?, 'running', ?)
         ON CONFLICT(task_id) DO UPDATE SET
           status = 'running',
           last_started_at = excluded.last_started_at,
           last_error = NULL`
      )
      .run(id, now);
    return prev || null;
  })();
}

/** Mark a sync task as completed successfully. */
export function syncStateMarkComplete({ taskId, durationMs, rowsChanged = 0, nextDueAt } = {}) {
  const id = String(taskId || "").trim();
  if (!id) throw new Error("syncStateMarkComplete requires taskId");
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO sync_state (task_id, status, last_completed_at, last_duration_ms, rows_changed, next_due_at, last_error)
       VALUES (?, 'idle', ?, ?, ?, ?, NULL)
       ON CONFLICT(task_id) DO UPDATE SET
         status = 'idle',
         last_completed_at = excluded.last_completed_at,
         last_duration_ms = excluded.last_duration_ms,
         rows_changed = excluded.rows_changed,
         next_due_at = excluded.next_due_at,
         last_error = NULL`
    )
    .run(id, now, Math.max(0, Math.floor(Number(durationMs) || 0)), Math.max(0, Math.floor(Number(rowsChanged) || 0)), nextDueAt != null ? Number(nextDueAt) : null);
}

/** Mark a sync task as failed. Keeps last_completed_at intact so endpoints
 *  can still display the previous good run timestamp. */
export function syncStateMarkFailed({ taskId, error, nextDueAt } = {}) {
  const id = String(taskId || "").trim();
  if (!id) throw new Error("syncStateMarkFailed requires taskId");
  db()
    .prepare(
      `INSERT INTO sync_state (task_id, status, last_error, last_started_at, next_due_at)
       VALUES (?, 'failed', ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         status = 'failed',
         last_error = excluded.last_error,
         next_due_at = excluded.next_due_at`
    )
    .run(id, String(error || "").slice(0, 4000), Date.now(), nextDueAt != null ? Number(nextDueAt) : null);
}

/** Read every sync_state row (small N — one per task). */
export function syncStateGetAll() {
  return db()
    .prepare(
      `SELECT task_id AS taskId, status, last_started_at AS lastStartedAt,
              last_completed_at AS lastCompletedAt, last_duration_ms AS lastDurationMs,
              last_error AS lastError, next_due_at AS nextDueAt,
              rows_changed AS rowsChanged
       FROM sync_state
       ORDER BY task_id`
    )
    .all();
}

/** Read one sync_state row by task id. */
export function syncStateGet(taskId) {
  const id = String(taskId || "").trim();
  if (!id) return null;
  return db()
    .prepare(
      `SELECT task_id AS taskId, status, last_started_at AS lastStartedAt,
              last_completed_at AS lastCompletedAt, last_duration_ms AS lastDurationMs,
              last_error AS lastError, next_due_at AS nextDueAt,
              rows_changed AS rowsChanged
       FROM sync_state WHERE task_id = ?`
    )
    .get(id);
}

/**
 * Replace all badges for one user atomically. Preserves `first_earned_at`:
 * once true, always true. Pass `[{ badgeId, earned, evidence }]`.
 */
export function badgeStateReplaceForUser({ userId, rows, when } = {}) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error("badgeStateReplaceForUser: bad userId");
  const now = Number.isFinite(Number(when)) ? Math.floor(Number(when)) : Date.now();
  const inputs = Array.isArray(rows) ? rows : [];
  return db().transaction(() => {
    const existing = db()
      .prepare(`SELECT badge_id AS badgeId, earned, first_earned_at AS firstEarnedAt FROM badge_state WHERE user_id = ?`)
      .all(uid);
    const existingByBadge = new Map(existing.map((r) => [r.badgeId, r]));
    const stmt = db().prepare(
      `INSERT INTO badge_state (user_id, badge_id, earned, first_earned_at, last_verified_at, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, badge_id) DO UPDATE SET
         earned = excluded.earned,
         first_earned_at = COALESCE(badge_state.first_earned_at, excluded.first_earned_at),
         last_verified_at = excluded.last_verified_at,
         evidence_json = excluded.evidence_json`
    );
    for (const row of inputs) {
      const badgeId = String(row?.badgeId || "").trim();
      if (!badgeId) continue;
      const earned = row?.earned ? 1 : 0;
      const prev = existingByBadge.get(badgeId);
      const firstEarnedAt = earned
        ? prev?.firstEarnedAt || now
        : prev?.firstEarnedAt || null;
      stmt.run(
        uid,
        badgeId,
        earned,
        firstEarnedAt,
        now,
        row?.evidence != null ? JSON.stringify(row.evidence) : null
      );
    }
    return { rowsTouched: inputs.length };
  })();
}

/** Read every badge state row for one user. */
export function badgeStateGetByUserId(userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return [];
  return db()
    .prepare(
      `SELECT badge_id AS badgeId, earned, first_earned_at AS firstEarnedAt,
              last_verified_at AS lastVerifiedAt, evidence_json AS evidenceJson
       FROM badge_state WHERE user_id = ? ORDER BY badge_id`
    )
    .all(uid);
}

// ============================================================
// Phase 5 — attendance / deaths / first-clears / best-time helpers
// ============================================================

/**
 * Resolve `characterName` to a canonical `(user_id, character_id)` pair via
 * `user_characters.character_name_key`. Returns `{ userId, characterId }`
 * or `null` when nothing matches. Used by sync workers to attach FK refs
 * to each materialised row.
 */
export function resolveOwnerForCharacterName(characterName) {
  const key = rhNameKey(characterName);
  if (!key) return null;
  const row = db()
    .prepare(
      `SELECT user_id AS userId, id AS characterId
       FROM user_characters WHERE character_name_key = ?
       ORDER BY is_main DESC, last_seen_at DESC LIMIT 1`
    )
    .get(key);
  return row || null;
}

/**
 * Replace `first_clear_participants` for a set of raid names. Called by
 * `syncAttendance` once per recompute.
 *
 * `entries` shape: `{ [raidName]: { reportCode, startTime, participants: [name, ...] } | null }`.
 */
export function firstClearParticipantsReplace({ raidEntries, raidNames, when } = {}) {
  const raidsIn = Array.isArray(raidNames) && raidNames.length ? raidNames : Object.keys(raidEntries || {});
  const now = Number.isFinite(Number(when)) ? Math.floor(Number(when)) : Date.now();
  return db().transaction(() => {
    const placeholders = raidsIn.map(() => "?").join(",");
    if (placeholders) {
      db().prepare(`DELETE FROM first_clear_participants WHERE raid_name IN (${placeholders})`).run(...raidsIn);
    }
    const stmt = db().prepare(
      `INSERT INTO first_clear_participants
         (raid_name, user_id, character_id, character_name, report_code, fight_id, cleared_at, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(raid_name, character_name) DO UPDATE SET
         user_id = excluded.user_id,
         character_id = excluded.character_id,
         report_code = excluded.report_code,
         fight_id = excluded.fight_id,
         cleared_at = excluded.cleared_at,
         computed_at = excluded.computed_at`
    );
    let rows = 0;
    for (const raidName of raidsIn) {
      const entry = raidEntries?.[raidName];
      if (!entry?.participants?.length) continue;
      for (const characterName of entry.participants) {
        const cn = String(characterName || "").trim();
        if (!cn) continue;
        const owner = resolveOwnerForCharacterName(cn);
        stmt.run(
          raidName,
          owner?.userId || null,
          owner?.characterId || null,
          cn,
          String(entry.reportCode || ""),
          entry.fightId != null ? Number(entry.fightId) : null,
          Number(entry.startTime || 0),
          now
        );
        rows += 1;
      }
    }
    return { rows };
  })();
}

/** Read first-clear participants by raid name (or all). */
export function firstClearParticipantsGet({ raidNames } = {}) {
  const raidsIn = Array.isArray(raidNames) ? raidNames : null;
  const rows = raidsIn?.length
    ? db()
        .prepare(
          `SELECT raid_name AS raidName, user_id AS userId, character_id AS characterId,
                  character_name AS characterName, report_code AS reportCode,
                  fight_id AS fightId, cleared_at AS clearedAt
           FROM first_clear_participants
           WHERE raid_name IN (${raidsIn.map(() => "?").join(",")})`
        )
        .all(...raidsIn)
    : db()
        .prepare(
          `SELECT raid_name AS raidName, user_id AS userId, character_id AS characterId,
                  character_name AS characterName, report_code AS reportCode,
                  fight_id AS fightId, cleared_at AS clearedAt
           FROM first_clear_participants`
        )
        .all();
  const grouped = {};
  for (const r of rows) {
    const raid = r.raidName;
    if (!grouped[raid]) {
      grouped[raid] = { reportCode: r.reportCode, startTime: r.clearedAt, participants: [] };
    }
    grouped[raid].participants.push(r.characterName);
  }
  return grouped;
}

/** Replace `death_totals` for the given window label. Inputs are
 *  `{ characterName, deaths }` rows; resolution to user_id is automatic. */
export function deathTotalsReplaceForWindow({ windowLabel, rows, when } = {}) {
  const win = String(windowLabel || "").trim();
  if (!win) throw new Error("deathTotalsReplaceForWindow: windowLabel required");
  const now = Number.isFinite(Number(when)) ? Math.floor(Number(when)) : Date.now();
  return db().transaction(() => {
    db().prepare(`DELETE FROM death_totals WHERE window_label = ?`).run(win);
    if (!Array.isArray(rows) || !rows.length) return { rows: 0 };
    // Aggregate by user (multiple character names can resolve to one user).
    const totalByUserId = new Map();
    const orphanByName = new Map();
    for (const r of rows) {
      const cn = String(r?.characterName || "").trim();
      const deaths = Math.max(0, Math.floor(Number(r?.deaths) || 0));
      if (!cn || deaths <= 0) continue;
      const owner = resolveOwnerForCharacterName(cn);
      if (owner?.userId) {
        totalByUserId.set(owner.userId, (totalByUserId.get(owner.userId) || 0) + deaths);
      } else {
        orphanByName.set(cn, (orphanByName.get(cn) || 0) + deaths);
      }
    }
    const stmt = db().prepare(
      `INSERT INTO death_totals (user_id, window_label, death_count, computed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, window_label) DO UPDATE SET
         death_count = excluded.death_count,
         computed_at = excluded.computed_at`
    );
    let written = 0;
    for (const [userId, deaths] of totalByUserId) {
      stmt.run(userId, win, deaths, now);
      written += 1;
    }
    return { rows: written, orphanCount: orphanByName.size };
  })();
}

/** Read death totals for one window, joined with users + main character name. */
export function deathTotalsGetByWindow(windowLabel) {
  const win = String(windowLabel || "").trim();
  if (!win) return [];
  return db()
    .prepare(
      `SELECT
         d.user_id AS userId,
         d.death_count AS deaths,
         u.discord_user_id AS discordUserId,
         u.display_name AS displayName,
         (SELECT character_name FROM user_characters c
            WHERE c.user_id = u.id ORDER BY c.is_main DESC, c.last_seen_at DESC LIMIT 1) AS mainCharacterName
       FROM death_totals d
       INNER JOIN users u ON u.id = d.user_id
       WHERE d.window_label = ?
       ORDER BY d.death_count DESC, u.id`
    )
    .all(win);
}

/**
 * Replace the `best_time_roster` table. `entries` shape:
 * `[{ encounterId, encounterName, characterName, reportCode, fightId, durationMs }, ...]`.
 *
 * One row per `(encounter_id, character_name)`. Rebuilt fully on every sync.
 */
export function bestTimeRosterReplace({ entries, when } = {}) {
  const now = Number.isFinite(Number(when)) ? Math.floor(Number(when)) : Date.now();
  return db().transaction(() => {
    db().prepare(`DELETE FROM best_time_roster`).run();
    if (!Array.isArray(entries) || !entries.length) return { rows: 0 };
    const stmt = db().prepare(
      `INSERT INTO best_time_roster
         (encounter_id, encounter_name, user_id, character_id, character_name,
          report_code, fight_id, duration_ms, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(encounter_id, character_name) DO UPDATE SET
         encounter_name = excluded.encounter_name,
         user_id = excluded.user_id,
         character_id = excluded.character_id,
         report_code = excluded.report_code,
         fight_id = excluded.fight_id,
         duration_ms = excluded.duration_ms,
         computed_at = excluded.computed_at`
    );
    let rows = 0;
    for (const e of entries) {
      const encounterId = Number(e?.encounterId);
      const characterName = String(e?.characterName || "").trim();
      if (!Number.isInteger(encounterId) || encounterId <= 0 || !characterName) continue;
      const owner = resolveOwnerForCharacterName(characterName);
      stmt.run(
        encounterId,
        String(e?.encounterName || ""),
        owner?.userId || null,
        owner?.characterId || null,
        characterName,
        e?.reportCode ? String(e.reportCode) : null,
        e?.fightId != null ? Number(e.fightId) : null,
        e?.durationMs != null ? Number(e.durationMs) : null,
        now
      );
      rows += 1;
    }
    return { rows };
  })();
}

/** Read best-time roster (optionally filtered by encounter id). */
export function bestTimeRosterGet({ encounterIds } = {}) {
  if (Array.isArray(encounterIds) && encounterIds.length) {
    const placeholders = encounterIds.map(() => "?").join(",");
    return db()
      .prepare(
        `SELECT encounter_id AS encounterId, encounter_name AS encounterName,
                user_id AS userId, character_id AS characterId,
                character_name AS characterName, report_code AS reportCode,
                fight_id AS fightId, duration_ms AS durationMs
         FROM best_time_roster
         WHERE encounter_id IN (${placeholders})
         ORDER BY encounter_id, duration_ms`
      )
      .all(...encounterIds.map((x) => Number(x)));
  }
  return db()
    .prepare(
      `SELECT encounter_id AS encounterId, encounter_name AS encounterName,
              user_id AS userId, character_id AS characterId,
              character_name AS characterName, report_code AS reportCode,
              fight_id AS fightId, duration_ms AS durationMs
       FROM best_time_roster
       ORDER BY encounter_id, duration_ms`
    )
    .all();
}

/**
 * Replace `raid_attendance` for one window label. Rows shape:
 * `[{ characterName, raidsAttended, raidsConsidered, attendanceHistory }, ...]`.
 * Aggregated to user; orphan character names without a canonical user are
 * dropped (they'll resurface on the next sync once Account Assignment links
 * are saved).
 */
export function raidAttendanceReplaceForWindow({ windowLabel, rows, when } = {}) {
  const win = String(windowLabel || "").trim();
  if (!win) throw new Error("raidAttendanceReplaceForWindow: windowLabel required");
  const now = Number.isFinite(Number(when)) ? Math.floor(Number(when)) : Date.now();
  return db().transaction(() => {
    db().prepare(`DELETE FROM raid_attendance WHERE window_label = ?`).run(win);
    if (!Array.isArray(rows) || !rows.length) return { rows: 0 };
    const byUserId = new Map();
    for (const r of rows) {
      const cn = String(r?.characterName || "").trim();
      if (!cn) continue;
      const owner = resolveOwnerForCharacterName(cn);
      if (!owner?.userId) continue;
      const prev = byUserId.get(owner.userId);
      const incoming = {
        raidsAttended: Number(r?.raidsAttended || 0),
        raidsConsidered: Number(r?.raidsConsidered || 0),
        attendanceHistory: Array.isArray(r?.attendanceHistory) ? r.attendanceHistory : [],
      };
      if (!prev || incoming.raidsAttended > prev.raidsAttended) {
        byUserId.set(owner.userId, incoming);
      }
    }
    const stmt = db().prepare(
      `INSERT INTO raid_attendance
         (user_id, window_label, raids_attended, raids_considered,
          attendance_rate, attendance_history, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, window_label) DO UPDATE SET
         raids_attended = excluded.raids_attended,
         raids_considered = excluded.raids_considered,
         attendance_rate = excluded.attendance_rate,
         attendance_history = excluded.attendance_history,
         computed_at = excluded.computed_at`
    );
    let written = 0;
    for (const [userId, vals] of byUserId) {
      const considered = Math.max(0, Math.floor(vals.raidsConsidered));
      const attended = Math.max(0, Math.min(considered, Math.floor(vals.raidsAttended)));
      const rate = considered > 0 ? attended / considered : 0;
      stmt.run(userId, win, attended, considered, rate, JSON.stringify(vals.attendanceHistory), now);
      written += 1;
    }
    return { rows: written };
  })();
}

// ============================================================
// Phase 6 — parse summaries
// ============================================================

/**
 * Replace every parse_summary row in one transaction. `entries` shape:
 * `[{ characterId, bracket, bestValue, bestEncounter, bestReportCode,
 *     bestFightId, bestMetric, bestAt, raidsInBracket, encounterTopInBracket }]`
 *
 * Used by `runSyncParses`. Idempotent — re-runs against the same input
 * produce the same rows (but `computed_at` is refreshed).
 */
export function parseSummaryReplaceAll({ entries, when } = {}) {
  const now = Number.isFinite(Number(when)) ? Math.floor(Number(when)) : Date.now();
  return db().transaction(() => {
    db().prepare(`DELETE FROM parse_summary`).run();
    if (!Array.isArray(entries) || !entries.length) return { rows: 0 };
    const stmt = db().prepare(
      `INSERT INTO parse_summary
         (character_id, bracket, best_value, best_encounter, best_report_code,
          best_fight_id, best_metric, best_at, raids_in_bracket,
          encounter_top_in_bracket, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(character_id, bracket) DO UPDATE SET
         best_value = excluded.best_value,
         best_encounter = excluded.best_encounter,
         best_report_code = excluded.best_report_code,
         best_fight_id = excluded.best_fight_id,
         best_metric = excluded.best_metric,
         best_at = excluded.best_at,
         raids_in_bracket = excluded.raids_in_bracket,
         encounter_top_in_bracket = excluded.encounter_top_in_bracket,
         computed_at = excluded.computed_at`
    );
    let written = 0;
    for (const e of entries) {
      const characterId = Number(e?.characterId);
      const bracket = String(e?.bracket || "").trim().toLowerCase();
      if (!Number.isInteger(characterId) || characterId <= 0) continue;
      if (!bracket) continue;
      stmt.run(
        characterId,
        bracket,
        e?.bestValue != null ? Number(e.bestValue) : null,
        e?.bestEncounter ? String(e.bestEncounter) : null,
        e?.bestReportCode ? String(e.bestReportCode) : null,
        e?.bestFightId != null ? Number(e.bestFightId) : null,
        e?.bestMetric ? String(e.bestMetric) : null,
        e?.bestAt != null ? Number(e.bestAt) : null,
        Math.max(0, Math.floor(Number(e?.raidsInBracket) || 0)),
        Math.max(0, Math.floor(Number(e?.encounterTopInBracket) || 0)),
        now
      );
      written += 1;
    }
    return { rows: written };
  })();
}

/** Read parse_summary rows for one user (joined via user_characters). */
export function parseSummaryGetByUserId(userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return [];
  return db()
    .prepare(
      `SELECT
         p.character_id AS characterId,
         p.bracket,
         p.best_value AS bestValue,
         p.best_encounter AS bestEncounter,
         p.best_report_code AS bestReportCode,
         p.best_fight_id AS bestFightId,
         p.best_metric AS bestMetric,
         p.best_at AS bestAt,
         p.raids_in_bracket AS raidsInBracket,
         p.encounter_top_in_bracket AS encounterTopInBracket,
         c.character_name AS characterName,
         c.is_main AS isMain
       FROM parse_summary p
       INNER JOIN user_characters c ON c.id = p.character_id
       WHERE c.user_id = ?
       ORDER BY p.bracket`
    )
    .all(uid);
}

/** Read parse_summary rows joined with users and main character. Used by
 *  the roster JOIN in `buildActiveRosterPlayersForGuild`. */
export function parseSummaryGetByMainCharacterIds(characterIds) {
  const ids = (Array.isArray(characterIds) ? characterIds : [])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db()
    .prepare(
      `SELECT character_id AS characterId, bracket,
              best_value AS bestValue, best_encounter AS bestEncounter,
              best_report_code AS bestReportCode, best_fight_id AS bestFightId,
              best_metric AS bestMetric, best_at AS bestAt,
              raids_in_bracket AS raidsInBracket,
              encounter_top_in_bracket AS encounterTopInBracket
       FROM parse_summary
       WHERE character_id IN (${placeholders})`
    )
    .all(...ids);
}

/**
 * Return the freshest non-empty raid_attendance window label, or null if
 * the table has no rows. Used by the live attendance endpoint to pick
 * the most recent materialised snapshot without hardcoding a label.
 */
export function raidAttendanceGetFreshestWindow() {
  const row = db()
    .prepare(
      `SELECT window_label AS windowLabel,
              MAX(computed_at) AS computedAt,
              COUNT(*) AS rowCount
         FROM raid_attendance
         GROUP BY window_label
         ORDER BY computedAt DESC
         LIMIT 1`
    )
    .get();
  if (!row || !Number(row.rowCount)) return null;
  return {
    windowLabel: String(row.windowLabel || ""),
    computedAt: Number(row.computedAt || 0),
    rowCount: Number(row.rowCount || 0),
  };
}

/**
 * Replace `raid_appearances` rows for the given report codes in one
 * transaction. `entries` shape: `[{ characterName, reportCode, reportStartedAt }]`.
 *
 * Each character is resolved to a canonical user via `resolveOwnerForCharacterName`
 * (same path as `raid_attendance`); orphan character names without a
 * canonical user are dropped. When two alts of the same user appear in
 * the same report we keep one row (the conflict clause keeps the latest
 * character name observed, which is fine for diagnostics).
 *
 * Idempotent — re-running with the same set of `(user, report_code)`
 * pairs only refreshes `computed_at`.
 */
export function raidAppearancesReplaceForReports({ reportCodes, entries, when } = {}) {
  const codes = (Array.isArray(reportCodes) ? reportCodes : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (!codes.length) return { rows: 0 };
  const now = Number.isFinite(Number(when)) ? Math.floor(Number(when)) : Date.now();
  return db().transaction(() => {
    const placeholders = codes.map(() => "?").join(",");
    db()
      .prepare(`DELETE FROM raid_appearances WHERE report_code IN (${placeholders})`)
      .run(...codes);
    if (!Array.isArray(entries) || !entries.length) return { rows: 0 };
    const stmt = db().prepare(
      `INSERT INTO raid_appearances
         (user_id, report_code, report_started_at, character_name, computed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, report_code) DO UPDATE SET
         report_started_at = excluded.report_started_at,
         character_name = excluded.character_name,
         computed_at = excluded.computed_at`
    );
    let written = 0;
    for (const e of entries) {
      const cn = String(e?.characterName || "").trim();
      const rc = String(e?.reportCode || "").trim();
      if (!cn || !rc) continue;
      const owner = resolveOwnerForCharacterName(cn);
      if (!owner?.userId) continue;
      const startedAt = Number.isFinite(Number(e?.reportStartedAt))
        ? Math.floor(Number(e.reportStartedAt))
        : null;
      stmt.run(owner.userId, rc, startedAt, cn, now);
      written += 1;
    }
    return { rows: written };
  })();
}

/**
 * Return a `Map<userId, count>` of distinct WCL report appearances per
 * canonical user. When `reportCodes` is provided, the count is
 * restricted to that set (use it to honour the admin Event Management
 * curated list); when omitted, every report in `raid_appearances` is
 * counted.
 */
export function raidAppearancesCountsByUser({ reportCodes } = {}) {
  const filter = Array.isArray(reportCodes)
    ? reportCodes.map((x) => String(x || "").trim()).filter(Boolean)
    : null;
  let rows;
  if (filter && filter.length) {
    const placeholders = filter.map(() => "?").join(",");
    rows = db()
      .prepare(
        `SELECT user_id AS userId, COUNT(DISTINCT report_code) AS n
           FROM raid_appearances
          WHERE report_code IN (${placeholders})
          GROUP BY user_id`
      )
      .all(...filter);
  } else if (filter && filter.length === 0) {
    return new Map();
  } else {
    rows = db()
      .prepare(
        `SELECT user_id AS userId, COUNT(DISTINCT report_code) AS n
           FROM raid_appearances
          GROUP BY user_id`
      )
      .all();
  }
  const out = new Map();
  for (const r of rows) {
    out.set(Number(r.userId), Number(r.n || 0));
  }
  return out;
}

/** Number of distinct WCL report codes currently materialised. */
export function raidAppearancesDistinctReportCount() {
  const row = db()
    .prepare(`SELECT COUNT(DISTINCT report_code) AS n FROM raid_appearances`)
    .get();
  return Number(row?.n || 0);
}

/**
 * Distinct canonical users with at least one row in `raid_appearances`.
 * When `reportCodes` is provided, only appearances in those reports count
 * (admin Event Management selection); when omitted, counts across all
 * materialised reports. Empty `reportCodes` array returns 0.
 */
export function raidAppearancesDistinctUserCount({ reportCodes } = {}) {
  const filter = Array.isArray(reportCodes)
    ? reportCodes.map((x) => String(x || "").trim()).filter(Boolean)
    : null;
  if (filter && filter.length === 0) return 0;
  let row;
  if (filter && filter.length) {
    const placeholders = filter.map(() => "?").join(",");
    row = db()
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS n
           FROM raid_appearances
          WHERE report_code IN (${placeholders})`
      )
      .get(...filter);
  } else {
    row = db().prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM raid_appearances`).get();
  }
  return Number(row?.n || 0);
}

/**
 * Distinct canonical `user_id`s that have at least one row in
 * `raid_appearances` whose `report_started_at` falls in `[startMs, endMs)`,
 * AND/OR whose `report_code` is in `reportCodes`. Either filter may be
 * omitted; passing both ORs them together so callers can scope by date and
 * still hand-pin specific reports.
 *
 * `report_started_at` is normalised at query time: rows historically
 * written as Unix seconds (raw `<` 100 billion) are multiplied by 1000
 * before comparison, so callers can always pass milliseconds without
 * worrying about the on-disk encoding. Rows where the column is NULL are
 * dropped from the date-range branch.
 *
 * Used by event-specific attendance badges (e.g. "AOE Cleave — attended
 * the May 7 raid") so we can resolve the awarded set straight from the
 * materialised WCL appearance log without re-fetching reports.
 */
export function raidAppearancesUserIdsInDateRange({ startMs, endMs, reportCodes } = {}) {
  const startNum = Number(startMs);
  const endNum = Number(endMs);
  const hasStart = Number.isFinite(startNum);
  const hasEnd = Number.isFinite(endNum);
  const codes = Array.isArray(reportCodes)
    ? reportCodes.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (!hasStart && !hasEnd && codes.length === 0) {
    return new Set();
  }
  /* `report_started_at` was historically stored as Unix seconds in some
     branches and Unix milliseconds in others. Normalise on read: any value
     below 100 billion is treated as seconds and scaled up. Keeps callers
     from having to know the on-disk encoding and matches the same
     heuristic `reportStartTimeMs` uses on write. */
  const normalisedStartedAt = `(CASE WHEN report_started_at < 100000000000
                                        THEN report_started_at * 1000
                                        ELSE report_started_at END)`;
  const dateClauses = [];
  const params = [];
  if (hasStart) {
    dateClauses.push(`${normalisedStartedAt} >= ?`);
    params.push(Math.floor(startNum));
  }
  if (hasEnd) {
    dateClauses.push(`${normalisedStartedAt} < ?`);
    params.push(Math.floor(endNum));
  }
  const whereParts = [];
  if (dateClauses.length) {
    whereParts.push(`(report_started_at IS NOT NULL AND ${dateClauses.join(" AND ")})`);
  }
  if (codes.length) {
    const placeholders = codes.map(() => "?").join(",");
    whereParts.push(`(report_code IN (${placeholders}))`);
    params.push(...codes);
  }
  const sql = `SELECT DISTINCT user_id AS userId
                 FROM raid_appearances
                WHERE ${whereParts.join(" OR ")}`;
  const rows = db().prepare(sql).all(...params);
  const out = new Set();
  for (const r of rows) {
    const uid = Number(r?.userId);
    if (Number.isInteger(uid) && uid > 0) out.add(uid);
  }
  return out;
}

/**
 * One row per distinct WCL report we have at least one appearance for,
 * ordered by start time (newest first). Used by the loot-history
 * fallback to surface every WCL guild raid we know about in the admin
 * Event Management list, even when no loot was awarded in that report.
 */
export function raidAppearancesListReports({ limit = 500 } = {}) {
  const lim = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 500)));
  return db()
    .prepare(
      `SELECT report_code AS reportCode,
              MAX(report_started_at) AS reportStartedAt,
              COUNT(DISTINCT user_id) AS userCount
         FROM raid_appearances
         GROUP BY report_code
         ORDER BY (CASE WHEN MAX(report_started_at) IS NULL THEN 0 ELSE MAX(report_started_at) END) DESC
         LIMIT ?`
    )
    .all(lim);
}

/** Recent appearance rows for diagnostics / admin DB drill-down. */
export function raidAppearancesRecent({ limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  return db()
    .prepare(
      `SELECT user_id AS userId, report_code AS reportCode,
              report_started_at AS reportStartedAt,
              character_name AS characterName,
              computed_at AS computedAt
         FROM raid_appearances
         ORDER BY (CASE WHEN report_started_at IS NULL THEN 0 ELSE report_started_at END) DESC
         LIMIT ?`
    )
    .all(lim);
}

/** Read raid attendance for one window joined with users. */
export function raidAttendanceGetByWindow(windowLabel) {
  const win = String(windowLabel || "").trim();
  if (!win) return [];
  return db()
    .prepare(
      `SELECT
         a.user_id AS userId,
         a.raids_attended AS raidsAttended,
         a.raids_considered AS raidsConsidered,
         a.attendance_rate AS attendanceRate,
         a.attendance_history AS attendanceHistoryJson,
         u.discord_user_id AS discordUserId,
         u.display_name AS displayName,
         u.guild_role AS guildRole
       FROM raid_attendance a
       INNER JOIN users u ON u.id = a.user_id
       WHERE a.window_label = ?
       ORDER BY a.raids_attended DESC, u.id`
    )
    .all(win)
    .map((r) => {
      let attendanceHistory = [];
      try {
        attendanceHistory = JSON.parse(r.attendanceHistoryJson || "[]");
      } catch {
        attendanceHistory = [];
      }
      const { attendanceHistoryJson, ...rest } = r;
      return { ...rest, attendanceHistory };
    });
}

// ============================================================
// Phase 7 — loot awards
// ============================================================

/**
 * Replace every `loot_awards` row with a fresh batch produced by
 * `runSyncLoot`. Idempotent — duplicate `(source, source_ref, item_id,
 * character_name)` rows in `entries` are deduped server-side.
 *
 * Each entry shape:
 *   { userId, characterId, characterName, itemId, awardedAt, source, sourceRef }
 *
 * `userId` and `characterId` may be `null` for orphans we couldn't resolve.
 */
const LOOT_AWARDS_SELECT_COLS = `
  id,
  user_id AS userId,
  character_id AS characterId,
  character_name AS characterName,
  item_id AS itemId,
  item_name AS itemName,
  awarded_at AS awardedAt,
  source,
  source_ref AS sourceRef,
  report_code AS reportCode,
  report_title AS reportTitle,
  report_raid_name AS reportRaidName,
  report_uploader AS reportUploader,
  raw_type AS rawType
`;

export function lootAwardsReplaceAll({ entries } = {}) {
  return db().transaction(() => {
    db().prepare(`DELETE FROM loot_awards`).run();
    if (!Array.isArray(entries) || !entries.length) return { rows: 0 };
    const stmt = db().prepare(
      `INSERT OR IGNORE INTO loot_awards
         (user_id, character_id, character_name, item_id, item_name, awarded_at,
          source, source_ref, report_code, report_title, report_raid_name,
          report_uploader, raw_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let written = 0;
    for (const e of entries) {
      const itemId = Number(e?.itemId);
      const characterName = String(e?.characterName || "").trim();
      const source = String(e?.source || "").trim();
      if (!Number.isInteger(itemId) || itemId <= 0) continue;
      if (!characterName) continue;
      if (!source) continue;
      const userId = Number.isInteger(Number(e?.userId)) && Number(e.userId) > 0 ? Number(e.userId) : null;
      const characterId =
        Number.isInteger(Number(e?.characterId)) && Number(e.characterId) > 0 ? Number(e.characterId) : null;
      const awardedAt = Number.isFinite(Number(e?.awardedAt)) ? Math.floor(Number(e.awardedAt)) : Date.now();
      const sourceRef = e?.sourceRef ? String(e.sourceRef) : null;
      const itemName = e?.itemName ? String(e.itemName) : null;
      const reportCode = e?.reportCode ? String(e.reportCode) : null;
      const reportTitle = e?.reportTitle ? String(e.reportTitle) : null;
      const reportRaidName = e?.reportRaidName ? String(e.reportRaidName) : null;
      const reportUploader = e?.reportUploader ? String(e.reportUploader) : null;
      const rawType = e?.rawType ? String(e.rawType) : null;
      const info = stmt.run(
        userId,
        characterId,
        characterName,
        itemId,
        itemName,
        awardedAt,
        source,
        sourceRef,
        reportCode,
        reportTitle,
        reportRaidName,
        reportUploader,
        rawType
      );
      written += info.changes || 0;
    }
    return { rows: written };
  })();
}

/** Read every loot award (used by `/api/loot-history` cutover). */
export function lootAwardsGetAll({ limit } = {}) {
  const cap =
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(20000, Math.floor(Number(limit))) : 20000;
  return db()
    .prepare(
      `SELECT ${LOOT_AWARDS_SELECT_COLS}
       FROM loot_awards
       ORDER BY awarded_at DESC, id DESC
       LIMIT ?`
    )
    .all(cap);
}

/** Distinct raids covered by `loot_awards` (newest first). */
export function lootAwardsListRaids() {
  return db()
    .prepare(
      `SELECT
         report_code AS reportCode,
         MAX(report_title) AS reportTitle,
         MAX(report_raid_name) AS reportRaidName,
         MAX(report_uploader) AS reportUploader,
         MAX(awarded_at) AS reportStartTime,
         COUNT(*) AS itemCount
       FROM loot_awards
       WHERE report_code IS NOT NULL AND report_code <> ''
       GROUP BY report_code
       ORDER BY reportStartTime DESC`
    )
    .all();
}

/** Read every loot award for a user's linked characters. */
export function lootAwardsGetByUserId(userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return [];
  return db()
    .prepare(
      `SELECT ${LOOT_AWARDS_SELECT_COLS}
       FROM loot_awards
       WHERE user_id = ?
       ORDER BY awarded_at DESC, id DESC`
    )
    .all(uid);
}

/** Read every loot award for a list of character ids. */
export function lootAwardsGetByCharacterIds(characterIds) {
  const ids = (Array.isArray(characterIds) ? characterIds : [])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db()
    .prepare(
      `SELECT ${LOOT_AWARDS_SELECT_COLS}
       FROM loot_awards
       WHERE character_id IN (${placeholders})
       ORDER BY awarded_at DESC, id DESC`
    )
    .all(...ids);
}

// ============================================================
// Phase 8 — readiness counts (used by /api/admin/cutover-readiness)
// ============================================================

/**
 * Return non-zero row counts for each materialised table that backs an
 * already-cutover read path. A `0` here means the corresponding sync
 * worker has not produced any rows yet, so the legacy fallback path is
 * still serving production traffic — it is NOT yet safe to remove
 * dual-write writers for that store.
 */
export function cutoverReadinessCounts() {
  const tables = [
    "users",
    "user_characters",
    "raid_attendance",
    "raid_appearances",
    "death_totals",
    "first_clear_participants",
    "best_time_roster",
    "parse_summary",
    "badge_state",
    "loot_awards",
    "mvp_votes",
    "dm_subscribers",
    "role_alert_log",
    "hof_notes",
  ];
  const out = {};
  for (const name of tables) {
    try {
      const row = db().prepare(`SELECT COUNT(*) AS n FROM ${name}`).get();
      out[name] = Number(row?.n || 0);
    } catch (error) {
      out[name] = { error: error?.message || "unknown" };
    }
  }
  return out;
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
