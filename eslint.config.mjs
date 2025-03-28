import eslint from "@eslint/js";
// import tseslint from 'typescript-eslint'; // Remove or comment out this line
import tseslintParser from "@typescript-eslint/parser"; // Import the parser
import tseslintPlugin from "@typescript-eslint/eslint-plugin"; // Import the plugin
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
// import path from "path";
// import { fileURLToPath } from "url";
import globals from "globals";

//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);

export default [
  // Ignore patterns first
  {
    ignores: [
      "node_modules/",
      "dist/",
      "client/dist/",
      "server/dist/",
      "**/*.js",
      "**/*.d.ts",
      ".replit",
      "replit.nix",
      // Add any other specific files/folders to ignore
    ],
  },
  // Global language options and plugins
  {
    plugins: {
      "@typescript-eslint": tseslintPlugin,
      // 'prettier' plugin is often implicitly included via eslintPluginPrettierRecommended now
    },
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        // project: true, // Let ESLint find tsconfigs automatically based on file location
        // OR explicitly list them relative to the config file's directory (__dirname)
        // project: [
        //   path.resolve(__dirname, './tsconfig.json'),
        //   path.resolve(__dirname, './client/tsconfig.json'),
        //   path.resolve(__dirname, './server/tsconfig.json'),
        // ],
        // tsconfigRootDir: __dirname, // Can specify root if needed with explicit project paths
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        __dirname: "readonly",
        // Add any other custom globals if needed
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
  },
  // Base ESLint recommended rules
  eslint.configs.recommended,
  // Base TypeScript recommended rules
  //...tseslint.configs.recommendedTypeChecked, // Or recommended
  // Prettier recommended rules (usually last)
  eslintPluginPrettierRecommended,
  // Your custom rules (can be in a separate object or merged)
  {
    rules: {
      // Add rules here
      // '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
