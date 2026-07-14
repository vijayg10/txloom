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
