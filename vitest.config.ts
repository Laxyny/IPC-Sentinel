import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts'],
      thresholds: {
        statements: 91.26,
        branches: 88.58,
        functions: 93.06,
        lines: 94.66,
      },
    },
  },
});
