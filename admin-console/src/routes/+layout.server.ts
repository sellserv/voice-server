import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: {
      userId: locals.session.userId,
      username: locals.session.username,
      displayName: locals.session.displayName,
    },
  };
};
