import { getInput, info, setFailed } from '@actions/core';
import { context, getOctokit } from '@actions/github';

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
    maxAttempts: number = 5,
    baseDelay: number = 1000
): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (err) {
            const error = err as Error;
            const isRateLimit = error.message.includes('rate limit');

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
 * Extracts the tag name from the PR branch name
 * Expected format: sync/upstream-v1.2.3
 *
 * @param branchName - The branch name
 * @returns {string|null} The tag name or null if not found
 */
function extractTagFromBranch(branchName: string): string | null {
    const match = branchName.match(/^sync\/upstream-(.+)$/);
    return match ? match[1] : null;
}

/**
 * Creates a tag and pushes it to the repository
 *
 * @param octokit - Configured Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param tagName - The tag name
 * @param sha - The commit SHA to tag
 * @param message - The tag message
 * @returns {Promise<void>} A promise that resolves when the tag is created
 * @throws {Error} If the tag creation fails
 */
async function createAndPushTag(
    octokit: OctokitClient,
    owner: string,
    repo: string,
    tagName: string,
    sha: string,
    message: string
): Promise<void> {
    await retryWithBackoff(async () => {
        // Create the tag object
        const { data: tag } = await octokit.rest.git.createTag({
            owner,
            repo,
            tag: tagName,
            message,
            object: sha,
            type: 'commit'
        });

        // Create the reference for the tag
        await octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/tags/${tagName}`,
            sha: tag.sha
        });
    });
}

/**
 * Main function that executes when a PR is merged.
 * This function:
 * 1. Checks if the merged PR was from a sync branch
 * 2. Extracts the tag name from the branch
 * 3. Creates and pushes the tag
 *
 * @returns {Promise<void>} A promise that resolves when the tag is created
 */
async function run(): Promise<void> {
    // Only proceed if this is a merged PR
    if (!context.payload.pull_request?.merged) {
        info('This is not a merged PR. Skipping.');
        return;
    }

    const token = getInput('github-token', { required: true });
    const octokit = getOctokit(token);

    const pr = context.payload.pull_request;
    const branchName = pr.head.ref;
    const tagName = extractTagFromBranch(branchName);

    if (!tagName) {
        info('This PR is not from a sync branch. Skipping.');
        return;
    }

    const { owner, repo } = context.repo;
    const message = `Tag created from sync PR #${pr.number}`;

    info(`Creating tag ${tagName} at commit ${pr.merge_commit_sha}`);
    await createAndPushTag(
        octokit,
        owner,
        repo,
        tagName,
        pr.merge_commit_sha,
        message
    );

    info(`Successfully created tag ${tagName}`);
}

try {
    await run();
} catch (err: unknown) {
    setFailed(err instanceof Error ? err.message : 'An unknown error occurred');
}
