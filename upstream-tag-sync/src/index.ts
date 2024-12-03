import { getInput, info, warning, setFailed } from '@actions/core';
import { getOctokit } from '@actions/github';
import { exec as execCommand } from '@actions/exec';
import type { components } from '@octokit/openapi-types';

interface TagInfo {
    name: string;
    version: string | null;
}

type Tag = components['schemas']['tag'];
import semver from 'semver';

type OctokitClient = ReturnType<typeof getOctokit>;

/**
 * Gets the name of the latest semver-compliant tag from a GitHub repository
 * @param {OctokitClient} octokit - Configured Octokit instance
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<string|null>} Latest tag name or null if no valid tags found
 */
async function getLatestTag(octokit: OctokitClient, owner: string, repo: string): Promise<string | null> {
    try {
        const { data: tags } = await octokit.rest.repos.listTags({
            owner,
            repo,
            per_page: 100
        });

        if (tags.length === 0) {
            return null;
        }

        const latestTag = tags
            .map((tag: Tag) => ({
                name: tag.name,
                version: semver.valid(semver.clean(tag.name))
            }))
            .filter((tag: TagInfo) => tag.version !== null)
            .sort((a: TagInfo, b: TagInfo) => semver.rcompare(a.version!, b.version!))[0];

        return latestTag ? latestTag.name : null;
    } catch (error) {
        if (error instanceof Error) {
            console.error('Error:', error.message);
        }
        throw error;
    }
}

async function run(): Promise<void> {
    // Get inputs
    const targetRepo = getInput('target-repo', { required: true });
    const upstreamRepo = getInput('upstream-repo', { required: true });
    const token = getInput('github-token', { required: true });

    // Create octokit instance
    const octokit = getOctokit(token);

    info(`Checking for updates between ${targetRepo} and ${upstreamRepo}`);

    // Get latest upstream tag
    const [upstreamOwner, upstreamRepoName] = upstreamRepo.split('/');
    if (!upstreamOwner || !upstreamRepoName) {
        throw new Error('Invalid upstream repository format');
    }

    const latestTag = await getLatestTag(octokit, upstreamOwner, upstreamRepoName);
    if (!latestTag) {
        info('No valid tags found in upstream repository');
        return;
    }
    info(`Latest upstream tag: ${latestTag}`);

    // Check for existing PR
    const [targetOwner, targetRepoName] = targetRepo.split('/');
    if (!targetOwner || !targetRepoName) {
        throw new Error('Invalid target repository format');
    }

    const labelName = `sync/upstream-${latestTag}`;

    const { data: searchResults } = await octokit.rest.search.issuesAndPullRequests({
        q: `repo:${targetOwner}/${targetRepoName} is:pr label:"${labelName}"`,
        per_page: 1
    });

    if (searchResults.total_count > 0) {
        info(`PR for tag ${latestTag} already exists or was previously processed`);
        return;
    }

    // Set up git configuration
    await execCommand('git', ['config', '--global', 'user.name', 'github-actions[bot]']);
    await execCommand('git', ['config', '--global', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

    // Add upstream remote and fetch
    await execCommand('git', ['remote', 'add', 'upstream', `https://github.com/${upstreamRepo}.git`]);
    await execCommand('git', ['fetch', 'upstream', '--tags']);

    // Create and switch to new branch
    const branchName = `sync/upstream-${latestTag}`;
    await execCommand('git', ['checkout', '-b', branchName]);

    let hasConflicts = false;
    let mergeMessage = '';

    // Attempt to merge the upstream tag
    try {
        await execCommand('git', ['merge', latestTag]);
        mergeMessage = 'Successfully merged upstream tag';
        info(mergeMessage);
    } catch (error) {
        hasConflicts = true;
        mergeMessage = 'Merge conflicts detected. Manual resolution required.';
        warning(mergeMessage);

        // Instead of hard reset, we'll push the conflicting state
        // This allows reviewers to resolve conflicts manually
        await execCommand('git', ['add', '.']);
        await execCommand('git', ['commit', '--no-verify', '-m', 'WIP: Sync with upstream (conflicts to resolve)']);
    }

    // Push to origin (with or without conflicts)
    await execCommand('git', [
        'push',
        `https://x-access-token:${token}@github.com/${targetRepo}.git`,
        branchName,
        '--force-with-lease'
    ]);

    // Get repository default branch
    const { data: repo } = await octokit.rest.repos.get({
        owner: targetOwner,
        repo: targetRepoName
    });
    const defaultBranch = repo.default_branch;

    // Common parts of the PR message
    const commonHeader = `This PR ${hasConflicts ? 'attempts to' : ''} sync your fork with the upstream repository's tag ${latestTag}.`;
    const commonChanges = `## Changes included:
- ${hasConflicts ? 'Attempted merge' : 'Successfully merged'} with tag ${latestTag}
- Updates from: https://github.com/${upstreamRepo}`;
    const commonFooter = `You can safely delete the \`${branchName}\` branch afterward.`;

    // Create PR with appropriate message
    const conflictInstructions = `## ⚠️ Merge Conflicts Detected
This PR contains merge conflicts that need to be resolved manually. Please:
1. Checkout this branch locally
2. Resolve the conflicts
3. Push the resolved changes back to this branch

### Next Steps:
1. Resolve conflicts between your customizations and upstream changes
2. Once conflicts are resolved:
   - If you want to sync to this tag: merge the PR
   - If you don't want to sync: close the PR
3. ${commonFooter}`;

    const normalInstructions = `Please review the changes and:
- If you want to sync to this tag: merge the PR
- If you don't want to sync: close the PR

${commonFooter}`;

    const prBody = `${commonHeader}

${hasConflicts ? conflictInstructions : normalInstructions}

${commonChanges}`;

    const { data: pr } = await octokit.rest.pulls.create({
        owner: targetOwner,
        repo: targetRepoName,
        title: hasConflicts
            ? `[Conflicts] Sync with upstream tag ${latestTag}`
            : `Sync with upstream tag ${latestTag}`,
        head: branchName,
        base: defaultBranch,
        body: prBody
    });

    // Add appropriate labels
    const labels = [labelName];
    if (hasConflicts) {
        labels.push('merge-conflicts');
    }

    await octokit.rest.issues.addLabels({
        owner: targetOwner,
        repo: targetRepoName,
        issue_number: pr.number,  // Note that PRs are also issues on GitHub
        labels: labels
    });

    info(`Created PR #${pr.number}${hasConflicts ? ' with merge conflicts' : ''}`);
}

try {
    await run();
} catch (err: unknown) {
    setFailed(err instanceof Error ? err.message : 'An unknown error occurred');
}
