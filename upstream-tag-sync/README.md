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

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: swisstxt/ast-gh-actions/upstream-tag-sync@main
        with:
          target-repo: your-org/your-fabric-fork
          upstream-repo: GoogleCloudPlatform/cloud-foundation-fabric
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `target-repo` | Repository to sync (format: owner/repo) | Yes | - |
| `upstream-repo` | Upstream repository to sync from | Yes | - |
| `github-token` | GitHub token for authentication | Yes | - |

### Authentication Options

For the `github-token` input, you have several options:

1. **GitHub Actions Token** (`${{ secrets.GITHUB_TOKEN }}`):
   - Default token provided by GitHub Actions
   - Only works when the workflow runs in the same repository you're trying to sync
   - Automatically expires after the workflow run

2. **GitHub App** (Recommended for cross-repo usage):
   - Create and install a GitHub App on your repositories
   - Use installation tokens
   - More secure due to granular permissions and automatic token rotation
   - Not tied to a personal account

3. **Personal Access Token (PAT)**:
   - Can be used for cross-repository access
   - Store as a secret and use like `${{ secrets.YOUR_PAT }}`
   - Consider using fine-grained PATs for more precise permission control

## What it does

1. Monitors the upstream repository for new tags
2. When a new tag is detected and hasn't been processed before:
   - Creates a new branch
   - Attempts to merge the upstream tag
   - If merge conflicts occur:
     - Preserves the conflicting state for manual resolution
     - Creates a PR with conflict markers and resolution instructions
   - If no conflicts:
     - Creates a regular sync PR
3. Avoids creating duplicate PRs for the same tag by tracking processed tags through labels
4. Provides detailed PR descriptions with change information and appropriate instructions

## Managing Sync PRs

When a sync PR is created, you'll see one of two scenarios:

### 1. PR without Conflicts

The PR will have a clean merge state and you can:

- Review and merge the PR to sync with the tag
- Close the PR without merging to skip this tag
- Delete the temporary branch after either action

### 2. PR with Conflicts

The PR will be marked with '[Conflicts]' in the title and include detailed resolution instructions:

1. Checkout the PR branch locally
2. Resolve the conflicts manually
3. Push the resolved changes back
4. Review and merge the updated PR
   - Or close it to skip this tag
5. Delete the temporary branch after completion

## Example PR Messages

### Without Conflicts

```markdown
This PR syncs your fork with the upstream repository's tag v1.0.0.

## Changes included:
- Successfully merged with tag v1.0.0
- Updates from: https://github.com/GoogleCloudPlatform/cloud-foundation-fabric

Please review the changes and:
- If you want to sync to this tag: merge the PR
- If you don't want to sync: close the PR

You can safely delete the `sync/upstream-v1.0.0` branch afterward.
```

### With Conflicts

```markdown
This PR attempts to sync your fork with the upstream repository's tag v1.0.0.

## ⚠️ Merge Conflicts Detected
This PR contains merge conflicts that need to be resolved manually. Please:
1. Checkout this branch locally
2. Resolve the conflicts
3. Push the resolved changes back to this branch

### Next Steps:
1. Resolve conflicts between your customizations and upstream changes
2. Once conflicts are resolved:
   - If you want to sync to this tag: merge the PR
   - If you don't want to sync: close the PR
3. You can safely delete the `sync/upstream-v1.0.0` branch afterward

## Changes included:
- Attempted merge with tag v1.0.0
- Updates from: https://github.com/GoogleCloudPlatform/cloud-foundation-fabric
```

## How Tag Processing Works

The action uses labels to track which upstream tags have been processed, making it safe and easy to manage your synchronization:

1. When a new upstream tag is detected, the action:
   - Creates a branch named `sync/upstream-${tag}`
   - Creates a PR from this branch
   - Adds a label `sync/upstream-${tag}` to the PR

2. For each run, the action:
   - Checks for PRs with the tag-specific label (regardless of PR status)
   - If a PR with this label exists (open, closed, or merged), the tag is considered "processed"
   - This means you won't get duplicate PRs for tags you've already handled

3. After processing a PR, you can:
   - Merge it to sync with the tag
   - Close it to skip the tag
   - Safely delete the `sync/upstream-${tag}` branch
   - The label ensures the action won't create another PR for this tag

### Labels Used

- `sync/upstream-${tag}`: Tracks which tags have been processed
- `merge-conflicts`: Identifies PRs requiring manual conflict resolution

This approach means:

- You maintain control over which tags to sync with
- Branch cleanup won't affect tag tracking
- The action's state is tracked through PR labels, not branches

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
    "build": "bun install && bun build src/index.ts --outdir=dist --target=node --entry-naming [name].mjs"
  }
}
