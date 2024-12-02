import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';

async function run() {
    try {
        // Get inputs
        const targetRepo = core.getInput('target-repo', { required: true });
        const upstreamRepo = core.getInput('upstream-repo', { required: true });
        const token = core.getInput('github-token', { required: true });

        // Create octokit instance
        const octokit = github.getOctokit(token);

        core.info(`Checking for updates between ${targetRepo} and ${upstreamRepo}`);

        // Get latest upstream tag
        const [upstreamOwner, upstreamRepoName] = upstreamRepo.split('/');
        const { data: tags } = await octokit.rest.repos.listTags({
            owner: upstreamOwner,
            repo: upstreamRepoName,
            per_page: 1
        });

        if (!tags.length) {
            core.info('No tags found in upstream repository');
            return;
        }

        const latestTag = tags[0].name;
        core.info(`Latest upstream tag: ${latestTag}`);

        // Check for existing PR
        const [targetOwner, targetRepoName] = targetRepo.split('/');
        const labelName = `sync/upstream-${latestTag}`;

        const { data: searchResults } = await octokit.rest.search.issuesAndPullRequests({
            q: `repo:${targetOwner}/${targetRepoName} is:pr label:"${labelName}"`,
            per_page: 1
        });

        if (searchResults.total_count > 0) {
            core.info(`PR for tag ${latestTag} already exists or was previously processed`);
            return;
        }

        // Set up git configuration
        await exec.exec('git', ['config', '--global', 'user.name', 'github-actions[bot]']);
        await exec.exec('git', ['config', '--global', 'user.email', 'github-actions[bot]@users.noreply.github.com']);

        // Add upstream remote and fetch
        await exec.exec('git', ['remote', 'add', 'upstream', `https://github.com/${upstreamRepo}.git`]);
        await exec.exec('git', ['fetch', 'upstream', '--tags']);

        // Create and switch to new branch
        const branchName = `sync/upstream-${latestTag}`;
        await exec.exec('git', ['checkout', '-b', branchName]);

        let hasConflicts = false;
        let mergeMessage = '';

        // Attempt to merge the upstream tag
        try {
            await exec.exec('git', ['merge', latestTag]);
            mergeMessage = 'Successfully merged upstream tag';
            core.info(mergeMessage);
        } catch (error) {
            hasConflicts = true;
            mergeMessage = 'Merge conflicts detected. Manual resolution required.';
            core.warning(mergeMessage);

            // Instead of hard reset, we'll push the conflicting state
            // This allows reviewers to resolve conflicts manually
            await exec.exec('git', ['add', '.']);
            await exec.exec('git', ['commit', '--no-verify', '-m', 'WIP: Sync with upstream (conflicts to resolve)']);
        }

        // Push to origin (with or without conflicts)
        await exec.exec('git', ['push',
            `https://x-access-token:${token}@github.com/${targetRepo}.git`,
            branchName,
            '--force'
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
            issue_number: pr.number,
            labels: labels
        });

        core.info(`Created PR #${pr.number}${hasConflicts ? ' with merge conflicts' : ''}`);

    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
