import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureUserTables,
  findOrCreateUser,
  getUserById,
  getUserByEmail,
  getUserOAuthAccounts,
  updateUser,
  deleteUser,
  unlinkOAuthAccount,
  OAuthUserInfo,
} from '../auth/user-store';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function githubInfo(overrides: Partial<OAuthUserInfo> = {}): OAuthUserInfo {
  return {
    provider: 'github',
    providerUserId: 'gh-12345',
    email: 'test@example.com',
    name: 'Test User',
    avatarUrl: 'https://avatars.example.com/12345',
    username: 'testuser',
    accessToken: 'gho_abc123',
    rawProfile: { login: 'testuser', id: 12345 },
    ...overrides,
  };
}

function googleInfo(overrides: Partial<OAuthUserInfo> = {}): OAuthUserInfo {
  return {
    provider: 'google',
    providerUserId: 'google-67890',
    email: 'test@example.com',
    name: 'Test User',
    username: '',
    accessToken: 'ya29.xyz',
    refreshToken: 'refresh_abc',
    tokenExpiresAt: new Date('2026-12-31T00:00:00Z'),
    rawProfile: { sub: '67890', email: 'test@example.com' },
    ...overrides,
  };
}

describe('user-store', () => {
  describe('ensureUserTables', () => {
    test('creates tables without error', () => {
      const db = makeDb();
      expect(() => ensureUserTables(db)).not.toThrow();
      // Verify tables exist
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const names = tables.map(t => t.name);
      expect(names).toContain('users');
      expect(names).toContain('oauth_accounts');
    });

    test('is idempotent', () => {
      const db = makeDb();
      ensureUserTables(db);
      expect(() => ensureUserTables(db)).not.toThrow();
    });
  });

  describe('findOrCreateUser', () => {
    test('creates new user from OAuth info', () => {
      const db = makeDb();
      const { user, created } = findOrCreateUser(db, githubInfo());
      expect(created).toBe(true);
      expect(user.id).toMatch(/^user-[0-9a-f]{12}$/);
      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Test User');
      expect(user.avatar_url).toBe('https://avatars.example.com/12345');
    });

    test('returns existing user on repeat login (same provider)', () => {
      const db = makeDb();
      const first = findOrCreateUser(db, githubInfo());
      const second = findOrCreateUser(db, githubInfo({ accessToken: 'gho_new_token' }));
      expect(second.created).toBe(false);
      expect(second.user.id).toBe(first.user.id);
    });

    test('updates access token on repeat login', () => {
      const db = makeDb();
      findOrCreateUser(db, githubInfo());
      findOrCreateUser(db, githubInfo({ accessToken: 'gho_refreshed' }));
      const db2 = db;
      const accounts = getUserOAuthAccounts(db2, getUserByEmail(db2, 'test@example.com')!.id);
      expect(accounts[0].access_token).toBe('gho_refreshed');
    });

    test('links new provider to existing user by email', () => {
      const db = makeDb();
      const { user: ghUser } = findOrCreateUser(db, githubInfo());
      const { user: googleUser, created } = findOrCreateUser(db, googleInfo());

      expect(created).toBe(false); // Same email, shouldn't create new user
      expect(googleUser.id).toBe(ghUser.id);

      const accounts = getUserOAuthAccounts(db, ghUser.id);
      expect(accounts).toHaveLength(2);
      expect(accounts.map(a => a.provider).sort()).toEqual(['github', 'google']);
    });

    test('creates separate users for different emails', () => {
      const db = makeDb();
      const { user: u1 } = findOrCreateUser(db, githubInfo());
      const { user: u2, created } = findOrCreateUser(db, githubInfo({
        providerUserId: 'gh-99999',
        email: 'other@example.com',
        username: 'otheruser',
      }));

      expect(created).toBe(true);
      expect(u1.id).not.toBe(u2.id);
    });
  });

  describe('getUserById / getUserByEmail', () => {
    test('returns user by ID', () => {
      const db = makeDb();
      const { user } = findOrCreateUser(db, githubInfo());
      const found = getUserById(db, user.id);
      expect(found).not.toBeNull();
      expect(found!.email).toBe('test@example.com');
    });

    test('returns user by email', () => {
      const db = makeDb();
      findOrCreateUser(db, githubInfo());
      const found = getUserByEmail(db, 'test@example.com');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test User');
    });

    test('returns null for unknown ID', () => {
      const db = makeDb();
      ensureUserTables(db);
      expect(getUserById(db, 'user-nonexistent')).toBeNull();
    });

    test('returns null for unknown email', () => {
      const db = makeDb();
      ensureUserTables(db);
      expect(getUserByEmail(db, 'nobody@example.com')).toBeNull();
    });
  });

  describe('updateUser', () => {
    test('updates name', () => {
      const db = makeDb();
      const { user } = findOrCreateUser(db, githubInfo());
      const updated = updateUser(db, user.id, { name: 'New Name' });
      expect(updated!.name).toBe('New Name');
      expect(updated!.email).toBe('test@example.com'); // unchanged
    });

    test('updates email', () => {
      const db = makeDb();
      const { user } = findOrCreateUser(db, githubInfo());
      const updated = updateUser(db, user.id, { email: 'new@example.com' });
      expect(updated!.email).toBe('new@example.com');
    });

    test('no-op with empty updates', () => {
      const db = makeDb();
      const { user } = findOrCreateUser(db, githubInfo());
      const updated = updateUser(db, user.id, {});
      expect(updated!.id).toBe(user.id);
    });
  });

  describe('deleteUser', () => {
    test('deletes user and cascades to OAuth accounts', () => {
      const db = makeDb();
      const { user } = findOrCreateUser(db, githubInfo());
      expect(deleteUser(db, user.id)).toBe(true);
      expect(getUserById(db, user.id)).toBeNull();
      expect(getUserOAuthAccounts(db, user.id)).toHaveLength(0);
    });

    test('returns false for unknown user', () => {
      const db = makeDb();
      ensureUserTables(db);
      expect(deleteUser(db, 'user-nonexistent')).toBe(false);
    });
  });

  describe('unlinkOAuthAccount', () => {
    test('unlinks a provider when multiple exist', () => {
      const db = makeDb();
      const { user } = findOrCreateUser(db, githubInfo());
      findOrCreateUser(db, googleInfo());

      expect(unlinkOAuthAccount(db, user.id, 'github')).toBe(true);
      const accounts = getUserOAuthAccounts(db, user.id);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].provider).toBe('google');
    });

    test('throws when unlinking the only account', () => {
      const db = makeDb();
      const { user } = findOrCreateUser(db, githubInfo());
      expect(() => unlinkOAuthAccount(db, user.id, 'github')).toThrow(
        'Cannot unlink the only OAuth account'
      );
    });
  });
});
