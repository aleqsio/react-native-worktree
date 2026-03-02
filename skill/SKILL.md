---
name: react-native-worktree
description: Manage git worktrees for parallel React Native / Expo development. Covers creating worktrees (excluding native dirs), registering them with react-native-worktree, switching the device between Metro servers, and coordinating runtime access via the mutex lock.
user_invocable: true
---

# react-native-worktree — Multi-Agent Worktree Guide

You are an AI agent working on a React Native / Expo project alongside other agents. Each agent works in its own git worktree with its own Metro server. Only one agent can use the device/simulator at a time. `react-native-worktree` handles port switching and runtime coordination.

## Creating a Worktree (Lightweight)

Git worktrees share the `.git` object store, so they're cheap — but you should still exclude heavy generated directories that each worktree can regenerate on its own.

### Expo projects with Continuous Native Generation (CNG)

If `ios/` and `android/` are in `.gitignore` (standard for CNG projects), worktrees are already lightweight — those dirs won't be copied. Just create normally:

```bash
git worktree add ../my-feature -b my-feature
```

### Projects with tracked native directories

If `ios/` and `android/` are tracked in git, use sparse checkout to skip them:

```bash
# Create worktree without checking out files
git worktree add --no-checkout ../my-feature -b my-feature

# Configure sparse checkout to exclude native dirs
cd ../my-feature
git sparse-checkout set --no-cone '/*' '!ios/' '!android/'
git checkout
```

This saves significant disk space and creation time. The agent can run `npx expo prebuild` later if it specifically needs native files.

### Always exclude node_modules

`node_modules/` is gitignored and never copied by worktrees. Each worktree needs its own install:

```bash
cd ../my-feature
npm install   # or: yarn / bun install
```

## Registering and Using react-native-worktree

### First-time setup (once per machine, from any Expo project dir)

```bash
cd /path/to/main/project
react-native-worktree init                        # auto-detects bundleId from app.json
react-native-worktree add main --port 8081        # register the main project
```

### Registering your worktree

```bash
react-native-worktree add my-feature --path /path/to/my-feature
# Output: Added 'my-feature' on port 8083
# Output: Start Metro: cd /path/to/my-feature && npx expo start --port 8083
```

The port is auto-assigned. Start Metro on the assigned port:

```bash
cd /path/to/my-feature
npx expo start --port 8083
```

### Switching the device to your worktree

```bash
react-native-worktree switch my-feature
```

This does three things atomically:
1. Acquires the mutex lock (waits if another agent holds it)
2. Reconfigures the device to connect to your Metro port
3. Kills and relaunches the app

If another agent holds the lock, the command blocks and prints `Waiting for 'other-agent' to release...` until the lock is freed or goes stale (default: 30s).

### Heartbeat — keeping the lock alive

While you are actively using the device (user is testing, you're observing logs, etc.), periodically call switch again with the same name:

```bash
react-native-worktree switch my-feature   # refreshes timestamp, no app restart
```

This updates the lock timestamp so other agents know you're still active. If you stop calling, the lock goes stale after 30s and another agent can take over.

### Releasing the device

When done testing:

```bash
react-native-worktree release
```

Always release when you're finished so other agents don't have to wait for the stale timeout.

### Checking status

```bash
react-native-worktree status    # who holds the lock, how long ago
react-native-worktree list      # all worktrees, ports, Metro running status
```

## Typical Agent Workflow

```bash
# 1. Create worktree and set up
git worktree add ../feat-auth -b feat-auth
cd ../feat-auth
npm install
react-native-worktree add feat-auth --path $(pwd)
# note the assigned port from output

# 2. Start Metro on your assigned port
npx expo start --port <assigned-port>

# 3. When you need the device to preview your work
react-native-worktree switch feat-auth
# device restarts connected to your Metro

# 4. Keep the lock alive while user is testing
react-native-worktree switch feat-auth   # heartbeat every ~20s

# 5. Release when done
react-native-worktree release

# 6. Clean up when branch is merged
cd /path/to/main
git worktree remove ../feat-auth
```

## Important Rules

- **Always release the lock** when you're done with the device. Don't hog it.
- **Start Metro before switching.** `react-native-worktree switch` warns if Metro isn't running on your port, but it still acquires the lock.
- **Don't force-take the lock.** If another agent holds it, wait. The mutex exists to prevent app thrashing.
- **Heartbeat if holding long.** If you hold the lock for more than a few seconds, call `switch` again periodically to avoid stale timeout.
- **One port per worktree.** Don't change ports after registration. Other agents rely on the mapping.
