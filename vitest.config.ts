import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Options for the test runner
    globals: true, // Use globals like describe, test, expect without importing
    environment: 'node', // Set environment for tests (node for server-side)
    // Optional: Include setup files if needed
    // setupFiles: ['./path/to/test-setup.ts'],
    // Optional: Specify include patterns for test files
    include: ['**/*.{test,spec}.ts'],
    // Optional: Configure coverage reporting
    // coverage: {
    //   provider: 'v8', // or 'istanbul'
    //   reporter: ['text', 'json', 'html'],
    // },
  },
});