import type { PageServerLoad, Actions } from './$types';
import { env } from '$env/dynamic/private';
import { ApiClient } from '$lib/api';

export const load: PageServerLoad = async ({ locals }) => {
  const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
  const [stats, settings] = await Promise.all([
    api.get<any>('/api/admin/stats'),
    api.get<any>('/api/admin/instance-settings'),
  ]);
  return { stats, settings };
};

export const actions: Actions = {
  updateSettings: async ({ request, locals }) => {
    const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
    const formData = await request.formData();
    const key = formData.get('key') as string;
    const value = formData.get('value') as string;

    const updates: Record<string, any> = {};
    if (key === 'allow_registration' || key === 'alpha_billing') {
      updates[key] = value === 'true' ? 1 : 0;
    } else {
      updates[key] = value;
    }

    const result = await api.patch<any>('/api/admin/instance-settings', updates);
    return { settings: result };
  },
};
