import admin from 'firebase-admin';
import { config } from '../config.js';
import db from '../db/connection.js';
import { createPendingNotification, cleanExpiredNotifications } from './pending.js';

let firebaseApp: admin.app.App | null = null;

function getFirebase(): admin.app.App | null {
  if (firebaseApp) return firebaseApp;
  if (!config.firebase.serviceAccount) return null;

  try {
    const serviceAccount = JSON.parse(config.firebase.serviceAccount);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return firebaseApp;
  } catch (err) {
    console.error('Failed to initialize Firebase:', err);
    return null;
  }
}

/**
 * Send a data-only push notification. No content passes through Google —
 * only an opaque notification ID. The app fetches content directly from the server.
 */
export async function sendDataPush(
  userId: string,
  type: string,
  data: Record<string, string>,
): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;

  const tokens = db
    .prepare('SELECT token FROM device_tokens WHERE user_id = ?')
    .all(userId) as { token: string }[];

  if (tokens.length === 0) return;

  const notificationId = createPendingNotification(userId, type, data);

  const messaging = fb.messaging();
  const results = await Promise.allSettled(
    tokens.map((t) =>
      messaging.send({
        token: t.token,
        data: { notificationId },
        android: {
          priority: 'high',
        },
      }),
    ),
  );

  // Remove invalid tokens
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      const err = result.reason;
      if (
        err?.code === 'messaging/registration-token-not-registered' ||
        err?.code === 'messaging/invalid-registration-token'
      ) {
        db.prepare('DELETE FROM device_tokens WHERE token = ?').run(
          tokens[i].token,
        );
      }
    }
  }
}

export function isFirebaseConfigured(): boolean {
  return !!config.firebase.serviceAccount;
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startPendingCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(cleanExpiredNotifications, 60_000);
}

export function stopPendingCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  cleanExpiredNotifications();
}
