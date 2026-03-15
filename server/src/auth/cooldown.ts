import db from '../db/connection.js';
import { isInstanceAdmin } from './middleware.js';

const NEW_USER_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

interface CooldownResult {
  restricted: boolean;
  minutesRemaining?: number;
}

/**
 * Check if a user is within the new-account cooldown period.
 * Instance admins are exempt.
 */
export function checkNewUserCooldown(userId: string): CooldownResult {
  const user = db
    .prepare('SELECT username, created_at FROM users WHERE id = ?')
    .get(userId) as { username: string; created_at: string } | undefined;

  if (!user) return { restricted: false };
  if (isInstanceAdmin(user.username)) return { restricted: false };

  const createdAt = new Date(user.created_at + 'Z').getTime();
  const elapsed = Date.now() - createdAt;

  if (elapsed < NEW_USER_COOLDOWN_MS) {
    const minutesRemaining = Math.ceil((NEW_USER_COOLDOWN_MS - elapsed) / 60000);
    return { restricted: true, minutesRemaining };
  }

  return { restricted: false };
}
