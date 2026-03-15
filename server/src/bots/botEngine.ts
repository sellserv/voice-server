import db from '../db/connection.js';
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
export function processMessageForBots(serverId: string, message: Message): boolean {
  // 1. Get all enabled bots for this server
  const bots = db.prepare(
    'SELECT id, type, name, enabled, config, server_id FROM bots WHERE server_id = ? AND enabled = 1'
  ).all(serverId) as any[];

  // Debug: also check all bots for this server (including disabled)
  const allBots = db.prepare(
    'SELECT id, type, name, enabled, config FROM bots WHERE server_id = ?'
  ).all(serverId) as any[];
  console.log(`[Automod] Server ${serverId}: ${allBots.length} total bots, ${bots.length} enabled. All bots:`, allBots.map((b: any) => `${b.name}(type=${b.type}, enabled=${b.enabled}, hasConfig=${!!b.config})`).join(', '));

  let shouldDelete = false;

  for (const bot of bots) {
    if (bot.type === 'automod') {
      console.log(`[Automod] Checking message "${message.content}" from ${message.user_id} against bot "${bot.name}", config: ${bot.config?.substring(0, 200)}`);
      const isBlocked = runAutomod(bot, message);
      console.log(`[Automod] Result: ${isBlocked ? 'BLOCKED' : 'allowed'}`);
      if (isBlocked) shouldDelete = true;
    }
  }

  return shouldDelete;
}

function runAutomod(bot: any, message: Message): boolean {
  if (!bot.config) return false;

  try {
    const config: AutomodConfig = JSON.parse(bot.config);
    if (!config.blockedWords || config.blockedWords.length === 0) return false;

    // Admin bypass
    const serverId = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(message.channel_id) as any;
    if (serverId && hasPermission(message.user_id, 'administrator', serverId.server_id)) {
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
