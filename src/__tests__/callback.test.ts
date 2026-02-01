import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleOAuthCallback, validateState, generateState, resolveProvider } from '../auth/callback.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('validateState', () => {
  it('returns true for matching states', () => {
    expect(validateState('abc123', 'abc123')).toBe(true);
  });

  it('returns false for mismatched states', () => {
    expect(validateState('abc123', 'xyz789')).toBe(false);
  });

  it('returns false for undefined values', () => {
    expect(validateState(undefined, 'abc')).toBe(false);
    expect(validateState('abc', undefined)).toBe(false);
    expect(validateState(undefined, undefined)).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(validateState('short', 'muchlonger')).toBe(false);
  });
});

describe('generateState', () => {
  it('returns a 64-char hex string', () => {
    const state = generateState();
    expect(state).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique values', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
  });
});

describe('resolveProvider', () => {
  beforeEach(() => {
    process.env.GITHUB_CLIENT_ID = 'gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
    process.env.GOOGLE_CLIENT_ID = 'g-id';
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
  });

  afterEach(() => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('resolves github provider', () => {
    const p = resolveProvider('github');
    expect(p).not.toBeNull();
    expect(p!.name).toBe('github');
  });

  it('resolves google provider', () => {
    const p = resolveProvider('google');
    expect(p).not.toBeNull();
    expect(p!.name).toBe('google');
  });

  it('returns null for unknown provider', () => {
    expect(resolveProvider('facebook')).toBeNull();
  });

  it('returns null when env vars are missing', () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    expect(resolveProvider('github')).toBeNull();
  });
});

describe('handleOAuthCallback', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.GITHUB_CLIENT_ID = 'gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
    process.env.GOOGLE_CLIENT_ID = 'g-id';
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret';
  });

  afterEach(() => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('returns error when provider reports an error', async () => {
    const result = await handleOAuthCallback('github', {
      error: 'access_denied',
      error_description: 'User denied access',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('User denied access');
      expect(result.code).toBe('provider_error');
    }
  });

  it('returns error when authorization code is missing', async () => {
    const result = await handleOAuthCallback('github', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('missing_code');
    }
  });

  it('returns error on CSRF state mismatch', async () => {
    const result = await handleOAuthCallback(
      'github',
      { code: 'abc', state: 'wrong' },
      'expected-state',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_state');
    }
  });

  it('returns error for unknown provider', async () => {
    const result = await handleOAuthCallback('facebook', { code: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unknown_provider');
    }
  });

  it('handles successful GitHub OAuth callback', async () => {
    // Mock token exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'gho_token123',
        token_type: 'bearer',
        scope: 'read:user,user:email',
      }),
    });

    // Mock user info fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 12345,
        login: 'octocat',
        name: 'The Octocat',
        email: 'octocat@github.com',
        avatar_url: 'https://github.com/images/octocat.png',
      }),
    });

    const state = 'valid-state';
    const result = await handleOAuthCallback(
      'github',
      { code: 'auth-code-123', state },
      state,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.provider).toBe('github');
      expect(result.user.providerId).toBe('12345');
      expect(result.user.name).toBe('The Octocat');
      expect(result.user.email).toBe('octocat@github.com');
      expect(result.user.accessToken).toBe('gho_token123');
    }

    // Verify token exchange was called correctly
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toBe('https://github.com/login/oauth/access_token');
  });

  it('handles successful Google OAuth callback', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'ya29.token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: '98765',
        email: 'user@gmail.com',
        name: 'Test User',
        picture: 'https://lh3.google.com/photo.jpg',
      }),
    });

    const result = await handleOAuthCallback('google', { code: 'google-code' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.provider).toBe('google');
      expect(result.user.providerId).toBe('98765');
      expect(result.user.email).toBe('user@gmail.com');
      expect(result.user.avatarUrl).toBe('https://lh3.google.com/photo.jpg');
    }
  });

  it('handles token exchange failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Bad credentials',
    });

    const result = await handleOAuthCallback('github', { code: 'bad-code' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('exchange_error');
      expect(result.error).toContain('Token exchange failed');
    }
  });

  it('handles token response with error field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: 'bad_verification_code',
        error_description: 'The code has expired',
      }),
    });

    const result = await handleOAuthCallback('github', { code: 'expired-code' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('exchange_error');
      expect(result.error).toContain('The code has expired');
    }
  });

  it('handles user info fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'token', token_type: 'bearer' }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    const result = await handleOAuthCallback('github', { code: 'code' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('exchange_error');
      expect(result.error).toContain('User info fetch failed');
    }
  });

  it('skips state validation when no expected state provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok', token_type: 'bearer' }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, login: 'user' }),
    });

    const result = await handleOAuthCallback('github', { code: 'code', state: 'anything' });
    expect(result.ok).toBe(true);
  });
});
