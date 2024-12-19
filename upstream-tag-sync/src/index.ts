import { getInput, info, setFailed } from '@actions/core';
import { getOctokit } from '@actions/github';
import { exec } from '@actions/exec';
import semver from 'semver';

type OctokitClient = ReturnType<typeof getOctokit>;

/**
 * Retries a function with exponential backoff when rate limits are hit
 *
 * @param {() => Promise<T>} operation - The async operation to retry
 * @param {number} maxAttempts - Maximum number of retry attempts
 * @param {number} baseDelay - Initial delay in milliseconds
 * @returns {Promise<T>} The result of the operation
 * @throws {Error} Throws if max attempts reached or non-rate-limit error occurs
 */
async function retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 5,
    baseDelay: number = 1000
): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (err) {
            const error = err as Error;
            const isRateLimit = error.message.includes('rate limit') ||
                error.message.includes('secondary rate limit');

            if (!isRateLimit || attempt === maxAttempts) {
                throw error;
            }

            const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
            info(`Rate limit hit, attempt ${attempt}/${maxAttempts}. Waiting ${Math.round(delay / 1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error('Should not reach here due to throw in loop');
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
    repo: string,
    attempt: number = 1,
    maxAttempts: number = 5,
    baseDelay: number = 1000
): Promise<string | null> {
    info(`Fetching tags for ${owner}/${repo}`);

    try {
        const tags: Array<{ name: string }> = [];
        const iterator = octokit.paginate.iterator(octokit.rest.repos.listTags, {
            owner,
            repo,
            per_page: 100
        });

        for await (const { data: pageTags } of iterator) {
            tags.push(...pageTags);
            info(`Fetched ${tags.length} tags so far...`);

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
            info('No semver-compliant tags found in repository');
            return null;
        }

        const latestTag = validTags[0];
        info(`Found latest tag: ${latestTag.name} (${latestTag.version})`);
        return latestTag.name;

    } catch (err) {
        const error = err as Error;
        if (attempt >= maxAttempts) {
            throw new Error(`Failed to fetch tags after ${maxAttempts} attempts: ${error.message}`);
        }

        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000, 60000); // Cap at 60 seconds
        info(`Error fetching tags (attempt ${attempt}/${maxAttempts}), waiting ${Math.round(delay / 1000)}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));

        return getLatestTag(octokit, owner, repo, attempt + 1, maxAttempts, baseDelay);
    }
}

/**
 * Creates an issue in the target repository to track the sync operation
 * Handles rate limiting with exponential backoff
 *
 * @param {OctokitClient} octokit - The authenticated GitHub client
 * @param {string} owner - The owner of the repository
 * @param {string} repo - The name of the repository
 * @param {string} title - The title of the issue
 * @param {string} body - The body content of the issue
 * @returns {Promise<number>} The number of the created issue
 */
async function createSyncIssue(
    octokit: OctokitClient,
    owner: string,
    repo: string,
    title: string,
    body: string,
    syncLabel: string
): Promise<number> {
    return retryWithBackoff(async () => {
        const { data: issue } = await octokit.rest.issues.create({
            owner,
            repo,
            title,
            body,
            labels: ['sync', syncLabel]
        });
        return issue.number;
    });
}

/**
 * Updates an existing issue with new content
 * Handles rate limiting with exponential backoff
 *
 * @param {OctokitClient} octokit - The authenticated GitHub client
 * @param {string} owner - The owner of the repository
 * @param {string} repo - The name of the repository
 * @param {number} issueNumber - The issue number to update
 * @param {string} body - The new body content for the issue
 * @returns {Promise<void>}
 */
async function updateIssue(
    octokit: OctokitClient,
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
): Promise<void> {
    await retryWithBackoff(() =>
        octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            body
        })
    );
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
 * Checks if there's already a sync issue/PR for the given tag
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
            q: `repo:${owner}/${repo}+label:"${syncLabel}"+is:open+is:issue`,
            per_page: 1
        });
        return searchResults.total_count > 0;
    });
}

/**
 * Main function that executes the sync workflow.
 * This function:
 * 1. Fetches the latest tag from the upstream repository
 * 2. Creates a new branch from that tag
 * 3. Creates an issue with instructions for creating a PR
 *
 * Required action inputs:
 * - target-repo: The repository to sync (format: owner/repo)
 * - upstream-repo: The repository to sync from (format: owner/repo)
 * - github-token: GitHub token with necessary permissions
 *
 * @returns {Promise<void>}
 */
async function run(): Promise<void> {
    try {
        const targetRepo = getInput('target-repo', { required: true });
        const upstreamRepo = getInput('upstream-repo', { required: true });
        const token = getInput('github-token', { required: true });

        const octokit = getOctokit(token);

        // Parse repository information
        const [upstreamOwner, upstreamRepoName] = upstreamRepo.split('/');
        const [targetOwner, targetRepoName] = targetRepo.split('/');

        if (!upstreamOwner || !upstreamRepoName || !targetOwner || !targetRepoName) {
            throw new Error('Invalid repository format');
        }

        // Get latest upstream tag with retries
        const latestTag = await getLatestTag(octokit, upstreamOwner, upstreamRepoName);
        if (!latestTag) {
            info('No valid tags found in upstream repository');
            return;
        }

        // Check for existing sync with this tag
        const syncLabel = `sync/upstream-${latestTag}`;
        const syncExists = await checkExistingSync(octokit, targetOwner, targetRepoName, syncLabel);
        if (syncExists) {
            info(`Sync for tag ${latestTag} already exists or was previously processed`);
            return;
        }

        // Get repository default branch with retries
        const defaultBranch = await getDefaultBranch(octokit, targetOwner, targetRepoName);

        // Set up git configuration
        await exec('git', ['config', '--global', 'user.name', 'github-actions[bot]']);
        await exec('git', ['config', '--global', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

        // Add upstream remote and fetch the specific tag
        await exec('git', ['remote', 'add', 'upstream', `https://github.com/${upstreamRepo}.git`]);
        await exec('git', ['fetch', 'upstream', `refs/tags/${latestTag}:refs/tags/${latestTag}`, '--no-tags']);

        // Create and push the branch
        const branchName = `sync/upstream-${latestTag}`;
        await exec('git', ['checkout', '-b', branchName, latestTag]);
        await exec('git', [
            'push',
            'origin',
            branchName,
            '--force'
        ]);

        // First create issue without the PR URL
        const branchUrl = `https://github.com/${targetRepo}/tree/${branchName}`;
        const initialIssueBody = `A sync branch has been created with ${upstreamRepo} tag ${latestTag}.

## Branch Details
- Branch name: \`${branchName}\`
- Base branch: \`${defaultBranch}\`
- Upstream tag: ${latestTag}

## Next Steps
1. [View the branch](${branchUrl})
2. Create a pull request (link will be updated)

You can create a pull request to see any potential conflicts.`;

        // Create the issue with retries
        const issueNumber = await createSyncIssue(
            octokit,
            targetOwner,
            targetRepoName,
            `[Action] Sync branch created for ${latestTag}`,
            initialIssueBody,
            syncLabel
        );

        // Now create the PR URL with the issue number
        const prTitle = encodeURIComponent(`Sync: Update to upstream ${latestTag}`);
        const prBody = encodeURIComponent(`Syncs with upstream tag ${latestTag}\n\nCloses #${issueNumber}`);
        const createPrUrl = `https://github.com/${targetRepo}/compare/${defaultBranch}...${branchName}?quick_pull=1&title=${prTitle}&body=${prBody}`;

        // Update the issue with the PR URL
        const finalIssueBody = `A sync branch has been created with ${upstreamRepo} tag ${latestTag}.

## Branch Details
- Branch name: \`${branchName}\`
- Base branch: \`${defaultBranch}\`
- Upstream tag: ${latestTag}

## Next Steps
1. [View the branch](${branchUrl})
2. [Create a pull request](${createPrUrl})

You can create a pull request using the link above to see any potential conflicts.`;

        // Update the issue with retries
        await updateIssue(octokit, targetOwner, targetRepoName, issueNumber, finalIssueBody);

        info(`Created issue #${issueNumber} and prepared PR URL with auto-close functionality`);

    } catch (error) {
        setFailed(error instanceof Error ? error.message : 'An unknown error occurred');
    }
}

run();
