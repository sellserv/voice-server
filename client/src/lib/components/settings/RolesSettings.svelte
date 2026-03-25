<script lang="ts">
  import { roles, loadRoles } from '$lib/stores/permissions';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { api } from '$lib/api';
  import { confirm, toast } from '$lib/stores/toast';
  import type { RolePermissions, RoleRecord } from '@voip-server/shared';
  import { getActiveServerId } from '$lib/stores/servers';
  import Icon from '../Icon.svelte';

  let editingRole = $state<RoleRecord | null>(null);
  let newRoleName = $state('');
  let newRoleColor = $state('#99aab5');
  let creatingRole = $state(false);
  let savingRole = $state(false);
  let draggingRoleId = $state<string | null>(null);
  let dragOverRoleId = $state<string | null>(null);

  const canManageRoles = hasPermissionStore('manage_roles');

  const PERMISSION_LABELS: { key: keyof RolePermissions; label: string; description: string; section: string }[] = [
    { key: 'administrator', label: 'Administrator', description: 'Gives full access to all permissions and bypasses channel overrides. Dangerous.', section: 'General' },
    { key: 'manage_server', label: 'Manage Server', description: 'Allows changing server name, icon, and general settings.', section: 'General' },
    { key: 'create_invites', label: 'Create Invites', description: 'Allows members to invite new members to the server.', section: 'General' },
    { key: 'manage_roles', label: 'Manage Roles', description: 'Allows creating, editing, and deleting roles below this one.', section: 'General' },
    { key: 'manage_channels_groups', label: 'Manage Channels & Groups', description: 'Allows creating, editing, and reordering channels and categories.', section: 'General' },
    { key: 'view_audit_log', label: 'View Audit Log', description: 'Allows viewing records of server administrative actions.', section: 'General' },
    
    { key: 'kick_members', label: 'Kick Members', description: 'Allows removing members from the server. They can rejoin with an invite.', section: 'Moderation' },
    { key: 'ban_members', label: 'Ban Members', description: 'Allows permanently removing members from the server.', section: 'Moderation' },
    { key: 'manage_messages', label: 'Manage Messages', description: 'Allows deleting messages sent by other members.', section: 'Moderation' },
    { key: 'pin_messages', label: 'Pin Messages', description: 'Allows pinning messages in channels.', section: 'Moderation' },
    
    { key: 'send_messages', label: 'Send Messages', description: 'Allows sending text messages in channels.', section: 'Text' },
    { key: 'upload_files', label: 'Upload Files', description: 'Allows uploading files and media.', section: 'Text' },
    { key: 'add_reactions', label: 'Add Reactions', description: 'Allows adding new emoji reactions to messages.', section: 'Text' },
    { key: 'use_custom_emoji', label: 'Use Custom Emoji', description: 'Allows using emojis uploaded to this server.', section: 'Text' },
    
    { key: 'connect_voice', label: 'Connect', description: 'Allows joining voice channels.', section: 'Voice' },
    { key: 'speak', label: 'Speak', description: 'Allows talking in voice channels.', section: 'Voice' },
    { key: 'share_screen', label: 'Video', description: 'Allows sharing screen or camera in voice channels.', section: 'Voice' },
    
    { key: 'manage_soundboard', label: 'Manage Soundboard', description: 'Allows adding or removing soundboard sounds.', section: 'Content' },
    { key: 'manage_emojis', label: 'Manage Emojis', description: 'Allows adding or removing custom server emojis.', section: 'Content' },
    { key: 'manage_bots', label: 'Manage Bots', description: 'Allows configuring and managing server bots.', section: 'Content' },
    { key: 'use_apps', label: 'Use Apps', description: 'Allows using interactive apps like Watch Together.', section: 'Content' },
    
    { key: 'change_nickname', label: 'Change Nickname', description: 'Allows members to change their own nickname.', section: 'Profile' },
  ];

  const SECTION_ICONS: Record<string, string> = {
    General: 'settings',
    Moderation: 'shield-check',
    Text: 'message-square',
    Voice: 'volume',
    Content: 'music',
    Profile: 'users'
  };

  async function createRole() {
    creatingRole = true;
    try {
      const serverId = getActiveServerId();
      
      // Find a unique default name
      let baseName = 'New Role';
      let name = baseName;
      let counter = 1;
      while ($roles.some(r => r.name.toLowerCase() === name.toLowerCase())) {
        name = `${baseName} ${counter}`;
        counter++;
      }

      await api.post(`/api/servers/${serverId}/roles`, { name, color: newRoleColor });
      newRoleName = '';
      newRoleColor = '#99aab5';
      await loadRoles();
      
      // Select the newly created role
      const newRole = $roles.find(r => r.name === name);
      if (newRole) selectRole(newRole);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create role');
    } finally {
      creatingRole = false;
    }
  }

  async function updateRole(role: RoleRecord) {
    savingRole = true;
    try {
      const serverId = getActiveServerId();
      await api.put(`/api/servers/${serverId}/roles/${role.id}`, {
        name: role.name,
        color: role.color,
        permissions: role.permissions,
      });
      await loadRoles();
      // Keep editing, but refresh state from global store to be safe
      const updated = $roles.find(r => r.id === role.id);
      if (updated) editingRole = { ...updated };
      toast.success('Role saved successfully');
    } catch (e: any) {
      toast.error(e.message || 'Failed to save role');
    } finally {
      savingRole = false;
    }
  }

  async function deleteRole(id: string) {
    if (!(await confirm('Delete this role?', { title: 'Delete Role', confirmLabel: 'Delete', dangerAction: true }))) return;
    try {
      const serverId = getActiveServerId();
      await api.delete(`/api/servers/${serverId}/roles/${id}`);
      await loadRoles();
      editingRole = null;
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function setDefaultRole(id: string) {
    const serverId = getActiveServerId();
    await api.put(`/api/servers/${serverId}/roles/${id}/default`);
    await loadRoles();
  }

  // Drag and Drop reordering
  function handleDragStart(id: string) {
    if (!$canManageRoles) return;
    draggingRoleId = id;
  }

  function handleDragOver(e: DragEvent, id: string) {
    if (!$canManageRoles || !draggingRoleId || draggingRoleId === id) return;
    e.preventDefault();
    dragOverRoleId = id;
  }

  async function handleDrop(targetId: string) {
    if (!$canManageRoles || !draggingRoleId || draggingRoleId === targetId) return;
    const currentRoles = [...$roles];
    const sourceIdx = currentRoles.findIndex(r => r.id === draggingRoleId);
    const targetIdx = currentRoles.findIndex(r => r.id === targetId);
    
    const [removed] = currentRoles.splice(sourceIdx, 1);
    currentRoles.splice(targetIdx, 0, removed);
    
    draggingRoleId = null;
    dragOverRoleId = null;

    try {
      const serverId = getActiveServerId();
      await api.put(`/api/servers/${serverId}/roles/reorder`, { order: currentRoles.map(r => r.id) });
      await loadRoles();
    } catch (e: any) {
      toast.error('Failed to reorder roles: ' + e.message);
    }
  }

  function selectRole(role: RoleRecord) {
    editingRole = { ...role };
  }
</script>

<div class="roles-container">
  <!-- Master: Role List -->
  <div class="roles-sidebar">
    <div class="sidebar-header">
      <span class="count">{$roles.length} Roles</span>
      {#if $canManageRoles}
        <button class="add-btn" onclick={createRole} title="Create Role">
          <Icon name="plus" size={16} strokeWidth={2.5} />
        </button>
      {/if}
    </div>

    <div class="roles-list scrollable">
      {#each $roles as role (role.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <button 
          class="role-item" 
          class:active={editingRole?.id === role.id}
          class:drag-over={dragOverRoleId === role.id}
          onclick={() => selectRole(role)}
          draggable={$canManageRoles}
          ondragstart={() => handleDragStart(role.id)}
          ondragover={(e) => handleDragOver(e, role.id)}
          ondrop={() => handleDrop(role.id)}
          ondragend={() => { draggingRoleId = null; dragOverRoleId = null; }}
        >
          <div class="role-dot" style:background={role.color}></div>
          <span class="role-name">{role.name}</span>
          {#if role.is_default}
            <Icon name="settings" size={14} class="default-icon" title="Default Role" />
          {/if}
          <Icon name="chevron-down" size={14} class="arrow-icon" style="transform: rotate(-90deg)" />
        </button>
      {/each}
    </div>
  </div>

  <!-- Detail: Role Editor -->
  <div class="role-editor">
    {#if editingRole}
      <div class="editor-content scrollable">
        <div class="editor-section">
          <h4 class="section-title">Role Settings</h4>
          <div class="role-identity">
            <div class="form-group">
              <label for="role-name">Role Name</label>
              <input id="role-name" type="text" class="text-input" bind:value={editingRole.name} />
            </div>
            <div class="form-group">
              <label for="role-color">Role Color</label>
              <div class="color-picker-row">
                <input id="role-color" type="color" bind:value={editingRole.color} class="color-input" />
                <input type="text" class="text-input color-text" bind:value={editingRole.color} maxlength="7" />
              </div>
            </div>
          </div>
        </div>

        <div class="section-divider"></div>

        <div class="editor-section">
          <div class="permissions-header">
            <h4 class="section-title">Permissions</h4>
            <span class="perms-count">{Object.values(editingRole.permissions).filter(Boolean).length} Active</span>
          </div>

          {#if editingRole.permissions.administrator}
            <div class="admin-warning">
              <Icon name="shield-check" size={24} />
              <div class="warning-text">
                <strong>Administrator Enabled</strong>
                <p>This role has every permission and bypasses all channel overrides. Use with extreme caution.</p>
              </div>
            </div>
          {/if}

          <div class="permissions-list">
            {#each ['General', 'Moderation', 'Text', 'Voice', 'Content', 'Profile'] as section}
              <div class="perm-section">
                <div class="perm-section-label">
                  <Icon name={SECTION_ICONS[section]} size={14} />
                  <span>{section}</span>
                </div>
                {#each PERMISSION_LABELS.filter(p => p.section === section) as perm}
                  <div class="perm-row" class:disabled={editingRole.permissions.administrator && perm.key !== 'administrator'}>
                    <div class="perm-info">
                      <span class="perm-label">{perm.label}</span>
                      <p class="perm-desc">{perm.description}</p>
                    </div>
                    <button 
                      class="toggle-switch" 
                      class:active={editingRole.permissions[perm.key]}
                      disabled={editingRole.permissions.administrator && perm.key !== 'administrator'}
                      onclick={() => editingRole!.permissions[perm.key] = !editingRole!.permissions[perm.key]}
                      aria-label="Toggle {perm.label}"
                    >
                      <div class="toggle-knob"></div>
                    </button>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <div class="footer-left">
          {#if !editingRole.is_default}
            <button class="btn-text danger" onclick={() => deleteRole(editingRole!.id)}>Delete Role</button>
            <button class="btn-text" onclick={() => setDefaultRole(editingRole!.id)}>Make Default</button>
          {:else}
            <span class="default-badge">This is the default role for new members.</span>
          {/if}
        </div>
        <div class="footer-right">
          <button class="btn-text" onclick={() => editingRole = null}>Cancel</button>
          <button class="btn-success" onclick={() => updateRole(editingRole!)} disabled={savingRole}>
            {savingRole ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    {:else}
      <div class="empty-editor">
        <div class="empty-icon-wrapper">
          <Icon name="users" size={48} class="empty-icon" />
        </div>
        <h3>Server Roles</h3>
        <p>Select a role from the left to manage its permissions and appearance. Roles at the top of the list have higher priority.</p>
        {#if $canManageRoles}
          <button class="btn-accent" onclick={() => {
            newRoleName = 'New Role';
            createRole();
          }}>Create New Role</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .roles-container {
    display: flex;
    height: 640px;
    background: var(--bg-dark);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    overflow: hidden;
    box-shadow: var(--shadow-xl);
  }

  .scrollable {
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  /* Sidebar */
  .roles-sidebar {
    width: 240px;
    display: flex;
    flex-direction: column;
    background: var(--bg-darker);
    border-right: 1px solid var(--border);
  }

  .sidebar-header {
    padding: 20px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }

  .sidebar-header .count {
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.08em;
  }

  .add-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--bg-mid);
    color: var(--text-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    border: none;
    cursor: pointer;
  }

  .add-btn:hover {
    background: var(--accent-success);
    color: white;
    transform: scale(1.1);
  }

  .roles-list {
    flex: 1;
    padding: 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .role-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-muted);
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    border: none;
    width: 100%;
  }

  .role-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .role-item.active {
    background: var(--bg-active);
    color: var(--text);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .role-item.drag-over {
    box-shadow: 0 -2px 0 var(--accent);
  }

  .role-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  }

  .role-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .default-icon { color: var(--text-dim); opacity: 0.7; }
  .arrow-icon { opacity: 0; transition: opacity 0.15s; color: var(--text-dim); }
  .role-item:hover .arrow-icon, .role-item.active .arrow-icon { opacity: 1; }

  /* Editor */
  .role-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg-dark);
    position: relative;
  }

  .editor-content {
    flex: 1;
    padding: 32px 40px;
  }

  .editor-section {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .section-title {
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--text);
  }

  .role-identity {
    display: flex;
    gap: 32px;
  }

  .role-identity .form-group { flex: 1; }

  .form-group label {
    display: block;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 10px;
    letter-spacing: 0.08em;
  }

  .text-input {
    width: 100%;
    padding: 12px 16px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.95rem;
    outline: none;
    transition: all 0.15s;
  }

  .text-input:focus { 
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-subtle);
  }

  .color-picker-row {
    display: flex;
    gap: 12px;
  }

  .color-input {
    width: 38px;
    height: 38px;
    padding: 0;
    border: 2px solid var(--border);
    background: none;
    cursor: pointer;
    border-radius: 50%;
    overflow: hidden;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .color-input::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-input::-webkit-color-swatch {
    border: none;
    border-radius: 50%;
  }

  .color-input:hover {
    transform: scale(1.15);
    border-color: white;
    box-shadow: 0 0 15px rgba(255, 255, 255, 0.2);
  }

  .color-text { font-family: var(--font-mono); text-transform: uppercase; }

  .section-divider {
    height: 1px;
    background: var(--border);
    margin: 40px 0;
    opacity: 0.5;
  }

  .permissions-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .perms-count { 
    font-size: 0.8rem; 
    color: var(--success); 
    font-weight: 800;
    background: rgba(var(--success-rgb), 0.1);
    padding: 2px 8px;
    border-radius: 12px;
  }

  .admin-warning {
    display: flex;
    gap: 20px;
    padding: 20px;
    background: rgba(248, 113, 113, 0.08);
    border: 1px solid rgba(248, 113, 113, 0.2);
    border-radius: var(--radius-lg);
    color: #f87171;
  }

  .warning-text strong { display: block; margin-bottom: 6px; font-size: 1rem; }
  .warning-text p { font-size: 0.9rem; line-height: 1.5; opacity: 0.9; }

  .permissions-list {
    display: flex;
    flex-direction: column;
    gap: 40px;
    margin-top: 12px;
  }

  .perm-section { display: flex; flex-direction: column; gap: 4px; }

  .perm-section-label {
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 16px;
    letter-spacing: 0.12em;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .perm-section-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
    opacity: 0.3;
  }

  .perm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 16px;
    background: rgba(0, 0, 0, 0.15);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    transition: all 0.15s;
  }

  .perm-row:hover:not(.disabled) { 
    background: rgba(0, 0, 0, 0.25);
    border-color: var(--border);
  }
  
  .perm-row.disabled { opacity: 0.4; pointer-events: none; }

  .perm-info { flex: 1; }
  .perm-label { font-weight: 700; color: var(--text); display: block; margin-bottom: 4px; font-size: 1rem; }
  .perm-desc { font-size: 0.85rem; color: var(--text-muted); line-height: 1.5; }

  .toggle-switch {
    width: 44px;
    height: 24px;
    background: var(--bg-mid);
    border-radius: 12px;
    position: relative;
    transition: all 0.2s var(--ease-out);
    flex-shrink: 0;
    border: 1px solid var(--border);
    cursor: pointer;
    padding: 0;
  }

  .toggle-switch.active { 
    background: var(--success);
    border-color: var(--success);
  }
  
  .toggle-knob {
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s var(--ease-out);
    box-shadow: var(--shadow-sm);
  }
  
  .toggle-switch.active .toggle-knob { transform: translateX(20px); }

  /* Footer */
  .editor-footer {
    padding: 20px 32px;
    background: var(--bg-darker);
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .footer-left { display: flex; gap: 16px; align-items: center; }
  .footer-right { display: flex; gap: 16px; }

  .default-badge { 
    font-size: 0.85rem; 
    color: var(--text-dim);
    font-weight: 500;
  }

  /* Empty State */
  .empty-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px;
    text-align: center;
    color: var(--text-dim);
    gap: 20px;
  }

  .empty-icon-wrapper {
    width: 96px;
    height: 96px;
    background: var(--bg-darker);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
  }

  .empty-icon { opacity: 0.15; }
  .empty-editor h3 { color: var(--text); font-weight: 800; font-size: 1.5rem; }
  .empty-editor p { max-width: 360px; line-height: 1.6; font-size: 1rem; opacity: 0.8; }

  /* Buttons */
  .btn-success {
    background: var(--success);
    color: white;
    padding: 10px 24px;
    border-radius: var(--radius);
    font-weight: 700;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(var(--success-rgb), 0.2);
    transition: all 0.15s;
  }
  
  .btn-success:hover {
    background: var(--success-hover);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(var(--success-rgb), 0.3);
  }

  .btn-accent {
    background: var(--accent);
    color: white;
    padding: 12px 28px;
    border-radius: var(--radius);
    font-weight: 700;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(var(--accent-rgb), 0.2);
    transition: all 0.15s;
  }
  
  .btn-accent:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(var(--accent-rgb), 0.3);
  }

  .btn-text {
    background: transparent;
    color: var(--text-dim);
    border: none;
    cursor: pointer;
    padding: 10px 16px;
    font-weight: 600;
    font-size: 0.9rem;
    border-radius: var(--radius);
    transition: all 0.15s;
  }

  .btn-text:hover { 
    background: var(--bg-hover);
    color: var(--text);
  }
  
  .btn-text.danger { 
    color: #f87171; 
  }
  
  .btn-text.danger:hover {
    background: rgba(248, 113, 113, 0.1);
  }
</style>
