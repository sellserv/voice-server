import { get } from 'svelte/store';
import { isDesktop } from './stores/server';
import { notifyDesktop } from './stores/settings';

let permissionGranted = false;

export async function initNotifications() {
  if (isDesktop) {
    permissionGranted = true;
    return;
  }

  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    permissionGranted = true;
  }
}

async function ensurePermission() {
  if (permissionGranted) return true;

  if (isDesktop) {
    permissionGranted = true;
    return true;
  }

  if (!('Notification' in window)) return false;
  if (Notification.permission === 'denied') return false;

  const p = await Notification.requestPermission();
  permissionGranted = p === 'granted';
  return permissionGranted;
}

async function notify(title: string, body: string, _requireInteraction = false) {
  if (!permissionGranted && !(await ensurePermission())) return;

  if (isDesktop) {
    const api = (window as any).electronAPI;
    api.notify(title, body);
    return;
  }

  if (document.hasFocus()) return;

  const n = new Notification(title, { body, silent: true });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

export function notifyMessage(username: string, displayName: string | undefined, content: string) {
  if (!get(notifyDesktop)) return;
  if (!isDesktop && document.hasFocus()) return;
  const title = displayName || username;
  const body = content.length > 100 ? content.slice(0, 100) + '...' : content;
  notify(title, body);
}

export function notifyCall(callerName: string) {
  if (!get(notifyDesktop)) return;
  notify('Incoming Call', `${callerName} is calling you`, true);
}

export function notifyMention(channelName: string, username: string, content: string) {
  if (!get(notifyDesktop)) return;
  const title = `Mentioned in #${channelName}`;
  const body = `${username}: ${content.length > 80 ? content.slice(0, 80) + '...' : content}`;
  notify(title, body);
}
