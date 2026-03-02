# react-native-worktree

Metro port switcher with mutex for multi-agent React Native development.

Multiple AI agents (or developers) work on different git worktrees of the same Expo app simultaneously. Each worktree runs its own Metro server on a unique port. Only one can use the device/simulator at a time. This tool handles switching which Metro server the app connects to and coordinates access via a cooperative lock.

## Install

```bash
npm install -g react-native-worktree
```

## Quick Start

```bash
# In your Expo project directory
rnwt init                          # auto-detects bundle ID from app.json
rnwt add main --port 8081          # register the main project

# Create a worktree and register it
git worktree add ../feat-auth -b feat-auth
rnwt add feat-auth --path ../feat-auth    # auto-assigns port 8082

# Start Metro in the worktree
cd ../feat-auth && npx expo start --port 8082

# Switch the device to the worktree
rnwt switch feat-auth              # acquires lock, restarts app on port 8082
rnwt switch feat-auth              # heartbeat (refreshes lock, no restart)
rnwt release                       # done, release for others
```

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

### `rnwt init`

Initialize configuration. Auto-detects bundle ID from `app.json` / `app.config.js`.

```bash
rnwt init                          # auto-detect
rnwt init --bundle-id com.myapp    # manual
rnwt init --platform android       # default: ios
```

### `rnwt add <name>`

Register a worktree. Port auto-increments from 8082.

```bash
rnwt add feat-auth --path ../feat-auth
rnwt add feat-auth --path ../feat-auth --port 9000
```

### `rnwt switch <name>`

Acquire the lock and switch the device to the worktree's Metro port.

```bash
rnwt switch feat-auth              # acquire + switch + relaunch
rnwt switch feat-auth              # heartbeat (same holder, no restart)
rnwt switch feat-auth --timeout 60000  # custom stale timeout
```

### `rnwt release`

Release the lock so other agents can use the device.

### `rnwt status`

Show who holds the lock and for how long.

```
Runtime held by 'feat-auth' (port 8082), last active 5s ago
```

### `rnwt list`

Show all registered worktrees with Metro running status.

```
Name                Port    Metro     Lock
--------------------------------------------------
main                8081    running
feat-auth           8082    running   held
fix-nav             8083    stopped
```

## Multi-Agent Usage

Designed for multiple Claude Code instances (or similar AI agents) working in parallel:

```bash
# Agent A (working on feat-auth):
rnwt switch feat-auth          # acquires lock, app switches to feat-auth
rnwt switch feat-auth          # heartbeat while user tests
rnwt release                   # done

# Agent B (working on fix-nav, while A holds the lock):
rnwt switch fix-nav            # blocks: "Waiting for feat-auth to release..."
                               # ...A releases...
                               # lock acquired, app switches to fix-nav
```

If an agent crashes without releasing, the lock goes stale after 30s and the next agent takes over automatically.

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
