// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/coverage/**",
      "data/**",
      "docs/agent/**",
      "apps/e2e/playwright-report/**",
      "apps/e2e/test-results/**",
      "apps/e2e/blob-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    // FR-051: an in-app link goes through the router (<Link> / navigate), never a full page load.
    // Links into the API (`/api/…`, downloads) are real URLs and stay plain anchors.
    files: ["apps/web/src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXOpeningElement[name.name='a'] > JSXAttribute[name.name='href'] > Literal[value=/^\\/(?!api\\/)/]",
          message: "Use the router's <Link to=…> for in-app links, not <a href>.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='a'] > JSXAttribute[name.name='href'] > JSXExpressionContainer > TemplateLiteral[quasis.0.value.raw=/^\\/(?!api\\/)/]",
          message: "Use the router's <Link to=…> for in-app links, not <a href>.",
        },
      ],
    },
  },
  {
    // Plain Node ESM entry point (no tsconfig/type info, so Node globals
    // aren't picked up automatically the way they are for .ts files).
    files: ["apps/worker/src/pool/worker-entry.mjs", "apps/worker/src/live/live-world-entry.mjs"],
    languageOptions: {
      globals: { URL: "readonly" },
    },
  },
  {
    // Constitution Principle II: no Math.random / wall-clock reads in the engine.
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "packages/engine must be deterministic — draw from the seeded RNG (rng.ts), never Math.random.",
        },
        {
          object: "Date",
          property: "now",
          message:
            "packages/engine must be deterministic — use the injected virtual clock (clock.ts), never wall-clock reads.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "packages/engine must be deterministic — use the injected virtual clock (clock.ts), never `new Date()`.",
        },
      ],
    },
  },
  prettier,
);
