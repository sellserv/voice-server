import * as mediasoup from 'mediasoup';
import { getNextWorker, mediaCodecs } from './worker.js';
import { config } from '../config.js';

interface Peer {
  userId: string;
  username: string;
  display_name?: string;
  muted: boolean;
  deafened: boolean;
  sendTransport?: mediasoup.types.WebRtcTransport;
  recvTransport?: mediasoup.types.WebRtcTransport;
  producer?: mediasoup.types.Producer;
  videoProducer?: mediasoup.types.Producer;
  consumers: Map<string, mediasoup.types.Consumer>;
}

export class VoiceRoom {
  channelId: string;
  router: mediasoup.types.Router | null = null;
  audioLevelObserver: mediasoup.types.AudioLevelObserver | null = null;
  peers = new Map<string, Peer>();
  private speakingUsers = new Set<string>();
  private speakingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private onSpeaking?: (userId: string, speaking: boolean) => void;

  constructor(channelId: string) {
    this.channelId = channelId;
  }

  async init() {
    const worker = getNextWorker();
    this.router = await worker.createRouter({ mediaCodecs });

    this.audioLevelObserver = await this.router.createAudioLevelObserver({
      maxEntries: 10,
      threshold: -60,
      interval: 50,
    });

    const HOLD_MS = 300;

    this.audioLevelObserver.on('volumes', (volumes) => {
      const currentSpeakers = new Set<string>();
      for (const { producer } of volumes) {
        const peer = this.findPeerByProducerId(producer.id);
        if (peer) {
          currentSpeakers.add(peer.userId);

          // Cancel any pending stop-speaking timer
          const timer = this.speakingTimers.get(peer.userId);
          if (timer) {
            clearTimeout(timer);
            this.speakingTimers.delete(peer.userId);
          }

          if (!this.speakingUsers.has(peer.userId) && this.onSpeaking) {
            this.onSpeaking(peer.userId, true);
          }
        }
      }

      // Schedule stop-speaking for users no longer in volumes
      for (const userId of this.speakingUsers) {
        if (!currentSpeakers.has(userId) && !this.speakingTimers.has(userId)) {
          this.speakingTimers.set(
            userId,
            setTimeout(() => {
              this.speakingTimers.delete(userId);
              this.speakingUsers.delete(userId);
              if (this.onSpeaking) this.onSpeaking(userId, false);
            }, HOLD_MS),
          );
        }
      }

      // Update: add new speakers, keep users with pending timers
      for (const userId of currentSpeakers) {
        this.speakingUsers.add(userId);
      }
    });

    this.audioLevelObserver.on('silence', () => {
      // Schedule stop-speaking for all currently speaking users
      for (const userId of this.speakingUsers) {
        if (!this.speakingTimers.has(userId)) {
          this.speakingTimers.set(
            userId,
            setTimeout(() => {
              this.speakingTimers.delete(userId);
              this.speakingUsers.delete(userId);
              if (this.onSpeaking) this.onSpeaking(userId, false);
            }, HOLD_MS),
          );
        }
      }
    });
  }

  setSpeakingCallback(cb: (userId: string, speaking: boolean) => void) {
    this.onSpeaking = cb;
  }

  private findPeerByProducerId(producerId: string): Peer | undefined {
    for (const peer of this.peers.values()) {
      if (peer.producer?.id === producerId) return peer;
    }
    return undefined;
  }

  addPeer(userId: string, username: string, display_name?: string): Peer {
    const peer: Peer = {
      userId,
      username,
      display_name,
      muted: false,
      deafened: false,
      consumers: new Map(),
    };
    this.peers.set(userId, peer);
    return peer;
  }

  removePeer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;

    // Clean up speaking state and timers
    const timer = this.speakingTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.speakingTimers.delete(userId);
    }
    this.speakingUsers.delete(userId);

    peer.producer?.close();
    peer.videoProducer?.close();
    peer.sendTransport?.close();
    peer.recvTransport?.close();
    for (const consumer of peer.consumers.values()) {
      consumer.close();
    }
    this.peers.delete(userId);
  }

  async createWebRtcTransport(userId: string, direction: 'send' | 'recv') {
    if (!this.router) throw new Error('Router not initialized');

    const transport = await this.router.createWebRtcTransport({
      listenInfos: [
        {
          protocol: 'udp',
          ip: '0.0.0.0',
          announcedAddress: config.mediasoup.announcedIp,
        },
        {
          protocol: 'tcp',
          ip: '0.0.0.0',
          announcedAddress: config.mediasoup.announcedIp,
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 600000,
    });

    const peer = this.peers.get(userId);
    if (!peer) throw new Error('Peer not found');

    if (direction === 'send') {
      peer.sendTransport = transport;
    } else {
      peer.recvTransport = transport;
    }

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async connectTransport(
    userId: string,
    transportId: string,
    dtlsParameters: mediasoup.types.DtlsParameters,
  ) {
    const peer = this.peers.get(userId);
    if (!peer) throw new Error('Peer not found');

    const transport =
      peer.sendTransport?.id === transportId
        ? peer.sendTransport
        : peer.recvTransport?.id === transportId
          ? peer.recvTransport
          : null;

    if (!transport) throw new Error('Transport not found');
    await transport.connect({ dtlsParameters });
  }

  async produce(
    userId: string,
    transportId: string,
    rtpParameters: mediasoup.types.RtpParameters,
    kind: 'audio' | 'video' = 'audio',
  ) {
    const peer = this.peers.get(userId);
    if (!peer?.sendTransport) throw new Error('Send transport not found');

    const producer = await peer.sendTransport.produce({
      kind,
      rtpParameters,
    });

    if (kind === 'video') {
      peer.videoProducer = producer;
    } else {
      peer.producer = producer;
      // Add to audio level observer
      if (this.audioLevelObserver) {
        await this.audioLevelObserver.addProducer({ producerId: producer.id });
      }
    }

    return producer.id;
  }

  closeVideoProducer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer?.videoProducer) return;
    peer.videoProducer.close();
    peer.videoProducer = undefined;
  }

  async consume(
    userId: string,
    producerId: string,
    rtpCapabilities: mediasoup.types.RtpCapabilities,
  ) {
    if (!this.router) throw new Error('Router not initialized');

    const peer = this.peers.get(userId);
    if (!peer?.recvTransport) throw new Error('Recv transport not found');

    if (!this.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume');
    }

    const consumer = await peer.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Start paused, client will resume
    });

    peer.consumers.set(consumer.id, consumer);

    return {
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(userId: string, consumerId: string) {
    const peer = this.peers.get(userId);
    const consumer = peer?.consumers.get(consumerId);
    if (consumer) {
      await consumer.resume();
    }
  }

  getPeerList() {
    return Array.from(this.peers.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      display_name: p.display_name,
      muted: p.muted,
      deafened: p.deafened,
      producerId: p.producer?.id,
      screenShareProducerId: p.videoProducer?.id,
    }));
  }

  isEmpty(): boolean {
    return this.peers.size === 0;
  }

  close() {
    for (const userId of this.peers.keys()) {
      this.removePeer(userId);
    }
    this.router?.close();
    this.router = null;
  }
}
