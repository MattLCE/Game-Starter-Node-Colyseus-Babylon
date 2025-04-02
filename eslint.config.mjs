// eslint.config.mjs
import eslint from "@eslint/js";
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";

export default [
  // 1. Ignore patterns
  {
    ignores: [
      "node_modules/", "dist/", "client/dist/", "server/dist/",
      "**/*.js", "**/*.d.ts", ".replit", "replit.nix",
      "eslint.config.mjs", // Keep ignoring the config itself
    ],
  },

  // 2. Base ESLint recommended rules
  eslint.configs.recommended,

  // 3. Base TypeScript configuration (Parser, Plugin, Project Setup)
  {
    files: ["**/*.ts", "**/*.mts", "**/*.cts"],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          './tsconfig.json',
          './client/tsconfig.json',
          './server/tsconfig.json'
        ],
        allowExtraFileExtensions: true,
      },
      globals: { ...globals.browser, ...globals.node, __dirname: "readonly" },
    },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
                                             "argsIgnorePattern": "^_", // Ignore args starting with _
                                             "varsIgnorePattern": "^_", // Ignore variables starting with _
                                             "caughtErrorsIgnorePattern": "^_" // Ignore caught error variables starting with _
                                           }],
      // Base promise rules - applied unless overridden
       '@typescript-eslint/no-misused-promises': 'error',
       '@typescript-eslint/no-floating-promises': 'error',
    }
  },

  // 4. Type-Checked Rules Applied ONLY to Source Code
  {
    files: ["client/src/**/*.ts", "server/src/**/*.ts"], // Target ONLY source files
    // Extend/Apply the type-checked ruleset *within this specific block*
    // This uses the parser/project settings from block #3
    rules: {
       // Manually merge rules from recommendedTypeChecked if spreading doesn't work scoped
       // (More verbose, but guarantees scope) - Let's try just applying the base rules first.
       // If errors appear HERE, we can add specific type-checked rules manually.

       // Ensure strict promises are enforced for source code (redundant if set in #3, but explicit)
       '@typescript-eslint/no-misused-promises': 'error',
       '@typescript-eslint/no-floating-promises': 'error',

       // Add other recommended type-checked rules here if needed, e.g.:
       // '@typescript-eslint/no-unsafe-return': 'error',
       // '@typescript-eslint/await-thenable': 'error',
       // ... etc (copy from the ruleset definition if necessary)
    }
  },
   // NOTE: The global spread `...tseslint.configs.recommendedTypeChecked,` has been REMOVED

  // 5. Overrides for Test Files
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      // Disable unused vars IN ADDITION to other rules for tests
      'no-unused-vars': 'off', // Disable basic JS rule for tests
      '@typescript-eslint/no-unused-vars': 'off', // Disable TS rule for tests
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    }
  },

  // 6. Overrides for Root Config Files (vite/vitest)
  {
     files: ["./vite.config.ts", "./vitest.config.ts"],
     rules: {
       // Disable type-aware rules since type-checking isn't strictly applied here now
       "@typescript-eslint/no-unsafe-assignment": "off",
       "@typescript-eslint/no-unsafe-call": "off",
       "@typescript-eslint/no-unsafe-member-access": "off",
       "@typescript-eslint/no-unsafe-argument": "off",
       '@typescript-eslint/no-misused-promises': 'off',
       '@typescript-eslint/no-floating-promises': 'off',
     }
  },

  // 7. Prettier recommended rules (Place Last)
  eslintPluginPrettierRecommended,
];