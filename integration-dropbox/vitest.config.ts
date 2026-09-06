import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@invoiceleaf/integration-sdk': path.resolve(__dirname, '../../integration-sdk/src/index.ts'),
    },
  },
  test: {
    root: __dirname,
    include: ['src/__tests__/**/*.test.ts'],
  },
});
