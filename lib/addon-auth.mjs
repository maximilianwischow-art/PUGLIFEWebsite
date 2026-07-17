/**
 * Addon bearer-token auth for wow-pug.com API (companion apps / future tooling).
 * In-game WoW addons cannot call HTTP; tokens are for external clients.
 */

import { createHash, randomBytes } from "node:crypto";
import { openItemNeedsDb } from "./item-needs-db.mjs";

const TOKEN_PREFIX = "plb_";

function db(dataDir) {
  return openItemNeedsDb(dataDir);
}

function ensureAddonTokensTable(dataDir) {
  const database = db(dataDir);
  database.exec(`
    CREATE TABLE IF NOT EXISTS addon_tokens (
      token_hash TEXT PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      token_hint TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_addon_tokens_user
      ON addon_tokens(discord_user_id);
  `);
  return database;
}

function hashToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function generateToken() {
  return `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
}

/**
 * @param {string} dataDir
 * @param {string} discordUserId
 * @returns {{ token: string, tokenHint: string, createdAt: number }}
 */
export function addonTokenCreate(dataDir, discordUserId) {
  const userId = String(discordUserId || "").trim();
  if (!userId) throw new Error("discordUserId required");

  const database = ensureAddonTokensTable(dataDir);
  const now = Date.now();
  database
    .prepare(`UPDATE addon_tokens SET revoked_at = ? WHERE discord_user_id = ? AND revoked_at IS NULL`)
    .run(now, userId);

  const token = generateToken();
  const tokenHash = hashToken(token);
  const tokenHint = token.slice(-6);
  database
    .prepare(
      `INSERT INTO addon_tokens (token_hash, discord_user_id, token_hint, created_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .run(tokenHash, userId, tokenHint, now);

  return { token, tokenHint, createdAt: now };
}

/**
 * @param {string} dataDir
 * @param {string} discordUserId
 */
export function addonTokenRevoke(dataDir, discordUserId) {
  const userId = String(discordUserId || "").trim();
  if (!userId) return 0;
  const database = ensureAddonTokensTable(dataDir);
  const result = database
    .prepare(`UPDATE addon_tokens SET revoked_at = ? WHERE discord_user_id = ? AND revoked_at IS NULL`)
    .run(Date.now(), userId);
  return Number(result?.changes || 0);
}

/**
 * @param {string} dataDir
 * @param {string} discordUserId
 */
export function addonTokenStatus(dataDir, discordUserId) {
  const userId = String(discordUserId || "").trim();
  if (!userId) return { active: false, tokenHint: null, createdAt: null };
  const database = ensureAddonTokensTable(dataDir);
  const row = database
    .prepare(
      `SELECT token_hint, created_at FROM addon_tokens
       WHERE discord_user_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId);
  if (!row) return { active: false, tokenHint: null, createdAt: null };
  return {
    active: true,
    tokenHint: String(row.token_hint || ""),
    createdAt: Number(row.created_at || 0),
  };
}

/**
 * @param {string} dataDir
 * @param {string} bearerToken
 * @returns {string | null} discord user id
 */
export function addonTokenResolveUserId(dataDir, bearerToken) {
  const raw = String(bearerToken || "").trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const database = ensureAddonTokensTable(dataDir);
  const row = database
    .prepare(
      `SELECT discord_user_id FROM addon_tokens
       WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`,
    )
    .get(hashToken(raw));
  return row?.discord_user_id ? String(row.discord_user_id) : null;
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {string | null}
 */
export function addonTokenFromRequest(req) {
  const header = String(req?.headers?.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim();
}
