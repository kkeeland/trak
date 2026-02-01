/**
 * User storage for OAuth-authenticated users.
 *
 * Stores user profiles and linked OAuth accounts in the trak SQLite database.
 * Supports multiple OAuth providers per user (e.g. GitHub + Google).
 */

import Database from 'better-sqlite3';

// ─── Types ───────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  created_at: string;
  updated_at: string;
  last_login_at: string;
}

export interface OAuthAccount {
  id: number;
  user_id: string;
  provider: string;
  provider_user_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
  provider_username: string;
  provider_email: string;
  raw_profile: string;
  created_at: string;
  updated_at: string;
}

export interface OAuthUserInfo {
  provider: string;
  providerUserId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  username?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  rawProfile?: Record<string, unknown>;
}

// ─── Schema Migration ────────────────────────────────────

/**
 * Ensure user and OAuth account tables exist.
 * Safe to call multiple times (CREATE IF NOT EXISTS).
 */
export function ensureUserTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      access_token TEXT DEFAULT '',
      refresh_token TEXT DEFAULT '',
      token_expires_at TEXT,
      provider_username TEXT DEFAULT '',
      provider_email TEXT DEFAULT '',
      raw_profile TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(provider, provider_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user_id ON oauth_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_accounts_provider ON oauth_accounts(provider, provider_user_id);
  `);
}

// ─── ID Generation ───────────────────────────────────────

function generateUserId(): string {
  const hex = Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
  return `user-${hex}`;
}

// ─── User CRUD ───────────────────────────────────────────

/**
 * Find or create a user from OAuth provider info.
 *
 * Matching strategy:
 *   1. Existing OAuth account (same provider + provider_user_id) → return linked user
 *   2. Existing user with same email → link new OAuth account
 *   3. No match → create new user + OAuth account
 *
 * Returns the user and whether they were newly created.
 */
export function findOrCreateUser(
  db: Database.Database,
  info: OAuthUserInfo
): { user: User; created: boolean } {
  ensureUserTables(db);

  // 1. Check for existing OAuth link
  const existingAccount = db.prepare(
    'SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?'
  ).get(info.provider, info.providerUserId) as { user_id: string } | undefined;

  if (existingAccount) {
    // Update tokens and profile
    updateOAuthAccount(db, info);

    // Update last login
    db.prepare(
      "UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(existingAccount.user_id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(existingAccount.user_id) as User;
    return { user, created: false };
  }

  // 2. Check for existing user by email
  const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(info.email) as User | undefined;

  if (existingUser) {
    // Link new OAuth provider to existing user
    insertOAuthAccount(db, existingUser.id, info);

    db.prepare(
      "UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(existingUser.id);

    return { user: { ...existingUser, last_login_at: new Date().toISOString() }, created: false };
  }

  // 3. Create new user
  const userId = generateUserId();
  db.prepare(`
    INSERT INTO users (id, email, name, avatar_url)
    VALUES (?, ?, ?, ?)
  `).run(userId, info.email, info.name, info.avatarUrl || '');

  insertOAuthAccount(db, userId, info);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  return { user, created: true };
}

/**
 * Get a user by ID.
 */
export function getUserById(db: Database.Database, userId: string): User | null {
  ensureUserTables(db);
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User) || null;
}

/**
 * Get a user by email.
 */
export function getUserByEmail(db: Database.Database, email: string): User | null {
  ensureUserTables(db);
  return (db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User) || null;
}

/**
 * Get all OAuth accounts linked to a user.
 */
export function getUserOAuthAccounts(db: Database.Database, userId: string): OAuthAccount[] {
  ensureUserTables(db);
  return db.prepare('SELECT * FROM oauth_accounts WHERE user_id = ?').all(userId) as OAuthAccount[];
}

/**
 * Update user profile fields.
 */
export function updateUser(
  db: Database.Database,
  userId: string,
  updates: Partial<Pick<User, 'email' | 'name' | 'avatar_url'>>
): User | null {
  ensureUserTables(db);
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.email !== undefined) {
    fields.push('email = ?');
    values.push(updates.email);
  }
  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.avatar_url !== undefined) {
    fields.push('avatar_url = ?');
    values.push(updates.avatar_url);
  }

  if (fields.length === 0) return getUserById(db, userId);

  fields.push("updated_at = datetime('now')");
  values.push(userId);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getUserById(db, userId);
}

/**
 * Delete a user and all linked OAuth accounts (cascading).
 */
export function deleteUser(db: Database.Database, userId: string): boolean {
  ensureUserTables(db);
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return result.changes > 0;
}

/**
 * Unlink an OAuth provider from a user.
 * Prevents unlinking the last account (user must have at least one).
 */
export function unlinkOAuthAccount(
  db: Database.Database,
  userId: string,
  provider: string
): boolean {
  ensureUserTables(db);
  const count = db.prepare(
    'SELECT COUNT(*) as cnt FROM oauth_accounts WHERE user_id = ?'
  ).get(userId) as { cnt: number };

  if (count.cnt <= 1) {
    throw new Error('Cannot unlink the only OAuth account. Delete the user instead.');
  }

  const result = db.prepare(
    'DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?'
  ).run(userId, provider);
  return result.changes > 0;
}

// ─── Internal Helpers ────────────────────────────────────

function insertOAuthAccount(db: Database.Database, userId: string, info: OAuthUserInfo): void {
  db.prepare(`
    INSERT INTO oauth_accounts (
      user_id, provider, provider_user_id,
      access_token, refresh_token, token_expires_at,
      provider_username, provider_email, raw_profile
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    info.provider,
    info.providerUserId,
    info.accessToken,
    info.refreshToken || '',
    info.tokenExpiresAt?.toISOString().replace('T', ' ').slice(0, 19) || null,
    info.username || '',
    info.email,
    JSON.stringify(info.rawProfile || {})
  );
}

function updateOAuthAccount(db: Database.Database, info: OAuthUserInfo): void {
  db.prepare(`
    UPDATE oauth_accounts SET
      access_token = ?,
      refresh_token = CASE WHEN ? != '' THEN ? ELSE refresh_token END,
      token_expires_at = COALESCE(?, token_expires_at),
      provider_username = CASE WHEN ? != '' THEN ? ELSE provider_username END,
      provider_email = ?,
      raw_profile = ?,
      updated_at = datetime('now')
    WHERE provider = ? AND provider_user_id = ?
  `).run(
    info.accessToken,
    info.refreshToken || '', info.refreshToken || '',
    info.tokenExpiresAt?.toISOString().replace('T', ' ').slice(0, 19) || null,
    info.username || '', info.username || '',
    info.email,
    JSON.stringify(info.rawProfile || {}),
    info.provider,
    info.providerUserId
  );
}
