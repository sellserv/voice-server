import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { PushNotifications } from '@capacitor/push-notifications';

export const isCapacitor = typeof window !== 'undefined' && Capacitor.isNativePlatform();

let pushToken: string | null = null;

export async function getPreference(key: string): Promise<string | null> {
  if (!isCapacitor) return null;
  const { value } = await Preferences.get({ key });
  return value;
}

export async function setPreference(key: string, value: string): Promise<void> {
  if (!isCapacitor) return;
  await Preferences.set({ key, value });
}

export async function removePreference(key: string): Promise<void> {
  if (!isCapacitor) return;
  await Preferences.remove({ key });
}

let pushInitialized = false;

export async function initPushNotifications(): Promise<void> {
  if (!isCapacitor || pushInitialized) return;
  pushInitialized = true;

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return;

  PushNotifications.addListener('registration', async (token) => {
    pushToken = token.value;
    // Register with server
    try {
      const { api } = await import('./api.js');
      await api.post('/api/push/register', { token: token.value, platform: 'android' });
    } catch (err) {
      console.error('Failed to register push token:', err);
    }
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.error('Push registration error:', err);
  });

  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // App is in foreground — suppress (WebSocket handles it)
    console.log('Push received in foreground (suppressed):', notification);
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    // User tapped notification — navigate to relevant channel
    const data = action.notification.data;
    if (data?.channelId) {
      // Navigation will be handled by the app's routing
      console.log('Push tapped, channel:', data.channelId);
    }
  });

  await PushNotifications.register();
}

export async function unregisterPush(): Promise<void> {
  if (!isCapacitor || !pushToken) return;
  try {
    const { api } = await import('./api.js');
    // Use POST to a dedicated unregister endpoint since api.delete doesn't accept a body
    await api.post('/api/push/unregister', { token: pushToken });
  } catch (err) {
    console.error('Failed to unregister push token:', err);
  }
  pushToken = null;
  pushInitialized = false;
}

interface BackgroundAudioPlugin {
  start(options: { channel: string }): Promise<void>;
  stop(): Promise<void>;
}

const BackgroundAudio = registerPlugin<BackgroundAudioPlugin>('BackgroundAudio');

export async function startBackgroundAudio(channelName: string): Promise<void> {
  if (!isCapacitor) return;
  try {
    await BackgroundAudio.start({ channel: channelName });
  } catch (err) {
    console.error('Failed to start background audio:', err);
  }
}

export async function stopBackgroundAudio(): Promise<void> {
  if (!isCapacitor) return;
  try {
    await BackgroundAudio.stop();
  } catch (err) {
    console.error('Failed to stop background audio:', err);
  }
}
