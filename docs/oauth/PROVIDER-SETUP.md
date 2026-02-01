# OAuth Provider Registration Guide

This document covers how to register trak with OAuth providers for user authentication.

## Supported Providers

| Provider | Status | Scopes Required |
|----------|--------|-----------------|
| GitHub   | ✅ Supported | `read:user`, `user:email` |
| Google   | ✅ Supported | `openid`, `email`, `profile` |

---

## GitHub OAuth App

### Registration Steps

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   - URL: https://github.com/settings/applications/new
2. Fill in:
   - **Application name:** `trak`
   - **Homepage URL:** `https://trak.dev` (or your domain)
   - **Authorization callback URL:** `http://localhost:3000/auth/github/callback`
     - Production: `https://your-domain.com/auth/github/callback`
3. Click **Register application**
4. Copy the **Client ID** and generate a **Client Secret**
5. Add to your `.env`:
   ```
   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
   ```

### OAuth Flow
- Authorization URL: `https://github.com/login/oauth/authorize`
- Token URL: `https://github.com/login/oauth/access_token`
- User Info URL: `https://api.github.com/user`

---

## Google OAuth Client

### Registration Steps

1. Go to **Google Cloud Console → APIs & Services → Credentials**
   - URL: https://console.cloud.google.com/apis/credentials
2. Click **Create Credentials → OAuth client ID**
3. Configure:
   - **Application type:** Web application
   - **Name:** `trak`
   - **Authorized redirect URIs:** `http://localhost:3000/auth/google/callback`
     - Production: `https://your-domain.com/auth/google/callback`
4. Copy the **Client ID** and **Client Secret**
5. Add to your `.env`:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   ```

### OAuth Flow
- Authorization URL: `https://accounts.google.com/o/oauth2/v2/auth`
- Token URL: `https://oauth2.googleapis.com/token`
- User Info URL: `https://www.googleapis.com/oauth2/v2/userinfo`

---

## Environment Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

See `.env.example` for all required variables.
