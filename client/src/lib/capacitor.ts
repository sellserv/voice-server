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

  PushNotifications.addListener('pushNotificationReceived', async (notification) => {
    const notificationId = notification.data?.notificationId;
    if (!notificationId) {
      console.log('Push received in foreground (suppressed):', notification);
      return;
    }

    // Data-only push: fetch content from server and show local notification
    try {
      const { api } = await import('./api.js');
      const result = await api.get(`/api/push/notification/${notificationId}`) as {
        type: string;
        data: Record<string, string>;
      };

      const { LocalNotifications } = await import('@capacitor/local-notifications');

      let title = 'SellServ Voice';
      let body = 'New notification';

      switch (result.type) {
        case 'dm':
          title = result.data.senderName || 'Direct Message';
          body = 'Sent you a message';
          break;
        case 'mention':
          title = result.data.senderName || 'Mention';
          body = `Mentioned you in #${result.data.channelName || 'channel'}`;
          break;
        case 'everyone':
          title = result.data.senderName || 'Announcement';
          body = `@everyone in #${result.data.channelName || 'channel'}`;
          break;
        case 'channel_message':
          title = result.data.senderName || 'New Message';
          body = `Message in #${result.data.channelName || 'channel'}`;
          break;
        case 'incoming_call':
          title = 'Incoming Call';
          body = `${result.data.callerName || 'Someone'} is calling you`;
          break;
        case 'missed_call':
          title = 'Missed Call';
          body = `${result.data.callerName || 'Someone'} joined #${result.data.channelName || 'channel'}`;
          break;
      }

      await LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Math.random() * 2147483647),
          title,
          body,
          extra: result.data,
          channelId: 'sellserv_messages',
        }],
      });
    } catch (err) {
      console.error('Failed to fetch/show notification:', err);
    }
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    // User tapped notification — navigate to relevant channel
    const data = action.notification.data;
    if (data?.channelId) {
      // Navigation will be handled by the app's routing
      console.log('Push tapped, channel:', data.channelId);
    }
  });

  // Handle taps on local notifications (from data-only push)
  import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const data = action.notification.extra;
      if (data?.channelId) {
        console.log('Local notification tapped, channel:', data.channelId);
      }
    });
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
