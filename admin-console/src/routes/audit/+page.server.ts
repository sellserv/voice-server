import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { ApiClient } from '$lib/api';

export const load: PageServerLoad = async ({ locals, url }) => {
  const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const result = await api.get<any>(`/api/admin/audit-log?limit=50&page=${page}`);
  return {
    entries: result.entries,
    total: result.total,
    page,
  };
};
