# Upstream Tag Sync Action

This action monitors an upstream repository for new semver compliant tags and automatically creates pull requests to sync a fork when new tags are detected.

## Usage

Create a workflow file in your repository (e.g., `.github/workflows/sync-upstream.yml`):

```yaml
name: Sync with Upstream

on:
  schedule:
    - cron: '0 */12 * * *'  # Runs every 12 hours
  workflow_dispatch:  # Allows manual trigger

permissions:
  actions: write
  contents: write     # using 'write' to allow pushing
  issues: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1                                   # Only get latest commit
          token: ${{ secrets.SERVICE_ACCOUNT_TOKEN }}      # Token to push back to fork
      - uses: swisstxt/ast-gh-actions/upstream-tag-sync@main
        with:
          target-repo: swisstxt/cloud-foundation-fabric
          upstream-repo: GoogleCloudPlatform/cloud-foundation-fabric
          github-token: ${{ secrets.SERVICE_ACCOUNT_TOKEN }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `target-repo` | Repository to sync (format: owner/repo) | Yes | - |
| `upstream-repo` | Upstream repository to sync from | Yes | - |
| `github-token` | GitHub token for authentication | Yes | - |

### Authentication Options

For the `github-token` input, you need a classic token from a service account with "repo" scope. Here's why:

1. **DO NOT USE GitHub Actions Token** (`${{ secrets.GITHUB_TOKEN }}`):
   - Cannot trigger workflows in the created PR
   - Will not work as intended for synchronization

2. **DO NOT USE Fine-Grained PAT**:
   - Requires administrators to manually grant access to repositories one-by-one
   - Not practical for organization-wide usage

3. **Classic Service Account Token** (Recommended):
   - Create a dedicated service account for automation
   - Generate a classic token with "repo" scope
   - Store as a secret and use like `${{ secrets.SERVICE_ACCOUNT_TOKEN }}`
   - Works across all repositories without per-repo configuration

## What it does

1. Monitors the upstream repository for new tags
2. When a new tag is detected:
   - Creates a new branch from the tag
   - Creates a pull request to merge the tag into your default branch
3. Avoids creating duplicate PRs for the same tag by checking for PRs with the corresponding sync label
4. Labels PRs appropriately for tracking and identification

Note: Any merge conflicts between your repository and the upstream tag will be handled through GitHub's standard PR conflict resolution process. When conflicts occur, you can resolve them just like any other PR by following GitHub's conflict resolution workflow.

## How Tag Processing Works

The action uses labels to track which upstream tags have been processed:

1. For each new upstream tag, the action:
   - Creates a branch named `sync/upstream-${tag}`
   - Creates a PR from this branch
   - Adds a label `sync/upstream-${tag}` to the PR

2. For each run, the action:
   - Checks for existing PRs with the tag-specific label
   - Skips creating a new PR if one with the label already exists
   - This prevents duplicate PRs for tags you've already handled

3. After processing a PR, you can:
   - Merge it to sync with the tag
   - Close it to skip the tag
   - The label ensures the action won't create another PR for this tag

### Labels Used

- `sync/upstream-${tag}`: Tracks which tags have been processed
- `sync`: General label for all sync PRs

This approach means:

- You maintain control over which tags to sync with
- The action's state is tracked through PR labels
- Tag processing status persists even if branches are deleted

## Example PR Message

```markdown
This PR syncs with upstream tag v1.0.0.

## Details
- Source: upstream-org/repo@v1.0.0
- Target Branch: `main`
- Sync Branch: `sync/upstream-v1.0.0`

This PR was automatically created by the sync action.
```

## Known Issues

### Build Output Format

FIXME: Build script workaround for MJS output

The current build script in `package.json` uses `--entry-naming [name].mjs` as a workaround for Bun's ESM output handling.
This is a temporary solution pending resolution of [Bun Issue #7252](https://github.com/oven-sh/bun/issues/7252#issuecomment-2054172188).

When fixed upstream, we should switch to using `--format=esm`.

Current workaround in package.json:

```json
{
  "scripts": {
    "build": "bun install && bun build src/index.ts --outdir=dist --target=node --entry-naming '[name].mjs'"
  }
}
```
