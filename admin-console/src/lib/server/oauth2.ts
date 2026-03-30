import { env } from '$env/dynamic/private';

export function getOAuth2Config() {
  return {
    clientId: env.OAUTH2_CLIENT_ID || 'admin-console',
    clientSecret: env.OAUTH2_CLIENT_SECRET || '',
    apiUrl: env.API_URL || 'http://localhost:3000',
    redirectUri: env.OAUTH2_REDIRECT_URI || 'http://localhost:5174/auth/callback',
  };
}

export function getAuthorizeUrl(state: string): string {
  const config = getOAuth2Config();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'admin',
    state,
  });
  return `${config.apiUrl}/oauth2/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<{ access_token: string; expires_in: number }> {
  const config = getOAuth2Config();
  const res = await fetch(`${config.apiUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || err.error || 'Token exchange failed');
  }
  return res.json();
}

export async function getUserInfo(accessToken: string): Promise<{
  id: string; username: string; displayName: string; email: string; avatarUrl: string | null; isAdmin: boolean;
}> {
  const config = getOAuth2Config();
  const res = await fetch(`${config.apiUrl}/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to get user info');
  return res.json();
}

export async function revokeToken(accessToken: string): Promise<void> {
  const config = getOAuth2Config();
  await fetch(`${config.apiUrl}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: accessToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
}
