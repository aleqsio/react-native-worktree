---
name: react-native-worktree
description: Manage git worktrees for parallel React Native / Expo development. Covers creating worktrees (excluding native dirs), registering them with react-native-worktree, switching the device between Metro servers, and coordinating runtime access via per-platform mutex locks.
user_invocable: true
---

# react-native-worktree — Multi-Agent Worktree Guide

You are an AI agent working on a React Native / Expo project alongside other agents. Each agent works in its own git worktree with its own Metro server. Only one agent can use the device/simulator at a time **per platform**. `react-native-worktree` handles port switching and runtime coordination.

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
react-native-worktree init                                 # auto-detects bundleId, default platform: ios
react-native-worktree init --platforms ios,android          # both platforms
react-native-worktree add main --port 8081                 # register the main project
```

### Registering your worktree

```bash
react-native-worktree add my-feature --path /path/to/my-feature
# Output: Added 'my-feature' on port 8083 (app: com.myapp)
# Output: Start Metro: cd /path/to/my-feature && npx expo start --port 8083
```

The port is auto-assigned. If a previously registered worktree's Metro is dead, its port is reused automatically. Start Metro on the assigned port:

```bash
cd /path/to/my-feature
npx expo start --port 8083
```

### Multi-app projects

If you have multiple apps configured, specify which one:

```bash
react-native-worktree add my-feature --app com.myapp --path /path/to/my-feature
```

If only one app is configured, `--app` is auto-detected.

### Switching the device to your worktree

```bash
react-native-worktree switch my-feature                    # uses first configured platform
react-native-worktree switch my-feature --platform ios     # explicit platform
react-native-worktree switch my-feature --platform android # independent Android lock
```

This does three things atomically:
1. Acquires the mutex lock **for that platform** (waits if another agent holds it)
2. Reconfigures the device to connect to your Metro port
3. Kills and relaunches the app

iOS and Android locks are **independent** — one agent can hold the iOS lock while another holds Android. If another agent holds the lock for your platform, the command blocks and prints `Waiting for 'other-agent' to release...` until the lock is freed or goes stale.

The `--timeout` flag controls the **inactivity threshold** — how long a lock can sit without a heartbeat before another agent can reclaim it. It does NOT limit how long the waiting agent will poll.

### Heartbeat — keeping the lock alive

While you are actively using the device, periodically call switch again:

```bash
react-native-worktree switch my-feature --platform ios   # refreshes timestamp, no app restart
```

This updates the lock timestamp so other agents know you're still active. If you stop calling, the lock goes stale after 60s and another agent can take over.

### Releasing the device

When done testing:

```bash
react-native-worktree release --platform ios
react-native-worktree release --platform android
```

Always release when you're finished so other agents don't have to wait for the stale timeout. Each platform is released independently.

### Checking status

```bash
react-native-worktree status                    # all platform locks
react-native-worktree status --platform ios      # just iOS
react-native-worktree list                       # all apps and worktrees
react-native-worktree list --app com.myapp       # filter by app
```

## Typical Agent Workflow

```bash
# 1. Create worktree and set up
git worktree add ../feat-auth -b feat-auth
cd ../feat-auth
npm install
react-native-worktree add feat-auth --path $(pwd)
# note the assigned port from output (may reuse a dead port)

# 2. Start Metro on your assigned port
npx expo start --port <assigned-port>

# 3. When you need the device to preview your work
react-native-worktree switch feat-auth --platform ios
# device restarts connected to your Metro

# 4. Keep the lock alive while user is testing
react-native-worktree switch feat-auth --platform ios   # heartbeat every ~20s

# 5. Release when done
react-native-worktree release --platform ios

# 6. Clean up when branch is merged
cd /path/to/main
git worktree remove ../feat-auth
```

## CRITICAL: Lock Before Any Device Operation

**You MUST call `react-native-worktree switch <name> --platform <platform>` and hold the lock BEFORE any operation that touches the simulator or emulator.** This includes:

- Taking screenshots of the app
- Reading simulator/emulator logs
- Running `xcrun simctl` commands
- Running `adb` commands against the device
- Any UI testing or visual inspection
- Launching or restarting the app

If you do not hold the lock, another agent may switch the device out from under you at any moment, causing your operation to hit the wrong app state or fail entirely. **Always acquire first, then interact with the device.**

## Important Rules

- **Lock before touching the device.** Every `xcrun simctl`, `adb`, screenshot, or log read requires you to hold the lock for that platform. No exceptions.
- **Always release the lock** when you're done with the device. Don't hog it.
- **Start Metro before switching.** `react-native-worktree switch` warns if Metro isn't running on your port, but it still acquires the lock.
- **Don't force-take the lock.** If another agent holds it, wait. The mutex exists to prevent app thrashing.
- **Heartbeat if holding long.** If you hold the lock for more than a few seconds, call `switch` again periodically to avoid the inactivity timeout (default 60s).
- **One port per worktree.** Don't change ports after registration. Other agents rely on the mapping.
- **`--timeout` is the inactivity threshold**, not a wait limit. It controls how long a lock survives without heartbeats. The waiting agent polls forever until the lock is free.
- **iOS and Android are independent.** You can hold both platform locks simultaneously if needed, and two different agents can hold different platform locks at the same time.
- **Port reuse is automatic.** When adding a worktree without `--port`, dead Metro ports are reclaimed. You don't need to manage port numbers manually.
