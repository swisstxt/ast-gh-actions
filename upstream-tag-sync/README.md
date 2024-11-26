# Upstream Tag Sync Action

This action monitors an upstream repository for new tags and automatically creates pull requests to sync a fork when new tags are detected.

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

## What it does

1. Monitors the upstream repository for new tags
2. When a new tag is detected:
   - Creates a new branch
   - Syncs the branch with the upstream tag
   - Creates a pull request
   - Adds the 'sync-upstream' label
3. Avoids creating duplicate PRs for the same tag
4. Provides detailed PR descriptions with change information

## Example PR

The created PR will look like this:

```markdown
This PR syncs your fork with the upstream repository's tag v1.0.0.

## Changes included:
- Merges all changes up to tag v1.0.0
- Updates from: https://github.com/GoogleCloudPlatform/cloud-foundation-fabric

Please review the changes and merge if everything looks good.
```
