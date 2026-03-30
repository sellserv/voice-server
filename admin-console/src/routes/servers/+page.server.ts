import type { PageServerLoad, Actions } from './$types';
import { env } from '$env/dynamic/private';
import { ApiClient } from '$lib/api';

export const load: PageServerLoad = async ({ locals }) => {
  const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
  const servers = await api.get<any[]>('/api/admin/servers');
  return { servers, apiUrl: env.API_URL || 'http://localhost:3000' };
};

export const actions: Actions = {
  delete: async ({ request, locals }) => {
    const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
    const formData = await request.formData();
    const serverId = formData.get('serverId') as string;

    await api.delete(`/api/admin/servers/${serverId}`);
    return { success: true };
  },
};
