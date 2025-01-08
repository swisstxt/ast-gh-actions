import { getInput, info, warning, setFailed } from '@actions/core';
import { getOctokit } from '@actions/github';
import { exec } from '@actions/exec';
import semver from 'semver';

type OctokitClient = ReturnType<typeof getOctokit>;

/**
 * Retries a function with exponential backoff when rate limits are hit
 *
 * @param operation - The operation to execute
 * @param maxAttempts - The maximum number of attempts
 * @param baseDelay - The base delay in milliseconds
 * @returns {Promise<T>} The result of the operation
 * @throws {Error} If the operation fails after all attempts
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxAttempts = 5,
  baseDelay = 1000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !err.message.includes("rate limit") ||
        attempt >= maxAttempts
      ) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
      const waitSeconds = Math.round(delay / 1000).toString();
      info(
        `Rate limit hit, attempt ` +
        attempt.toString() +
        `/` +
        maxAttempts.toString() +
        `. Waiting ` +
        waitSeconds.toString() +
        ` s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Should not reach here due to throw in loop");
}

/**
 * Gets the latest semver-compliant tag from a GitHub repository
 * Uses pagination to fetch all tags and handles rate limiting
 *
 * @param {OctokitClient} octokit - The authenticated GitHub client
 * @param {string} owner - The owner of the repository
 * @param {string} repo - The name of the repository
 * @returns {Promise<string | null>} The name of the latest semver tag, or null if no valid tags found
 */
async function getLatestTag(
  octokit: OctokitClient,
  owner: string,
  repo: string
): Promise<string | null> {
  info(`Fetching tags for ${owner}/${repo}`);

  return retryWithBackoff(async () => {
    const iterator = octokit.paginate.iterator(octokit.rest.repos.listTags, {
      owner,
      repo,
      per_page: 100,
    });

    const tags: { name: string }[] = [];
    for await (const { data: pageTags } of iterator) {
      tags.push(...pageTags);
      info(`Fetched ` + tags.length.toString() + ` tags so far...`);

      // Add a small delay between pages to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (tags.length === 0) {
      info('No tags found in repository');
      return null;
    }

    const validTags = tags
      .map(tag => ({
        name: tag.name,
        version: semver.valid(semver.clean(tag.name))
      }))
      .filter((tag): tag is { name: string, version: string } => tag.version !== null)
      .sort((a, b) => semver.rcompare(a.version, b.version));

    if (validTags.length === 0) {
      warning('No semver-compliant tags found in repository');
      return null;
    }

    const latestTag = validTags[0];
    info(`Found latest tag: ${latestTag.name} (${latestTag.version})`);
    return latestTag.name;
  });
}

/**
 * Gets the default branch for a repository
 * Handles rate limiting with exponential backoff
 *
 * @param {OctokitClient} octokit - The authenticated GitHub client
 * @param {string} owner - The owner of the repository
 * @param {string} repo - The name of the repository
 * @returns {Promise<string>} The name of the default branch
 */
async function getDefaultBranch(
  octokit: OctokitClient,
  owner: string,
  repo: string
): Promise<string> {
  return retryWithBackoff(async () => {
    const { data: repository } = await octokit.rest.repos.get({
      owner,
      repo
    });
    return repository.default_branch;
  });
}

/**
 * Checks if there's already a sync PR for the given tag
 *
 * @param {OctokitClient} octokit - The authenticated GitHub client
 * @param {string} owner - The owner of the repository
 * @param {string} repo - The name of the repository
 * @param {string} syncLabel - The label to search for
 * @returns {Promise<boolean>} True if a sync issue/PR exists
 */
async function checkExistingSync(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  syncLabel: string
): Promise<boolean> {
  return retryWithBackoff(async () => {
    const { data: searchResults } = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo}+label:"${syncLabel}"+is:pr`,
      per_page: 1
    });
    return searchResults.total_count > 0;
  });
}

/**
 * Creates a pull request in the target repository
 *
 * @param {OctokitClient} octokit - The authenticated GitHub client
 * @param {string} owner - The owner of the repository
 * @param {string} repo - The name of the repository
 * @param {string} title - The title of the pull request
 * @param {string} body - The body of the pull request
 * @param {string} head - The branch to merge from
 * @param {string} base - The branch to merge into
 * @param {string[]} labels - The labels to add to the pull request
 * @returns {Promise<number>} The number of the created pull request
 */
async function createPullRequest(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string,
  labels: string[]
): Promise<number> {
  return retryWithBackoff(async () => {
    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });

    if (labels.length > 0) {
      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: pr.number,
        labels
      });
    }

    return pr.number;
  });
}

/**
 * Main function that executes the sync workflow.
 * This function:
 * 1. Fetches the latest tag from the upstream repository
 * 2. Creates a new branch from that tag
 * 3. Creates a pull request to merge the changes
 *
 * @returns {Promise<void>} A promise that resolves when the sync is complete
 */
async function run(): Promise<void> {
  // Get inputs
  const targetRepo = getInput('target-repo', { required: true });
  const upstreamRepo = getInput('upstream-repo', { required: true });
  const token = getInput('github-token', { required: true });

  // Create octokit instance
  const octokit = getOctokit(token);

  info(`Checking for updates between ${targetRepo} and ${upstreamRepo}`);

  const [upstreamOwner, upstreamRepoName] = upstreamRepo.split('/');
  const [targetOwner, targetRepoName] = targetRepo.split('/');

  if (!upstreamOwner || !upstreamRepoName || !targetOwner || !targetRepoName) {
    throw new Error('Invalid repository format');
  }

  // Get latest upstream tag
  const latestTag = await getLatestTag(octokit, upstreamOwner, upstreamRepoName);
  if (!latestTag) {
    info('No valid tags found in upstream repository');
    return;
  }
  info(`Latest upstream tag: ${latestTag}`);

  const syncLabel = `sync/upstream-${latestTag}`;

  // Check for existing PR with the sync label
  const syncExists = await checkExistingSync(octokit, targetOwner, targetRepoName, syncLabel);
  if (syncExists) {
    info(`PR for label ${syncLabel} already exists or was previously processed`);
    return;
  }

  // Create branch name for the sync
  const branchName = `sync/upstream-${latestTag}`;

  // Get repository default branch
  const defaultBranch = await getDefaultBranch(octokit, targetOwner, targetRepoName);

  // Set up git configuration
  await exec('git', ['config', '--global', 'user.name', 'github-actions[bot]']);
  await exec('git', ['config', '--global', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

  // Add upstream remote and fetch the specific tag
  await exec('git', ['remote', 'add', 'upstream', `https://github.com/${upstreamRepo}.git`]);
  await exec('git', ['fetch', 'upstream', `refs/tags/${latestTag}:refs/tags/${latestTag}`, '--no-tags']);

  // Create and push the branch
  // NOTE: This assumes that the target branchName doesn't exist which it shouldn't, but a side effect is that
  // we won't update the branch if the corresponding upstream tag was updated.
  await exec('git', ['checkout', '-b', branchName, latestTag]);
  await exec('git', ['push', 'origin', branchName, '--force']);

  // Create pull request
  const prTitle = `Sync: Update to upstream ${latestTag}`;
  const prBody = `This PR syncs with upstream tag ${latestTag}.

## Details
- Source: ${upstreamRepo}@${latestTag}
- Target Branch: \`${defaultBranch}\`
- Sync Branch: \`${branchName}\`

This PR was automatically created by the sync action.`;

  const prNumber = await createPullRequest(
    octokit,
    targetOwner,
    targetRepoName,
    prTitle,
    prBody,
    branchName,
    defaultBranch,
    ['sync', syncLabel]
  );

  info(`Created PR #` + prNumber.toString() + ` to sync with ${latestTag}`);
}

try {
  await run();
} catch (err) {
  if (err instanceof Error) {
    setFailed(err.stack ? `${err.message}\n${err.stack}` : err.message);
  } else {
    setFailed("An unknown error occurred");
  }
}
