const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');

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
        const [upstreamOwner, upstreamRepo_] = upstreamRepo.split('/');
        const { data: tags } = await octokit.rest.repos.listTags({
            owner: upstreamOwner,
            repo: upstreamRepo_,
            per_page: 1
        });

        if (!tags.length) {
            core.info('No tags found in upstream repository');
            return;
        }

        const latestTag = tags[0].name;
        core.info(`Latest upstream tag: ${latestTag}`);

        // Check for existing PR
        const [targetOwner, targetRepo_] = targetRepo.split('/');
        const { data: pulls } = await octokit.rest.pulls.list({
            owner: targetOwner,
            repo: targetRepo_,
            state: 'open',
            head: `${targetOwner}:sync/upstream-${latestTag}`
        });

        if (pulls.length > 0) {
            core.info(`PR for tag ${latestTag} already exists`);
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

        // Reset to upstream tag
        await exec.exec('git', ['reset', '--hard', latestTag]);

        // Push to origin
        const githubToken = token;
        await exec.exec('git', ['push',
            `https://x-access-token:${githubToken}@github.com/${targetRepo}.git`,
            branchName,
            '--force'
        ]);

        // Create PR
        const { data: pr } = await octokit.rest.pulls.create({
            owner: targetOwner,
            repo: targetRepo_,
            title: `Sync with upstream tag ${latestTag}`,
            head: branchName,
            base: 'main',
            body: `This PR syncs your fork with the upstream repository's tag ${latestTag}.

      ## Changes included:
      - Merges all changes up to tag ${latestTag}
      - Updates from: https://github.com/${upstreamRepo}

      Please review the changes and merge if everything looks good.`
        });

        // Add label to PR
        await octokit.rest.issues.addLabels({
            owner: targetOwner,
            repo: targetRepo_,
            issue_number: pr.number,
            labels: ['sync-upstream']
        });

        core.info(`Created PR #${pr.number}`);

    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
