import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { decryptSession } from '$lib/server/session';
import { revokeToken } from '$lib/server/oauth2';

export const POST: RequestHandler = async ({ cookies }) => {
  const sessionCookie = cookies.get('admin_session');
  if (sessionCookie) {
    const session = decryptSession(sessionCookie);
    if (session) {
      await revokeToken(session.accessToken).catch(() => {});
    }
    cookies.delete('admin_session', { path: '/' });
  }

  throw redirect(302, '/');
};
