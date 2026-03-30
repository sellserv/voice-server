import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import { decryptSession } from '$lib/server/session';
import { getAuthorizeUrl } from '$lib/server/oauth2';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/auth/')) {
    return resolve(event);
  }

  const sessionCookie = event.cookies.get('admin_session');
  if (!sessionCookie) {
    const state = randomBytes(16).toString('hex');
    event.cookies.set('oauth2_state', state, {
      httpOnly: true,
      secure: event.url.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });
    throw redirect(302, getAuthorizeUrl(state));
  }

  const session = decryptSession(sessionCookie);
  if (!session) {
    event.cookies.delete('admin_session', { path: '/' });
    const state = randomBytes(16).toString('hex');
    event.cookies.set('oauth2_state', state, {
      httpOnly: true,
      secure: event.url.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });
    throw redirect(302, getAuthorizeUrl(state));
  }

  event.locals.session = session;
  return resolve(event);
};
