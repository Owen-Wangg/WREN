---
inclusion: always
---

# Git Best Practices

## Command Execution

When using git commands that could produce paginated or interactive scrollable output, always use the `-P` flag to ensure output is displayed directly without pagination. This prevents commands from hanging or requiring user interaction in automated environments.

For commands that may return large datasets, use reasonable output limits (default ~100 entries) to prevent overwhelming output.

Commands that should use `-P` with appropriate limits:

```bash
# Viewing commit history (limit to recent entries)
git -P log -n 100
git -P log --oneline -n 100
git -P log --graph --oneline -n 100

# Viewing differences
git -P diff
git -P diff --cached
git -P diff HEAD~1

# Viewing file content and blame
git -P show
git -P blame <file>

# Viewing configuration and remote information
git -P config --list
git -P remote -v

# Viewing branch information (limit output)
git -P branch -a | head -100
git -P branch -r | head -100

# Viewing tag information (limit output)
git -P tag -l | head -100
```

Other git commands like `git status`, `git add`, `git commit`, and `git checkout` typically don't require `-P` as they don't produce paginated output by default.

## Committing Changes

Follow the git best practice of committing early and often. Run `git commit` often, but DO NOT ever run `git push`.

BEFORE committing a change, ALWAYS build the package to verify the change.

## Commit Messages

All commit messages should follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <subject line>

[optional body]

[optional footer(s)]

sim: <SIM URL>
```

Types:
- feat: A new feature
- fix: A bug fix
- docs: Documentation only changes
- style: Changes that do not affect the meaning of the code
- refactor: A code change that neither fixes a bug nor adds a feature
- perf: A code change that improves performance
- test: Adding missing tests or correcting existing tests
- chore: Changes to the build process or auxiliary tools
- ci: Changes to CI configuration files and scripts

Best practices:
- Use the imperative mood ("add" not "added" or "adds")
- Don't end the subject line with a period
- Limit the subject line to 50 characters
- Capitalize the subject line
- Separate subject from body with a blank line
- Use the body to explain what and why vs. how
- Wrap the body at 72 characters

Example:
```
feat(lambda): Add Go implementation of DDB stream forwarder

Replace Node.js Lambda function with Go implementation to reduce cold
start times. The new implementation supports forwarding to multiple SQS
queues and maintains the same functionality as the original.
```

## Repository Integrity Rules

These rules ensure project integrity while allowing practical development workflows. The key principle: **once a commit exists in the remote repository, it's immutable**.

### 1. Never delete or corrupt Git internals
- The `.git` directory must never be modified directly
- Never run commands that would delete or corrupt Git history
- Do not use `git filter-branch` or similar commands that destructively rewrite history

### 2. Remote history is sacrosanct
- Never force push (`git push --force` or `git push -f`)
- Never rewrite, amend, or rebase commits that have been pushed
- Once pushed to remote, commits are permanent — fix forward with new commits

### 3. Local history can be cleaned before sharing
**Important**: Always `git fetch` before assuming commits are local-only. CRUX auto-merge can push commits to remote without explicit user action — commits that appear local may already exist in the remote repository.

The following are acceptable for commits that have **not** been pushed (only exist locally):
- Amending the most recent commit (`git commit --amend`)
- Soft/mixed reset to restructure unpushed work (`git reset --soft`, `git reset`)

Do not use interactive mode with rebase (`git rebase -i`) — it doesn't work well in CLI environments.

**Squashing commits:**

To squash commits from a feature branch onto the main branch:
1. Fetch the latest remote state (`git fetch`)
2. Checkout the main branch (`git checkout mainline`)
3. Squash the commits from the feature branch onto mainline (`git merge --squash $FEATURE_BRANCH_NAME`)
4. Commit the squashed content with a high quality commit message

To squash commits within a single branch:
1. Ensure your working directory is clean (no uncommitted changes)
2. Fetch the latest remote state (`git fetch`)
3. Reset to the point where your local work diverged (`git reset --soft origin/mainline`)
4. Commit the squashed content with a high quality commit message

Avoid even locally:
- Hard reset (`git reset --hard`) — too easy to lose work
- Cleaning untracked files (`git clean`) — might have important uncommitted work

### 4. Never push changes off host
- All Git operations must remain on the local system
- Do not configure remote repositories
- Do not attempt to push to external services
- Keep all repository data contained within the project directory

### Emergency Recovery

If these rules are accidentally violated:
1. STOP IMMEDIATELY — Do not attempt further Git operations that might compound the problem
2. Document what happened and what was lost and inform the user
3. Consider creating a new branch from the last known good state
4. If Git history is corrupted, preserve the working directory before attempting recovery
