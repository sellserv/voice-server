import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { getDb } from '../adapters/index.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { hasPermission } from '../auth/permissions.js';
import { sendToMany, broadcastToChannel } from '../ws/index.js';
import type { Poll, PollOption } from '@voip-server/shared';

async function getServerMemberUserIds(serverId: string): Promise<string[]> {
  const rows = await getDb().query<{ user_id: string }>('SELECT user_id FROM server_members WHERE server_id = ?', [serverId]);
  return rows.map(r => r.user_id);
}

async function getPollWithDetails(pollId: string, userId: string): Promise<Poll | null> {
  const poll = await getDb().queryOne<any>(`
    SELECT p.*, u.username as creator_username, u.display_name as creator_display_name, u.avatar_url as creator_avatar_url
    FROM polls p
    JOIN users u ON u.id = p.creator_id
    WHERE p.id = ?
  `, [pollId]);

  if (!poll) return null;

  // On-the-fly expiry check: if ends_at has passed, mark inactive
  if (poll.is_active && poll.ends_at && new Date(poll.ends_at) <= new Date()) {
    await getDb().run('UPDATE polls SET is_active = 0 WHERE id = ?', [pollId]);
    poll.is_active = 0;
  }

  const options = await getDb().query<any>(`
    SELECT o.*,
           (SELECT COUNT(*) FROM poll_votes WHERE option_id = o.id) as vote_count,
           (SELECT 1 FROM poll_votes WHERE option_id = o.id AND user_id = ?) as voted_by_me
    FROM poll_options o
    WHERE o.poll_id = ?
  `, [userId, pollId]);

  const totalVotes = await getDb().queryOne<{ c: number }>('SELECT COUNT(DISTINCT user_id) as c FROM poll_votes WHERE poll_id = ?', [pollId]);

  return {
    ...poll,
    is_active: !!poll.is_active,
    allow_multiple: !!poll.allow_multiple,
    options: options.map(o => ({
      ...o,
      voted_by_me: !!o.voted_by_me
    })),
    total_votes: totalVotes?.c ?? 0
  };
}

async function getPollsWithDetails(serverId: string, userId: string): Promise<Poll[]> {
  const polls = await getDb().query<any>(`
    SELECT p.*, u.username as creator_username, u.display_name as creator_display_name, u.avatar_url as creator_avatar_url
    FROM polls p
    JOIN users u ON u.id = p.creator_id
    WHERE p.server_id = ?
    ORDER BY p.created_at DESC
  `, [serverId]);

  if (polls.length === 0) return [];

  // Expire stale polls in one batch
  const now = new Date();
  const expiredIds = polls.filter(p => p.is_active && p.ends_at && new Date(p.ends_at) <= now).map(p => p.id);
  if (expiredIds.length > 0) {
    const placeholders = expiredIds.map(() => '?').join(',');
    await getDb().run(`UPDATE polls SET is_active = 0 WHERE id IN (${placeholders})`, expiredIds);
    for (const p of polls) {
      if (expiredIds.includes(p.id)) p.is_active = 0;
    }
  }

  const pollIds = polls.map(p => p.id);
  const placeholders = pollIds.map(() => '?').join(',');

  // Batch load all options
  const allOptions = await getDb().query<any>(`
    SELECT o.*,
           (SELECT COUNT(*) FROM poll_votes WHERE option_id = o.id) as vote_count,
           (SELECT 1 FROM poll_votes WHERE option_id = o.id AND user_id = ?) as voted_by_me
    FROM poll_options o
    WHERE o.poll_id IN (${placeholders})
  `, [userId, ...pollIds]);

  // Batch load total votes
  const voteCounts = await getDb().query<any>(`
    SELECT poll_id, COUNT(DISTINCT user_id) as c
    FROM poll_votes
    WHERE poll_id IN (${placeholders})
    GROUP BY poll_id
  `, pollIds);

  const optionsByPoll = new Map<string, any[]>();
  for (const o of allOptions) {
    if (!optionsByPoll.has(o.poll_id)) optionsByPoll.set(o.poll_id, []);
    optionsByPoll.get(o.poll_id)!.push({ ...o, voted_by_me: !!o.voted_by_me });
  }

  const votesByPoll = new Map<string, number>();
  for (const v of voteCounts) votesByPoll.set(v.poll_id, v.c);

  return polls.map(p => ({
    ...p,
    is_active: !!p.is_active,
    allow_multiple: !!p.allow_multiple,
    options: optionsByPoll.get(p.id) || [],
    total_votes: votesByPoll.get(p.id) || 0,
  }));
}

export default async function pollRoutes(app: FastifyInstance) {
  // List polls for a server
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/polls',
    { preHandler: [requireAuth, requireServerMember] },
    async (request) => {
      const serverId = getServerId(request);
      const userId = request.user.userId;

      return await getPollsWithDetails(serverId, userId);
    }
  );

  // Create a poll
  app.post<{
    Params: { serverId: string };
    Body: {
      question: string;
      options: string[];
      allow_multiple?: boolean;
      channel_id?: string;
      ends_at?: string;
    }
  }>(
    '/api/servers/:serverId/polls',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { question, options, allow_multiple, channel_id, ends_at } = request.body;

      if (!question || !options || options.length < 2) {
        return reply.code(400).send({ error: 'Question and at least 2 options required' });
      }

      const pollId = randomUUID();
      const messageId = randomUUID();

      const expiryDate = ends_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await getDb().transaction(async (tx) => {
        await tx.run(`
          INSERT INTO polls (id, server_id, channel_id, creator_id, question, allow_multiple, ends_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [pollId, serverId, channel_id || null, request.user.userId, question, allow_multiple ? 1 : 0, expiryDate]);

        for (const optText of options) {
          await tx.run('INSERT INTO poll_options (id, poll_id, text) VALUES (?, ?, ?)', [randomUUID(), pollId, optText]);
        }

        if (channel_id) {
          // Create linked message
          await tx.run(`
            INSERT INTO messages (id, channel_id, user_id, content, poll_id)
            VALUES (?, ?, ?, ?, ?)
          `, [messageId, channel_id, request.user.userId, `Created a poll: ${question}`, pollId]);
        }
      });

      const poll = await getPollWithDetails(pollId, request.user.userId);

      if (channel_id) {
        // Fetch and broadcast message
        const message = await getDb().queryOne<any>(`
          SELECT m.*, u.username, u.display_name, u.avatar_url,
                 r.color as role_color
          FROM messages m
          JOIN users u ON u.id = m.user_id
          LEFT JOIN roles r ON r.id = u.role_id
          WHERE m.id = ?
        `, [messageId]);

        if (message) {
          await broadcastToChannel(channel_id, {
            type: 'chat:message',
            message: {
              ...message,
              pinned: !!message.pinned
            }
          } as any);
        }
      }

      // Broadcast to server
      const memberIds = await getServerMemberUserIds(serverId);
      sendToMany(memberIds, {
        type: 'poll:created',
        serverId,
        poll: poll!
      });

      return poll;
    }
  );

  // Vote in a poll
  app.post<{ Params: { serverId: string; pollId: string }; Body: { optionIds: string[] } }>(
    '/api/servers/:serverId/polls/:pollId/vote',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const { pollId } = request.params;
      const { optionIds } = request.body;
      const userId = request.user.userId;
      const serverId = getServerId(request);

      const poll = await getDb().queryOne<{ id: string; is_active: number; allow_multiple: number }>('SELECT id, is_active, allow_multiple FROM polls WHERE id = ?', [pollId]);
      if (!poll || !poll.is_active) {
        return reply.code(404).send({ error: 'Poll not found or inactive' });
      }

      await getDb().transaction(async (tx) => {
        // Clear existing votes for this user in this poll
        await tx.run('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', [pollId, userId]);

        if (poll.allow_multiple) {
          for (const oid of optionIds) {
            await tx.run('INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)', [pollId, userId, oid]);
          }
        } else if (optionIds.length > 0) {
          await tx.run('INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)', [pollId, userId, optionIds[0]]);
        }
      });

      const updatedPoll = await getPollWithDetails(pollId, userId);

      // Broadcast update
      const memberIds = await getServerMemberUserIds(serverId);
      sendToMany(memberIds, {
        type: 'poll:updated',
        serverId,
        pollId,
        options: updatedPoll!.options,
        totalVotes: updatedPoll!.total_votes || 0
      });

      return updatedPoll;
    }
  );

  // Close a poll early (creator or admin only)
  app.patch<{ Params: { serverId: string; pollId: string } }>(
    '/api/servers/:serverId/polls/:pollId/close',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const { pollId } = request.params;
      const serverId = getServerId(request);
      const userId = request.user.userId;

      const poll = await getDb().queryOne<any>('SELECT id, creator_id, is_active, channel_id FROM polls WHERE id = ? AND server_id = ?', [pollId, serverId]);
      if (!poll) return reply.code(404).send({ error: 'Poll not found' });
      if (!poll.is_active) return reply.code(400).send({ error: 'Poll is already closed' });

      if (poll.creator_id !== userId && !await hasPermission(userId, 'administrator', serverId)) {
        return reply.code(403).send({ error: 'Only the poll creator or an admin can close this poll' });
      }

      await getDb().run('UPDATE polls SET is_active = 0 WHERE id = ?', [pollId]);

      const updatedPoll = await getPollWithDetails(pollId, userId);

      // Broadcast closure
      const memberIds = await getServerMemberUserIds(serverId);
      sendToMany(memberIds, {
        type: 'poll:updated',
        serverId,
        pollId,
        options: updatedPoll!.options.map(o => ({ id: o.id, vote_count: o.vote_count || 0 })),
        totalVotes: updatedPoll!.total_votes || 0,
        isActive: false
      } as any);

      return updatedPoll;
    }
  );

  // Delete a poll
  app.delete<{ Params: { serverId: string; pollId: string } }>(
    '/api/servers/:serverId/polls/:pollId',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const { pollId } = request.params;
      const serverId = getServerId(request);

      const poll = await getDb().queryOne<{ creator_id: string }>('SELECT creator_id FROM polls WHERE id = ?', [pollId]);
      if (!poll) return reply.code(404).send({ error: 'Poll not found' });

      // Only creator or admin can delete
      if (poll.creator_id !== request.user.userId && !await hasPermission(request.user.userId, 'administrator', serverId)) {
        return reply.code(403).send({ error: 'No permission to delete this poll' });
      }

      await getDb().run('DELETE FROM polls WHERE id = ?', [pollId]);

      // Broadcast deletion
      const memberIds = await getServerMemberUserIds(serverId);
      sendToMany(memberIds, {
        type: 'poll:deleted',
        serverId,
        pollId
      });

      return { ok: true };
    }
  );
}
