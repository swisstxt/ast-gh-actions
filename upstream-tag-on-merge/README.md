# Upstream Tag On Merge Action

This action automatically creates a git tag when a sync pull request is merged. It's designed to work in conjunction with the upstream-tag-sync action to maintain tag synchronization between repositories.

## Usage

Create a workflow file in your repository (e.g., `.github/workflows/upstream-tag-on-merge.yml`):

```yaml
name: Create Tag on Merge

on:
  pull_request:
    types: [closed]

jobs:
  tag:
    runs-on: ubuntu-latest
    # Only run this job if the PR was merged (not just closed)
    if: github.event.pull_request.merged == true && github.event.pull_request.base.label == "${{ github.event.repo.owner }}:${{ github.event.repo.default_branch }}"
    steps:
      - uses: swisstxt/ast-gh-actions/upstream-tag-on-merge@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for authentication | Yes | - |

## What it does

1. Triggers when a pull request is merged
2. Checks if the merged PR was from a sync branch (prefixed with `sync/upstream-`)
3. Extracts the tag name from the branch name
4. Creates a git tag pointing to the merge commit
5. Pushes the tag to the repository

## How it works

The action looks for merged PRs from branches that follow the naming convention used by the upstream-tag-sync action:

- Branch format: `sync/upstream-v1.2.3`
- Resulting tag: `v1.2.3`

When a matching PR is merged, the action:

1. Creates a tag object with a message referencing the PR
2. Creates a reference for the tag pointing to the merge commit
3. The tag is then available in your repository

## Example

If a PR from branch `sync/upstream-v1.2.3` is merged:

1. The action detects the merge
2. Creates tag `v1.2.3` pointing to the merge commit
3. Adds a message: "Tag created from sync PR #123"

## Authentication

The action requires a GitHub token with permissions to create tags. The default `GITHUB_TOKEN` provided by GitHub Actions should have sufficient permissions when running in the same repository.

## Error Handling

The action includes:

- Verification that the PR was actually merged
- Validation of the branch name format
- Rate limit handling with exponential backoff
- Detailed error messages in case of failures

## Usage with Upstream Tag Sync

This action complements the upstream-tag-sync action by:

1. upstream-tag-sync creates PRs to sync with upstream tags
2. When those PRs are merged, this action creates matching tags in your repository
3. This maintains a parallel tag structure between your repository and the upstream
