# Upstream Tag Sync Action

This action monitors an upstream repository for new semver compliant tags and automatically creates pull requests to sync a fork when new tags are detected.

## Usage

### With a GitHub App (recommended)

1. Create a [new GitHub app](https://docs.github.com/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app). Under the section `Permissions` → `Repository permissions`, grant the app `Read and write` access to `Contents`, `Workflows`, `Pull Requests`, and `Issues`.

2. Install the app in your GitHub Organization or in your personal account (whichever is applicable) and [generate a private key](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps#generating-private-keys).

3. In the settings of the repository where you want to use this Action, create two secrets: one that contains the app id and one that contains the private key that you generated in the previous step. In the example below `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` were chosen as names but you are free to pick other names.

4. Create a workflow file in your repository (e.g., `.github/workflows/sync-upstream.yml`):

```yaml
name: Sync with Upstream

on:
  schedule:
    - cron: '0 */12 * * *'  # Runs every 12 hours
  workflow_dispatch:  # Allows manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions: {} # No permission needed since we don't use the default GITHUB_TOKEN
    steps:
      # Use a service account app token because the default GITHUB_TOKEN cannot be granted the permission `workflows: write`
      # See: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions
      - uses: actions/create-github-app-token@67018539274d69449ef7c02e8e71183d1719ab42 # v2
        id: app-token
        with:
          app-id: ${{ vars.GITHUB_APP_ID }}
          private-key: ${{ secrets.GITHUB_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          permission-contents: write # For pushing the new branch containing the changes
          permission-workflows: write # For allowing the branch to contain changes to .github/{workflows,action}, as well as allowing workflows to run on the new branch
          permission-pull-requests: write # For creating the pull request
          permission-issues: write # For finding the existing (if it exists) pull request by label, and adding a label to the new pull request
      - name: Checkout repository
        uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5
        with:
          fetch-depth: 1
          token: ${{ steps.app-token.outputs.token }}
      - uses: swisstxt/ast-gh-actions/upstream-tag-sync@main
        with:
          target-repo: swisstxt/cloud-foundation-fabric
          upstream-repo: GoogleCloudPlatform/cloud-foundation-fabric
          github-token: ${{ steps.app-token.outputs.token }}
```

### With a Classic Service Account Token

Or alternatively if you use a Classic Service Account Token instead:

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
        uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5
        with:
          fetch-depth: 1
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

For the `github-token` input, it is recommended to use a GitHub App token. Here's why different approaches work or don't:

1. **DO NOT USE GitHub Actions Token** (`${{ secrets.GITHUB_TOKEN }}`):
   - Cannot trigger workflows in the created PR
   - Cannot be granted the `workflows: write` permission needed for syncing workflow changes
   - Will not work as intended for synchronization

2. **DO NOT USE Fine-Grained PAT**:
   - Requires administrators to manually grant access to repositories one-by-one
   - Not practical for organization-wide usage

3. **GitHub App Token** (Recommended):
   - Requires to create a GitHub app and installing it
   - Uses the `actions/create-github-app-token` action to generate a temporary token, which is more secure than using long-lived tokens
   - Can be granted specific permissions as needed (`contents: write`, `workflows: write`, etc.)
   - Works across all repositories the app has access to
   - More secure than classic PATs with fine-grained permissions
   - Requires to set up organization variables and secrets:
     - `GITHUB_APP_ID` (variable)
     - `GITHUB_APP_PRIVATE_KEY` (secret)

4. **Classic Service Account Token** (Alternative):
   - Create a dedicated service account for automation
   - Generate a classic token with "repo" scope
   - Store as a secret and use like `${{ secrets.SERVICE_ACCOUNT_TOKEN }}`
   - Works across all repositories without per-repo configuration
   - Requires creating a GitHub user, granting it access to the repository, and then creating the classic token. Note that sharing the GitHub user credentials poses a business continuity risk as well as a security risk.
   - Organizations that enforce Single Sign-On (SSO) tied to an intranet employee account render this option unfeasible.

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
