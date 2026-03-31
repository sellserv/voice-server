import { getDb } from '../adapters/index.js';
import { broadcastToChannel, sendTo } from '../ws/index.js';
import { hasPermission } from '../auth/permissions.js';
import type { Message } from '@voip-server/shared';

interface AutomodConfig {
  blockedWords: string[];
  action: 'delete' | 'warn' | 'both';
  warnMessage?: string;
}

/**
 * Processes a message through all enabled bots for a server.
 * Returns true if the message should be blocked/deleted.
 */
export async function processMessageForBots(serverId: string, message: Message): Promise<boolean> {
  // 1. Get all enabled bots for this server
  const bots = await getDb().query(
    'SELECT id, type, name, enabled, config, server_id FROM bots WHERE server_id = ? AND enabled = 1',
    [serverId],
  );

  // Debug: also check all bots for this server (including disabled)
  const allBots = await getDb().query(
    'SELECT id, type, name, enabled, config FROM bots WHERE server_id = ?',
    [serverId],
  );
  console.log(`[Automod] Server ${serverId}: ${allBots.length} total bots, ${bots.length} enabled. All bots:`, allBots.map((b: any) => `${b.name}(type=${b.type}, enabled=${b.enabled}, hasConfig=${!!b.config})`).join(', '));

  let shouldDelete = false;

  for (const bot of bots) {
    if ((bot as any).type === 'automod') {
      console.log(`[Automod] Checking message "${message.content}" from ${message.user_id} against bot "${(bot as any).name}", config: ${(bot as any).config?.substring(0, 200)}`);
      const isBlocked = await runAutomod(bot, message);
      console.log(`[Automod] Result: ${isBlocked ? 'BLOCKED' : 'allowed'}`);
      if (isBlocked) shouldDelete = true;
    }
  }

  return shouldDelete;
}

async function runAutomod(bot: any, message: Message): Promise<boolean> {
  if (!bot.config) return false;

  try {
    const config: AutomodConfig = JSON.parse(bot.config);
    if (!config.blockedWords || config.blockedWords.length === 0) return false;

    // Admin bypass
    const serverId = await getDb().queryOne<{ server_id: string }>(
      'SELECT server_id FROM channels WHERE id = ?',
      [message.channel_id],
    );
    if (serverId && await hasPermission(message.user_id, 'administrator', serverId.server_id)) {
      return false;
    }

    const content = message.content.toLowerCase();
    const foundWord = config.blockedWords.find(word => content.includes(word.toLowerCase()));

    if (foundWord) {
      console.log(`[Automod] Bot ${bot.name} triggered by word "${foundWord}" from user ${message.username}`);

      const action = config.action || 'delete';

      if (action === 'warn' || action === 'both') {
        const warnText = config.warnMessage || `Your message was flagged by Automod for containing a prohibited word.`;
        sendTo(message.user_id, {
          type: 'error',
          message: warnText
        });
      }

      return (action === 'delete' || action === 'both');
    }
  } catch (err) {
    console.error(`[Automod] Failed to process bot ${bot.name} config:`, err);
  }

  return false;
}
