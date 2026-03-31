import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    env: {
      JWT_SECRET: 'a]3Kf9$mPqR7!vXw2Lz8@nTjYe5Cb1Hg',
      DB_PATH: ':memory:',
    },
  },
});
