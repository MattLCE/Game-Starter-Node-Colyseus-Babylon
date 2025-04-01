// eslint.config.mjs
import eslint from "@eslint/js";
import tseslint from 'typescript-eslint'; // <--- Import the main typescript-eslint object
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
// import path from "path"; // You might need these if using explicit project paths
// import { fileURLToPath } from "url";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

export default [
  // 1. Ignore patterns first
  {
    ignores: [
      "node_modules/",
      "dist/", // Ignore root dist
      "client/dist/", // Ignore client dist
      "server/dist/", // Ignore server dist
      "**/*.js", // Keep ignoring JS if you don't use it
      "**/*.d.ts",
      ".replit",
      "replit.nix",
      // Add any other specific files/folders to ignore
    ],
  },

  // 2. Base ESLint recommended rules
  eslint.configs.recommended,

  // 3. TypeScript configuration (applied globally to TS files)
  {
    // Specify files this config applies to (optional, but good practice)
    // files: ["**/*.ts"], // You can uncomment this if you want to be explicit

    plugins: {
      // Use the imported 'tseslint' object for the plugin
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      // Use the imported 'tseslint' object for the parser
      parser: tseslint.parser,
      parserOptions: {
        // Enable type-aware linting by pointing to your tsconfig files
        project: true, // Let ESLint find tsconfigs automatically
        // OR explicitly list them relative to eslint.config.mjs if 'true' doesn't work:
        // project: [
        //   './server/tsconfig.json',
        //   // Add './client/tsconfig.json' here if you create one for the client
        // ],
        // tsconfigRootDir: __dirname, // Often needed with explicit project paths
      },
      globals: {
        ...globals.browser, // For client-side code if linted
        ...globals.node,    // For server-side code
        __dirname: "readonly", // For CommonJS modules (like your server output)
        // Add any other custom globals if needed
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
    rules: {
      // You can add TS-specific rule overrides here if needed later
      // Example: '@typescript-eslint/no-unused-vars': 'warn',
    }
  },

  // 4. TypeScript Recommended Type-Checked Rules (Uses settings from section 3)
  // These rules require type information.
  ...tseslint.configs.recommendedTypeChecked,
  // Or use the stricter version:
  // ...tseslint.configs.strictTypeChecked,

  // 5. Prettier recommended rules (DISABLES CONFLICTING ESLint formatting rules - place last)
  eslintPluginPrettierRecommended,

  // 6. Your custom global rule overrides (Optional)
  {
    rules: {
      // Add any final global overrides here
      // Example: Disabling a specific rule globally
      // 'no-console': 'warn',
       '@typescript-eslint/no-explicit-any': 'off', // Example: allow 'any' for now
    },
  },
];