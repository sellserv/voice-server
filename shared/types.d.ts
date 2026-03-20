export type Role = 'admin' | 'member';
export type MfaMethod = 'email' | 'totp';
export interface RolePermissions {
  manage_channels: boolean;
  manage_roles: boolean;
  kick_members: boolean;
  ban_members: boolean;
  manage_messages: boolean;
  manage_invite_codes: boolean;
  create_invites: boolean;
  manage_soundboard: boolean;
  manage_emojis: boolean;
  administrator: boolean;
  send_messages: boolean;
  upload_files: boolean;
  add_reactions: boolean;
  connect_voice: boolean;
  speak: boolean;
  share_screen: boolean;
  use_custom_emoji: boolean;
  change_nickname: boolean;
  pin_messages: boolean;
  manage_channel_groups: boolean;
  view_channel: boolean;
  use_apps: boolean;
  view_audit_log: boolean;
  manage_bots: boolean;
  manage_server: boolean;
}
export interface RoleRecord {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: RolePermissions;
  is_default: boolean;
}
export interface ServerSettings {
  name: string;
  icon_url: string | null;
}
export interface SoundboardSound {
  id: string;
  name: string;
  file_id: string;
  uploaded_by: string;
  created_at: string;
}
export interface CustomEmoji {
  id: string;
  name: string;
  file_id: string;
  uploaded_by: string;
  created_at: string;
}
export interface User {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  role_id: string | null;
  role_name?: string;
  role_color?: string;
  avatar_url: string | null;
  banned: boolean;
  totp_enabled: boolean;
  email?: string | null;
  email_verified?: boolean;
  mfa_method?: MfaMethod;
  created_at: string;
}
export interface UserRow extends Omit<User, 'email_verified'> {
  password_hash: string;
  ban_reason: string | null;
  totp_secret: string | null;
  email: string | null;
  email_verified: number;
  mfa_method: MfaMethod;
}
export type ChannelType = 'text' | 'voice';
export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  sort_order: number;
  created_at: string;
}
export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}
export interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  file_id: string | null;
  created_at: string;
  edited_at: string | null;
  reactions?: Reaction[];
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
}
export interface FileRecord {
  id: string;
  user_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}
export type ClientEvent =
  | {
      type: 'chat:send';
      channelId: string;
      content: string;
      fileId?: string;
    }
  | {
      type: 'chat:edit';
      messageId: string;
      content: string;
    }
  | {
      type: 'chat:delete';
      messageId: string;
    }
  | {
      type: 'typing:start';
      channelId: string;
    }
  | {
      type: 'typing:stop';
      channelId: string;
    }
  | {
      type: 'voice:join';
      channelId: string;
    }
  | {
      type: 'voice:leave';
    }
  | {
      type: 'voice:mute';
      muted: boolean;
    }
  | {
      type: 'voice:deafen';
      deafened: boolean;
    }
  | {
      type: 'rtc:getRouterCapabilities';
      channelId: string;
    }
  | {
      type: 'rtc:createTransport';
      direction: 'send' | 'recv';
    }
  | {
      type: 'rtc:connectTransport';
      transportId: string;
      dtlsParameters: unknown;
    }
  | {
      type: 'rtc:produce';
      transportId: string;
      kind: 'audio' | 'video';
      rtpParameters: unknown;
    }
  | {
      type: 'rtc:consume';
      producerId: string;
      rtpCapabilities?: unknown;
    }
  | {
      type: 'rtc:resumeConsumer';
      consumerId: string;
    }
  | {
      type: 'message:react';
      messageId: string;
      emoji: string;
    }
  | {
      type: 'message:unreact';
      messageId: string;
      emoji: string;
    }
  | {
      type: 'soundboard:play';
      soundId: string;
    }
  | {
      type: 'screen:start';
    }
  | {
      type: 'screen:stop';
    };
export type ServerEvent =
  | {
      type: 'chat:message';
      message: Message;
    }
  | {
      type: 'chat:edited';
      message: Message;
    }
  | {
      type: 'chat:deleted';
      messageId: string;
      channelId: string;
    }
  | {
      type: 'typing:update';
      channelId: string;
      userId: string;
      username: string;
      isTyping: boolean;
    }
  | {
      type: 'presence:update';
      userId: string;
      username: string;
      display_name?: string;
      online: boolean;
    }
  | {
      type: 'presence:list';
      users: {
        userId: string;
        username: string;
        display_name?: string;
      }[];
    }
  | {
      type: 'voice:joined';
      channelId: string;
      userId: string;
      username: string;
      display_name?: string;
      muted?: boolean;
      deafened?: boolean;
    }
  | {
      type: 'voice:left';
      channelId: string;
      userId: string;
      username: string;
    }
  | {
      type: 'voice:speaking';
      userId: string;
      speaking: boolean;
    }
  | {
      type: 'voice:peers';
      channelId: string;
      peers: {
        userId: string;
        username: string;
        display_name?: string;
        muted: boolean;
        producerId?: string;
        screenShareProducerId?: string;
      }[];
    }
  | {
      type: 'voice:muteUpdate';
      channelId: string;
      userId: string;
      muted: boolean;
    }
  | {
      type: 'voice:deafenUpdate';
      channelId: string;
      userId: string;
      deafened: boolean;
    }
  | {
      type: 'voice:channelMembers';
      channels: Record<
        string,
        {
          userId: string;
          username: string;
          display_name?: string;
          muted: boolean;
          deafened: boolean;
        }[]
      >;
    }
  | {
      type: 'channel:created';
      channel: Channel;
    }
  | {
      type: 'channel:deleted';
      channelId: string;
    }
  | {
      type: 'user:kicked';
      userId: string;
      reason?: string;
    }
  | {
      type: 'user:banned';
      userId: string;
    }
  | {
      type: 'rtc:routerCapabilities';
      codecs: unknown;
    }
  | {
      type: 'rtc:transportCreated';
      id: string;
      iceParameters: unknown;
      iceCandidates: unknown;
      dtlsParameters: unknown;
    }
  | {
      type: 'rtc:transportConnected';
    }
  | {
      type: 'rtc:produced';
      producerId: string;
    }
  | {
      type: 'rtc:newProducer';
      producerId: string;
      userId: string;
      username: string;
    }
  | {
      type: 'rtc:consumed';
      consumerId: string;
      producerId: string;
      kind: string;
      rtpParameters: unknown;
    }
  | {
      type: 'message:reacted';
      messageId: string;
      channelId: string;
      emoji: string;
      userId: string;
    }
  | {
      type: 'message:unreacted';
      messageId: string;
      channelId: string;
      emoji: string;
      userId: string;
    }
  | {
      type: 'soundboard:play';
      soundUrl: string;
      soundName: string;
      userId: string;
      username: string;
    }
  | {
      type: 'screen:started';
      userId: string;
      username: string;
      producerId: string;
    }
  | {
      type: 'screen:stopped';
      userId: string;
    }
  | {
      type: 'server:settingsUpdated';
      settings: ServerSettings;
    }
  | {
      type: 'role:created';
      role: RoleRecord;
    }
  | {
      type: 'role:updated';
      role: RoleRecord;
    }
  | {
      type: 'role:deleted';
      roleId: string;
    }
  | {
      type: 'roles:reordered';
      roles: RoleRecord[];
    }
  | {
      type: 'channels:reordered';
      order: string[];
    }
  | {
      type: 'channelGroups:reordered';
      order: string[];
    }
  | {
      type: 'emoji:created';
      emoji: any;
    }
  | {
      type: 'emoji:deleted';
      emojiId: string;
    }
  | {
      type: 'soundboard:created';
      sound: any;
    }
  | {
      type: 'soundboard:deleted';
      soundId: string;
    }
  | {
      type: 'bot:updated';
      bot: Bot;
    }
  | {
      type: 'error';
      message: string;
      code?: string;
    };
export interface InviteCode {
  id: string;
  code: string;
  created_by: string;
  server_id: string;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  created_at: string;
}
export interface RegisterBody {
  username: string;
  password: string;
  email: string;
  display_name?: string;
  captcha_token?: string;
}
export interface LoginBody {
  username: string;
  password: string;
  totp_code?: string;
}
export type LoginResponse =
  | User
  | {
      mfa_required: true;
      mfa_user_id: string;
      mfa_method: MfaMethod;
    }
  | {
      password_expired: true;
      user_id: string;
    }
  | {
      email_not_verified: true;
      user_id: string;
    }
  | {
      email_required: true;
      user_id: string;
    }
  | {
      verification_required: true;
      user_id: string;
    };
export interface CreateChannelBody {
  name: string;
  type: ChannelType;
}
export interface PaginatedMessages {
  messages: Message[];
  hasMore: boolean;
}
