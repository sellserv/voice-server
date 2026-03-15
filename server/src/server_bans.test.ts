import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { initSchema } from './db/schema.js';
import authRoutes from './routes/auth.js';
import serverRoutes from './routes/servers.ts';
import adminRoutes from './routes/admin.js';
import db from './db/connection.js';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

describe('Server-Scoped Bans Integration', () => {
  const app = Fastify();
  
  beforeAll(async () => {
    await app.register(fastifyCookie);
    await app.register(authRoutes);
    await app.register(serverRoutes);
    await app.register(adminRoutes);
    console.log('DEBUG: Registered routes:');
    console.log(app.printRoutes());
    initSchema();
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM servers').run();
    db.prepare('DELETE FROM auth_sessions').run();
    db.prepare('DELETE FROM server_bans').run();
    db.exec('PRAGMA foreign_keys = ON');
  });

  afterAll(async () => {
    await app.close();
  });

  let adminToken: string;
  let adminCookies: Record<string, string>;
  let userToken: string;
  let userCookies: Record<string, string>;
  let userId: string;
  let serverId: string;

  it('should setup users and a server', async () => {
    // 1. Create admin
    const regAdmin = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'admin_user', password: 'Password12345678', email: 'admin@example.com' }
    });
    const adminId = JSON.parse(regAdmin.body).user_id;
    db.prepare("UPDATE users SET email_verified = 1, role = 'admin' WHERE id = ?").run(adminId);

    const loginAdmin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin_user', password: 'Password12345678' }
    });
    
    // Admin needs to finish MFA to get CSRF from body
    const adminMfaCode = '111222';
    db.prepare("UPDATE email_codes SET code = ? WHERE user_id = ? AND type = 'mfa'").run(hashCode(adminMfaCode), adminId);
    const adminMfaRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login/mfa',
      payload: { user_id: adminId, code: adminMfaCode }
    });
    adminCookies = adminMfaRes.cookies.reduce((acc, c) => ({ ...acc, [c.name]: c.value }), {});
    const adminCsrf = JSON.parse(adminMfaRes.body).csrf;
    adminCookies.csrfToken = adminCsrf; // store for later

    // 2. Create target user
    const regUser = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'target_user', password: 'Password12345678', email: 'target@example.com' }
    });
    userId = JSON.parse(regUser.body).user_id;
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);

    const loginUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'target_user', password: 'Password12345678' }
    });
    
    const userMfaCode = '333444';
    db.prepare("UPDATE email_codes SET code = ? WHERE user_id = ? AND type = 'mfa'").run(hashCode(userMfaCode), userId);
    const userMfaRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login/mfa',
      payload: { user_id: userId, code: userMfaCode }
    });
    userCookies = userMfaRes.cookies.reduce((acc, c) => ({ ...acc, [c.name]: c.value }), {});
    const userCsrf = JSON.parse(userMfaRes.body).csrf;
    userCookies.csrfToken = userCsrf;

    const createServer = await app.inject({
      method: 'POST',
      url: '/api/servers',
      cookies: adminCookies,
      headers: { 'x-csrf-token': adminCsrf },
      payload: { name: 'Test Server' }
    });
    serverId = JSON.parse(createServer.body).id;
    console.log('DEBUG: serverId =', serverId);
  });

  it('should ban a user and prevent them from joining via invite', async () => {
    const adminCsrf = adminCookies.csrfToken;
    const userCsrf = userCookies.csrfToken;

    // 1. Admin bans user
    const banRes = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/admin/ban/${userId}`,
      cookies: adminCookies,
      headers: { 'x-csrf-token': adminCsrf },
      payload: { reason: 'Test Ban' }
    });
    if (banRes.statusCode !== 200) console.log('BAN ERROR:', banRes.body);
    expect(banRes.statusCode).toBe(200);

    // Verify in DB
    const ban = db.prepare('SELECT * FROM server_bans WHERE server_id = ? AND user_id = ?').get(serverId, userId);
    expect(ban).toBeDefined();

    // 2. Create invite code
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/admin/invite-codes`,
      cookies: adminCookies,
      headers: { 'x-csrf-token': adminCsrf },
      payload: {}
    });
    const { code } = JSON.parse(inviteRes.body);

    // 3. User tries to join
    const joinRes = await app.inject({
      method: 'POST',
      url: '/api/servers/join',
      cookies: userCookies,
      headers: { 'x-csrf-token': userCsrf },
      payload: { invite_code: code }
    });
    expect(joinRes.statusCode).toBe(403);
    expect(JSON.parse(joinRes.body).error).toContain('banned');
  });

  it('should prevent accepting an invitation if banned', async () => {
    const adminCsrf = adminCookies.csrfToken;
    const userCsrf = userCookies.csrfToken;

    // 1. Admin invites user
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/invitations`,
      cookies: adminCookies,
      headers: { 'x-csrf-token': adminCsrf },
      payload: { userId: userId }
    });
    if (inviteRes.statusCode !== 200) console.log('INVITE ERROR:', inviteRes.body);
    expect(inviteRes.statusCode).toBe(200);
    const invitationId = JSON.parse(inviteRes.body).id;

    // 2. User tries to accept
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/invitations/${invitationId}/accept`,
      cookies: userCookies,
      headers: { 'x-csrf-token': userCsrf }
    });
    expect(acceptRes.statusCode).toBe(403);
    expect(JSON.parse(acceptRes.body).error).toContain('banned');
  });

  it('should allow joining after unban', async () => {
    const adminCsrf = adminCookies.csrfToken;
    const userCsrf = userCookies.csrfToken;

    // 1. Unban
    const unbanRes = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/admin/unban/${userId}`,
      cookies: adminCookies,
      headers: { 'x-csrf-token': adminCsrf }
    });
    expect(unbanRes.statusCode).toBe(200);

    // 2. Get new invite code
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/admin/invite-codes`,
      cookies: adminCookies,
      headers: { 'x-csrf-token': adminCsrf },
      payload: {}
    });
    const { code } = JSON.parse(inviteRes.body);

    // 3. Try to join
    const joinRes = await app.inject({
      method: 'POST',
      url: '/api/servers/join',
      cookies: userCookies,
      headers: { 'x-csrf-token': userCsrf },
      payload: { invite_code: code }
    });
    expect(joinRes.statusCode).toBe(200);
    expect(JSON.parse(joinRes.body).id).toBe(serverId);
  });
});
