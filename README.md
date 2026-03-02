# react-native-worktree

Metro port switcher with mutex for multi-agent React Native development.

Multiple AI agents (or developers) work on different git worktrees of the same Expo app simultaneously. Each worktree runs its own Metro server on a unique port. Only one can use the device/simulator at a time. This tool handles switching which Metro server the app connects to and coordinates access via a cooperative lock.

## Install

```bash
npm install -g react-native-worktree
```

## Quick Start

### 1. Initialize (once, in your Expo project)

```bash
cd my-expo-app
react-native-worktree init                    # auto-detects bundle ID from app.json
react-native-worktree add main --port 8081    # register the main project
```

### 2. Install the Claude Code skill

Copy `skill/SKILL.md` into your Claude Code skills directory:

```bash
mkdir -p ~/.claude/skills/react-native-worktree
cp skill/SKILL.md ~/.claude/skills/react-native-worktree/SKILL.md
```

This teaches agents how to create worktrees, register them, manage the mutex, and exclude native directories for faster setup.

### 3. Tell agents to use it

Start multiple Claude Code sessions. Each agent works in a worktree:

```
> Add a user authentication feature, use react-native-worktree
```

The agent will (guided by the skill):
1. Create a git worktree and register it with an auto-assigned port
2. Install dependencies and start Metro on that port
3. Call `react-native-worktree switch` to acquire the device and preview
4. Heartbeat while you test, then release when done

Meanwhile, another agent in a separate session:

```
> Fix the navigation bug on the settings screen, use react-native-worktree
```

This agent creates its own worktree. When it needs the device, it calls `switch` — if the first agent still holds the lock, it waits automatically until the device is free.

## How It Works

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

File-based cooperative lock at `~/.rnwt/lock.json`. Two operations:

- **`switch <name>`** — acquire the lock (or heartbeat if already held). If another agent holds it, blocks until released or stale.
- **`release`** — free the lock immediately.

The lock has a heartbeat/staleness model: each `switch` call updates a timestamp. If the holder stops calling (crashed, moved on), the timestamp goes stale after a timeout (default 30s) and another agent can take over.

## Commands

### `react-native-worktree init`

Initialize configuration. Auto-detects bundle ID from `app.json` / `app.config.js`.

```bash
react-native-worktree init                          # auto-detect
react-native-worktree init --bundle-id com.myapp    # manual
react-native-worktree init --platform android       # default: ios
```

### `react-native-worktree add <name>`

Register a worktree. Port auto-increments from 8082.

```bash
react-native-worktree add feat-auth --path ../feat-auth
react-native-worktree add feat-auth --path ../feat-auth --port 9000
```

### `react-native-worktree switch <name>`

Acquire the lock and switch the device to the worktree's Metro port.

```bash
react-native-worktree switch feat-auth              # acquire + switch + relaunch
react-native-worktree switch feat-auth              # heartbeat (same holder, no restart)
react-native-worktree switch feat-auth --timeout 60000  # custom stale timeout
```

### `react-native-worktree release`

Release the lock so other agents can use the device.

### `react-native-worktree status`

Show who holds the lock and for how long.

```
Runtime held by 'feat-auth' (port 8082), last active 5s ago
```

### `react-native-worktree list`

Show all registered worktrees with Metro running status.

```
Name                Port    Metro     Lock
--------------------------------------------------
main                8081    running
feat-auth           8082    running   held
fix-nav             8083    stopped
```

## Config

Stored at `~/.rnwt/config.json`:

```json
{
  "bundleId": "com.example.myapp",
  "platform": "ios",
  "worktrees": {
    "main": { "path": "/path/to/project", "port": 8081 },
    "feat-auth": { "path": "/path/to/feat-auth", "port": 8082 }
  },
  "nextPort": 8083
}
```

## License

MIT
