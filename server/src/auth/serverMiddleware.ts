import { FastifyRequest, FastifyReply } from 'fastify';
import db from '../db/connection.js';

export function requireServerMember(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  // Skip if a previous preHandler already sent a response (e.g. auth or permission denied)
  if (reply.sent) return done();

  const serverId = (request.params as any).serverId;
  if (!serverId) {
    reply.code(400).send({ error: 'Server ID required' });
    return;
  }

  if (!request.user?.userId) {
    reply.code(401).send({ error: 'Not authenticated' });
    return;
  }

  const member = db.prepare(
    'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?'
  ).get(serverId, request.user.userId);

  if (!member) {
    reply.code(403).send({ error: 'Not a member of this server' });
    return;
  }

  // Attach serverId to request for downstream use
  (request as any).serverId = serverId;
  done();
}

export function getServerId(request: FastifyRequest): string {
  return (request as any).serverId || (request.params as any).serverId;
}
