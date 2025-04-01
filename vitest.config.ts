// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, 
    environment: 'node', 
    include: ['**/*.{test,spec}.ts'],
    // Add or modify deps section:
    deps: {
      // Try telling Vitest to pre-bundle or optimize Geotic
      // Option A: Inline specific problematic deps
      // inline: ['geotic'], 
      // Option B: If Option A doesn't work, try optimizing the whole dep graph (slower)
      optimizeDeps: { include: ['geotic'] } 
    },
  },
});