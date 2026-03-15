import { writable } from 'svelte/store';
import { sendWs } from '$lib/ws';

export interface ActiveCall {
  callId: string;
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  status: 'outgoing' | 'incoming' | 'active';
  channelId?: string;
  video: boolean;
}

export const activeCall = writable<ActiveCall | null>(null);

export function initiateCall(peerId: string, peerName: string, peerAvatar: string | null, video = false) {
  activeCall.set({
    callId: '', // will be set when server sends call:ringing
    peerId,
    peerName,
    peerAvatar,
    status: 'outgoing',
    video,
  });
  sendWs({ type: 'call:initiate', targetUserId: peerId, video });
}

export function acceptCall(callId: string) {
  sendWs({ type: 'call:accept', callId });
}

export function rejectCall(callId: string) {
  sendWs({ type: 'call:reject', callId });
  activeCall.set(null);
}

export function endCall(callId: string) {
  sendWs({ type: 'call:end', callId });
  activeCall.set(null);
}
