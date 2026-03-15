import { writable } from 'svelte/store';
import type { ClientEvent, ServerEvent } from '@voip-server/shared';
import { getWsBaseUrl, isDesktop, getDesktopToken, markSessionExpired } from './stores/server';

type EventHandler = (event: ServerEvent) => void;

let socket: WebSocket | null = null;
let handlers: EventHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let lastPong = 0;

// Generation counter to detect stale close events from replaced sockets
let connectionGen = 0;

const HEARTBEAT_INTERVAL = 25000; // 25s
const HEARTBEAT_TIMEOUT = 35000; // 35s — if no pong in this window, reconnect

export const wsConnected = writable(false);
export const wsKicked = writable(false);

function getWsUrl(): string {
  const wsBase = getWsBaseUrl();
  let url: string;
  if (wsBase) {
    url = `${wsBase}/ws`;
  } else {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url = `${proto}//${location.host}/ws`;
  }
  // Desktop app: pass token as query param since cookies are in Tauri HTTP plugin's jar
  if (isDesktop) {
    const token = getDesktopToken();
    if (token) url += `?token=${encodeURIComponent(token)}`;
  }
  return url;
}

export function connectWs() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  wsKicked.set(false);
  const wsUrl = getWsUrl();
  console.log('[WS] Connecting to:', wsUrl.replace(/token=[^&]+/, 'token=<REDACTED>'));
  console.log('[WS] Has token:', wsUrl.includes('token='));

  // Increment generation so any pending close events from old sockets are ignored
  const gen = ++connectionGen;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    if (gen !== connectionGen) return; // stale
    console.log('[WS] Connected');
    reconnectDelay = 1000;
    wsConnected.set(true);
    lastPong = Date.now();
    startHeartbeat();
  };

  socket.onmessage = (ev) => {
    if (gen !== connectionGen) return; // stale
    try {
      const event: ServerEvent = JSON.parse(ev.data);
      if (event.type === 'ws:pong') {
        lastPong = Date.now();
      }
      for (const handler of handlers) {
        handler(event);
      }
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };

  socket.onclose = (ev) => {
    // Ignore close events from a socket that has already been replaced
    if (gen !== connectionGen) {
      console.log(`[WS] Ignoring stale close (gen ${gen}, current ${connectionGen}): ${ev.code} ${ev.reason}`);
      return;
    }

    console.log(`[WS] Closed: ${ev.code} ${ev.reason}`);
    socket = null;
    wsConnected.set(false);
    stopHeartbeat();

    if (ev.code === 4001) {
      markSessionExpired();
      return;
    }

    // Connected from another location — genuine second session
    if (ev.code === 4002) {
      wsKicked.set(true);
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connectWs();
    }, reconnectDelay);
  };

  socket.onerror = () => {
    // onclose will fire after this
  };
}

export function disconnectWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  // Increment generation so the close event from this socket is ignored
  connectionGen++;
  socket?.close();
  socket = null;
  wsConnected.set(false);
}

export function sendWs(event: ClientEvent) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

export function onWsEvent(handler: EventHandler): () => void {
  handlers.push(handler);
  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}

export function isWsConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      const sincePong = Date.now() - lastPong;
      // Check if we got a pong recently
      if (sincePong > HEARTBEAT_TIMEOUT) {
        console.log(`[WS] Heartbeat timeout: no pong for ${Math.round(sincePong / 1000)}s, reconnecting...`);
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ type: 'ws:ping', timestamp: Date.now() }));
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
