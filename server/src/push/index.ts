import admin from 'firebase-admin';
import { config } from '../config.js';
import db from '../db/connection.js';

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

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;

  const tokens = db.prepare(
    'SELECT token FROM device_tokens WHERE user_id = ?',
  ).all(userId) as { token: string }[];

  if (tokens.length === 0) return;

  const messaging = fb.messaging();
  const results = await Promise.allSettled(
    tokens.map((t) =>
      messaging.send({
        token: t.token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'sellserv_messages',
            sound: 'default',
          },
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
        db.prepare('DELETE FROM device_tokens WHERE token = ?').run(tokens[i].token);
      }
    }
  }
}

export function isFirebaseConfigured(): boolean {
  return !!config.firebase.serviceAccount;
}
