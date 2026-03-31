import { RoomServiceClient, AccessToken } from 'livekit-server-sdk';
import type { VoiceAdapter } from '../types.js';

export class LiveKitAdapter implements VoiceAdapter {
  private roomService: RoomServiceClient;
  private apiKey: string;
  private apiSecret: string;
  private url: string;

  constructor(url: string, apiKey: string, apiSecret: string) {
    this.url = url;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.roomService = new RoomServiceClient(url, apiKey, apiSecret);
  }

  async createRoom(channelId: string): Promise<{ roomName: string }> {
    await this.roomService.createRoom({ name: channelId, emptyTimeout: 0 });
    return { roomName: channelId };
  }

  async deleteRoom(channelId: string): Promise<void> {
    try {
      await this.roomService.deleteRoom(channelId);
    } catch {
      // Room may already be deleted or not exist
    }
  }

  async generateJoinToken(channelId: string, userId: string, displayName: string): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: userId,
      name: displayName,
    });
    token.addGrant({
      roomJoin: true,
      room: channelId,
      canPublish: true,
      canSubscribe: true,
    });
    return await token.toJwt();
  }

  async getRoomParticipants(channelId: string): Promise<{ userId: string; displayName: string }[]> {
    try {
      const participants = await this.roomService.listParticipants(channelId);
      return participants.map(p => ({
        userId: p.identity,
        displayName: p.name || p.identity,
      }));
    } catch {
      return [];
    }
  }

  /** Get the LiveKit server URL (needed by clients to connect) */
  getServerUrl(): string {
    return this.url;
  }

  async close(): Promise<void> {}
}
