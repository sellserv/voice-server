import type { VoiceAdapter } from '../types.js';

// Stub — Phase 3 will implement this properly by wrapping existing media/ code
export class MediasoupAdapter implements VoiceAdapter {
  async createRoom(_channelId: string) { return { roomName: _channelId }; }
  async deleteRoom(_channelId: string) {}
  async generateJoinToken(_channelId: string, _userId: string, _displayName: string) { return ''; }
  async getRoomParticipants(_channelId: string) { return []; }
  async close() {}
}
