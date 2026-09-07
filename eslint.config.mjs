import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  globalIgnores([
    "node_modules/**",
    "research/**",
    "upload/**",
    "anchor-baseline/**",
    "saos-sovereign-platform/**",
    "skills/**",
    "tool-results/**",
    ".next/**",
    "db/**"
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
    }
  }
]);

export default eslintConfig;
