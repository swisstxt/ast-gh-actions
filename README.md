# ast-gh-actions

A library or collection of AST github shared composite actions.

## Development

### Git Pre-commit Hook

The repository uses a pre-commit hook to run linting on all TypeScript projects.

This runs automatically when installing dependencies in the root directory of the actions.

When adding a new action, update `.githooks/pre-commit` to include your project:

[Pre-commit Hook](.githooks/pre-commit)

The pre-commit hook:

- Builds TypeScript files
- Stages compiled dist files
- Runs linting

### GitHub Workflows

#### Lint

`.github/workflows/linting.yml` runs on PR creation and updates:

- Runs ESLint on all TypeScript files
- Executes in parallel for each project
- Fails if linting errors are found

#### Build Verification

`.github/workflows/building.yml` ensures compiled code matches source:

- Cleans and rebuilds TypeScript
- Compares with committed build artifacts
- Fails if builds are out of sync

## Adding New Actions

When creating a new shared GitHub Action:

1. Create a new directory for your action:

```bash
mkdir my-new-action
cd my-new-action
```

2. Initialize the project:

```bash
bun init
```

3. Add to GitHub workflows by updating the matrix in both workflow files:

```yaml
strategy:
  matrix:
    project: ['upstream-tag-on-merge', 'upstream-tag-sync', 'my-new-action']
```

4. Required files:

- `src/index.ts` - Action source code
- `action.yml` - Action metadata
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration

5. Required files and configurations:

`package.json` scripts:

```json
{
  "scripts": {
    "build": "bun install && bun build src/index.ts --outdir=dist --target=node --entry-naming '[name].mjs'",
    "lint": "eslint . \"**/*.ts\"",
    "format": "prettier --write \"src/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\"",
    "lint:staged": "lint-staged",
    "type-check": "tsc --noEmit",
    "prepare": "git config core.hooksPath .githooks"
  }
}
```

`.lintstagedrc`:

```json
{
    "*.{js,ts,mjs}": [
        "eslint --fix",
        "prettier --write"
    ],
    "*.{json,yml,yaml,md}": [
        "prettier --write"
    ]
}
```

`eslint.config.js`:

```javascript
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["eslint.config.js", "dist"],
  },
  js.configs.recommended,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": "error",
    },
  },
];
```

## Versioning and Releasing

Follow github best practice:
<https://docs.github.com/en/actions/sharing-automations/creating-actions/about-custom-actions#using-tags-for-release-management>
