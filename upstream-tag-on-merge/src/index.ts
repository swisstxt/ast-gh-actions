import { getInput, info, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import type { PullRequest } from "@octokit/webhooks-types";

type OctokitClient = ReturnType<typeof getOctokit>;

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

function extractTagFromBranch(branchName: string): string | null {
  const match = /^sync\/upstream-(.+)$/.exec(branchName);
  return match ? match[1] : null;
}

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

// Type guard for PullRequest
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
