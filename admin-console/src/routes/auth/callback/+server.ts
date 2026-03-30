import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { exchangeCode, getUserInfo } from '$lib/server/oauth2';
import { encryptSession } from '$lib/server/session';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    throw redirect(302, '/?error=access_denied');
  }

  if (!code || !state) {
    throw redirect(302, '/?error=missing_params');
  }

  const savedState = cookies.get('oauth2_state');
  cookies.delete('oauth2_state', { path: '/' });

  if (!savedState || savedState !== state) {
    throw redirect(302, '/?error=invalid_state');
  }

  const tokenResponse = await exchangeCode(code);
  const userInfo = await getUserInfo(tokenResponse.access_token);

  if (!userInfo.isAdmin) {
    throw redirect(302, '/?error=not_admin');
  }

  const sessionValue = encryptSession({
    userId: userInfo.id,
    username: userInfo.username,
    displayName: userInfo.displayName,
    accessToken: tokenResponse.access_token,
    createdAt: Date.now(),
  });

  cookies.set('admin_session', sessionValue, {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  throw redirect(302, '/');
};
