import eslint from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import-x";
import promisePlugin from "eslint-plugin-promise";
import sonarjsPlugin from "eslint-plugin-sonarjs";
import unicornPlugin from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "coverage/", "eslint.config.ts"],
  },

  eslint.configs.all,

  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  unicornPlugin.configs["flat/all"],
  sonarjsPlugin.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  promisePlugin.configs["flat/recommended"],

  prettierConfig,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import-x/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
      },
    },
  },

  {
    rules: {
      "no-console": "off",
      "one-var": "off",
      "sort-imports": "off",
      "sort-keys": "off",
      "no-ternary": "off",
      "no-undefined": "off",
      "id-length": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      "no-magic-numbers": "off",
      "capitalized-comments": "off",
      "no-inline-comments": "off",
      "line-comment-position": "off",
      "max-lines": "off",
      "no-warning-comments": "off",
      "no-plusplus": "off",
      camelcase: "off",

      "func-style": ["error", "declaration", { allowArrowFunctions: true }],
      "max-params": ["error", { max: 4 }],
      complexity: ["error", { max: 15 }],

      "@typescript-eslint/no-magic-numbers": "off",
      "@typescript-eslint/prefer-readonly-parameter-types": "off",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "enumMember",
          format: ["PascalCase"],
        },
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
        {
          selector: ["objectLiteralProperty", "typeProperty"],
          format: null,
          filter: {
            regex:
              "^(authorization|content-type|cache-control|owned_by|finish_reason|prompt_tokens|completion_tokens|total_tokens|max_tokens|Authorization|Content-Type|claude/channel|request_id|newlines-between|prefer-inline)",
            match: true,
          },
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/consistent-type-exports": [
        "error",
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],

      "unicorn/no-null": "off",
      "unicorn/prevent-abbreviations": [
        "error",
        {
          allowList: {
            args: true,
            env: true,
            msg: true,
            req: true,
            res: true,
          },
        },
      ],
      "unicorn/no-process-exit": "off",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],

      "sonarjs/cognitive-complexity": ["error", 15],

      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import-x/no-duplicates": ["error", { "prefer-inline": true }],
      "import-x/no-cycle": "error",
      "import-x/no-self-import": "error",
      "import-x/no-useless-path-segments": "error",
    },
  },

  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "sonarjs/no-duplicate-string": "off",
      "max-params": "off",
      complexity: "off",
      "import-x/no-unresolved": ["error", { ignore: ["^bun:"] }],
    },
  },
);
