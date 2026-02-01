/**
 * OAuth provider configuration for trak.
 *
 * Defines supported providers, their endpoints, and required scopes.
 * Credentials are loaded from environment variables.
 */

export interface OAuthProviderConfig {
  name: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  callbackPath: string;
}

function env(key: string, fallback?: string): string {
  const val = process.env[key] || fallback;
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

export function getAppUrl(): string {
  return process.env.APP_URL || 'http://localhost:3000';
}

export function getGitHubConfig(): OAuthProviderConfig {
  return {
    name: 'github',
    clientId: env('GITHUB_CLIENT_ID'),
    clientSecret: env('GITHUB_CLIENT_SECRET'),
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
    callbackPath: process.env.GITHUB_CALLBACK_PATH || '/auth/github/callback',
  };
}

export function getGoogleConfig(): OAuthProviderConfig {
  return {
    name: 'google',
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile'],
    callbackPath: process.env.GOOGLE_CALLBACK_PATH || '/auth/google/callback',
  };
}

export function getCallbackUrl(provider: OAuthProviderConfig): string {
  return `${getAppUrl()}${provider.callbackPath}`;
}

/**
 * Returns all configured providers (skips any missing credentials).
 */
export function getConfiguredProviders(): OAuthProviderConfig[] {
  const providers: OAuthProviderConfig[] = [];

  try { providers.push(getGitHubConfig()); } catch { /* not configured */ }
  try { providers.push(getGoogleConfig()); } catch { /* not configured */ }

  return providers;
}
