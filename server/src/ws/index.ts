import type { FastifyInstance } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import { verifyToken, type JwtPayload } from '../auth/jwt.js';
import { handleMessage } from './handlers.js';
import { getAllRoomMembers } from '../media/signaling.js';
import { onUserIdle, onUserActive } from '../media/afkManager.js';
import type { ServerEvent, UserStatus, Channel } from '@voip-server/shared';
import db from '../db/connection.js';
import { getCachedChannelAccess } from '../auth/permissions.js';

// WebSocket limits
const WS_MAX_MESSAGES_PER_SECOND = 15;
const WS_MAX_MESSAGE_SIZE = 64 * 1024; // 64KB

// Per-event rate limits (max per 10 seconds)
const EVENT_RATE_LIMITS: Record<string, number> = {
  'chat:send': 10,
  'dm:open': 5,
  'message:react': 20,
  'message:pin': 5,
  'message:unpin': 5,
  'effect:send': 3,
};

interface EventRateState {
  counts: Map<string, number>;
  windowStart: number;
}

interface ConnectedClient {
  ws: WebSocket;
  user: JwtPayload;
  status: UserStatus;
  display_name?: string;
  avatar_url?: string | null;
  serverIds: string[];
  isAlive: boolean;
  activity?: string | null;
  activityVisibility?: 'all' | 'selected';
  activityServerIds?: string[];
}

const clients = new Map<string, ConnectedClient>();

function heartbeat(this: any) {
  // this is the WebSocket instance
  for (const client of clients.values()) {
    if (client.ws === this) {
      client.isAlive = true;
      break;
    }
  }
}

export function getClient(userId: string): ConnectedClient | undefined {
  return clients.get(userId);
}

export function isUserOnline(userId: string): boolean {
  return clients.has(userId);
}

export function getDisplayName(userId: string): string | undefined {
  const client = clients.get(userId);
  if (client) return client.display_name;
  const row = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId) as
    | { display_name: string }
    | undefined;
  return row?.display_name;
}

export function getAvatarUrl(userId: string): string | null {
  const client = clients.get(userId);
  if (client) return client.avatar_url ?? null;
  const row = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(userId) as
    | { avatar_url: string | null }
    | undefined;
  return row?.avatar_url ?? null;
}

export function getOnlineUsers(serverId?: string): {
  userId: string;
  username: string;
  display_name?: string;
  status: UserStatus;
  activity?: string;
}[] {
  const result = Array.from(clients.values())
    .filter((c) => c.status !== 'invisible')
    .filter((c) => !serverId || c.serverIds?.includes(serverId))
    .map((c) => {
      const showActivity = !serverId ||
        c.activityVisibility === 'all' ||
        (c.activityVisibility === 'selected' && c.activityServerIds?.includes(serverId));
      return {
        userId: c.user.userId,
        username: c.user.username,
        display_name: c.display_name,
        status: c.status,
        activity: showActivity && c.activity ? c.activity : undefined,
      };
    });

  // Add enabled bots as always-online
  if (serverId) {
    const bots = db.prepare('SELECT b.user_id, b.name FROM bots b WHERE b.enabled = 1 AND b.server_id = ?').all(serverId) as {
      user_id: string;
      name: string;
    }[];
    for (const bot of bots) {
      result.push({
        userId: bot.user_id,
        username: bot.name,
        display_name: bot.name,
        status: 'online' as UserStatus,
        activity: undefined,
      });
    }
  } else {
    const bots = db.prepare('SELECT b.user_id, b.name FROM bots b WHERE b.enabled = 1').all() as {
      user_id: string;
      name: string;
    }[];
    for (const bot of bots) {
      result.push({
        userId: bot.user_id,
        username: bot.name,
        display_name: bot.name,
        status: 'online' as UserStatus,
        activity: undefined,
      });
    }
  }

  return result;
}

export function broadcast(event: ServerEvent, excludeUserId?: string) {
  const msg = JSON.stringify(event);
  for (const [userId, client] of clients) {
    if (userId !== excludeUserId && client.ws.readyState === 1) {
      client.ws.send(msg);
    }
  }
}

export function broadcastToServer(serverId: string, event: ServerEvent, excludeUserId?: string) {
  const msg = JSON.stringify(event);
  for (const [userId, client] of clients) {
    if (userId === excludeUserId) continue;
    if (!client.serverIds?.includes(serverId)) continue;
    if (client.ws.readyState === 1) client.ws.send(msg);
  }
}

export function addClientServer(userId: string, serverId: string) {
  const client = clients.get(userId);
  if (client && !client.serverIds.includes(serverId)) {
    client.serverIds.push(serverId);
  }
}

export function removeClientServer(userId: string, serverId: string) {
  const client = clients.get(userId);
  if (client) {
    client.serverIds = client.serverIds.filter(id => id !== serverId);
  }
}

export function sendTo(userId: string, event: ServerEvent) {
  const client = clients.get(userId);
  if (client && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(event));
  }
}

export function disconnectUser(userId: string) {
  const client = clients.get(userId);
  if (client) {
    client.ws.close(1000, 'Disconnected by server');
  }
}

export function setClientStatus(userId: string, status: UserStatus) {
  const client = clients.get(userId);
  if (!client) return;

  const oldStatus = client.status;
  client.status = status;

  // AFK voice channel management
  if (status === 'idle') {
    onUserIdle(userId);
  } else {
    onUserActive(userId);
  }

  // Persist to DB (don't save 'idle' — it's a transient auto-idle state, not a preference)
  if (status !== 'idle') {
    db.prepare('UPDATE users SET status_preference = ? WHERE id = ?').run(status, userId);
  }

  const displayName = getDisplayName(userId);

  if (oldStatus === 'invisible' && status !== 'invisible') {
    // invisible → visible: appear online
    broadcast(
      {
        type: 'presence:update',
        userId,
        username: client.user.username,
        display_name: displayName,
        online: true,
        status,
      },
      userId,
    );
  } else if (oldStatus !== 'invisible' && status === 'invisible') {
    // visible → invisible: appear offline
    broadcast(
      {
        type: 'presence:update',
        userId,
        username: client.user.username,
        display_name: displayName,
        online: false,
      },
      userId,
    );
  } else if (status !== 'invisible') {
    // visible → visible: status change
    broadcast(
      {
        type: 'presence:update',
        userId,
        username: client.user.username,
        display_name: displayName,
        online: true,
        status,
      },
      userId,
    );
  }
}

export function getDmParticipantIds(channelId: string): string[] {
  const rows = db
    .prepare('SELECT user_id FROM dm_participants WHERE channel_id = ?')
    .all(channelId) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

export function sendToMany(userIds: string[], event: ServerEvent, excludeUserId?: string) {
  const msg = JSON.stringify(event);
  for (const userId of userIds) {
    if (userId === excludeUserId) continue;
    const client = clients.get(userId);
    if (client && client.ws.readyState === 1) {
      client.ws.send(msg);
    }
  }
}

// Cache whether a channel has view_channel overrides (to avoid DB query on every broadcast)
const channelHasViewOverridesCache = new Map<string, boolean>();

export function invalidateChannelCache(channelId: string) {
  channelHasViewOverridesCache.delete(channelId);
}

export function broadcastToChannel(channelId: string, event: ServerEvent, excludeUserId?: string) {
  // Check if this is a DM channel or a server channel
  const channel = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(channelId) as { server_id: string | null } | undefined;

  let hasOverrides = channelHasViewOverridesCache.get(channelId);
  if (hasOverrides === undefined) {
    const override = db
      .prepare(
        'SELECT 1 FROM channel_permission_overrides WHERE channel_id = ? AND view_channel IS NOT NULL',
      )
      .get(channelId);
    hasOverrides = !!override;
    channelHasViewOverridesCache.set(channelId, hasOverrides);
  }
  if (!hasOverrides) {
    if (channel?.server_id) {
      broadcastToServer(channel.server_id, event, excludeUserId);
    } else {
      broadcast(event, excludeUserId); // DM or global
    }
    return;
  }
  const userIds = getCachedChannelAccess(channelId);
  sendToMany(userIds, event, excludeUserId);
}

export function broadcastChannelAccessChange(
  channelId: string,
  beforeSet: Set<string> | null,
  afterSet: Set<string> | null,
  channel: Channel,
) {
  // Pre-serialize all possible payloads once to avoid per-connection JSON.stringify
  const updatedMsg = JSON.stringify({ type: 'channel:updated', channel });
  const createdMsg = JSON.stringify({ type: 'channel:created', channel });
  const deletedMsg = JSON.stringify({ type: 'channel:deleted', channelId });

  // Scope to server members if channel belongs to a server
  const channelRow = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(channelId) as { server_id: string | null } | undefined;
  const serverId = channelRow?.server_id;

  for (const [userId, client] of clients) {
    if (serverId && !client.serverIds?.includes(serverId)) continue;

    const hadAccess = beforeSet === null || beforeSet.has(userId);
    const hasAccess = afterSet === null || afterSet.has(userId);

    if (client.ws.readyState !== 1) continue;

    if (hadAccess && hasAccess) {
      client.ws.send(updatedMsg);
    } else if (!hadAccess && hasAccess) {
      client.ws.send(createdMsg);
    } else if (hadAccess && !hasAccess) {
      client.ws.send(deletedMsg);
    }
  }
}

export function setupWebSocket(app: FastifyInstance) {
  // Heartbeat interval for cleaning up dead connections
  const interval = setInterval(() => {
    for (const [userId, client] of clients) {
      if (client.isAlive === false) {
        console.log(`[WS] Terminating dead connection for user ${userId}`);
        client.ws.terminate();
        clients.delete(userId);
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
  }, 30000);

  app.addHook('onClose', async () => {
    clearInterval(interval);
  });

  app.get('/ws', { websocket: true }, (socket, request) => {
    // Authenticate from cookie or query parameter (for desktop app)
    let token = (request.query as Record<string, string>)?.token || '';

    if (!token) {
      const cookieHeader = request.headers.cookie || '';
      const cookies: Record<string, string> = {};
      for (const pair of cookieHeader.split(';')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) continue;
        const key = pair.slice(0, eqIdx).trim();
        const value = decodeURIComponent(pair.slice(eqIdx + 1).trim());
        cookies[key] = value;
      }
      token = cookies['token'] || '';
    }

    if (!token) {
      socket.close(4001, 'Not authenticated');
      return;
    }

    let user: JwtPayload;
    try {
      user = verifyToken(token);
    } catch {
      socket.close(4001, 'Invalid token');
      return;
    }

    // Check ban status from DB (#6)
    const dbUser = db.prepare('SELECT role, banned FROM users WHERE id = ?').get(user.userId) as
      | { role: string; banned: number }
      | undefined;
    if (!dbUser || dbUser.banned) {
      socket.close(4003, 'Account banned');
      return;
    }
    // Use fresh role from DB (#7)
    user = { ...user, role: dbUser.role };

    // Close existing connection for this user (single-session)
    const existing = clients.get(user.userId);
    if (existing) {
      if (existing.isAlive === false) {
        // Old connection is unresponsive — terminate silently, not a real second session
        console.log(`[WS] Terminating stale connection for ${user.userId} (new connection arrived)`);
        existing.ws.terminate();
      } else {
        // Old connection is alive — genuine second session
        existing.ws.close(4002, 'Connected from another location');
      }
    }

    // Read status preference, display name, and avatar from DB
    const profileRow = db
      .prepare('SELECT status_preference, display_name, avatar_url FROM users WHERE id = ?')
      .get(user.userId) as
      | { status_preference: string; display_name: string; avatar_url: string | null }
      | undefined;
    // Treat 'idle' as 'online' on connect — idle is a transient auto state, not a preference
    const rawStatus = profileRow?.status_preference || 'online';
    const preferredStatus = (rawStatus === 'idle' ? 'online' : rawStatus) as UserStatus;

    // Fetch server memberships for this user
    const serverRows = db.prepare(
      'SELECT server_id FROM server_members WHERE user_id = ?'
    ).all(user.userId) as { server_id: string }[];

    clients.set(user.userId, {
      ws: socket,
      user,
      status: preferredStatus,
      display_name: profileRow?.display_name,
      avatar_url: profileRow?.avatar_url,
      serverIds: serverRows.map(s => s.server_id),
      isAlive: true,
    });

    socket.on('pong', heartbeat);

    // Notify everyone of new presence (skip if invisible)
    if (preferredStatus !== 'invisible') {
      broadcast(
        {
          type: 'presence:update',
          userId: user.userId,
          username: user.username,
          display_name: getDisplayName(user.userId),
          online: true,
          status: preferredStatus,
        },
        user.userId,
      );
    }

    // Send current online users to the new client (with own status)
    sendTo(user.userId, {
      type: 'presence:list',
      users: getOnlineUsers(),
      ownStatus: preferredStatus,
    });

    // Send current voice channel members to the new client
    const channelMembers = getAllRoomMembers();
    if (Object.keys(channelMembers).length > 0) {
      sendTo(user.userId, { type: 'voice:channelMembers', channels: channelMembers });
    }

    // Rate limiting per connection
    let messageCount = 0;
    let messageWindowStart = Date.now();
    let lastBanCheck = Date.now();
    const eventRate: EventRateState = { counts: new Map(), windowStart: Date.now() };

    socket.on('message', (raw: RawData) => {
      try {
        // Check message size (#12)
        const rawBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (rawBuf.length > WS_MAX_MESSAGE_SIZE) {
          sendTo(user.userId, { type: 'error', message: 'Message too large' });
          return;
        }

        // Rate limit check (#5)
        const now = Date.now();
        if (now - messageWindowStart > 1000) {
          messageCount = 0;
          messageWindowStart = now;
        }
        messageCount++;
        if (messageCount > WS_MAX_MESSAGES_PER_SECOND) {
          sendTo(user.userId, { type: 'error', message: 'Rate limit exceeded' });
          return;
        }

        const data = JSON.parse(raw.toString());

        // Re-check ban status periodically (every 30s) to catch mid-session bans
        const eventType = data?.type as string;
        if (eventType === 'chat:send' || eventType === 'chat:edit') {
          if (!lastBanCheck || now - lastBanCheck > 30_000) {
            lastBanCheck = now;
            const freshUser = db
              .prepare('SELECT banned FROM users WHERE id = ?')
              .get(user.userId) as { banned: number } | undefined;
            if (!freshUser || freshUser.banned) {
              socket.close(4003, 'Account banned');
              return;
            }
          }
        }

        // Per-event rate limiting
        if (eventType && EVENT_RATE_LIMITS[eventType]) {
          if (now - eventRate.windowStart > 10_000) {
            eventRate.counts.clear();
            eventRate.windowStart = now;
          }
          const count = (eventRate.counts.get(eventType) || 0) + 1;
          eventRate.counts.set(eventType, count);
          if (count > EVENT_RATE_LIMITS[eventType]) {
            sendTo(user.userId, { type: 'error', message: `Rate limit exceeded for ${eventType}` });
            return;
          }
        }

        handleMessage(user, data);
      } catch (err) {
        console.error('[WS] Error handling message from', user.userId, err);
        sendTo(user.userId, { type: 'error', message: 'Invalid message format' });
      }
    });

    socket.on('close', () => {
      const client = clients.get(user.userId);

      // Only clean up if this socket is still the active connection.
      // If a new connection already replaced us, skip cleanup to avoid
      // deleting the new connection from the clients map.
      if (!client || client.ws !== socket) return;

      const wasInvisible = client.status === 'invisible';
      clients.delete(user.userId);

      // Handle voice cleanup
      import('./handlers.js').then((m) => m.handleDisconnect(user));

      // Don't broadcast offline if user was invisible
      if (!wasInvisible) {
        broadcast({
          type: 'presence:update',
          userId: user.userId,
          username: user.username,
          display_name: getDisplayName(user.userId),
          online: false,
        });
      }
    });
  });
}
