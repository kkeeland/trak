import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateStateToken,
  storeState,
  verifyAndConsumeState,
  generateLoginRedirect,
  createProviderConfig,
  generatePKCE,
  PROVIDER_PRESETS,
  getPendingStateCount,
} from '../auth/oauth.js';
import type { OAuthProviderConfig, OAuthState } from '../auth/oauth.js';

// ---------------------------------------------------------------------------
// Test provider config
// ---------------------------------------------------------------------------

function testProvider(overrides?: Partial<OAuthProviderConfig>): OAuthProviderConfig {
  return {
    name: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/auth/callback/github',
    scopes: ['read:user', 'user:email'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuth Login Endpoint', () => {
  describe('generateStateToken', () => {
    it('generates a 64-char hex string', () => {
      const token = generateStateToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique tokens', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => generateStateToken()));
      expect(tokens.size).toBe(100);
    });
  });

  describe('state management', () => {
    it('stores and retrieves state', () => {
      const state: OAuthState = {
        token: generateStateToken(),
        provider: 'github',
        createdAt: Date.now(),
      };
      storeState(state);
      const retrieved = verifyAndConsumeState(state.token);
      expect(retrieved).toEqual(state);
    });

    it('consumes state on retrieval (one-time use)', () => {
      const state: OAuthState = {
        token: generateStateToken(),
        provider: 'github',
        createdAt: Date.now(),
      };
      storeState(state);
      verifyAndConsumeState(state.token);
      const second = verifyAndConsumeState(state.token);
      expect(second).toBeNull();
    });

    it('rejects expired state', () => {
      const state: OAuthState = {
        token: generateStateToken(),
        provider: 'github',
        createdAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago (TTL is 10)
      };
      storeState(state);
      const retrieved = verifyAndConsumeState(state.token);
      expect(retrieved).toBeNull();
    });

    it('returns null for unknown tokens', () => {
      expect(verifyAndConsumeState('nonexistent')).toBeNull();
    });
  });

  describe('generateLoginRedirect', () => {
    it('builds correct GitHub authorization URL', () => {
      const provider = testProvider();
      const { redirectUrl, state } = generateLoginRedirect(provider);

      const url = new URL(redirectUrl);
      expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback/github');
      expect(url.searchParams.get('scope')).toBe('read:user user:email');
      expect(url.searchParams.get('state')).toBe(state.token);
      expect(url.searchParams.get('response_type')).toBe('code');
    });

    it('includes returnTo in state', () => {
      const provider = testProvider();
      const { state } = generateLoginRedirect(provider, { returnTo: '/dashboard' });
      expect(state.returnTo).toBe('/dashboard');
      expect(state.provider).toBe('github');
    });

    it('adds Google-specific params', () => {
      const provider = testProvider({
        name: 'google',
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      });
      const { redirectUrl } = generateLoginRedirect(provider);

      const url = new URL(redirectUrl);
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
    });

    it('passes extra params through', () => {
      const provider = testProvider();
      const { redirectUrl } = generateLoginRedirect(provider, {
        extraParams: { login: 'testuser' },
      });

      const url = new URL(redirectUrl);
      expect(url.searchParams.get('login')).toBe('testuser');
    });
  });

  describe('createProviderConfig', () => {
    it('creates GitHub config from preset', () => {
      const config = createProviderConfig('github', {
        clientId: 'my-id',
        clientSecret: 'my-secret',
        redirectUri: 'http://localhost/callback',
      });

      expect(config.name).toBe('github');
      expect(config.authorizeUrl).toBe('https://github.com/login/oauth/authorize');
      expect(config.clientId).toBe('my-id');
      expect(config.scopes).toEqual(['read:user', 'user:email']);
    });

    it('creates Google config from preset', () => {
      const config = createProviderConfig('google', {
        clientId: 'my-id',
        clientSecret: 'my-secret',
        redirectUri: 'http://localhost/callback',
      });

      expect(config.name).toBe('google');
      expect(config.tokenUrl).toBe('https://oauth2.googleapis.com/token');
    });

    it('allows scope override', () => {
      const config = createProviderConfig('github', {
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost/cb',
        scopes: ['repo'],
      });
      expect(config.scopes).toEqual(['repo']);
    });

    it('throws for unknown provider', () => {
      expect(() =>
        createProviderConfig('unknown', {
          clientId: 'id',
          clientSecret: 'secret',
          redirectUri: 'http://localhost/cb',
        }),
      ).toThrow(/Unknown OAuth provider/);
    });
  });

  describe('PKCE', () => {
    it('generates valid PKCE challenge', () => {
      const pkce = generatePKCE();
      expect(pkce.codeVerifier.length).toBeGreaterThan(40);
      expect(pkce.codeVerifier.length).toBeLessThanOrEqual(128);
      expect(pkce.codeChallenge.length).toBeGreaterThan(0);
      expect(pkce.codeChallengeMethod).toBe('S256');
    });

    it('generates unique verifiers', () => {
      const a = generatePKCE();
      const b = generatePKCE();
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
      expect(a.codeChallenge).not.toBe(b.codeChallenge);
    });
  });

  describe('provider presets', () => {
    it('has GitHub preset', () => {
      expect(PROVIDER_PRESETS.github).toBeDefined();
      expect(PROVIDER_PRESETS.github.authorizeUrl).toContain('github.com');
    });

    it('has Google preset', () => {
      expect(PROVIDER_PRESETS.google).toBeDefined();
      expect(PROVIDER_PRESETS.google.authorizeUrl).toContain('google.com');
    });
  });
});
