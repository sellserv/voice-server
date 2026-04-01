export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible';
export type Role = 'admin' | 'member';
export type MfaMethod = 'email' | 'totp';

export interface RolePermissions {
  manage_channels_groups: boolean;
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
  view_channel: boolean;
  use_apps: boolean;
  view_audit_log: boolean;
  manage_bots: boolean;
  manage_server: boolean;
}

export type ChannelOverridablePermission =
  | 'view_channel'
  | 'send_messages'
  | 'upload_files'
  | 'add_reactions'
  | 'use_custom_emoji'
  | 'manage_messages'
  | 'pin_messages'
  | 'connect_voice'
  | 'speak'
  | 'share_screen';

export interface ChannelPermissionOverride {
  id: string;
  channel_id: string;
  target_type: 'role' | 'user';
  target_id: string;
  view_channel: boolean | null;
  send_messages: boolean | null;
  upload_files: boolean | null;
  add_reactions: boolean | null;
  use_custom_emoji: boolean | null;
  manage_messages: boolean | null;
  pin_messages: boolean | null;
  connect_voice: boolean | null;
  speak: boolean | null;
  share_screen: boolean | null;
}

export interface GroupPermissionOverride {
  id: string;
  group_id: string;
  target_type: 'role' | 'user';
  target_id: string;
  view_channel: boolean | null;
  send_messages: boolean | null;
  upload_files: boolean | null;
  add_reactions: boolean | null;
  use_custom_emoji: boolean | null;
  manage_messages: boolean | null;
  pin_messages: boolean | null;
  connect_voice: boolean | null;
  speak: boolean | null;
  share_screen: boolean | null;
}

export interface RoleRecord {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: RolePermissions;
  is_default: boolean;
}

export interface ChannelGroup {
  id: string;
  name: string;
  sort_order: number;
  permissions_enabled: boolean;
  created_at: string;
}

export interface ServerSettings {
  name: string;
  icon_url: string | null;
  enabled_apps: string[];
  afk_channel_id: string | null;
  afk_timeout: number;
}

export interface Bot {
  id: string;
  user_id: string;
  type: string;
  name: string;
  avatar_url: string | null;
  channel_id: string | null;
  enabled: boolean;
  greeting: string;
  dm_enabled: boolean;
  dm_greeting: string;
  config?: string | null;
}

export interface PollOption {
  id: string;
  poll_id: string;
  text: string;
  vote_count?: number;
  voted_by_me?: boolean;
}

export interface Poll {
  id: string;
  server_id: string;
  channel_id: string | null;
  creator_id: string;
  question: string;
  is_active: boolean;
  allow_multiple: boolean;
  ends_at: string | null;
  created_at: string;
  options: PollOption[];
  total_votes?: number;
  creator_username?: string;
  creator_display_name?: string;
  creator_avatar_url?: string | null;
}

export interface SoundboardSound {
  id: string;
  name: string;
  file_id: string;
  emoji_id: string | null;
  emoji: string | null;
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
  role_ids?: string[];
  role_names?: string[];
  role_colors?: string[];
  name_font?: string | null;
  name_color?: string | null;
  avatar_url: string | null;
  bio?: string;
  banner_url?: string | null;
  banned: boolean;
  totp_enabled: boolean;
  email?: string | null;
  email_verified?: boolean;
  mfa_method?: MfaMethod;
  created_at: string;
  premium_tier?: string;
  is_instance_admin?: boolean;
}
export interface UserRow extends Omit<User, 'email_verified'> {
  password_hash: string;
  ban_reason: string | null;
  totp_secret: string | null;
  email: string | null;
  email_verified: number;
  mfa_method: MfaMethod;
}
export type ChannelType = 'text' | 'voice' | 'dm';
export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  sort_order: number;
  group_id?: string | null;
  created_at: string;
  dm_participant_ids?: string[];
  dm_participants?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  }[];
  restricted?: boolean;
  allowed_role_ids?: string[];
  allowed_user_ids?: string[];
  permission_overrides?: ChannelPermissionOverride[];
  accessible_user_ids?: string[];
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
  file_mime_type?: string | null;
  created_at: string;
  edited_at: string | null;
  reactions?: Reaction[];
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  role_color?: string;
  name_font?: string | null;
  name_color?: string | null;
  reply_to_id?: string | null;
  reply_to_username?: string | null;
  reply_to_display_name?: string | null;
  reply_to_content?: string;
  invite_id?: string | null;
  poll_id?: string | null;
  pinned?: boolean;
  pinned_by?: string | null;
  type?: 'user' | 'call';
  metadata?: string | null;
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

export interface Server {
  id: string;
  name: string;
  icon_file_id: string | null;
  icon_url: string | null;
  owner_id: string;
  member_count?: number;
  created_at: string;
}

export type NotificationLevel = 'default' | 'all' | 'mentions' | 'nothing';

export interface ServerMember {
  server_id: string;
  user_id: string;
  nickname: string | null;
  avatar_url: string | null;
  joined_at: string;
  notification_level: NotificationLevel;
}

export type ClientEvent =
  | {
      type: 'chat:send';
      channelId: string;
      content: string;
      fileId?: string;
      replyToId?: string;
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
      type: 'voice:disconnect';
      userId: string;
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
    }
  | {
      type: 'presence:setStatus';
      status: UserStatus;
    }
  | {
      type: 'dm:open';
      targetUserId: string;
    }
  | {
      type: 'watch:start';
      videoUrl?: string;
    }
  | {
      type: 'watch:queue';
      videoUrl: string;
    }
  | {
      type: 'watch:skip';
    }
  | {
      type: 'watch:next';
    }
  | {
      type: 'watch:join';
    }
  | {
      type: 'watch:leave';
    }
  | {
      type: 'watch:transferHost';
      targetUserId: string;
    }
  | {
      type: 'watch:sync';
      state: 'playing' | 'paused';
      time: number;
      pingMs?: number;
    }
  | {
      type: 'watch:stop';
    }
  | {
      type: 'ws:ping';
      timestamp: number;
    }
  | {
      type: 'call:initiate';
      targetUserId: string;
      video?: boolean;
    }
  | {
      type: 'call:accept';
      callId: string;
    }
  | {
      type: 'call:reject';
      callId: string;
    }
  | {
      type: 'call:end';
      callId: string;
    }
  | {
      type: 'message:pin';
      messageId: string;
    }
  | {
      type: 'message:unpin';
      messageId: string;
    }
  | {
      type: 'effect:send';
      channelId: string;
      effect: string;
    }
  | { type: 'poll:vote'; pollId: string; optionIds: string[] }
  | { type: 'presence:activity'; game: string | null; visibility: 'all' | 'selected'; serverIds?: string[] }
  | { type: 'server:switch'; serverId: string };
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
      status?: UserStatus;
      activity?: string;
    }
  | {
      type: 'presence:activity';
      userId: string;
      activity: string | null;
    }
  | {
      type: 'presence:list';
      users: {
        userId: string;
        username: string;
        display_name?: string;
        status: UserStatus;
      }[];
      ownStatus: UserStatus;
    }
  | {
      type: 'voice:joined';
      channelId: string;
      userId: string;
      username: string;
      display_name?: string;
      avatar_url?: string | null;
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
        avatar_url?: string | null;
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
          avatar_url?: string | null;
          muted: boolean;
          deafened: boolean;
        }[]
      >;
    }
  | {
      type: 'channel:created';
      serverId?: string;
      channel: Channel;
    }
  | {
      type: 'channel:updated';
      serverId?: string;
      channel: Channel;
    }
  | {
      type: 'channel:deleted';
      serverId?: string;
      channelId: string;
    }
  | {
      type: 'user:banned';
      userId: string;
    }
  | {
      type: 'user:updated';
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
      playbackId: string;
      soundUrl: string;
      soundName: string;
      userId: string;
      username: string;
    }
  | {
      type: 'soundboard:stop';
      playbackId: string;
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
      serverId?: string;
      settings: ServerSettings;
    }
  | {
      type: 'watch:started';
      channelId: string;
      hostUserId: string;
      hostUsername: string;
      videoId: string | null;
    }
  | {
      type: 'watch:queueUpdated';
      channelId: string;
      queue: { videoId: string; addedBy: string; addedByUsername: string }[];
      currentVideoId: string | null;
    }
  | {
      type: 'watch:viewersUpdated';
      channelId: string;
      viewers: {
        userId: string;
        username: string;
        display_name?: string;
        avatar_url?: string | null;
      }[];
    }
  | {
      type: 'watch:sessionUpdated';
      channelId: string;
      hostUserId: string;
      hostUsername: string;
      videoId: string | null;
    }
  | {
      type: 'watch:synced';
      state: 'playing' | 'paused';
      time: number;
    }
  | {
      type: 'watch:stopped';
      channelId: string;
    }
  | {
      type: 'ws:pong';
      timestamp: number;
    }
  | {
      type: 'dm:created';
      channel: Channel;
    }
  | {
      type: 'channelGroup:created';
      serverId?: string;
      group: ChannelGroup;
    }
  | {
      type: 'channelGroup:updated';
      serverId?: string;
      group: ChannelGroup;
    }
  | {
      type: 'channelGroup:deleted';
      serverId?: string;
      groupId: string;
    }
  | {
      type: 'channelOverrides:updated';
      serverId?: string;
      channelId: string;
      overrides: ChannelPermissionOverride[];
    }
  | {
      type: 'groupOverrides:updated';
      serverId?: string;
      groupId: string;
      overrides: GroupPermissionOverride[];
    }
  | {
      type: 'call:ringing';
      callId: string;
      targetUserId: string;
      video?: boolean;
    }
  | {
      type: 'call:incoming';
      callId: string;
      callerId: string;
      callerName: string;
      callerAvatar: string | null;
      video?: boolean;
    }
  | {
      type: 'call:accepted';
      callId: string;
      channelId: string;
    }
  | {
      type: 'call:rejected';
      callId: string;
    }
  | {
      type: 'call:ended';
      callId: string;
      reason: 'rejected' | 'timeout' | 'ended' | 'busy' | 'unavailable';
    }
  | {
      type: 'message:pinned';
      messageId: string;
      channelId: string;
      pinnedBy: string;
    }
  | {
      type: 'message:unpinned';
      messageId: string;
      channelId: string;
    }
  | {
      type: 'role:created';
      serverId?: string;
      role: RoleRecord;
    }
  | {
      type: 'role:updated';
      serverId?: string;
      role: RoleRecord;
    }
  | {
      type: 'role:deleted';
      serverId?: string;
      roleId: string;
    }
  | {
      type: 'roles:reordered';
      serverId?: string;
      roles: RoleRecord[];
    }
  | {
      type: 'channels:reordered';
      serverId?: string;
      order: string[];
    }
  | {
      type: 'channelGroups:reordered';
      serverId?: string;
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
      type: 'effect:play';
      channelId: string;
      effect: string;
      userId: string;
      username: string;
    }
  | {
      type: 'poll:created';
      serverId: string;
      poll: Poll;
    }
  | {
      type: 'poll:updated';
      serverId: string;
      pollId: string;
      options: PollOption[];
      totalVotes: number;
    }
  | {
      type: 'poll:deleted';
      serverId: string;
      pollId: string;
    }
  | {
      type: 'server:memberJoined';
      serverId: string;
      userId: string;
      username: string;
    }
  | {
      type: 'server:memberLeft';
      serverId: string;
      userId: string;
    }
  | {
      type: 'server:updated';
      server: Server;
    }
  | {
      type: 'server:memberUpdated';
      serverId: string;
      userId: string;
      nickname?: string | null;
      avatar_url?: string | null;
      banner_url?: string | null;
    }
  | {
      type: 'server:deleted';
      serverId: string;
    }
  | {
      type: 'server:invitation';
      invitation: ServerInvitation;
    }
  | {
      type: 'voice:afkMoved';
      channelId: string;
    }
  | {
      type: 'friend:requestReceived';
      request: FriendRequest;
    }
  | {
      type: 'friend:requestAccepted';
      userId: string;
      friend: FriendInfo;
    }
  | {
      type: 'friend:removed';
      userId: string;
    }
  | {
      type: 'friend:blocked';
      userId: string;
    }
  | {
      type: 'voice:token';
      token: string;
      url: string;
      channelId: string;
      e2eeKey: string;
    }
  | {
      type: 'error';
      message: string;
      code?: string;
    };
export interface ServerInvitation {
  id: string;
  server_id: string;
  server_name: string;
  server_icon_url: string | null;
  inviter_id: string;
  inviter_name: string;
  invitee_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

export interface Friendship {
  id: string;
  user_id: string;
  target_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
}

export interface FriendInfo {
  id: string;
  friendship_id?: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  status?: UserStatus;
  online?: boolean;
}

export interface FriendRequest {
  id: string;
  user: FriendInfo;
  direction: 'incoming' | 'outgoing';
  created_at: string;
}
export interface InviteCode {
  id: string;
  code: string;
  created_by: string;
  server_id: string | null;
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
    }
  | {
      account_locked: true;
      user_id: string;
      mfa_method: MfaMethod;
    };
export interface CreateChannelBody {
  name: string;
  type: ChannelType;
  group_id?: string | null;
}
export interface PaginatedMessages {
  messages: Message[];
  hasMore: boolean;
}
