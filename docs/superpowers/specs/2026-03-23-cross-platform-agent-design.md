# Cross-Platform Agent Support Design

**Date:** 2026-03-23
**Status:** Draft
**Author:** Claude

## Overview

Extend the remoteCli agent to support Linux and macOS terminals, in addition to the existing Windows PowerShell support. The agent will automatically detect the platform and use the appropriate shell.

## Goals

1. Single npm package works on Windows, Linux, and macOS
2. Automatic platform detection and shell selection
3. Graceful degradation if preferred shell is unavailable
4. Auto-start service installation for Linux (systemd) and macOS (launchd)
5. Descriptive agent names including hostname for multi-device identification

## Non-Goals

- Custom shell configuration (user cannot specify alternative shells)
- Runtime shell selection from the frontend
- Windows Service support for auto-start (deferred to future work)

## Shell Selection

### Default Shells and Fallback Chain

| Platform | Primary Shell | Fallback 1 | Fallback 2 |
|----------|--------------|------------|------------|
| Windows | `powershell.exe` | `cmd.exe` | - |
| macOS | `/bin/zsh` | `/bin/bash` | `/bin/sh` |
| Linux | `/bin/bash` | `/bin/sh` | - |

### Detection Logic

```typescript
function getShell(): { shell: string; args: string[] } {
  const platform = process.platform;

  if (platform === 'win32') {
    // Check PowerShell exists, fallback to cmd
    if (shellExists('powershell.exe')) {
      return { shell: 'powershell.exe', args: [] };
    }
    return { shell: 'cmd.exe', args: [] };
  }

  if (platform === 'darwin') {
    // macOS: zsh -> bash -> sh
    if (shellExists('/bin/zsh')) {
      return { shell: '/bin/zsh', args: ['-l'] };
    }
    if (shellExists('/bin/bash')) {
      return { shell: '/bin/bash', args: ['-l'] };
    }
    return { shell: '/bin/sh', args: ['-l'] };
  }

  // Linux: bash -> sh
  if (shellExists('/bin/bash')) {
    return { shell: '/bin/bash', args: ['-l'] };
  }
  return { shell: '/bin/sh', args: ['-l'] };
}

function shellExists(shell: string): boolean {
  // On Windows, check via `where` command
  // On Unix, check via fs.existsSync or `which`
}
```

## Agent Naming

### Format

```
${PlatformName} (${hostname})
```

### Examples

- `Linux (my-server)`
- `macOS (MacBook-Pro)`
- `Windows (DESKTOP-ABC)`

### Platform Names

| Platform | Display Name |
|----------|-------------|
| `win32` | `Windows` |
| `darwin` | `macOS` |
| `linux` | `Linux` |

### Implementation

```typescript
function getAgentName(): string {
  const platform = process.platform;
  const hostname = os.hostname();

  const platformNames: Record<string, string> = {
    'win32': 'Windows',
    'darwin': 'macOS',
    'linux': 'Linux',
  };

  const platformName = platformNames[platform] || platform;
  return `${platformName} (${hostname})`;
}
```

## File Changes

### `packages/agent/src/pty.ts`

- Add `getShell()` function with platform detection and fallback logic
- Add `shellExists()` helper function
- Modify `PtyManager.create()` to use `getShell()` instead of hardcoded `powershell.exe`
- Use login shell args (`-l`) for Unix shells to load user profile

### `packages/agent/src/tunnel.ts`

- Modify `register()` method to use `getAgentName()` instead of hardcoded `'Windows PowerShell'`

### `packages/agent/src/shell.ts` (new file)

- Export `getShell()` and `shellExists()` functions
- Export `getAgentName()` function

## Auto-Start Service Scripts

### Directory Structure

```
packages/agent/
├── scripts/
│   ├── install-service.sh
│   └── uninstall-service.sh
└── templates/
    ├── remotecli-agent.service    # systemd template
    └── com.remotecli.agent.plist  # launchd template
```

### Linux (systemd)

**Service Template (`remotecli-agent.service`):**

```ini
[Unit]
Description=remoteCli Agent
After=network.target

[Service]
Type=simple
User=%USER%
WorkingDirectory=%INSTALL_DIR%
ExecStart=%INSTALL_DIR%/node_modules/.bin/tsx src/index.ts
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Install Script Actions:**
1. Detect Linux distribution
2. Copy service file to `/etc/systemd/system/remotecli-agent.service`
3. Replace placeholders with actual values
4. Run `systemctl daemon-reload`
5. Run `systemctl enable remotecli-agent`
6. Run `systemctl start remotecli-agent`

### macOS (launchd)

**LaunchAgent Template (`com.remotecli.agent.plist`):**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.remotecli.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>%INSTALL_DIR%/node_modules/.bin/tsx</string>
        <string>%INSTALL_DIR%/src/index.ts</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/remotecli-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/remotecli-agent.log</string>
</dict>
</plist>
```

**Install Script Actions:**
1. Copy plist to `~/Library/LaunchAgents/com.remotecli.agent.plist`
2. Replace placeholders with actual values
3. Run `launchctl load ~/Library/LaunchAgents/com.remotecli.agent.plist`

### Install Script Usage

```bash
# Install service
./scripts/install-service.sh

# Uninstall service
./scripts/uninstall-service.sh
```

## Testing Plan

1. **Unit Tests**
   - Test `getShell()` returns correct shell for each platform
   - Test fallback logic when primary shell doesn't exist
   - Test `getAgentName()` format

2. **Integration Tests**
   - Test PTY creation with selected shell on each platform
   - Test session persistence works across platforms

3. **Manual Testing**
   - Install agent on Ubuntu, macOS, Windows
   - Verify terminal works correctly
   - Verify service installation scripts work

## Migration Notes

- Existing Windows users: No changes required, continues using PowerShell
- Agent name will change from `'Windows PowerShell'` to `'Windows (hostname)'`
- Session persistence is unaffected by this change

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Shell not found on minimal Linux | Fallback to `/bin/sh` which is always available |
| Service script permissions | Require sudo for Linux, run as user for macOS |
| Hostname contains special chars | Sanitize hostname for service file names |