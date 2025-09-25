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
    permissions: {} # No permission needed since we don't use the default GITHUB_TOKEN
    # Only run this job if the PR was merged (not just closed) and merged into default branch e.g. main / master
    if: github.event.pull_request.merged == true && github.event.pull_request.base.label == "${{ github.event.repo.owner }}:${{ github.event.repo.default_branch }}"
    steps:
      - uses: actions/create-github-app-token@67018539274d69449ef7c02e8e71183d1719ab42 # v2
        id: app-token
        with:
          app-id: ${{ vars.GITHUB_APP_ID }}
          private-key: ${{ secrets.GITHUB_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          permission-contents: write # In order to push the tag
      - name: Checkout repository
        uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5
        with:
          fetch-depth: 1
          token: ${{ steps.app-token.outputs.token }}
      - uses: swisstxt/ast-gh-actions/upstream-tag-on-merge@main
        with:
          github-token: ${{ steps.app-token.outputs.token }}
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

The action requires a GitHub token with permissions to create tags. 

### With a GitHub App (recommended)

1. Create a [new GitHub app](https://docs.github.com/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app). Under the section `Permissions` → `Repository permissions` grant the app `Read and write` access to `Contents`. This is needed for pushing tags

2. Install the app in your GitHub Organization or in your personal account (whichever is applicable) and [generate a private key](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps#generating-private-keys).

3. In the settings of the repository where you want to use this Action, create two secrets: one that contains the app id and one that contains the private key that you generated in the previous step. In the example below `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` were chosen as names but you are free to pick other names.

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
