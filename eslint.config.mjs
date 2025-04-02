// eslint.config.mjs
import eslint from "@eslint/js";
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";

export default [
  // 1. Ignore patterns first
  {
    ignores: [
      "node_modules/", "dist/", "client/dist/", "server/dist/",
      "**/*.js", "**/*.d.ts", ".replit", "replit.nix",
    ],
  },

  // 2. Base ESLint recommended rules (applied globally)
  eslint.configs.recommended,

  // 3. Base TypeScript configuration (Parser, Plugin, Project Setup)
  // This sets up the environment for subsequent TS rules.
  {
    // Apply broadly to allow parser/plugin to work on all TS files
    files: ["**/*.ts", "**/*.mts", "**/*.cts"],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [ // Still need project reference for type-aware rules
          './tsconfig.json',
          './client/tsconfig.json',
          './server/tsconfig.json'
        ],
        // Might be needed if tsconfigs include non-TS files
        allowExtraFileExtensions: true,
      },
      globals: { ...globals.browser, ...globals.node, __dirname: "readonly" },
    },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      // Rule to ignore unused args starting with underscore
      // Applied here so it affects all TS files unless overridden
      '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    }
  },

  // 4. Apply recommended Type-Checked rules directly into the main array
  // These rules generally apply only to files covered by the 'project' setting above.
  // Let's see if they scope correctly this way.
  ...tseslint.configs.recommendedTypeChecked,

  // 5. Configuration Overrides for Test Files
  // This block MUST come *after* spreading recommendedTypeChecked if it overrides those rules.
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      // Disable rules often problematic in tests
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      // Disable promise checks in tests
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    }
  },

  // 6. Configuration Overrides for Root Config Files
  // This block MUST come *after* spreading recommendedTypeChecked.
  {
     files: ["./vite.config.ts", "./vitest.config.ts", "./eslint.config.mjs"],
     rules: {
       // Disable type-aware rules for configs
       "@typescript-eslint/no-unsafe-assignment": "off",
       "@typescript-eslint/no-unsafe-call": "off",
       "@typescript-eslint/no-unsafe-member-access": "off",
       "@typescript-eslint/no-unsafe-argument": "off",
       // Disable promise checks for configs
       '@typescript-eslint/no-misused-promises': 'off',
       '@typescript-eslint/no-floating-promises': 'off',
     }
  },

  // 7. Prettier recommended rules (Place Last)
  // This plugin disables ESLint formatting rules that conflict with Prettier.
  eslintPluginPrettierRecommended,
];