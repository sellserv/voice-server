import type { PageServerLoad, Actions } from './$types';
import { env } from '$env/dynamic/private';
import { ApiClient } from '$lib/api';

export const load: PageServerLoad = async ({ locals, url }) => {
  const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
  const selectedUserId = url.searchParams.get('userId');

  const [users, roles] = await Promise.all([
    api.get<any[]>('/api/admin/users'),
    api.get<any[]>('/api/admin/global-roles'),
  ]);

  let selectedUser: any = null;
  let selectedUserGlobalRoles: string[] = [];

  if (selectedUserId) {
    const [user, userRoles] = await Promise.all([
      api.get<any>(`/api/admin/users/${selectedUserId}`),
      api.get<any[]>(`/api/admin/users/${selectedUserId}/global-roles`),
    ]);
    selectedUser = user;
    selectedUserGlobalRoles = userRoles.map((r: any) => r.id);
  }

  return {
    users,
    roles,
    selectedUser,
    selectedUserGlobalRoles,
    apiUrl: env.API_URL || 'http://localhost:3000',
  };
};

export const actions: Actions = {
  toggleRole: async ({ request, locals }) => {
    const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
    const formData = await request.formData();
    const userId = formData.get('userId') as string;
    const roleId = formData.get('roleId') as string;
    const action = formData.get('action') as string;

    await api.patch(`/api/admin/users/${userId}/global-roles`, { roleId, action });
    return { success: true };
  },

  ban: async ({ request, locals }) => {
    const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
    const formData = await request.formData();
    const userId = formData.get('userId') as string;

    await api.post(`/api/admin/users/${userId}/ban`, { reason: 'Banned by instance admin' });
    return { success: true };
  },

  unban: async ({ request, locals }) => {
    const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
    const formData = await request.formData();
    const userId = formData.get('userId') as string;

    await api.post(`/api/admin/users/${userId}/unban`);
    return { success: true };
  },
};
