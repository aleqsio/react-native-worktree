<img width="1440" height="505" alt="Header" src="https://github.com/user-attachments/assets/c77276e5-fef4-46a7-9704-281bc9826cb4" />

# react-native-worktree

A mutex tool for react-native/Expo that allows multiple agents to write code at the same time in worktrees.

They can then use the ios simulator or the android emulator to test and the tool queues them up automatically.

# How it works

Each worktree runs its own Metro server on a unique port. Only one can use the device/simulator at a time **per platform**. This tool handles switching which Metro server the app connects to and coordinates access via per-platform cooperative locks.

# Install

```bash
npm install -g react-native-worktree
```

Install the Claude Code skill so agents know how to use it:

```bash
mkdir -p ~/.claude/skills/react-native-worktree && curl -fsSL https://raw.githubusercontent.com/aleqsio/react-native-worktree/main/skill/SKILL.md -o ~/.claude/skills/react-native-worktree/SKILL.md
```

# Quick Start

Start multiple Claude Code sessions. Each agent works in a worktree:

```
> Add a user authentication feature, take screenshots on ios and android simulators, use react-native-worktree
```

The agent will (guided by the skill):
1. Initialize the tool if needed (auto-detects bundle ID and platform)
2. Create a git worktree and register it with an auto-assigned port
3. Install dependencies and start Metro on that port
4. Call `react-native-worktree switch --platform ios` to acquire the device and preview
5. Heartbeat while you test, then release when done

Meanwhile, another agent in a separate session:

```
> Fix the navigation bug on the settings screen, take screenshots on ios and android simulators, use react-native-worktree
```

This agent creates its own worktree. When it needs the device, it calls `switch` — if the first agent still holds the lock for that platform, it waits automatically until the device is free.

## Deep dive

### Port Switching

**iOS Simulator** — writes `RCT_jsLocation` to the app's `NSUserDefaults`, then terminates and relaunches:

```
xcrun simctl spawn booted defaults write <bundleId> RCT_jsLocation "localhost:<port>"
xcrun simctl terminate booted <bundleId>
xcrun simctl launch booted <bundleId>
```

**Android Emulator** — remaps the default Metro port via `adb reverse`, then force-stops and relaunches:

```
adb reverse tcp:8081 tcp:<port>
adb shell am force-stop <packageName>
adb shell monkey -p <packageName> -c android.intent.category.LAUNCHER 1
```

No proxy, no native module, no app changes required.

### Mutex

File-based cooperative lock at `~/.rnwt/lock.json`, keyed by platform. iOS and Android locks are independent — two agents can hold different platform locks simultaneously.

- **`switch <name> --platform ios`** — acquire the iOS lock (or heartbeat if already held). If another agent holds it, blocks until released or stale.
- **`release --platform ios`** — free the iOS lock immediately.

The lock has a heartbeat/staleness model: each `switch` call updates a timestamp. If the holder stops calling (crashed, moved on), the timestamp goes stale after the inactivity timeout (default 60s) and another agent can take over. The `--timeout` flag on `switch` controls this inactivity threshold.

### Port Reclamation

When adding a worktree without `--port`, the tool probes all existing ports for running Metro servers. If any port has Metro stopped (the worktree's server was killed), it's reused. Otherwise, a new port is assigned as `max(all ports) + 1`.

## Commands

### `react-native-worktree init`

Initialize configuration. Auto-detects bundle ID from `app.json` / `app.config.js`.

```bash
react-native-worktree init                                  # auto-detect, ios only
react-native-worktree init --bundle-id com.myapp             # manual bundle ID
react-native-worktree init --platforms ios,android            # both platforms
```

### `react-native-worktree add <name>`

Register a worktree. Port auto-assigned (reuses dead ports, or increments from max).

```bash
react-native-worktree add feat-auth --path ../feat-auth
react-native-worktree add feat-auth --path ../feat-auth --port 9000
react-native-worktree add feat-auth --app com.myapp          # explicit app (multi-app)
```

### `react-native-worktree switch <name>`

Acquire the lock and switch the device to the worktree's Metro port.

```bash
react-native-worktree switch feat-auth                       # first configured platform
react-native-worktree switch feat-auth --platform ios        # explicit platform
react-native-worktree switch feat-auth --platform android    # independent Android lock
react-native-worktree switch feat-auth --timeout 120000      # 2min inactivity threshold
react-native-worktree switch feat-auth --app com.myapp       # explicit app
```

### `react-native-worktree release`

Release the lock for a platform so other agents can use the device.

```bash
react-native-worktree release                                # default: ios
react-native-worktree release --platform android
```

### `react-native-worktree status`

Show who holds the lock and for how long.

```
[ios] Runtime held by 'feat-auth' (port 8082), last active 5s ago
[android] Runtime held by 'fix-nav' (port 8083), last active 12s ago
```

```bash
react-native-worktree status                                 # all platforms
react-native-worktree status --platform ios                  # single platform
```

### `react-native-worktree list`

Show all registered worktrees with Metro running status, grouped by app.

```
com.myapp (ios, android)
  Name                Port    Metro     Lock
  -------------------------------------------------------
  main                8081    running
  feat-auth           8082    running   ios
  fix-nav             8083    stopped
```

```bash
react-native-worktree list                                   # all apps
react-native-worktree list --app com.myapp                   # single app
```

## Config

Stored at `~/.rnwt/config.json`:

```json
{
  "apps": {
    "com.example.myapp": {
      "platforms": ["ios", "android"],
      "worktrees": {
        "main": { "path": "/path/to/project", "port": 8081 },
        "feat-auth": { "path": "/path/to/feat-auth", "port": 8082 }
      }
    }
  }
}
```

Old single-app configs (`{ bundleId, platform, worktrees, nextPort }`) are auto-migrated on first load.

### Lock file

`~/.rnwt/lock.json` — keyed by platform:

```json
{
  "ios": { "holder": "feat-auth", "app": "com.example.myapp", "pid": 123, "updatedAt": "..." },
  "android": { "holder": "fix-nav", "app": "com.example.myapp", "pid": 456, "updatedAt": "..." }
}
```

## License

MIT
