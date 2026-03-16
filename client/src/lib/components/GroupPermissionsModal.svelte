<script lang="ts">
  import { api } from '$lib/api';
  import { channelGroups } from '$lib/stores/channels';
  import { getActiveServerId } from '$lib/stores/servers';
  import { roles } from '$lib/stores/permissions';
  import { toast } from '$lib/stores/toast';
  import { allUsers as usersStore, fetchUsers } from '$lib/stores/users';
  import type { GroupPermissionOverride, ChannelOverridablePermission, User } from '@voip-server/shared';
  import TriStateToggle from './TriStateToggle.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let { groupId, onclose }: { groupId: string; onclose: () => void } = $props();

  const PERM_CATEGORIES: {
    label: string;
    perms: { key: ChannelOverridablePermission; label: string; icon: string }[];
  }[] = [
    {
      label: 'General Permissions',
      perms: [
        { key: 'view_channel', label: 'View Channel', icon: 'hash' },
        { key: 'manage_messages', label: 'Manage Messages', icon: 'message-square' },
        { key: 'pin_messages', label: 'Pin Messages', icon: 'star' },
      ],
    },
    {
      label: 'Text Permissions',
      perms: [
        { key: 'send_messages', label: 'Send Messages', icon: 'message-square' },
        { key: 'upload_files', label: 'Upload Files', icon: 'plus' },
        { key: 'add_reactions', label: 'Add Reactions', icon: 'star' },
        { key: 'use_custom_emoji', label: 'Use Custom Emoji', icon: 'palette' },
      ],
    },
    {
      label: 'Voice Permissions',
      perms: [
        { key: 'connect_voice', label: 'Connect Voice', icon: 'volume' },
        { key: 'speak', label: 'Speak', icon: 'mic' },
        { key: 'share_screen', label: 'Share Screen', icon: 'monitor' },
      ],
    },
  ];

  const PERM_LABELS = PERM_CATEGORIES.flatMap((c) => c.perms);

  const EVERYONE_ID = '__everyone__';

  let overrides = $state<GroupPermissionOverride[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let selectedTarget: { type: 'role' | 'user'; id: string } | null = $state(null);
  let editedPerms = $state<Record<string, boolean | null>>({});
  let showAddMenu = $state(false);
  let addMenuType = $state<'role' | 'user'>('role');

  const group = $derived($channelGroups.find((g) => g.id === groupId));
  const groupName = $derived(group?.name ?? 'group');
  const permissionsEnabled = $derived(group?.permissions_enabled ?? false);
  let togglingPermissions = $state(false);

  const isEveryone = $derived(
    selectedTarget?.type === 'role' && selectedTarget?.id === EVERYONE_ID,
  );
  const hasEveryoneOverrides = $derived(overrides.some((o) => o.target_type === 'role'));

  async function togglePermissionsEnabled() {
    const newValue = !permissionsEnabled;
    togglingPermissions = true;
    try {
      const serverId = getActiveServerId();
      await api.patch(`/api/servers/${serverId}/channel-groups/${groupId}`, { permissions_enabled: newValue });
      channelGroups.update((list) =>
        list.map((g) => (g.id === groupId ? { ...g, permissions_enabled: newValue } : g)),
      );
      if (newValue) {
        await loadData();
      }
    } catch (err: any) {
      toast.error('Failed to update: ' + err.message);
    } finally {
      togglingPermissions = false;
    }
  }

  // Selected override data
  const selectedOverride = $derived(
    selectedTarget
      ? isEveryone
        ? null
        : overrides.find(
            (o) => o.target_type === selectedTarget!.type && o.target_id === selectedTarget!.id,
          )
      : null,
  );

  // Get display info for a target
  function getTargetName(targetType: string, targetId: string): string {
    if (targetId === EVERYONE_ID) return '@everyone';
    if (targetType === 'role') {
      const role = $roles.find((r) => r.id === targetId);
      if (!role) return '@Unknown Role';
      return `@${role.name}`;
    }
    const user = $usersStore.find((u) => u.id === targetId);
    return user ? user.display_name || user.username : 'Unknown User';
  }

  function getTargetColor(targetType: string, targetId: string): string {
    if (targetId === EVERYONE_ID) return 'var(--text-muted)';
    if (targetType === 'role') {
      const role = $roles.find((r) => r.id === targetId);
      return role?.color ?? 'var(--text-muted)';
    }
    return 'var(--text)';
  }

  function getTargetUser(targetId: string): User | undefined {
    return $usersStore.find((u) => u.id === targetId);
  }

  // Roles/users not yet in overrides
  const availableRoles = $derived(
    $roles.filter((r) => !overrides.some((o) => o.target_type === 'role' && o.target_id === r.id)),
  );
  const availableUsers = $derived(
    $usersStore.filter(
      (u) => !overrides.some((o) => o.target_type === 'user' && o.target_id === u.id),
    ),
  );

  async function loadData() {
    loading = true;
    try {
      const serverId = getActiveServerId();
      const [overrideData] = await Promise.all([
        api.get<GroupPermissionOverride[]>(`/api/servers/${serverId}/channel-groups/${groupId}/permissions`),
        fetchUsers(),
      ]);
      overrides = overrideData;
    } catch (err: any) {
      toast.error('Failed to load permissions: ' + err.message);
    } finally {
      loading = false;
    }
  }

  function selectTarget(type: 'role' | 'user', id: string) {
    selectedTarget = { type, id };
    if (id === EVERYONE_ID) {
      const roleOverrides = overrides.filter((o) => o.target_type === 'role');
      const perms: Record<string, boolean | null> = {};
      for (const p of PERM_LABELS) {
        if (roleOverrides.length === 0) {
          perms[p.key] = null;
        } else {
          const first = roleOverrides[0][p.key];
          const allSame = roleOverrides.every((o) => o[p.key] === first);
          perms[p.key] = allSame ? first : null;
        }
      }
      editedPerms = perms;
      return;
    }
    const override = overrides.find((o) => o.target_type === type && o.target_id === id);
    if (override) {
      const perms: Record<string, boolean | null> = {};
      for (const p of PERM_LABELS) {
        perms[p.key] = override[p.key];
      }
      editedPerms = perms;
    } else {
      const perms: Record<string, boolean | null> = {};
      for (const p of PERM_LABELS) {
        perms[p.key] = null;
      }
      editedPerms = perms;
    }
  }

  async function saveOverride() {
    if (!selectedTarget) return;
    saving = true;
    try {
      const serverId = getActiveServerId();
      if (isEveryone) {
        for (const role of $roles) {
          await api.put(`/api/servers/${serverId}/channel-groups/${groupId}/permissions`, {
            target_type: 'role',
            target_id: role.id,
            permissions: editedPerms,
          });
        }
      } else {
        await api.put(`/api/servers/${serverId}/channel-groups/${groupId}/permissions`, {
          target_type: selectedTarget.type,
          target_id: selectedTarget.id,
          permissions: editedPerms,
        });
      }
      overrides = await api.get<GroupPermissionOverride[]>(
        `/api/servers/${serverId}/channel-groups/${groupId}/permissions`,
      );
      toast.success('Permissions saved');
    } catch (err: any) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      saving = false;
    }
  }

  async function deleteOverride() {
    if (!selectedTarget) return;
    saving = true;
    try {
      const serverId = getActiveServerId();
      if (isEveryone) {
        const roleOverrides = overrides.filter((o) => o.target_type === 'role');
        for (const o of roleOverrides) {
          await api.delete(`/api/servers/${serverId}/channel-groups/${groupId}/permissions/role/${o.target_id}`);
        }
      } else {
        await api.delete(
          `/api/servers/${serverId}/channel-groups/${groupId}/permissions/${selectedTarget.type}/${selectedTarget.id}`,
        );
      }
      overrides = await api.get<GroupPermissionOverride[]>(
        `/api/servers/${serverId}/channel-groups/${groupId}/permissions`,
      );
      selectedTarget = null;
      editedPerms = {};
      toast.success('Override removed');
    } catch (err: any) {
      toast.error('Failed to delete: ' + err.message);
    } finally {
      saving = false;
    }
  }

  function addTarget(type: 'role' | 'user', id: string) {
    showAddMenu = false;
    const newOverride: GroupPermissionOverride = {
      id: '',
      group_id: groupId,
      target_type: type,
      target_id: id,
      view_channel: null,
      send_messages: null,
      upload_files: null,
      add_reactions: null,
      use_custom_emoji: null,
      manage_messages: null,
      pin_messages: null,
      connect_voice: null,
      speak: null,
      share_screen: null,
    };
    overrides = [...overrides, newOverride];
    selectTarget(type, id);
  }

  $effect(() => {
    if (permissionsEnabled) {
      loadData();
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <div class="header-info">
        <Icon name="hash" size={20} class="header-icon" />
        <h3>Group Permissions: {groupName}</h3>
      </div>
      <button class="close-btn" onclick={onclose}>
        <Icon name="x" size={20} />
      </button>
    </div>

    <div class="permissions-toggle-card">
      <div class="toggle-main">
        <div class="toggle-info">
          <h4>Group Sync Permissions</h4>
          <p>When enabled, all channels in this group will inherit these permissions unless individually overridden.</p>
        </div>
        <button 
          class="toggle-switch" 
          class:active={permissionsEnabled} 
          class:disabled={togglingPermissions}
          onclick={togglePermissionsEnabled}
          aria-label="Toggle group permissions"
        >
          <div class="toggle-knob"></div>
        </button>
      </div>
    </div>

    {#if loading && permissionsEnabled}
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading permissions...</span>
      </div>
    {:else if !permissionsEnabled}
      <div class="disabled-state">
        <div class="disabled-icon">
          <Icon name="shield-check" size={64} />
        </div>
        <h3>Permissions Sync Disabled</h3>
        <p>Enable group permissions above to configure overrides that apply to all channels in this category.</p>
        <button class="enable-btn" onclick={togglePermissionsEnabled} disabled={togglingPermissions}>
          Enable Group Permissions
        </button>
      </div>
    {:else}
      <div class="content">
        <!-- Left panel: targets list -->
        <div class="targets-panel">
          <div class="panel-label">ROLES / USERS</div>
          <button
            class="target-item everyone-item"
            class:selected={isEveryone}
            onclick={() => selectTarget('role', EVERYONE_ID)}
          >
            <div class="target-avatar-mini everyone">
              <Icon name="users" size={12} />
            </div>
            <span class="target-name">@everyone</span>
          </button>
          <div class="targets-scroll">
            {#each overrides as override (override.target_type + '-' + override.target_id)}
              <button
                class="target-item"
                class:selected={selectedTarget?.type === override.target_type &&
                  selectedTarget?.id === override.target_id}
                onclick={() => selectTarget(override.target_type, override.target_id)}
              >
                {#if override.target_type === 'role'}
                  <div class="target-avatar-mini" style="background: {getTargetColor(override.target_type, override.target_id)}20">
                    <div class="role-dot-mini" style="background: {getTargetColor(override.target_type, override.target_id)}"></div>
                  </div>
                {:else}
                  <Avatar user={getTargetUser(override.target_id)} size={20} />
                {/if}
                <span
                  class="target-name"
                  style="color: {getTargetColor(override.target_type, override.target_id)}"
                >
                  {getTargetName(override.target_type, override.target_id)}
                </span>
                <span class="target-type-badge">{override.target_type === 'role' ? 'role' : 'user'}</span>
              </button>
            {/each}
          </div>

          <div class="add-section">
            <button class="add-btn" onclick={() => (showAddMenu = !showAddMenu)}>
              <Icon name="plus" size={14} />
              <span>Add Role or User</span>
            </button>
            {#if showAddMenu}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="add-menu-overlay" onclick={() => (showAddMenu = false)}></div>
              <div class="add-menu">
                <div class="add-menu-tabs">
                  <button
                    class:active={addMenuType === 'role'}
                    onclick={() => (addMenuType = 'role')}>Roles</button
                  >
                  <button
                    class:active={addMenuType === 'user'}
                    onclick={() => (addMenuType = 'user')}>Users</button
                  >
                </div>
                <div class="add-menu-list scrollable">
                  {#if addMenuType === 'role'}
                    {#each availableRoles as role (role.id)}
                      <button class="add-menu-item" onclick={() => addTarget('role', role.id)}>
                        <div class="role-dot-mini" style="background: {role.color}"></div>
                        <span style="color: {role.color}">@{role.name}</span>
                      </button>
                    {:else}
                      <div class="add-menu-empty">No more roles</div>
                    {/each}
                  {:else}
                    {#each availableUsers as user (user.id)}
                      <button class="add-menu-item" onclick={() => addTarget('user', user.id)}>
                        <Avatar {user} size={20} />
                        <span>{user.display_name || user.username}</span>
                      </button>
                    {:else}
                      <div class="add-menu-empty">No more users</div>
                    {/each}
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- Right panel: permission toggles -->
        <div class="perms-panel">
          {#if selectedTarget}
            <div class="perms-header-label">
              <span class="label-text">PERMISSIONS FOR</span>
              <span class="target-display" style="color: {getTargetColor(selectedTarget.type, selectedTarget.id)}">
                {getTargetName(selectedTarget.type, selectedTarget.id)}
              </span>
            </div>
            
            <div class="perms-scroll scrollable">
              {#each PERM_CATEGORIES as category}
                <div class="perm-category">
                  <div class="category-header">{category.label}</div>
                  {#each category.perms as perm (perm.key)}
                    {@const val = editedPerms[perm.key]}
                    <div class="perm-row">
                      <div class="perm-info">
                        <Icon name={perm.icon} size={16} class="perm-icon" />
                        <span class="perm-label">{perm.label}</span>
                      </div>
                      <TriStateToggle
                        value={val}
                        onchange={(newVal) => {
                          editedPerms[perm.key] = newVal;
                          editedPerms = { ...editedPerms };
                        }}
                      />
                    </div>
                  {/each}
                </div>
              {/each}
            </div>

            <div class="perm-actions">
              <button
                class="delete-override-btn"
                onclick={deleteOverride}
                disabled={saving ||
                  (!selectedOverride && !isEveryone) ||
                  (isEveryone && !hasEveryoneOverrides)}
              >
                <Icon name="x" size={14} />
                <span>{isEveryone ? 'Remove All Overrides' : 'Remove Override'}</span>
              </button>
              <button class="save-btn" onclick={saveOverride} disabled={saving}>
                <Icon name="shield-check" size={16} />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          {:else}
            <div class="no-selection">
              <div class="no-selection-icon">
                <Icon name="shield-check" size={48} />
              </div>
              <h3>Manage Category Overrides</h3>
              <p>Select a role or user on the left to configure permissions that apply to all channels in this group.</p>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: overlayIn 200ms var(--ease-out);
  }

  .modal {
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    width: 720px;
    height: 640px;
    max-height: 90vh;
    box-shadow: var(--shadow-xl);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: modalIn 200ms var(--ease-out);
  }

  @keyframes overlayIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.95) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: var(--bg-darker);
    border-bottom: 1px solid var(--border);
  }

  .header-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-icon {
    color: var(--text-dim);
  }

  .modal-header h3 {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0;
    color: var(--text);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 150ms;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
    transform: rotate(90deg);
  }

  .permissions-toggle-card {
    padding: 16px 24px;
    background: var(--bg-darker);
    border-bottom: 1px solid var(--border);
  }

  .toggle-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    background: var(--bg-darkest);
    padding: 12px 16px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
  }

  .toggle-info h4 {
    margin: 0 0 4px;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
  }

  .toggle-info p {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-dim);
    line-height: 1.4;
  }

  .toggle-switch {
    width: 44px;
    height: 24px;
    background: var(--bg-mid);
    border-radius: 12px;
    position: relative;
    transition: background 0.2s;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  .toggle-switch.active {
    background: var(--accent);
  }

  .toggle-switch.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-knob {
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 3px;
    left: 3px;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .toggle-switch.active .toggle-knob {
    transform: translateX(20px);
  }

  .loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--text-dim);
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .disabled-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px;
    text-align: center;
    color: var(--text-dim);
  }

  .disabled-icon {
    margin-bottom: 24px;
    opacity: 0.15;
    color: var(--text-dim);
  }

  .disabled-state h3 {
    font-size: 1.25rem;
    color: var(--text);
    margin-bottom: 12px;
  }

  .disabled-state p {
    max-width: 360px;
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 24px;
  }

  .enable-btn {
    padding: 10px 24px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius);
    font-weight: 700;
    cursor: pointer;
    transition: all 150ms;
  }

  .enable-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  .content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .targets-panel {
    width: 240px;
    background: var(--bg-darker);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 16px 8px;
  }

  .panel-label {
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    margin-bottom: 12px;
    padding: 0 8px;
    text-transform: uppercase;
  }

  .targets-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 8px;
  }

  .scrollable {
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .target-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    width: 100%;
    text-align: left;
    transition: all 150ms;
  }

  .target-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .target-item.selected {
    background: var(--bg-active);
    color: var(--text);
  }

  .everyone-item {
    margin-bottom: 8px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
  }

  .target-avatar-mini {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .target-avatar-mini.everyone {
    background: var(--bg-mid);
    color: var(--text-dim);
  }

  .role-dot-mini {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .target-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .target-type-badge {
    font-size: 0.65rem;
    color: var(--text-dim);
    text-transform: uppercase;
    background: var(--bg-mid);
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 700;
  }

  .add-section {
    padding: 8px;
    position: relative;
  }

  .add-btn {
    width: 100%;
    padding: 10px;
    background: var(--bg-darkest);
    color: var(--text-dim);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 150ms;
  }

  .add-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
    border-style: solid;
    border-color: var(--text-dim);
  }

  .add-menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
  }

  .add-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 8px;
    right: 8px;
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 11;
    display: flex;
    flex-direction: column;
    max-height: 300px;
    animation: menuIn 150ms var(--ease-out);
  }

  @keyframes menuIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .add-menu-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
  }

  .add-menu-tabs button {
    flex: 1;
    padding: 10px;
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 2px solid transparent;
  }

  .add-menu-tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.05);
  }

  .add-menu-list {
    padding: 4px;
    max-height: 240px;
  }

  .add-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.9rem;
    text-align: left;
    border-radius: var(--radius-sm);
  }

  .add-menu-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .add-menu-empty {
    padding: 24px;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.85rem;
  }

  .perms-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-dark);
  }

  .perms-header-label {
    padding: 24px 32px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label-text {
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .target-display {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .perms-scroll {
    flex: 1;
    padding: 24px 32px;
  }

  .perm-category {
    margin-bottom: 32px;
  }

  .category-header {
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .category-header::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
    opacity: 0.5;
  }

  .perm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }

  .perm-row:last-child {
    border-bottom: none;
  }

  .perm-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .perm-icon {
    color: var(--text-dim);
  }

  .perm-label {
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text);
  }

  .perm-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 32px;
    background: var(--bg-darker);
    border-top: 1px solid var(--border);
  }

  .delete-override-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: transparent;
    color: var(--danger);
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    transition: all 150ms;
  }

  .delete-override-btn:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.1);
    border-color: var(--danger);
  }

  .delete-override-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .save-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 24px;
    background: var(--accent);
    color: white;
    font-weight: 700;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 0.9rem;
    box-shadow: 0 4px 12px rgba(var(--accent-rgb), 0.3);
    transition: all 150ms;
  }

  .save-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(var(--accent-rgb), 0.4);
  }

  .save-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    box-shadow: none;
  }

  .no-selection {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px;
    text-align: center;
    color: var(--text-dim);
  }

  .no-selection-icon {
    margin-bottom: 24px;
    opacity: 0.2;
  }

  .no-selection h3 {
    font-size: 1.25rem;
    color: var(--text);
    margin-bottom: 12px;
  }

  .no-selection p {
    max-width: 320px;
    font-size: 0.95rem;
    line-height: 1.5;
  }

  @media (max-width: 768px) {
    .modal {
      width: 100vw;
      height: 100vh;
      max-height: 100vh;
      border-radius: 0;
    }

    .targets-panel {
      width: 60px;
      padding: 16px 4px;
    }

    .target-name, .target-type-badge, .panel-label, .add-btn span {
      display: none;
    }

    .add-btn {
      padding: 10px 0;
    }
  }
</style>
