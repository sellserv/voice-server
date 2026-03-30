import type { PageServerLoad, Actions } from './$types';
import { env } from '$env/dynamic/private';
import { ApiClient } from '$lib/api';

export const load: PageServerLoad = async ({ locals, url }) => {
  const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
  const filter = url.searchParams.get('filter') || 'open';
  const apiUrl = filter === 'all' ? '/api/admin/reports' : '/api/admin/reports?status=open';
  const reports = await api.get<any[]>(apiUrl);
  return { reports, filter };
};

export const actions: Actions = {
  resolve: async ({ request, locals }) => {
    const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
    const formData = await request.formData();
    const reportId = formData.get('reportId') as string;

    await api.post(`/api/admin/reports/${reportId}`, { status: 'resolved' });
    return { success: true };
  },

  dismiss: async ({ request, locals }) => {
    const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
    const formData = await request.formData();
    const reportId = formData.get('reportId') as string;

    await api.post(`/api/admin/reports/${reportId}`, { status: 'dismissed' });
    return { success: true };
  },
};
