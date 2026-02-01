/**
 * OAuth Login Endpoint
 *
 * Implements the OAuth 2.0 Authorization Code flow for user authentication.
 * Supports multiple providers (GitHub, Google) with a pluggable architecture.
 *
 * Flow:
 *   1. User hits /auth/login/:provider
 *   2. We generate a state token, store it, and redirect to provider's auth URL
 *   3. Provider redirects back to /auth/callback/:provider (handled by callback module)
 *   4. We exchange the code for tokens and create a session
 */

import { randomBytes, createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthProviderConfig {
  /** Provider identifier (e.g., 'github', 'google') */
  name: string;
  /** OAuth authorization endpoint */
  authorizeUrl: string;
  /** OAuth token exchange endpoint */
  tokenUrl: string;
  /** User info / profile endpoint */
  userInfoUrl: string;
  /** Application client ID */
  clientId: string;
  /** Application client secret */
  clientSecret: string;
  /** Where the provider redirects after auth */
  redirectUri: string;
  /** Requested permission scopes */
  scopes: string[];
}

export interface OAuthState {
  /** Random state token for CSRF protection */
  token: string;
  /** Provider this state was generated for */
  provider: string;
  /** When this state was created (unix ms) */
  createdAt: number;
  /** Optional: where to redirect the user after auth */
  returnTo?: string;
}

export interface LoginRedirectResult {
  /** The full URL to redirect the user to */
  redirectUrl: string;
  /** The state object (store this server-side for verification) */
  state: OAuthState;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface OAuthUserInfo {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
  provider: string;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Built-in provider presets
// ---------------------------------------------------------------------------

export const PROVIDER_PRESETS: Record<string, Partial<OAuthProviderConfig>> = {
  github: {
    name: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
  },
  google: {
    name: 'google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
};

// ---------------------------------------------------------------------------
// State management (in-memory with TTL)
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pendingStates = new Map<string, OAuthState>();

/** Generate a cryptographically random state token */
export function generateStateToken(): string {
  return randomBytes(32).toString('hex');
}

/** Store a pending OAuth state */
export function storeState(state: OAuthState): void {
  pendingStates.set(state.token, state);

  // Auto-cleanup expired states
  setTimeout(() => {
    pendingStates.delete(state.token);
  }, STATE_TTL_MS);
}

/** Verify and consume a state token (one-time use) */
export function verifyAndConsumeState(token: string): OAuthState | null {
  const state = pendingStates.get(token);
  if (!state) return null;

  // Check TTL
  if (Date.now() - state.createdAt > STATE_TTL_MS) {
    pendingStates.delete(token);
    return null;
  }

  // Consume (one-time use prevents replay attacks)
  pendingStates.delete(token);
  return state;
}

/** Get count of pending states (for monitoring) */
export function getPendingStateCount(): number {
  return pendingStates.size;
}

// ---------------------------------------------------------------------------
// Core: Generate Login Redirect
// ---------------------------------------------------------------------------

/**
 * Generate the OAuth login redirect URL for a given provider.
 *
 * @param provider - Provider configuration
 * @param options - Optional overrides (returnTo URL, extra params)
 * @returns LoginRedirectResult with the redirect URL and state
 *
 * @example
 * ```ts
 * const config = createProviderConfig('github', {
 *   clientId: process.env.GITHUB_CLIENT_ID!,
 *   clientSecret: process.env.GITHUB_CLIENT_SECRET!,
 *   redirectUri: 'https://myapp.com/auth/callback/github',
 * });
 * const { redirectUrl, state } = generateLoginRedirect(config);
 * storeState(state);
 * // redirect user to redirectUrl
 * ```
 */
export function generateLoginRedirect(
  provider: OAuthProviderConfig,
  options: { returnTo?: string; extraParams?: Record<string, string> } = {},
): LoginRedirectResult {
  const stateToken = generateStateToken();

  const state: OAuthState = {
    token: stateToken,
    provider: provider.name,
    createdAt: Date.now(),
    returnTo: options.returnTo,
  };

  // Build the authorization URL
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: provider.redirectUri,
    scope: provider.scopes.join(' '),
    state: stateToken,
    response_type: 'code',
    ...options.extraParams,
  });

  // Google requires access_type for refresh tokens
  if (provider.name === 'google') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }

  const redirectUrl = `${provider.authorizeUrl}?${params.toString()}`;

  return { redirectUrl, state };
}

// ---------------------------------------------------------------------------
// Token Exchange
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for access tokens.
 */
export async function exchangeCodeForTokens(
  provider: OAuthProviderConfig,
  code: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: provider.redirectUri,
    grant_type: 'authorization_code',
  });

  const resp = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Token exchange failed: HTTP ${resp.status} — ${text}`);
  }

  return resp.json() as Promise<OAuthTokenResponse>;
}

// ---------------------------------------------------------------------------
// Fetch User Info
// ---------------------------------------------------------------------------

/**
 * Fetch user profile information from the OAuth provider.
 */
export async function fetchUserInfo(
  provider: OAuthProviderConfig,
  accessToken: string,
): Promise<OAuthUserInfo> {
  const resp = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`User info fetch failed: HTTP ${resp.status} — ${text}`);
  }

  const raw = (await resp.json()) as Record<string, unknown>;

  // Normalize across providers
  if (provider.name === 'github') {
    return {
      id: String(raw.id),
      email: raw.email as string | undefined,
      name: raw.name as string | undefined,
      avatar: raw.avatar_url as string | undefined,
      provider: 'github',
      raw,
    };
  }

  if (provider.name === 'google') {
    return {
      id: String(raw.id),
      email: raw.email as string | undefined,
      name: raw.name as string | undefined,
      avatar: raw.picture as string | undefined,
      provider: 'google',
      raw,
    };
  }

  // Generic fallback
  return {
    id: String(raw.id || raw.sub || ''),
    email: (raw.email as string) || undefined,
    name: (raw.name as string) || undefined,
    provider: provider.name,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Helper: Create provider config from preset + overrides
// ---------------------------------------------------------------------------

/**
 * Create a full provider config by merging a preset with app-specific values.
 */
export function createProviderConfig(
  providerName: string,
  overrides: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes?: string[];
  },
): OAuthProviderConfig {
  const preset = PROVIDER_PRESETS[providerName];
  if (!preset) {
    throw new Error(`Unknown OAuth provider: ${providerName}. Available: ${Object.keys(PROVIDER_PRESETS).join(', ')}`);
  }

  return {
    ...preset,
    name: providerName,
    authorizeUrl: preset.authorizeUrl!,
    tokenUrl: preset.tokenUrl!,
    userInfoUrl: preset.userInfoUrl!,
    clientId: overrides.clientId,
    clientSecret: overrides.clientSecret,
    redirectUri: overrides.redirectUri,
    scopes: overrides.scopes || preset.scopes || [],
  };
}

// ---------------------------------------------------------------------------
// PKCE support (for public clients / enhanced security)
// ---------------------------------------------------------------------------

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

/**
 * Generate a PKCE code verifier and challenge for enhanced security.
 */
export function generatePKCE(): PKCEChallenge {
  const codeVerifier = randomBytes(32)
    .toString('base64url')
    .slice(0, 128);

  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}
