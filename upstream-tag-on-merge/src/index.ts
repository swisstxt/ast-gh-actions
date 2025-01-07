import { getInput, info, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import type { PullRequest } from "@octokit/webhooks-types";

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
 * Extracts a tag name from a branch name that follows the sync/upstream-{tag} format
 *
 * @param branchName - The name of the branch to extract the tag from
 * @returns {string | null} The extracted tag name, or null if the branch name doesn't match the expected format
 */
function extractTagFromBranch(branchName: string): string | null {
  const match = /^sync\/upstream-(.+)$/.exec(branchName);
  return match ? match[1] : null;
}

/**
 * Creates and pushes a new Git tag
 *
 * @param octokit - The Octokit client instance
 * @param owner - The repository owner
 * @param repo - The repository name
 * @param tagName - The name of the tag to create
 * @param sha - The commit SHA to tag
 * @param message - The tag message
 * @returns {Promise<void>}
 * @throws {Error} If creating or pushing the tag fails
 */
async function createAndPushTag(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  tagName: string,
  sha: string,
  message: string,
): Promise<void> {
  await retryWithBackoff(async () => {
    const { data: tag } = await octokit.rest.git.createTag({
      owner,
      repo,
      tag: tagName,
      message,
      object: sha,
      type: "commit",
    });

    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/tags/${tagName}`,
      sha: tag.sha,
    });
  });
}

/**
 * Main function that processes a merged pull request and creates a tag if appropriate
 *
 * @returns {Promise<void>}
 * @throws {Error} If the merge commit SHA is undefined or if tag creation fails
 */
async function run(): Promise<void> {
  const pr = context.payload.pull_request;

  if (!pr || !isPullRequest(pr) || !pr.merged) {
    info("This is not a merged PR. Skipping.");
    return;
  }

  const token = getInput("github-token", { required: true });
  const octokit = getOctokit(token);

  const branchName = pr.head.ref;
  const tagName = extractTagFromBranch(branchName);

  if (!tagName) {
    info("This PR is not from a sync branch. Skipping.");
    return;
  }

  const { owner, repo } = context.repo;
  const prNumber = pr.number;
  const message = `Tag created from sync PR ` + prNumber.toString();

  if (!pr.merge_commit_sha) {
    throw new Error("Merge commit SHA is undefined");
  }

  info(`Creating tag ${tagName} at commit ${pr.merge_commit_sha}`);
  await createAndPushTag(
    octokit,
    owner,
    repo,
    tagName,
    pr.merge_commit_sha,
    message,
  );

  info(`Successfully created tag ${tagName}`);
}

/**
 * Type guard to check if an object is a valid PullRequest
 *
 * @param obj - The object to check
 * @returns {boolean} True if the object is a valid PullRequest, false otherwise
 */
function isPullRequest(obj: unknown): obj is PullRequest {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "merged" in obj &&
    "head" in obj &&
    "number" in obj &&
    "merge_commit_sha" in obj
  );
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
