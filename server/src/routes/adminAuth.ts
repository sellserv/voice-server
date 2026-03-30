import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { signAdminToken } from '../auth/adminToken.js';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function adminIpAllowlist(request: FastifyRequest, reply: FastifyReply) {
  const allowedIps = config.admin.allowedIps;
  if (allowedIps.length === 0) return;
  if (!allowedIps.includes(request.ip)) {
    reply.code(403).send({ error: 'Forbidden' });
  }
}

export default async function adminAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { username: string; password: string } }>(
    '/api/admin/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          keyGenerator: (request: any) => request.ip,
        },
      },
      preHandler: adminIpAllowlist,
    },
    async (request, reply) => {
      const { username, password } = request.body;

      if (!config.admin.username || !config.admin.password) {
        return reply.code(503).send({ error: 'Admin console not configured' });
      }

      if (!username || !password) {
        return reply.code(400).send({ error: 'Username and password required' });
      }

      const usernameMatch = safeCompare(username, config.admin.username);
      const passwordMatch = safeCompare(password, config.admin.password);

      if (!usernameMatch || !passwordMatch) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const token = signAdminToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      return { token, expiresAt };
    },
  );
}
