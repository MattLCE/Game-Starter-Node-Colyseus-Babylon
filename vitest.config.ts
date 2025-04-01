// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
    // REMOVE or comment out the entire deps and ssr sections
    // if they only contained 'geotic' entries.
    // deps: {
    //   inline: ['geotic'],
    // },
    // ssr: {
    //   noExternal: ['geotic'],
    // }
  },
});