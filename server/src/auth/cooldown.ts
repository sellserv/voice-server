import { getDb } from '../adapters/index.js';
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
export async function checkNewUserCooldown(userId: string): Promise<CooldownResult> {
  const user = await getDb().queryOne<{ created_at: string }>(
    'SELECT created_at FROM users WHERE id = ?',
    [userId],
  );

  if (!user) return { restricted: false };
  if (isInstanceAdmin(userId)) return { restricted: false };

  const createdAt = new Date(user.created_at + 'Z').getTime();
  const elapsed = Date.now() - createdAt;

  if (elapsed < NEW_USER_COOLDOWN_MS) {
    const minutesRemaining = Math.ceil((NEW_USER_COOLDOWN_MS - elapsed) / 60000);
    return { restricted: true, minutesRemaining };
  }

  return { restricted: false };
}
