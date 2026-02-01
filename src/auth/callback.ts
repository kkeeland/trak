/**
 * OAuth Callback Handler for trak.
 *
 * Handles the redirect from OAuth providers (GitHub, Google) after user authorization.
 * Exchanges the authorization code for an access token, fetches user info,
 * and returns a normalized user profile.
 */

import {
  OAuthProviderConfig,
  getGitHubConfig,
  getGoogleConfig,
  getCallbackUrl,
  getConfiguredProviders,
} from '../oauth-config.js';

/** Normalized user profile returned after successful OAuth */
export interface OAuthUser {
  provider: string;
  providerId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  accessToken: string;
  rawProfile: Record<string, unknown>;
}

/** Token response from OAuth provider */
interface TokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
}

/** Result of processing an OAuth callback */
export type CallbackResult =
  | { ok: true; user: OAuthUser }
  | { ok: false; error: string; code?: string };

/**
 * Exchange an authorization code for an access token.
 */
async function exchangeCodeForToken(
  provider: OAuthProviderConfig,
  code: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getCallbackUrl(provider),
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
  });

  const resp = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Token exchange failed (HTTP ${resp.status}): ${text}`);
  }

  const data = await resp.json() as any;
  if (data.error) {
    throw new Error(`Token error: ${data.error_description || data.error}`);
  }

  return data as TokenResponse;
}

/**
 * Fetch user info from the provider's userinfo endpoint.
 */
async function fetchUserInfo(
  provider: OAuthProviderConfig,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const resp = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`User info fetch failed (HTTP ${resp.status}): ${text}`);
  }

  return (await resp.json()) as Record<string, unknown>;
}

/**
 * Normalize a GitHub user profile.
 */
function normalizeGitHubUser(
  profile: Record<string, unknown>,
  accessToken: string,
): OAuthUser {
  return {
    provider: 'github',
    providerId: String(profile.id),
    email: (profile.email as string) || null,
    name: (profile.name as string) || (profile.login as string) || null,
    avatarUrl: (profile.avatar_url as string) || null,
    accessToken,
    rawProfile: profile,
  };
}

/**
 * Normalize a Google user profile.
 */
function normalizeGoogleUser(
  profile: Record<string, unknown>,
  accessToken: string,
): OAuthUser {
  return {
    provider: 'google',
    providerId: String(profile.id || profile.sub),
    email: (profile.email as string) || null,
    name: (profile.name as string) || null,
    avatarUrl: (profile.picture as string) || null,
    accessToken,
    rawProfile: profile,
  };
}

/**
 * Normalize user profile based on provider name.
 */
function normalizeUser(
  providerName: string,
  profile: Record<string, unknown>,
  accessToken: string,
): OAuthUser {
  switch (providerName) {
    case 'github':
      return normalizeGitHubUser(profile, accessToken);
    case 'google':
      return normalizeGoogleUser(profile, accessToken);
    default:
      // Generic fallback
      return {
        provider: providerName,
        providerId: String(profile.id || profile.sub || ''),
        email: (profile.email as string) || null,
        name: (profile.name as string) || null,
        avatarUrl: (profile.picture as string) || (profile.avatar_url as string) || null,
        accessToken,
        rawProfile: profile,
      };
  }
}

/**
 * Resolve provider config by name.
 */
export function resolveProvider(providerName: string): OAuthProviderConfig | null {
  try {
    switch (providerName) {
      case 'github':
        return getGitHubConfig();
      case 'google':
        return getGoogleConfig();
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Validate the state parameter to prevent CSRF attacks.
 * Returns true if the state matches the expected value.
 */
export function validateState(
  receivedState: string | undefined,
  expectedState: string | undefined,
): boolean {
  if (!receivedState || !expectedState) return false;
  // Constant-time comparison to prevent timing attacks
  if (receivedState.length !== expectedState.length) return false;
  let mismatch = 0;
  for (let i = 0; i < receivedState.length; i++) {
    mismatch |= receivedState.charCodeAt(i) ^ expectedState.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Handle an OAuth callback.
 *
 * This is the core function: given the provider name and the callback
 * query parameters (code, state, error), it exchanges the code for
 * a token, fetches the user profile, and returns a normalized result.
 *
 * @param providerName - 'github' or 'google'
 * @param params - Query parameters from the callback URL
 * @param expectedState - The state value stored in the session (for CSRF check)
 */
export async function handleOAuthCallback(
  providerName: string,
  params: { code?: string; state?: string; error?: string; error_description?: string },
  expectedState?: string,
): Promise<CallbackResult> {
  // 1. Check for provider-reported errors
  if (params.error) {
    return {
      ok: false,
      error: params.error_description || params.error,
      code: 'provider_error',
    };
  }

  // 2. Validate authorization code is present
  if (!params.code) {
    return {
      ok: false,
      error: 'Missing authorization code',
      code: 'missing_code',
    };
  }

  // 3. Validate state parameter (CSRF protection)
  if (expectedState && !validateState(params.state, expectedState)) {
    return {
      ok: false,
      error: 'Invalid state parameter — possible CSRF attack',
      code: 'invalid_state',
    };
  }

  // 4. Resolve provider configuration
  const provider = resolveProvider(providerName);
  if (!provider) {
    return {
      ok: false,
      error: `Unknown or unconfigured provider: ${providerName}`,
      code: 'unknown_provider',
    };
  }

  try {
    // 5. Exchange authorization code for access token
    const tokenData = await exchangeCodeForToken(provider, params.code);

    // 6. Fetch user profile from provider
    const profile = await fetchUserInfo(provider, tokenData.access_token);

    // 7. Normalize and return user data
    const user = normalizeUser(providerName, profile, tokenData.access_token);

    return { ok: true, user };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `OAuth callback failed: ${message}`,
      code: 'exchange_error',
    };
  }
}

/**
 * Generate a cryptographically random state parameter for CSRF protection.
 */
export function generateState(): string {
  const { randomBytes } = require('crypto');
  return randomBytes(32).toString('hex');
}
