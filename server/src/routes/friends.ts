import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import { requireAuth } from '../auth/middleware.js';
import { sendTo, getClient } from '../ws/index.js';
import type { FriendInfo, FriendRequest, Friendship } from '@voip-server/shared';

export default async function friendRoutes(app: FastifyInstance) {
  // Look up a user by username (for friend requests across servers)
  app.get<{ Querystring: { username: string } }>(
    '/api/users/lookup',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { username } = request.query;
      if (!username || typeof username !== 'string') {
        return reply.status(400).send({ error: 'username query parameter is required' });
      }

      const user = db.prepare(
        'SELECT id, username, display_name, avatar_url FROM users WHERE LOWER(username) = ? AND email_verified = 1'
      ).get(username.toLowerCase()) as any;

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return user;
    },
  );
  // List accepted friends with online status
  app.get('/api/friends', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.userId;

    const rows = db.prepare(
      `SELECT f.id as friendship_id, u.id, u.username, u.display_name, u.avatar_url
       FROM friendships f
       JOIN users u ON (CASE WHEN f.user_id = ? THEN f.target_id ELSE f.user_id END) = u.id
       WHERE (f.user_id = ? OR f.target_id = ?) AND f.status = 'accepted'`
    ).all(userId, userId, userId) as any[];

    // Deduplicate by user id (bidirectional rows may produce duplicates)
    const seen = new Set<string>();
    const friends: FriendInfo[] = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const client = getClient(row.id);
      friends.push({
        id: row.id,
        friendship_id: row.friendship_id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        online: !!client && client.status !== 'invisible',
        status: client && client.status !== 'invisible' ? client.status : undefined,
      });
    }

    return friends;
  });

  // List pending friend requests
  app.get('/api/friends/pending', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.userId;

    const incoming = db.prepare(
      `SELECT f.id, f.created_at, u.id as user_id, u.username, u.display_name, u.avatar_url
       FROM friendships f
       JOIN users u ON f.user_id = u.id
       WHERE f.target_id = ? AND f.status = 'pending'`
    ).all(userId) as any[];

    const outgoing = db.prepare(
      `SELECT f.id, f.created_at, u.id as user_id, u.username, u.display_name, u.avatar_url
       FROM friendships f
       JOIN users u ON f.target_id = u.id
       WHERE f.user_id = ? AND f.status = 'pending'`
    ).all(userId) as any[];

    const requests: FriendRequest[] = [
      ...incoming.map((r: any) => ({
        id: r.id,
        user: {
          id: r.user_id,
          username: r.username,
          display_name: r.display_name,
          avatar_url: r.avatar_url,
        },
        direction: 'incoming' as const,
        created_at: r.created_at,
      })),
      ...outgoing.map((r: any) => ({
        id: r.id,
        user: {
          id: r.user_id,
          username: r.username,
          display_name: r.display_name,
          avatar_url: r.avatar_url,
        },
        direction: 'outgoing' as const,
        created_at: r.created_at,
      })),
    ];

    return requests;
  });

  // List blocked users
  app.get('/api/friends/blocked', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.userId;

    const rows = db.prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM friendships f
       JOIN users u ON f.target_id = u.id
       WHERE f.user_id = ? AND f.status = 'blocked'`
    ).all(userId) as any[];

    return rows.map((r: any): FriendInfo => ({
      id: r.id,
      username: r.username,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
    }));
  });

  // Send friend request
  app.post<{ Body: { target_id: string } }>(
    '/api/friends/request',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { target_id } = request.body;

      if (!target_id || typeof target_id !== 'string') {
        return reply.status(400).send({ error: 'target_id is required' });
      }

      if (target_id === userId) {
        return reply.status(400).send({ error: 'Cannot send a friend request to yourself' });
      }

      // Verify target exists
      const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(target_id) as any;
      if (!targetUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Check if blocked by target
      const blockedByTarget = db.prepare(
        "SELECT id FROM friendships WHERE user_id = ? AND target_id = ? AND status = 'blocked'"
      ).get(target_id, userId) as any;
      if (blockedByTarget) {
        return reply.status(403).send({ error: 'Cannot send friend request to this user' });
      }

      // Check if already friends
      const alreadyFriends = db.prepare(
        `SELECT id FROM friendships
         WHERE ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))
         AND status = 'accepted'`
      ).get(userId, target_id, target_id, userId) as any;
      if (alreadyFriends) {
        return reply.status(400).send({ error: 'Already friends with this user' });
      }

      // Check if pending request already exists from current user to target
      const existingRequest = db.prepare(
        "SELECT id FROM friendships WHERE user_id = ? AND target_id = ? AND status = 'pending'"
      ).get(userId, target_id) as any;
      if (existingRequest) {
        return reply.status(400).send({ error: 'Friend request already sent' });
      }

      // Check if target already sent a pending request to current user — auto-accept
      const reverseRequest = db.prepare(
        "SELECT id FROM friendships WHERE user_id = ? AND target_id = ? AND status = 'pending'"
      ).get(target_id, userId) as any;

      if (reverseRequest) {
        const autoAccept = db.transaction(() => {
          // Update the existing request to accepted
          db.prepare(
            "UPDATE friendships SET status = 'accepted' WHERE id = ?"
          ).run(reverseRequest.id);

          // Insert reverse row for bidirectional lookup
          const reverseId = randomUUID();
          db.prepare(
            "INSERT INTO friendships (id, user_id, target_id, status) VALUES (?, ?, ?, 'accepted')"
          ).run(reverseId, userId, target_id);

          return reverseRequest.id;
        });
        autoAccept();

        // Get current user info for the WS event
        const currentUser = db.prepare(
          'SELECT id, username, display_name, avatar_url FROM users WHERE id = ?'
        ).get(userId) as any;

        const friendInfo: FriendInfo = {
          id: currentUser.id,
          friendship_id: reverseRequest.id,
          username: currentUser.username,
          display_name: currentUser.display_name,
          avatar_url: currentUser.avatar_url,
          online: true,
        };

        sendTo(target_id, {
          type: 'friend:requestAccepted',
          userId,
          friend: friendInfo,
        });

        const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(reverseRequest.id) as Friendship;
        return row;
      }

      // Insert new pending request
      const id = randomUUID();
      db.prepare(
        "INSERT INTO friendships (id, user_id, target_id, status) VALUES (?, ?, ?, 'pending')"
      ).run(id, userId, target_id);

      const friendship = db.prepare('SELECT * FROM friendships WHERE id = ?').get(id) as Friendship;

      // Build WS event
      const senderInfo = db.prepare(
        'SELECT id, username, display_name, avatar_url FROM users WHERE id = ?'
      ).get(userId) as any;

      const friendRequest: FriendRequest = {
        id,
        user: {
          id: senderInfo.id,
          username: senderInfo.username,
          display_name: senderInfo.display_name,
          avatar_url: senderInfo.avatar_url,
        },
        direction: 'incoming',
        created_at: friendship.created_at,
      };

      sendTo(target_id, {
        type: 'friend:requestReceived',
        request: friendRequest,
      });

      return friendship;
    },
  );

  // Accept incoming friend request
  app.post<{ Params: { id: string } }>(
    '/api/friends/accept/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { id } = request.params;

      const friendship = db.prepare(
        "SELECT * FROM friendships WHERE id = ? AND status = 'pending'"
      ).get(id) as Friendship | undefined;

      if (!friendship) {
        return reply.status(404).send({ error: 'Friend request not found' });
      }

      if (friendship.target_id !== userId) {
        return reply.status(403).send({ error: 'Cannot accept this request' });
      }

      const accept = db.transaction(() => {
        // Update the request to accepted
        db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(id);

        // Insert reverse row for bidirectional lookup
        const reverseId = randomUUID();
        db.prepare(
          "INSERT INTO friendships (id, user_id, target_id, status) VALUES (?, ?, ?, 'accepted')"
        ).run(reverseId, userId, friendship.user_id);
      });
      accept();

      // Send WS event to the requester
      const currentUser = db.prepare(
        'SELECT id, username, display_name, avatar_url FROM users WHERE id = ?'
      ).get(userId) as any;

      const client = getClient(userId);
      const friendInfo: FriendInfo = {
        id: currentUser.id,
        friendship_id: id,
        username: currentUser.username,
        display_name: currentUser.display_name,
        avatar_url: currentUser.avatar_url,
        online: !!client && client.status !== 'invisible',
        status: client && client.status !== 'invisible' ? client.status : undefined,
      };

      sendTo(friendship.user_id, {
        type: 'friend:requestAccepted',
        userId,
        friend: friendInfo,
      });

      return { ok: true };
    },
  );

  // Decline incoming friend request
  app.post<{ Params: { id: string } }>(
    '/api/friends/decline/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { id } = request.params;

      const friendship = db.prepare(
        "SELECT * FROM friendships WHERE id = ? AND status = 'pending'"
      ).get(id) as Friendship | undefined;

      if (!friendship) {
        return reply.status(404).send({ error: 'Friend request not found' });
      }

      if (friendship.target_id !== userId) {
        return reply.status(403).send({ error: 'Cannot decline this request' });
      }

      db.prepare('DELETE FROM friendships WHERE id = ?').run(id);

      return { ok: true };
    },
  );

  // Remove a friend
  app.post<{ Params: { id: string } }>(
    '/api/friends/remove/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { id } = request.params;

      const friendship = db.prepare(
        'SELECT * FROM friendships WHERE id = ?'
      ).get(id) as Friendship | undefined;

      if (!friendship) {
        return reply.status(404).send({ error: 'Friendship not found' });
      }

      if (friendship.user_id !== userId && friendship.target_id !== userId) {
        return reply.status(403).send({ error: 'Not authorized' });
      }

      const otherId = friendship.user_id === userId ? friendship.target_id : friendship.user_id;

      const removeFriend = db.transaction(() => {
        // Delete both direction rows
        db.prepare(
          'DELETE FROM friendships WHERE (user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?)'
        ).run(userId, otherId, otherId, userId);
      });
      removeFriend();

      sendTo(otherId, {
        type: 'friend:removed',
        userId,
      });

      return { ok: true };
    },
  );

  // Block a user
  app.post<{ Params: { userId: string } }>(
    '/api/friends/block/:userId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const currentUserId = request.user.userId;
      const targetUserId = request.params.userId;

      if (targetUserId === currentUserId) {
        return reply.status(400).send({ error: 'Cannot block yourself' });
      }

      // Verify target exists
      const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId) as any;
      if (!targetUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const blockUser = db.transaction(() => {
        // Delete any existing friendship rows between the two users
        db.prepare(
          'DELETE FROM friendships WHERE (user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?)'
        ).run(currentUserId, targetUserId, targetUserId, currentUserId);

        // Insert blocked row
        const id = randomUUID();
        db.prepare(
          "INSERT INTO friendships (id, user_id, target_id, status) VALUES (?, ?, ?, 'blocked')"
        ).run(id, currentUserId, targetUserId);
      });
      blockUser();

      // Send friend:removed to target (don't reveal the block)
      sendTo(targetUserId, {
        type: 'friend:removed',
        userId: currentUserId,
      });

      return { ok: true };
    },
  );

  // Unblock a user
  app.post<{ Params: { userId: string } }>(
    '/api/friends/unblock/:userId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const currentUserId = request.user.userId;
      const targetUserId = request.params.userId;

      const result = db.prepare(
        "DELETE FROM friendships WHERE user_id = ? AND target_id = ? AND status = 'blocked'"
      ).run(currentUserId, targetUserId);

      if (result.changes === 0) {
        return reply.status(404).send({ error: 'Block not found' });
      }

      return { ok: true };
    },
  );
}
