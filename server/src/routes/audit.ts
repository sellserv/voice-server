import { FastifyInstance } from 'fastify';
import { requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { getAuditLog } from '../audit/log.js';

export default async function auditRoutes(app: FastifyInstance) {
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/admin/audit-log',
    { preHandler: [requirePermission('view_audit_log'), requireServerMember] },
    async (request) => {
      const serverId = getServerId(request);
      const { page, limit, event_type, user_id } = request.query as {
        page?: string;
        limit?: string;
        event_type?: string;
        user_id?: string;
      };
      return await getAuditLog({
        page: page ? parseInt(page) : undefined,
        limit: limit ? Math.min(parseInt(limit), 100) : undefined,
        eventType: event_type,
        userId: user_id,
        serverId,
      });
    },
  );
}
