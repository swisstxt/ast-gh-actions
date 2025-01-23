# ast-gh-actions

A library or collection of AST github shared composite actions.

## Development

### Git Pre-commit Hook

The repository uses a pre-commit hook to run linting on all TypeScript projects. To enable:

```bash
git config core.hooksPath .githooks
```

This runs automatically when installing dependencies in the root directory.

When adding a new action, update `.githooks/pre-commit` to include your project:

```bash
#!/bin/bash
# set -e exits on error, making `|| exit 1` redundant
set -euo

# Print each command before executing
set -x

for project in upstream-tag-on-merge upstream-tag-sync my-new-action; do
    cd $project
    echo "Building $project..."
    bun run build
    git add dist
    echo "Linting $project..."
    bun run lint
    cd ..
done
```

The pre-commit hook:

- Uses bash safety features (`set -euo`)
- Prints commands for debugging (`set -x`)
- Builds TypeScript files
- Stages compiled dist files
- Runs linting

### GitHub Workflows

#### Lint

`.github/workflows/lint.yml` runs on PR creation and updates:

- Runs ESLint on all TypeScript files
- Executes in parallel for each project
- Fails if linting errors are found

#### Build Verification

`.github/workflows/verify-build.yml` ensures compiled code matches source:

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

### Versioning

- Repository uses unified versioning across all actions
- Use major version tags (v1, v2, etc.)
- Tag both the specific commit and major version:

```bash
# For first release or updates within v1
git tag -a v1 -m "v1 release"
git push origin v1

# For breaking changes in any action
git tag -a v2 -m "v2 release"
git push origin v2
```

### Usage

Reference actions using major version tags:

```yaml
# All actions in the repo share the same version
uses: swisstxt/ast-gh-actions/action1@v1
uses: swisstxt/ast-gh-actions/action2@v1
```

### Best Practices

- Coordinate breaking changes across actions
- Force-update major version tags for non-breaking updates
- Create new major version (v2, v3) when any action has breaking changes
- Document changes in release notes
- Keep old major versions available for compatibility
