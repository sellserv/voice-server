<script lang="ts">
  import {
    theme,
    themes,
    voiceMode,
    vadSensitivity,
    pttKey,
    noiseSuppression,
    notifyDesktop,
    notifySound,
    notifyMessageSound,
    notifyJoinLeaveSound,
  } from '$lib/stores/settings';
  import { selectedInputDeviceId, selectedOutputDeviceId, selectedVideoDeviceId } from '$lib/stores/media';
  import { currentUser, updateProfile, changePassword } from '$lib/stores/auth';
  import { applyNoiseSuppression } from '$lib/webrtc';
  import { api } from '$lib/api';
  import { isDesktop, resolveAsset } from '$lib/stores/server';
  import { servers, updateServerMember } from '$lib/stores/servers';
  import { isGradient, parseGradientColors, nameStyle } from '$lib/nameColor';
  import GifPicker from './GifPicker.svelte';
  import Icon from './Icon.svelte';

  let { onclose, onlogout }: { onclose: () => void; onlogout: () => void } = $props();

  let activeTab = $state('my-account');
  let activeProfileTab = $state('global'); // 'global' or 'server'
  let selectedServerId = $state<string | null>(null);

  let inputDevices = $state<MediaDeviceInfo[]>([]);
  let outputDevices = $state<MediaDeviceInfo[]>([]);
  let videoDevices = $state<MediaDeviceInfo[]>([]);
  let loadingDevices = $state(true);
  let capturingPttKey = $state(false);

  // Game Activity settings
  let gameEnabled = $state(true);
  let gameVisibility = $state<'all' | 'selected'>('all');
  let gameServerIds = $state<string[]>([]);
  let customGames = $state<Record<string, string>>({});
  let newGameExe = $state('');
  let newGameName = $state('');

  async function loadGameSettings() {
    if (!window.electronAPI?.getGameSettings) return;
    const s = await window.electronAPI.getGameSettings();
    gameEnabled = s.enabled;
    gameVisibility = s.visibility;
    gameServerIds = s.selectedServerIds;
    customGames = s.customGames;
  }

  async function saveGameEnabled(enabled: boolean) {
    gameEnabled = enabled;
    await window.electronAPI?.setGameEnabled(enabled);
  }

  async function saveGameVisibility(vis: 'all' | 'selected') {
    gameVisibility = vis;
    await window.electronAPI?.setGameVisibility(vis);
  }

  async function toggleGameServer(serverId: string) {
    if (gameServerIds.includes(serverId)) {
      gameServerIds = gameServerIds.filter(id => id !== serverId);
    } else {
      gameServerIds = [...gameServerIds, serverId];
    }
    await window.electronAPI?.setGameServerIds(gameServerIds);
  }

  async function addCustomGame() {
    if (!newGameExe.trim() || !newGameName.trim()) return;
    await window.electronAPI?.addCustomGame(newGameExe.trim(), newGameName.trim());
    customGames = { ...customGames, [newGameExe.trim().toLowerCase()]: newGameName.trim() };
    newGameExe = '';
    newGameName = '';
  }

  async function removeCustomGame(exe: string) {
    await window.electronAPI?.removeCustomGame(exe);
    const updated = { ...customGames };
    delete updated[exe];
    customGames = updated;
  }

  let videoPreviewStream = $state<MediaStream | null>(null);
  let videoPreviewEl = $state<HTMLVideoElement>();

  const MOUSE_BUTTON_NAMES: Record<string, string> = {
    Mouse0: 'Left Click',
    Mouse1: 'Middle Click',
    Mouse2: 'Right Click',
    Mouse3: 'Mouse 4 (Back)',
    Mouse4: 'Mouse 5 (Forward)',
  };

  function formatPttKey(key: string): string {
    if (key.startsWith('Mouse')) return MOUSE_BUTTON_NAMES[key] || key;
    return key.replace(/^Key/, '').replace(/^Digit/, '');
  }

  // PTT Capture logic
  $effect(() => {
    if (!capturingPttKey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        capturingPttKey = false;
        return;
      }
      pttKey.set(e.code);
      capturingPttKey = false;
    };

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      pttKey.set(`Mouse${e.button}`);
      capturingPttKey = false;
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
    };
  });

  // Global profile state
  let displayName = $state($currentUser?.display_name || '');
  let avatarPreview = $state<string | null>($currentUser?.avatar_url || null);
  let avatarFile = $state<File | null>(null);
  let bio = $state($currentUser?.bio || '');
  let bannerPreview = $state<string | null>($currentUser?.banner_url || null);
  let bannerFile = $state<File | null>(null);
  let bannerGiphyUrl = $state<string | null>(null);
  let showAvatarMenu = $state(false);
  let showServerAvatarMenu = $state(false);
  let showBannerMenu = $state(false);
  let showBannerGifPicker = $state(false);
  let nameFont = $state($currentUser?.name_font ?? '');
  let nameColor = $state($currentUser?.name_color ?? '');
  let useGradient = $state(isGradient($currentUser?.name_color));
  let gradientStart = $state(
    isGradient($currentUser?.name_color) ? parseGradientColors($currentUser!.name_color!)[0] : '#ff0000',
  );
  let gradientEnd = $state(
    isGradient($currentUser?.name_color) ? parseGradientColors($currentUser!.name_color!)[1] : '#0000ff',
  );
  let roleColor = $derived($currentUser?.role_color ?? '#99aab5');
  let saving = $state(false);

  // Server profile state
  let serverNickname = $state('');
  let serverAvatarPreview = $state<string | null>(null);
  let serverAvatarFile = $state<File | null>(null);
  let serverBannerPreview = $state<string | null>(null);
  let serverBannerFile = $state<File | null>(null);
  let serverBannerGiphyUrl = $state<string | null>(null);
  let showServerBannerMenu = $state(false);
  let showServerBannerGifPicker = $state(false);
  let loadingServerProfile = $state(false);

  // Track original server profile values for change detection
  let origServerNickname = $state('');
  let origServerAvatarPreview = $state<string | null>(null);
  let origServerBannerPreview = $state<string | null>(null);

  async function loadServerProfile() {
    if (!selectedServerId) return;
    loadingServerProfile = true;
    try {
      const members = await api.get<any[]>(`/api/servers/${selectedServerId}/members`);
      const me = members.find((m) => m.user_id === $currentUser?.id);
      if (me) {
        serverNickname = me.nickname || '';
        serverAvatarPreview = me.member_avatar_url || null;
        serverAvatarFile = null;
        serverBannerPreview = me.member_banner_url || null;
        serverBannerFile = null;
        serverBannerGiphyUrl = null;
        // Store originals for change detection
        origServerNickname = serverNickname;
        origServerAvatarPreview = serverAvatarPreview;
        origServerBannerPreview = serverBannerPreview;
      }
    } catch {
      // ignore
    } finally {
      loadingServerProfile = false;
    }
  }

  $effect(() => {
    if (selectedServerId) {
      loadServerProfile();
    }
  });

  const fontOptions = [
    { value: '', label: 'Default' },
    { value: "'Permanent Marker', cursive", label: 'Marker' },
    { value: "'Press Start 2P', monospace", label: 'Pixel' },
    { value: "'Pacifico', cursive", label: 'Pacifico' },
    { value: "'Bangers', cursive", label: 'Bangers' },
    { value: "'Creepster', cursive", label: 'Creepster' },
    { value: "'Fredoka', sans-serif", label: 'Fredoka' },
    { value: "'Caveat', cursive", label: 'Handwriting' },
    { value: "'Special Elite', monospace", label: 'Typewriter' },
    { value: "'Orbitron', sans-serif", label: 'Orbitron' },
    { value: "'Silkscreen', monospace", label: 'Silkscreen' },
    { value: "'Bebas Neue', sans-serif", label: 'Bebas Neue' },
    { value: "'Righteous', sans-serif", label: 'Righteous' },
  ];

  // Change password state
  let cpCurrentPassword = $state('');
  let cpNewPassword = $state('');
  let cpConfirmPassword = $state('');
  let cpLoading = $state(false);
  let cpError = $state('');
  let cpSuccess = $state('');

  // Change email state
  let showEmailEdit = $state(false);
  let emailValue = $state($currentUser?.email || '');
  let emailCode = $state('');
  let emailLoading = $state(false);
  let emailError = $state('');
  let emailSuccess = $state('');
  let emailVerifying = $state(false);

  // 2FA state
  let mfaSetupData = $state<{ qr_url: string; secret: string } | null>(null);
  let mfaConfirmCode = $state('');
  let mfaDisableCode = $state('');
  let mfaLoading = $state(false);
  let mfaError = $state('');
  let mfaSuccess = $state('');

  // Desktop settings (autostart, close to tray, start minimized)
  let autostartEnabled = $state(false);
  let autostartLoading = $state(false);
  let closeToTray = $state(true);
  let closeToTrayLoading = $state(false);
  let startMinimized = $state(false);
  let startMinimizedLoading = $state(false);
  let appVersion = $state('');

  if (isDesktop) {
    const api = (window as any).electronAPI;
    api.getVersion().then((v: string) => {
      appVersion = v;
    });
    api.isAutoStartEnabled().then((v: boolean) => {
      autostartEnabled = v;
    });
    api.storeGet('closeToTray').then((v: boolean | undefined) => {
      if (v !== null && v !== undefined) closeToTray = v;
    });
    api.storeGet('startMinimized').then((v: boolean | undefined) => {
      if (v !== null && v !== undefined) startMinimized = v;
    });
  }

  async function toggleAutostart() {
    autostartLoading = true;
    try {
      const api = (window as any).electronAPI;
      autostartEnabled = !autostartEnabled;
      await api.setAutoStart(autostartEnabled);
    } catch {
      autostartEnabled = !autostartEnabled;
    }
    autostartLoading = false;
  }

  async function toggleCloseToTray() {
    closeToTrayLoading = true;
    try {
      const api = (window as any).electronAPI;
      closeToTray = !closeToTray;
      await api.storeSet('closeToTray', closeToTray);
    } catch {}
    closeToTrayLoading = false;
  }

  async function toggleStartMinimized() {
    startMinimizedLoading = true;
    try {
      const api = (window as any).electronAPI;
      startMinimized = !startMinimized;
      await api.storeSet('startMinimized', startMinimized);
    } catch {}
    startMinimizedLoading = false;
  }

  let fileInput = $state<HTMLInputElement>();
  let bannerFileInput = $state<HTMLInputElement>();
  let serverAvatarFileInput = $state<HTMLInputElement>();
  let serverBannerFileInput = $state<HTMLInputElement>();

  function handleAvatarClick() {
    fileInput?.click();
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    avatarFile = file;
    avatarPreview = URL.createObjectURL(file);
  }

  function handleServerAvatarClick() {
    serverAvatarFileInput?.click();
  }

  function handleServerAvatarFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    serverAvatarFile = file;
    serverAvatarPreview = URL.createObjectURL(file);
  }

  function handleBannerClick() {
    showBannerMenu = !showBannerMenu;
    showBannerGifPicker = false;
  }

  function handleBannerUploadChoice() {
    showBannerMenu = false;
    showBannerGifPicker = false;
    bannerFileInput?.click();
  }

  function handleBannerGifChoice() {
    showBannerGifPicker = true;
  }

  function handleBannerFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    bannerFile = file;
    bannerGiphyUrl = null;
    bannerPreview = URL.createObjectURL(file);
  }

  function handleBannerGifSelect(gifUrl: string) {
    bannerGiphyUrl = gifUrl;
    bannerFile = null;
    bannerPreview = gifUrl;
    showBannerGifPicker = false;
    showBannerMenu = false;
  }

  async function handleSave() {
    saving = true;
    try {
      if (activeProfileTab === 'global') {
        const data: {
          display_name?: string;
          avatar_url?: string | null;
          bio?: string;
          banner_url?: string | null;
          name_font?: string | null;
          name_color?: string | null;
        } = {};

        if (displayName && displayName !== $currentUser?.display_name) {
          data.display_name = displayName;
        }

        if (avatarFile) {
          const result = await api.upload(avatarFile);
          data.avatar_url = `/uploads/${result.stored_name}`;
          avatarPreview = data.avatar_url;
          avatarFile = null;
        } else if (!avatarPreview && $currentUser?.avatar_url) {
          data.avatar_url = null;
        }

        if (bio !== ($currentUser?.bio || '')) {
          data.bio = bio;
        }

        if (bannerGiphyUrl) {
          data.banner_url = bannerGiphyUrl;
          bannerPreview = bannerGiphyUrl;
          bannerGiphyUrl = null;
        } else if (bannerFile) {
          const result = await api.upload(bannerFile);
          data.banner_url = `/uploads/${result.stored_name}`;
          bannerPreview = data.banner_url;
          bannerFile = null;
        } else if (!bannerPreview && $currentUser?.banner_url) {
          data.banner_url = null;
        }

        const currentFont = $currentUser?.name_font ?? '';
        if (nameFont !== currentFont) {
          data.name_font = nameFont || null;
        }

        const resolvedColor = useGradient ? `gradient:${gradientStart},${gradientEnd}` : nameColor;
        const currentColor = $currentUser?.name_color ?? '';
        if (resolvedColor !== currentColor) {
          data.name_color = resolvedColor || null;
        }

        if (Object.keys(data).length > 0) {
          await updateProfile(data);
        }
      } else if (activeProfileTab === 'server' && selectedServerId) {
        const data: { nickname?: string | null; avatar_url?: string | null; banner_url?: string | null } = {};
        
        if (serverNickname !== origServerNickname) {
          data.nickname = serverNickname.trim() || null;
        }

        if (serverAvatarFile) {
          const result = await api.upload(serverAvatarFile);
          data.avatar_url = `/uploads/${result.stored_name}`;
          serverAvatarPreview = data.avatar_url;
          serverAvatarFile = null;
        } else if (serverAvatarPreview !== origServerAvatarPreview) {
          data.avatar_url = serverAvatarPreview;
        }

        if (serverBannerGiphyUrl) {
          data.banner_url = serverBannerGiphyUrl;
          serverBannerPreview = serverBannerGiphyUrl;
          serverBannerGiphyUrl = null;
        } else if (serverBannerFile) {
          const result = await api.upload(serverBannerFile);
          data.banner_url = `/uploads/${result.stored_name}`;
          serverBannerPreview = data.banner_url;
          serverBannerFile = null;
        } else if (serverBannerPreview !== origServerBannerPreview) {
          data.banner_url = serverBannerPreview;
        }

        if (Object.keys(data).length > 0) {
          await updateServerMember(selectedServerId, data);
          // Sync original state so the bar hides
          origServerNickname = serverNickname;
          origServerAvatarPreview = serverAvatarPreview;
          origServerBannerPreview = serverBannerPreview;
        }
      }
    } catch (err: any) {
      console.error('Failed to save profile:', err);
    } finally {
      saving = false;
    }
  }

  async function loadDevices() {
    loadingDevices = true;
    try {
      // Request permission first so labels are available
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((t) => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      inputDevices = devices.filter((d) => d.kind === 'audioinput');
      outputDevices = devices.filter((d) => d.kind === 'audiooutput');
      videoDevices = devices.filter((d) => d.kind === 'videoinput');
    } catch {
      // Permission denied or no devices
    } finally {
      loadingDevices = false;
    }
  }

  $effect(() => {
    loadDevices();
  });

  function stopVideoPreview() {
    if (videoPreviewStream) {
      videoPreviewStream.getTracks().forEach((t) => t.stop());
      videoPreviewStream = null;
    }
  }

  async function toggleVideoPreview() {
    if (videoPreviewStream) {
      stopVideoPreview();
    } else {
      try {
        videoPreviewStream = await navigator.mediaDevices.getUserMedia({
          video: $selectedVideoDeviceId ? { deviceId: { exact: $selectedVideoDeviceId } } : true,
        });
      } catch (err) {
        console.error('Failed to start video preview:', err);
      }
    }
  }

  $effect(() => {
    if (videoPreviewEl && videoPreviewStream) {
      videoPreviewEl.srcObject = videoPreviewStream;
    }
  });

  // Stop video preview if we switch away from voice-video tab
  $effect(() => {
    if (activeTab !== 'voice-video') {
      stopVideoPreview();
    }
  });

  function handleClose() {
    if (hasChanges && !window.confirm('You have unsaved changes. Are you sure you want to close?')) {
      return;
    }
    stopVideoPreview();
    onclose();
  }

  async function handleChangePassword() {
    cpError = '';
    cpSuccess = '';
    if (cpNewPassword.length < 15) {
      cpError = 'New password must be at least 15 characters';
      return;
    }
    if (cpNewPassword !== cpConfirmPassword) {
      cpError = 'Passwords do not match';
      return;
    }
    cpLoading = true;
    try {
      await changePassword(undefined, cpCurrentPassword, cpNewPassword);
      cpSuccess = 'Password changed successfully';
      cpCurrentPassword = '';
      cpNewPassword = '';
      cpConfirmPassword = '';
    } catch (e: any) {
      cpError = e.message;
    } finally {
      cpLoading = false;
    }
  }

  async function handleChangeEmail() {
    emailError = '';
    emailSuccess = '';
    if (!emailValue || emailValue === $currentUser?.email) {
      emailError = 'Enter a new email address';
      return;
    }
    emailLoading = true;
    try {
      await api.post('/api/auth/change-email', { email: emailValue });
      emailVerifying = true;
      emailSuccess = 'Verification code sent to your new email';
    } catch (e: any) {
      emailError = e.message;
    } finally {
      emailLoading = false;
    }
  }

  async function handleVerifyEmailChange() {
    emailError = '';
    emailSuccess = '';
    emailLoading = true;
    try {
      const res = await api.post<{ ok: boolean; email: string }>('/api/auth/verify-email', {
        code: emailCode,
      });
      emailVerifying = false;
      emailCode = '';
      emailSuccess = 'Email updated successfully';
      currentUser.update((u) => (u ? { ...u, email: res.email } : u));
    } catch (e: any) {
      emailError = e.message;
    } finally {
      emailLoading = false;
    }
  }

  async function startMfaSetup() {
    mfaLoading = true;
    mfaError = '';
    mfaSuccess = '';
    try {
      const data = await api.post<{ qr_url: string; secret: string }>('/api/mfa/setup');
      mfaSetupData = data;
    } catch (e: any) {
      mfaError = e.message;
    } finally {
      mfaLoading = false;
    }
  }

  async function confirmMfaSetup() {
    mfaLoading = true;
    mfaError = '';
    try {
      await api.post('/api/mfa/verify', { totp_code: mfaConfirmCode });
      mfaSetupData = null;
      mfaConfirmCode = '';
      mfaSuccess = 'Switched to Authenticator App';
      currentUser.update((u) =>
        u ? { ...u, totp_enabled: true, mfa_method: 'totp' as const } : u,
      );
    } catch (e: any) {
      mfaError = e.message;
    } finally {
      mfaLoading = false;
    }
  }

  async function disableMfa() {
    mfaLoading = true;
    mfaError = '';
    try {
      await api.post('/api/mfa/disable', { totp_code: mfaDisableCode });
      mfaDisableCode = '';
      mfaSuccess = 'Switched to Email MFA';
      currentUser.update((u) =>
        u ? { ...u, totp_enabled: false, mfa_method: 'email' as const } : u,
      );
    } catch (e: any) {
      mfaError = e.message;
    } finally {
      mfaLoading = false;
    }
  }

  // Unsaved changes detection
  let hasChanges = $derived.by(() => {
    if (activeTab === 'profiles') {
      if (activeProfileTab === 'global') {
        return (
          displayName !== ($currentUser?.display_name || '') ||
          avatarFile !== null ||
          avatarPreview !== ($currentUser?.avatar_url || null) ||
          bio !== ($currentUser?.bio || '') ||
          bannerFile !== null ||
          bannerGiphyUrl !== null ||
          bannerPreview !== ($currentUser?.banner_url || null) ||
          nameFont !== ($currentUser?.name_font || '') ||
          (useGradient ? `gradient:${gradientStart},${gradientEnd}` : nameColor) !== ($currentUser?.name_color || '')
        );
      } else {
        return (
          serverNickname !== origServerNickname ||
          serverAvatarFile !== null ||
          serverAvatarPreview !== origServerAvatarPreview ||
          serverBannerFile !== null ||
          serverBannerGiphyUrl !== null ||
          serverBannerPreview !== origServerBannerPreview
        );
      }
    }
    return false;
  });

  function resetGlobalProfile() {
    displayName = $currentUser?.display_name || '';
    avatarPreview = $currentUser?.avatar_url || null;
    avatarFile = null;
    bio = $currentUser?.bio || '';
    bannerPreview = $currentUser?.banner_url || null;
    bannerFile = null;
    bannerGiphyUrl = null;
    nameFont = $currentUser?.name_font ?? '';
    nameColor = $currentUser?.name_color ?? '';
  }

  function resetServerProfile() {
    loadServerProfile();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={handleClose} onkeydown={(e) => e.key === 'Escape' && handleClose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="sidebar">
      <div class="sidebar-inner">
        <h5 class="sidebar-title">User Settings</h5>
        <button class="sidebar-item" class:active={activeTab === 'my-account'} onclick={() => activeTab = 'my-account'}>My Account</button>
        <button class="sidebar-item" class:active={activeTab === 'profiles'} onclick={() => activeTab = 'profiles'}>Profiles</button>
        <button class="sidebar-item" class:active={activeTab === 'mfa'} onclick={() => activeTab = 'mfa'}>Two-Factor Authentication</button>
        
        <div class="sidebar-separator"></div>
        <h5 class="sidebar-title">App Settings</h5>
        <button class="sidebar-item" class:active={activeTab === 'voice-video'} onclick={() => activeTab = 'voice-video'}>Voice & Video</button>
        <button class="sidebar-item" class:active={activeTab === 'notifications'} onclick={() => activeTab = 'notifications'}>Notifications</button>
        <button class="sidebar-item" class:active={activeTab === 'appearance'} onclick={() => activeTab = 'appearance'}>Appearance</button>
        <button class="sidebar-item" class:active={activeTab === 'game-activity'} onclick={() => { activeTab = 'game-activity'; loadGameSettings(); }}>Game Activity</button>
        {#if isDesktop}
          <button class="sidebar-item" class:active={activeTab === 'desktop'} onclick={() => activeTab = 'desktop'}>Desktop</button>
        {/if}
        
        <div class="sidebar-separator"></div>
        <button class="sidebar-item logout-nav-btn" onclick={onlogout}>
          <Icon name="logout" size={18} />
          <span>Log Out</span>
        </button>
        
        {#if appVersion}
          <div class="sidebar-version">v{appVersion}</div>
        {/if}
      </div>
    </div>

    <div class="content-area">
      <div class="content-wrapper">
        {#if activeTab === 'my-account'}
          <section class="section">
            <h3 class="content-title">My Account</h3>
            
            <div class="account-card">
              <div class="account-banner" style:background={$currentUser?.banner_url ? `url(${resolveAsset($currentUser.banner_url)}) center/cover` : 'var(--accent)'}></div>
              <div class="account-info-row">
                <div class="account-avatar-wrapper">
                  <div class="account-avatar">
                    {#if $currentUser?.avatar_url}
                      <img src={resolveAsset($currentUser.avatar_url)} alt="" onerror={(e) => { e.currentTarget.remove(); }} />
                    {/if}
                    {#if !$currentUser?.avatar_url}
                      <span class="avatar-initial">{$currentUser?.username.charAt(0).toUpperCase()}</span>
                    {/if}
                  </div>
                </div>
                <div class="account-name-details">
                  <div class="account-display-name">{$currentUser?.display_name || $currentUser?.username}</div>
                  <div class="account-username">@{$currentUser?.username}</div>
                </div>
                <div class="account-actions-right">
                  <button class="btn-accent edit-profile-btn" onclick={() => activeTab = 'profiles'}>Edit User Profile</button>
                </div>
              </div>

              <div class="account-details-grid">
                <div class="detail-item">
                  <div class="detail-label-group">
                    <div class="detail-label">Username</div>
                    <div class="detail-value">{$currentUser?.username}</div>
                  </div>
                </div>
                <div class="detail-item">
                  <div class="detail-label-group">
                    <div class="detail-label">Email</div>
                    <div class="detail-value">
                      {#if emailVerifying}
                        <div class="email-verify-row">
                          <input type="text" class="text-input" bind:value={emailCode} placeholder="Enter verification code" />
                          <button class="btn-accent" onclick={handleVerifyEmailChange} disabled={emailLoading || !emailCode}>Verify</button>
                          <button class="btn-text" onclick={() => emailVerifying = false}>Cancel</button>
                        </div>
                      {:else if showEmailEdit}
                        <div class="email-edit-row">
                          <input type="email" class="text-input" bind:value={emailValue} placeholder="New email address" />
                          <button class="btn-accent" onclick={handleChangeEmail} disabled={emailLoading || !emailValue || emailValue === $currentUser?.email}>Save</button>
                          <button class="btn-text" onclick={() => showEmailEdit = false}>Cancel</button>
                        </div>
                      {:else}
                        {$currentUser?.email ? $currentUser.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : 'Not set'}
                      {/if}
                    </div>
                  </div>
                  {#if !showEmailEdit && !emailVerifying}
                    <button class="detail-edit-btn" onclick={() => showEmailEdit = true}>Edit</button>
                  {/if}
                </div>
              </div>
            </div>

            {#if emailError}<p class="status-msg error">{emailError}</p>{/if}
            {#if emailSuccess}<p class="status-msg success">{emailSuccess}</p>{/if}

            <div class="section-divider"></div>

            <h4 class="section-subtitle">Password and Authentication</h4>
            {#if cpError}<p class="status-msg error">{cpError}</p>{/if}
            {#if cpSuccess}<p class="status-msg success">{cpSuccess}</p>{/if}
            
            <div class="form-group">
              <label>Current Password</label>
              <input type="password" class="text-input" bind:value={cpCurrentPassword} placeholder="••••••••••••••••" />
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" class="text-input" bind:value={cpNewPassword} placeholder="Enter new password" />
            </div>
            <div class="form-group">
              <label>Confirm New Password</label>
              <input type="password" class="text-input" bind:value={cpConfirmPassword} placeholder="Confirm new password" />
            </div>
            <button class="btn-accent" onclick={handleChangePassword} disabled={cpLoading || !cpCurrentPassword || !cpNewPassword}>Change Password</button>
          </section>

        {:else if activeTab === 'profiles'}
          <section class="section">
            <h3 class="content-title">Profiles</h3>
            
            <div class="profile-tabs">
              <button class:active={activeProfileTab === 'global'} onclick={() => activeProfileTab = 'global'}>User Profile</button>
              <button class:active={activeProfileTab === 'server'} onclick={() => { activeProfileTab = 'server'; if (!selectedServerId && $servers.length > 0) selectedServerId = $servers[0].id; }}>Server Profiles</button>
            </div>

            {#if activeProfileTab === 'global'}
              <div class="profile-editor">
                <div class="editor-left">
                  <div class="form-group">
                    <label>Display Name</label>
                    <input type="text" class="text-input" bind:value={displayName} maxlength="32" />
                  </div>
                  
                  <div class="form-group">
                    <label>About Me</label>
                    <textarea class="text-input" bind:value={bio} maxlength="190" rows="4" placeholder="Tell us about yourself..."></textarea>
                    <div class="char-count">{bio.length}/190</div>
                  </div>

                  <div class="form-group">
                    <label>Avatar</label>
                    <div class="avatar-upload-row">
                      <div class="avatar-preview-small" onclick={() => showAvatarMenu = !showAvatarMenu}>
                        {#if avatarPreview}
                          <img src={avatarFile ? avatarPreview : resolveAsset(avatarPreview)} alt="" onerror={() => { avatarPreview = null; avatarFile = null; }} />
                        {:else}
                          <span class="avatar-initial">{(displayName || $currentUser?.username || '?').charAt(0).toUpperCase()}</span>
                        {/if}
                        <div class="preview-overlay">Change</div>
                      </div>
                      <div class="upload-btns">
                        <button class="btn-subtle" onclick={() => showAvatarMenu = !showAvatarMenu}>Change Avatar</button>
                        {#if showAvatarMenu}
                          <div class="avatar-menu">
                            <button onclick={() => { handleAvatarClick(); showAvatarMenu = false; }}>Upload Image</button>
                            <button class="btn-danger-text" onclick={() => { avatarPreview = null; avatarFile = null; showAvatarMenu = false; }}>Remove Avatar</button>
                          </div>
                        {/if}
                      </div>
                    </div>
                    <input type="file" bind:this={fileInput} onchange={handleFileChange} hidden accept="image/*" />
                  </div>

                  <div class="form-group">
                    <label>Banner</label>
                    <div class="banner-upload-row">
                      <div class="banner-preview-small" onclick={handleBannerClick}>
                        {#if bannerPreview}
                          <img src={bannerFile ? bannerPreview : resolveAsset(bannerPreview)} alt="" onerror={(e) => { e.currentTarget.remove(); }} />
                        {:else}
                          <div class="banner-placeholder">Click to choose banner</div>
                        {/if}
                        <div class="preview-overlay">Change</div>
                      </div>
                      {#if showBannerMenu}
                        <div class="glass-panel banner-popover">
                          {#if !showBannerGifPicker}
                            <button onclick={handleBannerUploadChoice}>Upload Image</button>
                            <button onclick={handleBannerGifChoice}>Choose GIF</button>
                            {#if bannerPreview}
                              <button class="btn-danger-text" onclick={() => { bannerPreview = null; bannerFile = null; bannerGiphyUrl = null; showBannerMenu = false; }}>Remove Banner</button>
                            {/if}
                          {:else}
                            <button class="btn-back" onclick={() => showBannerGifPicker = false}>← Back</button>
                            <GifPicker onSelect={handleBannerGifSelect} />
                          {/if}
                        </div>
                      {/if}
                    </div>
                    <input type="file" bind:this={bannerFileInput} onchange={handleBannerFileChange} hidden accept="image/*" />
                  </div>
                </div>

                <div class="editor-right">
                  <label class="preview-label">Preview</label>
                  <div class="profile-preview-card">
                    <div class="preview-banner" style:background={bannerPreview ? `url(${resolveAsset(bannerPreview)}) center/cover` : 'var(--accent)'}></div>
                    <div class="preview-avatar">
                      {#if avatarPreview}
                        <img src={avatarFile ? avatarPreview : resolveAsset(avatarPreview)} alt="" onerror={() => { avatarPreview = null; avatarFile = null; }} />
                      {:else}
                        <span class="avatar-initial">{(displayName || $currentUser?.username || '?').charAt(0).toUpperCase()}</span>
                      {/if}
                    </div>
                    <div class="preview-content">
                      <div class="preview-names">
                        <div class="preview-display-name" style={nameStyle(useGradient ? `gradient:${gradientStart},${gradientEnd}` : nameColor, roleColor, nameFont)}>
                          {displayName || $currentUser?.username}
                        </div>
                        <div class="preview-username">@{$currentUser?.username}</div>
                      </div>
                      <div class="preview-divider"></div>
                      <div class="preview-bio-label">About Me</div>
                      <div class="preview-bio">{bio || 'User has no bio yet.'}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="section-divider"></div>
              <h4 class="section-subtitle">Name Style</h4>
              <div class="name-style-editor">
                <div class="form-group">
                  <label>Font</label>
                  <select bind:value={nameFont}>
                    {#each fontOptions as opt}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-group">
                  <label>Color</label>
                  <div class="color-type-tabs">
                    <button class:active={!useGradient} onclick={() => useGradient = false}>Solid</button>
                    <button class:active={useGradient} onclick={() => useGradient = true}>Gradient</button>
                  </div>
                  {#if useGradient}
                    <div class="gradient-inputs">
                      <input type="color" bind:value={gradientStart} />
                      <Icon name="arrow-right" size={14} />
                      <input type="color" bind:value={gradientEnd} />
                    </div>
                  {:else}
                    <div class="color-input-row">
                      <input type="color" bind:value={nameColor} />
                      <input type="text" class="text-input" bind:value={nameColor} placeholder="#000000" />
                      <button class="btn-subtle" onclick={() => nameColor = ''}>Reset</button>
                    </div>
                  {/if}
                </div>
              </div>
            {:else}
              <!-- Server Profiles -->
              <div class="form-group">
                <label>Choose a Server</label>
                <select bind:value={selectedServerId}>
                  {#each $servers as s (s.id)}
                    <option value={s.id}>{s.name}</option>
                  {/each}
                </select>
              </div>

              <div class="profile-editor">
                <div class="editor-left">
                  <div class="form-group">
                    <label>Server Nickname</label>
                    <input type="text" class="text-input" bind:value={serverNickname} maxlength="32" placeholder={$currentUser?.display_name || $currentUser?.username} />
                  </div>

                  <div class="form-group">
                    <label>Server Avatar</label>
                    <div class="avatar-upload-row">
                      <div class="avatar-preview-small" onclick={() => showServerAvatarMenu = !showServerAvatarMenu}>
                        {#if serverAvatarPreview}
                          <img src={serverAvatarFile ? serverAvatarPreview : resolveAsset(serverAvatarPreview)} alt="" onerror={() => { serverAvatarPreview = null; serverAvatarFile = null; }} />
                        {:else if avatarPreview || $currentUser?.avatar_url}
                          <img src={avatarFile ? avatarPreview : resolveAsset(avatarPreview || $currentUser?.avatar_url)} alt="" />
                        {:else}
                          <span class="avatar-initial">{(displayName || $currentUser?.username || '?').charAt(0).toUpperCase()}</span>
                        {/if}
                        <div class="preview-overlay">Change</div>
                      </div>
                      <div class="upload-btns">
                        <button class="btn-subtle" onclick={() => showServerAvatarMenu = !showServerAvatarMenu}>Change Avatar</button>
                        {#if showServerAvatarMenu}
                          <div class="avatar-menu">
                            <button onclick={() => { handleServerAvatarClick(); showServerAvatarMenu = false; }}>Upload Image</button>
                            <button onclick={() => { serverAvatarPreview = null; serverAvatarFile = null; showServerAvatarMenu = false; }}>Reset to Global</button>
                          </div>
                        {/if}
                      </div>
                    </div>
                    <input type="file" bind:this={serverAvatarFileInput} onchange={handleServerAvatarFileChange} hidden accept="image/*" />
                  </div>

                  <div class="form-group">
                    <label>Server Banner</label>
                    <div class="banner-upload-row">
                      <div class="banner-preview-small" onclick={() => showServerBannerMenu = !showServerBannerMenu}>
                        {#if serverBannerPreview}
                          <img src={serverBannerFile ? serverBannerPreview : resolveAsset(serverBannerPreview)} alt="" onerror={(e) => { e.currentTarget.remove(); }} />
                        {:else}
                          <div class="banner-placeholder">Using global banner</div>
                        {/if}
                        <div class="preview-overlay">Change</div>
                      </div>
                      {#if showServerBannerMenu}
                        <div class="glass-panel banner-popover">
                          {#if !showServerBannerGifPicker}
                            <button onclick={() => { serverBannerFileInput?.click(); showServerBannerMenu = false; }}>Upload Image</button>
                            <button onclick={() => showServerBannerGifPicker = true}>Choose GIF</button>
                            {#if serverBannerPreview}
                              <button class="btn-danger-text" onclick={() => { serverBannerPreview = null; serverBannerFile = null; serverBannerGiphyUrl = null; showServerBannerMenu = false; }}>Reset to Global</button>
                            {/if}
                          {:else}
                            <button class="btn-back" onclick={() => showServerBannerGifPicker = false}>← Back</button>
                            <GifPicker onSelect={(url) => { serverBannerGiphyUrl = url; serverBannerFile = null; serverBannerPreview = url; showServerBannerGifPicker = false; showServerBannerMenu = false; }} />
                          {/if}
                        </div>
                      {/if}
                    </div>
                    <input type="file" bind:this={serverBannerFileInput} onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) { serverBannerFile = f; serverBannerGiphyUrl = null; serverBannerPreview = URL.createObjectURL(f); } }} hidden accept="image/*" />
                  </div>
                </div>

                <div class="editor-right">
                  <label class="preview-label">Preview</label>
                  <div class="profile-preview-card">
                    <div class="preview-banner" style:background={(serverBannerPreview || bannerPreview) ? `url(${resolveAsset(serverBannerPreview || bannerPreview)}) center/cover` : 'var(--accent)'}></div>
                    <div class="preview-avatar">
                      {#if serverAvatarPreview}
                        <img src={serverAvatarFile ? serverAvatarPreview : resolveAsset(serverAvatarPreview)} alt="" onerror={(e) => { e.currentTarget.remove(); }} />
                      {:else if avatarPreview || $currentUser?.avatar_url}
                        <img src={avatarFile ? avatarPreview : resolveAsset(avatarPreview || $currentUser?.avatar_url)} alt="" onerror={(e) => { e.currentTarget.remove(); }} />
                      {:else}
                        <span class="avatar-initial">{(displayName || $currentUser?.username || '?').charAt(0).toUpperCase()}</span>
                      {/if}
                    </div>
                    <div class="preview-content">
                      <div class="preview-names">
                        <div class="preview-display-name" style={nameStyle(useGradient ? `gradient:${gradientStart},${gradientEnd}` : nameColor, roleColor, nameFont)}>
                          {serverNickname || displayName || $currentUser?.username}
                        </div>
                        <div class="preview-username">@{$currentUser?.username}</div>
                      </div>
                      <div class="preview-divider"></div>
                      <div class="preview-bio-label">About Me</div>
                      <div class="preview-bio">{bio || 'User has no bio yet.'}</div>
                    </div>
                  </div>
                </div>
              </div>
            {/if}

            <div class="sticky-footer" class:visible={hasChanges}>
              <p class="footer-hint">Careful — you have unsaved changes!</p>
              <div class="footer-btns">
                <button class="btn-text" onclick={() => { activeProfileTab === 'global' ? resetGlobalProfile() : resetServerProfile() }}>Reset</button>
                <button class="btn-success" onclick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </section>

        {:else if activeTab === 'mfa'}
          <section class="section">
            <h3 class="content-title">Two-Factor Authentication</h3>
            <p class="section-desc">To keep your account secure, MFA is mandatory. You are currently using {$currentUser?.totp_enabled ? 'an Authenticator App' : 'Email codes'}.</p>

            <div class="mfa-status-card" class:enabled={$currentUser?.totp_enabled}>
              <div class="mfa-status-icon">
                <Icon name="shield-check" size={32} />
              </div>
              <div class="mfa-status-info">
                <div class="mfa-status-title">
                  2FA is <strong>Always Active</strong>
                </div>
                <div class="mfa-status-desc">
                  {#if $currentUser?.totp_enabled}
                    Your account is protected by an Authenticator App.
                  {:else}
                    Your account is currently protected by Email codes. Switch to an Authenticator App for even stronger security.
                  {/if}
                </div>
              </div>
              <div class="mfa-status-badge">
                {$currentUser?.totp_enabled ? 'SECURE' : 'BASIC'}
              </div>
            </div>

            {#if mfaError}<p class="status-msg error">{mfaError}</p>{/if}
            {#if mfaSuccess}<p class="status-msg success">{mfaSuccess}</p>{/if}

            <div class="section-divider"></div>

            {#if $currentUser?.totp_enabled}
              <div class="mfa-management">
                <h4 class="section-subtitle">Manage Authentication</h4>
                <p class="section-desc">To switch back to email authentication, enter your current 6-digit TOTP code below.</p>
                <div class="mfa-action-row">
                  <input type="text" class="text-input mfa-code-input" bind:value={mfaDisableCode} placeholder="000000" maxlength="6" />
                  <button class="btn-accent" onclick={disableMfa} disabled={mfaLoading || mfaDisableCode.length !== 6}>
                    {mfaLoading ? 'Switching...' : 'Switch to Email MFA'}
                  </button>
                </div>
              </div>
            {:else if mfaSetupData}              <div class="mfa-setup-flow">
                <h4 class="section-subtitle">Setup Authenticator App</h4>
                
                <div class="setup-steps">
                  <div class="setup-step">
                    <div class="step-number">1</div>
                    <div class="step-content">
                      <p>Scan the QR code with your authenticator app (like Google Authenticator or Authy).</p>
                      <div class="qr-container">
                        <img src={mfaSetupData.qr_url} alt="QR Code" />
                      </div>
                    </div>
                  </div>

                  <div class="setup-step">
                    <div class="step-number">2</div>
                    <div class="step-content">
                      <p>If you can't scan the code, enter this secret key manually into your app:</p>
                      <div class="secret-display">
                        <code>{mfaSetupData.secret}</code>
                        <button class="btn-copy-tiny" onclick={() => { navigator.clipboard.writeText(mfaSetupData!.secret); toast.success('Secret copied!'); }}>Copy</button>
                      </div>
                    </div>
                  </div>

                  <div class="setup-step">
                    <div class="step-number">3</div>
                    <div class="step-content">
                      <p>Enter the 6-digit code generated by your app to verify the setup.</p>
                      <div class="mfa-verify-row">
                        <input type="text" class="text-input mfa-code-input" bind:value={mfaConfirmCode} placeholder="000000" maxlength="6" />
                        <button class="btn-accent" onclick={confirmMfaSetup} disabled={mfaLoading || mfaConfirmCode.length !== 6}>
                          {mfaLoading ? 'Verifying...' : 'Enable 2FA'}
                        </button>
                        <button class="btn-text" onclick={() => mfaSetupData = null}>Cancel</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {:else}
              <div class="mfa-enable-promo">
                <h4 class="section-subtitle">Authenticator App</h4>
                <p class="section-desc">Using an authenticator app like Google Authenticator or Authy is more secure than email codes.</p>
                <button class="btn-accent" style="padding: 12px 32px;" onclick={startMfaSetup} disabled={mfaLoading}>
                  {mfaLoading ? 'Starting Setup...' : 'Enable Authenticator App'}
                </button>
              </div>
            {/if}
          </section>

        {:else if activeTab === 'voice-video'}
          <section class="section">
            <h3 class="content-title">Voice & Video</h3>
            
            <h4 class="section-subtitle">Voice Settings</h4>
            <div class="form-grid">
              <div class="form-group">
                <label>Input Device</label>
                <select bind:value={$selectedInputDeviceId} disabled={loadingDevices}>
                  <option value="">Default</option>
                  {#each inputDevices as d}
                    <option value={d.deviceId}>{d.label || 'Microphone'}</option>
                  {/each}
                </select>
              </div>
              <div class="form-group">
                <label>Output Device</label>
                <select bind:value={$selectedOutputDeviceId} disabled={loadingDevices}>
                  <option value="">Default</option>
                  {#each outputDevices as d}
                    <option value={d.deviceId}>{d.label || 'Speaker'}</option>
                  {/each}
                </select>
              </div>
            </div>

            <div class="section-divider"></div>
            
            <div class="setting-toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Noise Suppression</div>
                <div class="toggle-desc">Reduce background noise for a clearer voice.</div>
              </div>
              <button class="toggle-switch" class:active={$noiseSuppression} aria-label="Toggle noise suppression" onclick={() => { noiseSuppression.set(!$noiseSuppression); applyNoiseSuppression($noiseSuppression); }}>
                <div class="toggle-knob"></div>
              </button>
            </div>

            <div class="section-divider"></div>
            
            <h4 class="section-subtitle">Input Mode</h4>
            <div class="input-mode-selector">
              <button class="mode-btn" class:active={$voiceMode === 'vad'} onclick={() => voiceMode.set('vad')}>
                <Icon name="mic" size={18} />
                <span>Voice Activity</span>
              </button>
              <button class="mode-btn" class:active={$voiceMode === 'ptt'} onclick={() => voiceMode.set('ptt')}>
                <Icon name="keyboard" size={18} />
                <span>Push to Talk</span>
              </button>
            </div>

            {#if $voiceMode === 'vad'}
              <div class="form-group">
                <label>Input Sensitivity</label>
                <div class="slider-row">
                  <span class="slider-label">High</span>
                  <input type="range" class="slider" min="0" max="100" bind:value={$vadSensitivity} />
                  <span class="slider-label">Low</span>
                </div>
              </div>
            {:else}
              <div class="form-group">
                <label>Shortcut</label>
                <button class="btn-capture" class:capturing={capturingPttKey} onclick={() => capturingPttKey = true}>
                  {capturingPttKey ? 'Recording...' : formatPttKey($pttKey)}
                </button>
              </div>
            {/if}

            <div class="section-divider"></div>

            <h4 class="section-subtitle">Video Settings</h4>
            <div class="form-group">
              <label>Camera</label>
              <select bind:value={$selectedVideoDeviceId} disabled={loadingDevices} onchange={stopVideoPreview}>
                <option value="">Default</option>
                {#each videoDevices as d}
                  <option value={d.deviceId}>{d.label || 'Camera'}</option>
                {/each}
              </select>
            </div>

            <div class="video-preview-container">
              <div class="video-preview-box">
                {#if videoPreviewStream}
                  <video bind:this={videoPreviewEl} autoplay playsinline muted class="preview-video"></video>
                {:else}
                  <div class="preview-placeholder">
                    <Icon name="video-off" size={48} />
                    <span>Video Preview Disabled</span>
                  </div>
                {/if}
              </div>
              <button class="btn-accent" onclick={toggleVideoPreview}>
                {videoPreviewStream ? 'Stop Testing' : 'Test Video'}
              </button>
            </div>
          </section>

        {:else if activeTab === 'notifications'}
          <section class="section">
            <h3 class="content-title">Notifications</h3>
            
            <div class="setting-toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Enable Desktop Notifications</div>
                <div class="toggle-desc">Get notifications when the app is in the background.</div>
              </div>
              <button class="toggle-switch" class:active={$notifyDesktop} aria-label="Toggle desktop notifications" onclick={() => notifyDesktop.set(!$notifyDesktop)}>
                <div class="toggle-knob"></div>
              </button>
            </div>

            <div class="section-divider"></div>

            <div class="setting-toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Enable Notification Sounds</div>
                <div class="toggle-desc">Hear a sound for incoming messages and events.</div>
              </div>
              <button class="toggle-switch" class:active={$notifySound} aria-label="Toggle notification sounds" onclick={() => notifySound.set(!$notifySound)}>
                <div class="toggle-knob"></div>
              </button>
            </div>

            <div class="toggle-subset" class:disabled={!$notifySound}>
              <div class="setting-toggle-row">
                <div class="toggle-info">
                  <div class="toggle-label">Message Sound</div>
                </div>
                <button class="toggle-switch" class:active={$notifyMessageSound} aria-label="Toggle message sound" onclick={() => notifyMessageSound.set(!$notifyMessageSound)}>
                  <div class="toggle-knob"></div>
                </button>
              </div>
              <div class="setting-toggle-row">
                <div class="toggle-info">
                  <div class="toggle-label">User Join/Leave Sounds</div>
                </div>
                <button class="toggle-switch" class:active={$notifyJoinLeaveSound} aria-label="Toggle join/leave sounds" onclick={() => notifyJoinLeaveSound.set(!$notifyJoinLeaveSound)}>
                  <div class="toggle-knob"></div>
                </button>
              </div>
            </div>
          </section>

        {:else if activeTab === 'appearance'}
          <section class="section">
            <h3 class="content-title">Appearance</h3>
            
            <h4 class="section-subtitle">Theme</h4>
            <div class="theme-picker-grid">
              {#each themes as t}
                <button class="theme-card" class:active={$theme === t.id} onclick={() => theme.set(t.id)}>
                  <div class="theme-preview-box {t.id}">
                    <div class="preview-sidebar"></div>
                    <div class="preview-chat">
                      <div class="preview-bubble"></div>
                      <div class="preview-bubble-short"></div>
                    </div>
                  </div>
                  <div class="theme-info">
                    <div class="theme-radio"></div>
                    <span>{t.name}</span>
                  </div>
                </button>
              {/each}
            </div>
          </section>

        {:else if activeTab === 'game-activity'}
          <section class="section">
            <h3 class="content-title">Game Activity</h3>

            {#if !window.electronAPI}
              <div class="setting-toggle-row">
                <div class="toggle-info">
                  <div class="toggle-label">Desktop Only</div>
                  <div class="toggle-desc">Game detection is only available in the desktop app. Download it from the <a href="https://info.sellserv.net/downloads.html" target="_blank" rel="noopener">downloads page</a>.</div>
                </div>
              </div>
            {:else}
              <div class="setting-toggle-row">
                <div class="toggle-info">
                  <div class="toggle-label">Display Current Activity</div>
                  <div class="toggle-desc">Automatically detect and show what game you're playing.</div>
                </div>
                <button class="toggle-switch" class:active={gameEnabled} onclick={() => saveGameEnabled(!gameEnabled)}>
                  <div class="toggle-knob"></div>
                </button>
              </div>

              {#if gameEnabled}
                <div class="section-divider"></div>

                <h4 class="section-subtitle">Visibility</h4>
                <div class="input-mode-selector">
                  <button class="mode-btn" class:active={gameVisibility === 'all'} onclick={() => saveGameVisibility('all')}>
                    <Icon name="users" size={18} />
                    <span>All Servers</span>
                  </button>
                  <button class="mode-btn" class:active={gameVisibility === 'selected'} onclick={() => saveGameVisibility('selected')}>
                    <Icon name="shield-check" size={18} />
                    <span>Selected Servers</span>
                  </button>
                </div>

                {#if gameVisibility === 'selected'}
                  <div class="server-checkboxes">
                    {#each $servers as server (server.id)}
                      <label class="checkbox-row">
                        <input
                          type="checkbox"
                          checked={gameServerIds.includes(server.id)}
                          onchange={() => toggleGameServer(server.id)}
                        />
                        <span>{server.name}</span>
                      </label>
                    {/each}
                  </div>
                {/if}

                <div class="section-divider"></div>

                <h4 class="section-subtitle">Custom Games</h4>
                <p class="toggle-desc" style="margin-bottom: 12px;">Add games that aren't automatically detected.</p>

                {#if Object.keys(customGames).length > 0}
                  <div class="custom-games-list">
                    {#each Object.entries(customGames) as [exe, name] (exe)}
                      <div class="custom-game-row">
                        <div class="custom-game-info">
                          <span class="custom-game-name">{name}</span>
                          <span class="custom-game-exe">{exe}</span>
                        </div>
                        <button class="remove-game-btn" onclick={() => removeCustomGame(exe)}>
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}

                <div class="add-game-form">
                  <input
                    type="text"
                    class="game-input"
                    placeholder="Executable (e.g. mygame.exe)"
                    bind:value={newGameExe}
                  />
                  <input
                    type="text"
                    class="game-input"
                    placeholder="Display name (e.g. My Game)"
                    bind:value={newGameName}
                  />
                  <button class="btn-accent" onclick={addCustomGame} disabled={!newGameExe.trim() || !newGameName.trim()}>
                    Add Game
                  </button>
                </div>
              {/if}
            {/if}
          </section>

        {:else if activeTab === 'desktop' && isDesktop}
          <section class="section">
            <h3 class="content-title">Desktop Settings</h3>
            
            <div class="setting-toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Open on Startup</div>
                <div class="toggle-desc">Automatically open the app when your computer starts.</div>
              </div>
              <button class="toggle-switch" class:active={autostartEnabled} aria-label="Toggle open on startup" disabled={autostartLoading} onclick={toggleAutostart}>
                <div class="toggle-knob"></div>
              </button>
            </div>

            <div class="setting-toggle-row">
              <div class="toggle-info">
                <div class="toggle-label">Minimize to Tray</div>
                <div class="toggle-desc">Closing the window will minimize it to the system tray.</div>
              </div>
              <button class="toggle-switch" class:active={closeToTray} aria-label="Toggle minimize to tray" disabled={closeToTrayLoading} onclick={toggleCloseToTray}>
                <div class="toggle-knob"></div>
              </button>
            </div>
          </section>
        {/if}
      </div>

      <div class="esc-container">
        <button class="close-modal-btn" onclick={handleClose} aria-label="Close settings">
          <Icon name="x" size={24} />
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    z-index: 1000;
    animation: overlayIn 0.3s var(--ease-out);
  }

  @keyframes overlayIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    display: flex;
    width: 100%;
    height: 100%;
    background: rgba(8, 8, 15, 0.85);
    position: relative;
    animation: modalIn 0.4s var(--ease-elastic);
  }

  @keyframes modalIn {
    from { transform: scale(1.05); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  /* Sidebar */
  .sidebar {
    flex: 0 0 240px;
    background: rgba(8, 8, 15, 0.5);
    display: flex;
    justify-content: flex-end;
    padding-top: 60px;
    z-index: 2;
    border-right: 1px solid var(--glass-border);
  }

  .sidebar-inner {
    width: 218px;
    padding: 0 12px 40px 20px;
    display: flex;
    flex-direction: column;
  }

  .sidebar-title {
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--text-dim);
    text-transform: uppercase;
    padding: 12px 10px 8px;
    letter-spacing: 0.08em;
  }

  .sidebar-item {
    padding: 10px 12px;
    margin-bottom: 2px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 600;
    text-align: left;
    transition: all 0.2s var(--ease-out);
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sidebar-item:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
    padding-left: 16px;
  }

  .sidebar-item.active {
    background: var(--accent);
    color: white;
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .sidebar-separator {
    height: 1px;
    background: var(--glass-border);
    margin: 12px 10px;
    opacity: 0.5;
  }

  .logout-nav-btn {
    margin-top: 8px;
    color: var(--danger);
  }

  .logout-nav-btn:hover {
    background: rgba(248, 113, 113, 0.1) !important;
    color: var(--danger) !important;
  }

  .sidebar-version {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--text-dim);
    padding: 20px 10px;
    margin-top: auto;
    opacity: 0.5;
  }

  /* Content Area */
  .content-area {
    flex: 1;
    background: transparent;
    display: flex;
    padding-top: 60px;
    position: relative;
    overflow: hidden;
  }

  .content-wrapper {
    flex: 1;
    max-width: 800px;
    padding: 0 40px 120px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--glass-border) transparent;
  }

  .content-title {
    font-size: 1.75rem;
    font-weight: 800;
    color: white;
    margin-bottom: 24px;
    letter-spacing: -0.02em;
  }

  .section-subtitle {
    font-size: 1.1rem;
    font-weight: 800;
    color: white;
    margin: 48px 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .section-subtitle::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--glass-border);
    opacity: 0.5;
  }

  .section-desc {
    font-size: 0.95rem;
    color: var(--text-muted);
    margin-bottom: 24px;
    line-height: 1.6;
  }

  .section-divider {
    height: 1px;
    background: var(--glass-border);
    margin: 48px 0;
    opacity: 0.5;
  }

  /* Account Card */
  .account-card {
    background: rgba(255, 255, 255, 0.03);
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 1px solid var(--glass-border);
    box-shadow: var(--shadow-lg);
    margin-bottom: 32px;
  }

  .account-banner {
    height: 120px;
    background: var(--accent);
    position: relative;
  }
.account-info-row {
  padding: 0 24px 20px;
  display: flex;
  align-items: center;
  gap: 20px;
  position: relative;
  margin-top: -40px;
}

.account-avatar-wrapper {
  padding: 6px;
  background: #0e0e1a; /* Match card bg for seamless look */
  border-radius: 50%;
  box-shadow: var(--shadow-lg);
  flex-shrink: 0;
}

.account-name-details {
  margin-top: 60px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.account-actions-right {
  margin-left: auto;
  margin-top: 60px;
}

.account-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--bg-mid);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255, 255, 255, 0.1);
}

.account-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
  .account-display-name {
    font-size: 1.4rem;
    font-weight: 800;
    color: white;
    line-height: 1.2;
  }

  .account-username {
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .edit-profile-btn {
    margin-left: auto;
    margin-bottom: 10px;
    padding: 8px 16px;
    font-size: 0.85rem;
  }

  .account-details-grid {
    background: rgba(0, 0, 0, 0.2);
    margin: 0 24px 24px;
    padding: 20px;
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 20px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .detail-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .detail-label-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .detail-label {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  .detail-value {
    font-size: 1rem;
    font-weight: 600;
    color: white;
  }

  .detail-edit-btn {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    padding: 6px 16px;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 700;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .detail-edit-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: translateY(-1px);
  }

  /* Profile Tabs */
  .profile-tabs {
    display: flex;
    gap: 24px;
    border-bottom: 1px solid var(--glass-border);
    margin-bottom: 32px;
  }

  .profile-tabs button {
    padding: 12px 4px;
    background: transparent;
    border: none;
    border-bottom: 3px solid transparent;
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }

  .profile-tabs button:hover {
    color: white;
  }

  .profile-tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  /* Form Controls */
  .form-group {
    margin-bottom: 28px;
  }

  .form-group label {
    display: block;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 10px;
    letter-spacing: 0.05em;
  }

  .text-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    padding: 12px 16px;
    color: white;
    font-size: 1rem;
    transition: all 0.2s;
    outline: none;
  }

  .text-input:focus {
    border-color: var(--accent);
    background: rgba(0, 0, 0, 0.4);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .char-count {
    font-size: 0.7rem;
    color: var(--text-dim);
    text-align: right;
    margin-top: 6px;
    font-weight: 600;
  }

  select {
    width: 100%;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    padding: 12px 16px;
    color: white;
    font-size: 1rem;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 16px center;
    outline: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  /* Buttons */
  .btn-accent {
    background: var(--accent);
    color: white;
    padding: 10px 24px;
    border-radius: var(--radius-sm);
    font-weight: 800;
    font-size: 0.95rem;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .btn-accent:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px var(--accent-glow);
  }

  .btn-accent:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .btn-subtle {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    padding: 8px 16px;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 700;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .btn-subtle:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  /* Profile Editor */
  .profile-editor {
    display: flex;
    gap: 48px;
  }

  .editor-left {
    flex: 1;
  }

  .editor-right {
    flex: 0 0 320px;
  }

  .preview-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 10px;
    letter-spacing: 0.05em;
  }

  .avatar-upload-row {
    display: flex;
    align-items: center;
    gap: 20px;
    background: rgba(255, 255, 255, 0.02);
    padding: 16px;
    border-radius: var(--radius);
    border: 1px dashed var(--glass-border);
  }

  .upload-btns {
    display: flex;
    flex-direction: column;
    gap: 8px;
    position: relative;
  }

  .avatar-menu {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius-sm);
    box-shadow: var(--glass-shadow);
  }

  .avatar-menu button {
    padding: 8px 14px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }

  .avatar-menu button:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
  }

  .avatar-menu .btn-danger-text {
    color: var(--danger);
  }

  .avatar-menu .btn-danger-text:hover {
    background: rgba(248, 113, 113, 0.1);
    color: var(--danger);
  }

  .avatar-preview-small {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: var(--bg-mid);
    position: relative;
    cursor: pointer;
    overflow: hidden;
    box-shadow: var(--shadow);
    flex-shrink: 0;
    border: 2px solid rgba(255, 255, 255, 0.1);
  }

  .avatar-preview-small img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-initial {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    font-weight: 800;
    color: var(--accent);
    background: var(--bg-light);
  }

  .preview-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .avatar-preview-small:hover .preview-overlay {
    opacity: 1;
  }

  .banner-upload-row {
    display: flex;
    align-items: center;
    gap: 20px;
    position: relative;
  }

  .banner-preview-small {
    width: 160px;
    height: 60px;
    border-radius: var(--radius-sm);
    background: var(--bg-mid);
    position: relative;
    cursor: pointer;
    overflow: hidden;
    box-shadow: var(--shadow);
    flex-shrink: 0;
    border: 2px solid rgba(255, 255, 255, 0.1);
  }

  .banner-preview-small img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .banner-preview-small:hover .preview-overlay {
    opacity: 1;
  }

  .banner-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    color: var(--text-dim);
    text-align: center;
    padding: 8px;
    font-weight: 600;
  }

  .banner-popover {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
    z-index: 100;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 180px;
    background: rgba(12, 12, 22, 0.95);
    backdrop-filter: blur(24px);
    border: 1px solid var(--glass-border-bright);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    border-radius: var(--radius-sm);
  }

  .banner-popover button {
    background: transparent;
    border: none;
    color: white;
    padding: 10px 12px;
    text-align: left;
    font-weight: 700;
    font-size: 0.9rem;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .banner-popover button:hover {
    background: var(--accent);
  }

  /* Profile Preview Card Override */
  .profile-preview-card {
    background: #08080f;
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    border: 1px solid var(--glass-border-bright);
  }

  .preview-banner {
    height: 100px;
    background: var(--accent);
  }

  .preview-avatar {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: var(--bg-mid);
    margin: -40px 0 0 16px;
    border: 6px solid #08080f;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 2;
  }

  .preview-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .preview-content {
    padding: 16px;
    background: rgba(255,255,255,0.03);
    margin: 12px;
    border-radius: var(--radius);
    border: 1px solid rgba(255,255,255,0.03);
  }

  .preview-display-name {
    font-size: 1.1rem;
    font-weight: 800;
    color: white;
  }

  .preview-username {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .preview-divider {
    height: 1px;
    background: var(--glass-border);
    margin: 12px 0;
    opacity: 0.5;
  }

  .preview-bio-label {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 6px;
    letter-spacing: 0.05em;
  }

  .preview-bio {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* Color type tabs */
  .color-type-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .color-type-tabs button {
    flex: 1;
    padding: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }

  .color-type-tabs button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .gradient-inputs, .color-input-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .color-input-row input[type="color"], .gradient-inputs input[type="color"] {
    width: 38px;
    height: 38px;
    padding: 0;
    border: 2px solid var(--glass-border-bright);
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    overflow: hidden;
    transition: all 0.3s var(--ease-elastic);
    flex-shrink: 0;
  }

  .color-input-row input[type="color"]::-webkit-color-swatch-wrapper,
  .gradient-inputs input[type="color"]::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-input-row input[type="color"]::-webkit-color-swatch,
  .gradient-inputs input[type="color"]::-webkit-color-swatch {
    border: none;
    border-radius: 50%;
  }

  .color-input-row input[type="color"]:hover, .gradient-inputs input[type="color"]:hover {
    transform: scale(1.15);
    border-color: white;
    box-shadow: 0 0 15px rgba(255, 255, 255, 0.2);
  }

  .color-input-row .text-input {
    width: 120px;
  }

  /* Voice/Video Overhaul */
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .input-mode-selector {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
  }

  .mode-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius);
    color: var(--text-muted);
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }

  .mode-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: white;
  }

  .mode-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    box-shadow: 0 4px 15px var(--accent-glow);
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 16px;
    background: rgba(0, 0, 0, 0.2);
    padding: 12px 16px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
  }

  .slider-label {
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--text-dim);
    text-transform: uppercase;
  }

  .slider {
    flex: 1;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    appearance: none;
    outline: none;
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    border: 2px solid var(--accent);
    transition: transform 0.2s;
  }

  .slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }

  .btn-capture {
    width: 100%;
    padding: 14px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    color: white;
    font-weight: 800;
    font-size: 1rem;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-capture.capturing {
    border-color: var(--danger);
    background: rgba(248, 113, 113, 0.1);
    color: var(--danger);
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.6; }
    100% { opacity: 1; }
  }

  /* Toggle Switches Overhaul */
  .setting-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 16px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: var(--radius);
    border: 1px solid transparent;
    transition: all 0.2s;
  }

  .setting-toggle-row:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--glass-border);
  }

  .toggle-info {
    flex: 1;
  }

  .toggle-label {
    font-size: 1.05rem;
    font-weight: 700;
    color: white;
  }

  .toggle-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-top: 4px;
    line-height: 1.4;
  }

  .toggle-switch {
    width: 44px;
    height: 24px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    position: relative;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    flex-shrink: 0;
    border: none;
    cursor: pointer;
  }

  .toggle-switch.active {
    background: var(--success);
    box-shadow: 0 0 12px rgba(52, 211, 153, 0.3);
  }

  .toggle-knob {
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 3px;
    left: 3px;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  }

  .toggle-switch.active .toggle-knob {
    transform: translateX(20px);
  }

  .toggle-subset {
    margin-top: 8px;
    padding-left: 24px;
    border-left: 2px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .toggle-subset.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  /* Theme Picker Overhaul */
  .theme-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 20px;
  }

  .theme-card {
    background: rgba(255, 255, 255, 0.02);
    border: 2px solid var(--glass-border);
    border-radius: var(--radius);
    padding: 16px;
    text-align: left;
    transition: all 0.2s var(--ease-out);
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }

  .theme-card:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.2);
    transform: translateY(-2px);
  }

  .theme-card.active {
    border-color: var(--accent);
    background: rgba(124, 92, 252, 0.05);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  .theme-preview-box {
    height: 100px;
    border-radius: var(--radius-sm);
    margin-bottom: 16px;
    display: flex;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: var(--shadow);
  }

  /* Theme Previews specific colors */
  .theme-preview-box:not(.theme-dark):not(.theme-light) { background: #0e0e1a; }
  .theme-preview-box:not(.theme-dark):not(.theme-light) .preview-sidebar { background: #0c0c16; }
  .theme-preview-box:not(.theme-dark):not(.theme-light) .preview-bubble { background: #1e1e32; }
  .theme-preview-box:not(.theme-dark):not(.theme-light) .preview-bubble-short { background: #1e1e32; }

  .theme-preview-box.theme-dark { background: #0d0d0d; }
  .theme-preview-box.theme-dark .preview-sidebar { background: #050505; }
  .theme-preview-box.theme-dark .preview-bubble { background: #212121; }
  .theme-preview-box.theme-dark .preview-bubble-short { background: #212121; }

  .theme-preview-box.theme-light { background: #ffffff; }
  .theme-preview-box.theme-light .preview-sidebar { background: #f2f3f5; border-right: 1px solid #e3e5e8; }
  .theme-preview-box.theme-light .preview-bubble { background: #e3e5e8; }
  .theme-preview-box.theme-light .preview-bubble-short { background: #e3e5e8; }

  .preview-sidebar { width: 30%; height: 100%; }
  .preview-chat { flex: 1; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .preview-bubble { height: 10px; border-radius: 5px; width: 85%; }
  .preview-bubble-short { height: 10px; border-radius: 5px; width: 55%; }

  .theme-info {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 1rem;
    font-weight: 800;
    color: white;
  }

  .theme-radio {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--text-dim);
    position: relative;
    transition: all 0.2s;
  }

  .theme-card.active .theme-radio {
    border-color: var(--accent);
    background: var(--accent);
  }

  .theme-card.active .theme-radio::after {
    content: '';
    position: absolute;
    inset: 4px;
    background: white;
    border-radius: 50%;
  }

  /* Close Button Overhaul */
  .esc-container {
    position: absolute;
    top: 60px;
    right: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    z-index: 10;
  }

  .close-modal-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.3s var(--ease-elastic);
  }

  .close-modal-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: white;
    color: white;
    transform: rotate(90deg) scale(1.1);
  }

  .esc-hint {
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  /* Sticky Footer Overhaul */
  .sticky-footer {
    position: fixed;
    bottom: 32px;
    left: calc(240px + (100% - 240px) / 2);
    transform: translateX(-50%) translateY(120px);
    width: min(740px, calc(100% - 320px));
    background: rgba(12, 12, 22, 0.9);
    backdrop-filter: blur(32px);
    -webkit-backdrop-filter: blur(32px);
    padding: 12px 24px;
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: space-between;
    z-index: 1100;
    border: 1px solid var(--glass-border-bright);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    opacity: 0;
    transition: all 0.4s var(--ease-elastic);
    pointer-events: none;
  }

  .sticky-footer.visible {
    transform: translateX(-50%) translateY(0);
    opacity: 1;
    pointer-events: auto;
  }

  .footer-hint {
    font-weight: 700;
    color: white;
    font-size: 0.95rem;
  }

  .footer-btns {
    display: flex;
    gap: 16px;
  }

  .btn-text {
    background: transparent;
    border: none;
    color: white;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .btn-text:hover {
    opacity: 0.7;
    text-decoration: underline;
  }

  .btn-success {
    background: var(--success);
    color: white;
    padding: 10px 24px;
    border-radius: var(--radius-sm);
    font-weight: 800;
    font-size: 0.95rem;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(52, 211, 153, 0.2);
    transition: all 0.2s;
  }

  .btn-success:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(52, 211, 153, 0.3);
  }

  /* Status Messages */
  .status-msg {
    padding: 14px 16px;
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    margin-bottom: 24px;
    font-weight: 700;
    border: 1px solid transparent;
  }

  .status-msg.error {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.2);
    color: var(--danger);
  }

  .status-msg.success {
    background: rgba(52, 211, 153, 0.1);
    border-color: rgba(52, 211, 153, 0.2);
    color: var(--success);
  }

  /* MFA Settings Overhaul */
  .mfa-status-card {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 24px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius);
    margin-bottom: 32px;
    position: relative;
    overflow: hidden;
  }

  .mfa-status-card.enabled {
    border-color: rgba(52, 211, 153, 0.3);
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.02) 0%, rgba(52, 211, 153, 0.05) 100%);
  }

  .mfa-status-icon {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .mfa-status-card.enabled .mfa-status-icon {
    background: var(--success);
    color: white;
    box-shadow: 0 0 20px rgba(52, 211, 153, 0.3);
  }

  .mfa-status-info {
    flex: 1;
  }

  .mfa-status-title {
    font-size: 1.15rem;
    color: white;
    margin-bottom: 6px;
    font-weight: 600;
  }

  .mfa-status-desc {
    font-size: 0.9rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .mfa-status-badge {
    padding: 6px 14px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .mfa-status-card.enabled .mfa-status-badge {
    background: rgba(52, 211, 153, 0.2);
    color: var(--success);
  }

  .setup-steps {
    display: flex;
    flex-direction: column;
    gap: 40px;
  }

  .setup-step {
    display: flex;
    gap: 24px;
  }

  .step-number {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    flex-shrink: 0;
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .step-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .step-content p {
    font-size: 1rem;
    color: white;
    line-height: 1.6;
    margin: 0;
  }

  .qr-container {
    padding: 16px;
    background: white;
    border-radius: var(--radius);
    width: fit-content;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  }

  .qr-container img {
    display: block;
    width: 180px;
    height: 180px;
  }

  .secret-display {
    display: flex;
    align-items: center;
    gap: 16px;
    background: rgba(0, 0, 0, 0.3);
    padding: 14px 20px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
    width: fit-content;
  }

  .secret-display code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 1.15rem;
    color: var(--success);
    letter-spacing: 0.1em;
    font-weight: 700;
  }

  .btn-copy-tiny {
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-copy-tiny:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .email-edit-row, .email-verify-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
    width: 100%;
  }

  .email-edit-row .text-input, .email-verify-row .text-input {
    flex: 1;
    padding: 8px 12px;
    font-size: 0.95rem;
  }

  .mfa-verify-row, .mfa-action-row {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .mfa-code-input {
    width: 160px;
    text-align: center;
    font-size: 1.4rem;
    font-weight: 800;
    letter-spacing: 0.3em;
    font-family: 'JetBrains Mono', monospace;
  }

  .mfa-enable-promo {
    background: rgba(255, 255, 255, 0.02);
    padding: 32px;
    border-radius: var(--radius);
    border: 1px solid var(--glass-border);
    text-align: center;
  }

  .mfa-enable-promo .section-subtitle {
    margin-top: 0;
    justify-content: center;
  }

  .mfa-enable-promo .section-subtitle::after {
    display: none;
  }

  .btn-danger {
    background: var(--danger);
    color: white;
    padding: 12px 28px;
    border-radius: var(--radius-sm);
    font-weight: 800;
    font-size: 1rem;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(248, 113, 113, 0.2);
  }

  .btn-danger:hover:not(:disabled) {
    background: #dc2626;
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(248, 113, 113, 0.3);
  }

  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Responsive refinements */
  @media (max-width: 1100px) {
    .profile-editor {
      flex-direction: column;
      gap: 32px;
    }
    .editor-right {
      flex: none;
      width: 100%;
      max-width: 340px;
    }
  }

  @media (max-width: 768px) {
    .sidebar { display: none; }
    .content-area { padding-top: 20px; }
    .content-wrapper { padding: 0 16px 40px; }
    .profile-editor { flex-direction: column; }
    .editor-right { display: none; }
    .esc-container { top: 20px; right: 16px; }
    .sticky-footer { 
      width: calc(100% - 32px); 
      left: 50%; 
      bottom: 16px;
      padding: 12px 16px;
    }
    .footer-hint { font-size: 0.85rem; }
    .footer-btns { gap: 10px; }
    .btn-success { padding: 8px 16px; font-size: 0.85rem; }
    .form-grid { grid-template-columns: 1fr; }
  }

  /* Video Preview */
  .video-preview-container {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: flex-start;
  }

  .video-preview-box {
    width: 100%;
    max-width: 480px;
    aspect-ratio: 16 / 9;
    background: #05050a;
    border-radius: var(--radius);
    border: 1px solid var(--glass-border);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    box-shadow: var(--shadow-lg);
  }

  .preview-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .preview-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--text-dim);
  }

  .preview-placeholder span {
    font-size: 0.9rem;
    font-weight: 600;
  }

  /* Game Activity */
  .server-checkboxes {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
    padding: 12px;
    background: var(--bg-mid);
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
    color: var(--text-muted);
    cursor: pointer;
  }

  .custom-games-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }

  .custom-game-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--bg-mid);
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
  }

  .custom-game-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .custom-game-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: white;
  }

  .custom-game-exe {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .remove-game-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: transparent;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: all 0.15s;
  }

  .remove-game-btn:hover {
    background: var(--danger);
    color: white;
  }

  .add-game-form {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .game-input {
    flex: 1;
    padding: 8px 12px;
    background: var(--bg-mid);
    color: var(--text);
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
    font-size: 0.85rem;
    outline: none;
    transition: border-color 150ms;
  }

  .game-input:focus {
    border-color: var(--accent);
  }
</style>
