import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, type JwtPayload } from './jwt.js';
import { getSessionByToken } from './sessions.js';
import { getPasswordExpiryStatus } from './policy.js';
import { hasPermission, hasChannelPermission, getUserRoleIds } from './permissions.js';
import db from '../db/connection.js';
import { config } from '../config.js';
import type { RolePermissions } from '@voip-server/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  // Accept token from cookie or Authorization header (desktop app uses Bearer token)
  let token = request.cookies.token;
  let fromBearer = false;

  if (!token) {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
      fromBearer = true;
    }
  }

  if (!token) {
    reply.code(401).send({ error: 'Not authenticated' });
    return;
  }
  try {
    const payload = verifyToken(token);

    // Verify session in DB
    const session = getSessionByToken(payload.jti);
    if (!session || session.user_id !== payload.userId) {
      reply.code(401).send({ error: 'Session revoked or expired — please log in again' });
      return;
    }

    // Re-check user status from DB on every request (#6 ban check, #7 role refresh)
    const dbUser = db
      .prepare('SELECT role, banned, role_id, password_changed_at FROM users WHERE id = ?')
      .get(payload.userId) as
      | { role: string; banned: number; role_id: string | null; password_changed_at: string | null }
      | undefined;

    if (!dbUser) {
      reply.code(401).send({ error: 'User not found' });
      return;
    }
    if (dbUser.banned) {
      reply.code(403).send({ error: 'Account banned' });
      return;
    }

    // Invalidate JWT if password was changed after token was issued
    if (payload.pwc && dbUser.password_changed_at && payload.pwc !== dbUser.password_changed_at) {
      reply.code(401).send({ error: 'Session expired — please log in again' });
      return;
    }

    // CSRF double-submit check for state-changing requests
    // Skip for Bearer token auth (not auto-sent by browser, so CSRF doesn't apply)
    if (!fromBearer) {
      const method = request.method.toUpperCase();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const csrfCookie = request.cookies.csrf;
        const csrfHeader = request.headers['x-csrf-token'] as string | undefined;
        if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
          return reply.code(403).send({ error: 'Invalid CSRF token' });
        }
      }
    }

    // Enforce password expiry mid-session
    if (getPasswordExpiryStatus(dbUser.password_changed_at).expired) {
      reply.code(401).send({ error: 'Password expired — please change your password' });
      return;
    }

    // Use the current role from DB, not the stale JWT role
    const roleIds = getUserRoleIds(payload.userId);
    request.user = { ...payload, role: dbUser.role, roleId: dbUser.role_id ?? undefined, roleIds };
  } catch {
    reply.code(401).send({ error: 'Invalid or expired token' });
  }
}

/**
 * Check if a user is an instance-level admin (configured via ADMIN_USERS env var).
 */
export function isInstanceAdmin(username: string): boolean {
  return config.adminUsers.includes(username.toLowerCase());
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (!isInstanceAdmin(request.user.username)) {
    reply.code(403).send({ error: 'Admin access required' });
  }
}

export function requirePermission(perm: keyof RolePermissions) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    await requireAuth(request, reply);
    if (reply.sent) return;
    const serverId = (request.params as any).serverId;
    if (!hasPermission(request.user.userId, perm, serverId)) {
      return reply.code(403).send({ error: `Missing permission: ${String(perm)}` });
    }
  };
}

export function requireChannelPermission(perm: keyof RolePermissions, channelIdParam = 'id') {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    await requireAuth(request, reply);
    if (reply.sent) return;
    const channelId = (request.params as any)[channelIdParam];
    if (!hasChannelPermission(request.user.userId, channelId, perm)) {
      reply.code(403).send({ error: `Missing permission: ${String(perm)}` });
    }
  };
}
