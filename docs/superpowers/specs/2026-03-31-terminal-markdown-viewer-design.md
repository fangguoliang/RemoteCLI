# Terminal Markdown Viewer Design Spec

**Date**: 2026-03-31
**Author**: fangguoliang

## Overview

Add a feature to RemoteCLI that allows users to click on markdown file paths displayed in the terminal output to open a fullscreen viewer/editor popup. This enables quick viewing and editing of markdown files generated during Claude Code usage on mobile devices.

## Requirements

### User Story

When using Claude Code through RemoteCLI on a mobile device, markdown files are frequently generated (specs, plans, documentation). Users need a convenient way to:
1. View these markdown files directly from terminal output
2. Edit them if needed
3. Save changes back to the Agent machine

### Key Requirements

- Detect `.md` file paths in terminal output (absolute and relative paths)
- Click to validate path existence via Agent
- Open fullscreen markdown viewer popup
- Default to render preview mode (mobile-friendly)
- Swipe left/right to switch between preview and edit modes
- Auto-sync saved content to Agent with completion notification

## Architecture

### Flow Diagram

```
Terminal Output → LinkMatcher detects .md path → User clicks →
file:validate request → Agent validates & returns full path →
file:downloadForView (in-memory) → MarkdownViewer popup opens (preview mode) →
Swipe right → Edit mode → Save → file:upload → Auto-sync → Toast notification
```

**Note**: Unlike regular file downloads that trigger browser file downloads, markdown preview requires content loaded into memory. A separate download method `downloadForView()` stores content in fileStore instead of triggering browser download.

### Components

#### Frontend (packages/web)

1. **MarkdownViewer.vue** - New component
   - Fullscreen overlay modal
   - md-editor-v3 integration (previewOnly for viewing, full editor for editing)
   - Swipe gesture detection (touch events)
   - Save button with sync status indicator

2. **TerminalTab.vue** - Modifications
   - Custom LinkMatcher for .md paths
   - Click handler to trigger validation request
   - Integration with MarkdownViewer component

3. **fileWebSocket.ts** - Add handlers
   - `file:validate` request sending
   - `file:validated` response handling

4. **stores/file.ts** - Add methods
   - `validateFilePath()` - request validation
   - State for current viewing file path

#### Backend (packages/shared, packages/agent)

1. **types.ts** - New message types
   ```typescript
   'file:validate' | 'file:validated'
   ```

2. **agent/src/file.ts** - Add validation handler

The existing `FileManager` class handles file operations but doesn't have access to session IDs or working directories. We need to add validation handling that bridges `FileManager` and `PtyManager`:

**Option A: Add validation method to FileManager with PtyManager dependency:**
```typescript
// In packages/agent/src/file.ts
import { ptyManager } from './pty';
import * as path from 'path';
import * as fs from 'fs';

export class FileManager {
  // ... existing methods ...

  // NEW: Validate file path with session context
  validatePath(payload: FileValidatePayload): FileValidatedPayload {
    const { path: inputPath, sessionId } = payload;

    // Get working directory from PtyManager
    const cwd = ptyManager.getWorkingDirectory(sessionId);
    if (!cwd) {
      return {
        originalPath: inputPath,
        resolvedPath: inputPath,
        exists: false,
        error: 'Session not found or no working directory'
      };
    }

    // Resolve relative paths
    let resolvedPath = inputPath;
    if (!inputPath.match(/^[A-Za-z]:/)) {
      resolvedPath = path.resolve(cwd, inputPath);
    }

    // Check existence
    const exists = fs.existsSync(resolvedPath);

    return {
      originalPath: inputPath,
      resolvedPath,
      exists,
      error: exists ? undefined : 'File not found'
    };
  }
}
```

**Option B (Recommended): Create separate validation handler that imports both managers:**
```typescript
// In packages/agent/src/validation.ts (new file)
import { ptyManager } from './pty';
import * as path from 'path';
import * as fs from 'fs';

export function validateFilePath(payload: FileValidatePayload): FileValidatedPayload {
  // Same implementation as above
}
```

3. **server/src/ws/router.ts** - Route new message types

Following existing pattern in router.ts (browser→agent messages go through one case block, agent→browser through another):

```typescript
// Add to existing browser-to-agent case block (around line handling 'file:browse' etc)
case 'file:validate':
  // Browser requests path validation
  if (session.agentId && message.sessionId) {
    tunnelManager.sendToAgent(session.agentId, {
      type: 'file:validate',
      payload: message.payload,
      sessionId: message.sessionId,
      timestamp: Date.now()
    });
  }
  break;

// Add to existing agent-to-browser case block (around line handling 'file:list' etc)
case 'file:validated':
  // Agent returns validation result
  if (message.sessionId) {
    tunnelManager.sendToBrowserSession(message.sessionId, {
      type: 'file:validated',
      payload: message.payload,
      timestamp: Date.now()
    });
  }
  break;
```

## Technical Details

### Path Detection Regex

```typescript
// Match .md file paths in various formats
// Simplified regex - may over-match slightly but acceptable for user-triggered action
// Excludes URLs (http/https) to avoid conflict with WebLinksAddon

const mdPathRegex = /[A-Za-z]:[\\/][^\s]+\.md|\.{1,2}[\\/][^\s]+\.md|(?:^(?![A-Za-z]:|https?:)[^\s]+\.md)/g;
```

**Test cases (for implementation verification):**
| Input | Expected Match | Notes |
|-------|----------------|-------|
| `D:\project\README.md` | `D:\project\README.md` | Absolute Windows path |
| `C:\Users\admin\docs\spec.md` | `C:\Users\admin\docs\spec.md` | Absolute Windows path |
| `./docs/spec.md` | `./docs/spec.md` | Relative with ./ prefix |
| `../README.md` | `../README.md` | Relative with ../ prefix |
| `docs/file.md` | `docs/file.md` | Simple relative path |
| `file.md` | `file.md` | Simple relative path |
| `Created file: D:\test.md` | `D:\test.md` | Embedded in text |
| `https://example.com/file.md` | Not matched | URL excluded |
| `http://docs/spec.md` | Not matched | URL excluded |
| `\\server\share\file.md` | Not matched | UNC paths excluded |
| `D:\my docs\file.md` | `D:\my` (truncated) | Space limitation - acceptable |

### Message Types

#### file:validate (Browser → Agent)

```typescript
interface FileValidatePayload {
  path: string;        // The detected path (may be relative)
  sessionId: string;   // Session to get working directory from
}
```

#### file:validated (Agent → Browser)

```typescript
interface FileValidatedPayload {
  originalPath: string;    // Original detected path
  resolvedPath: string;    // Full resolved path
  exists: boolean;         // Whether file exists
  error?: string;          // Error message if validation failed
}
```

### LinkMatcher Implementation

**Architecture Note**: `TerminalTab.vue` uses its own WebSocket connection for terminal I/O (the `ws` variable). File operations use a separate `fileWebSocket` service accessed through `useFileStore()`.

```typescript
// In TerminalTab.vue script setup section
import { useFileStore } from '@/stores/file';
import { fileWebSocket } from '@/services/fileWebSocket';

const fileStore = useFileStore();

// sessionId is tracked as local variable in TerminalTab.vue
// It's set when session:created message is received

// Register link matcher after terminal is initialized
terminal.registerLinkMatcher(mdPathRegex, (event, matchedPath) => {
  // Validate: fileWebSocket must be connected, sessionId must exist
  if (!sessionId) {
    console.warn('No session ID, cannot validate path');
    return;
  }

  // Set validation state in store (triggers MarkdownViewer to open on success)
  fileStore.setValidatingPath(matchedPath);

  // Send validation request via fileWebSocket
  fileWebSocket.validatePath(matchedPath, sessionId, props.tab.agentId);
}, {
  matchIndex: 0,
  priority: 0
});
```

**Integration Flow**:
1. LinkMatcher callback sets `fileStore.validatingPath` state
2. `fileWebSocket.validatePath()` sends `file:validate` message
3. On `file:validated` response, `fileWebSocket` handler updates store
4. `MarkdownViewer.vue` watches store state and opens popup

### Swipe Gesture Detection

```typescript
// In MarkdownViewer.vue
let touchStartX = 0;
let currentMode = 'preview'; // 'preview' | 'edit'

const handleTouchStart = (e: TouchEvent) => {
  touchStartX = e.touches[0].clientX;
};

const handleTouchEnd = (e: TouchEvent) => {
  const touchEndX = e.changedTouches[0].clientX;
  const deltaX = touchEndX - touchStartX;

  if (deltaX < -50) { // Swipe left → edit mode
    currentMode = 'edit';
  } else if (deltaX > 50) { // Swipe right → preview mode
    currentMode = 'preview';
  }
};
```

### Mode Transition

- **Preview Mode**: md-editor-v3 with `previewOnly="true"` prop
- **Edit Mode**: md-editor-v3 with full editor toolbar
- Transition animation: slide effect between modes

### File Sync Flow

1. User edits content
2. Clicks save button
3. Component sends `file:upload` with modified content
4. Shows "Syncing..." indicator
5. On `file:uploaded` success, shows "已同步到 Agent" toast (3s)
6. User can close popup (returns to terminal)

### Current Working Directory Resolution

**Problem**: Agent's `PtyManager` in `packages/agent/src/pty.ts` currently does not track working directory. The `PtySession` interface only stores `{ pty, sessionId, cols, rows, onDataCallback }`.

**Solution**: Extend PtyManager to track working directory per session.

#### Implementation Details

**1. Extend PtySession interface (packages/agent/src/pty.ts):**

```typescript
interface PtySession {
  pty: IPty;
  sessionId: string;
  cols: number;
  rows: number;
  onDataCallback: (data: string) => void;
  workingDirectory: string;  // NEW: Track current working directory
}
```

**2. Initialize working directory on PTY spawn:**

```typescript
// In PtyManager.createSession()
const pty = spawn('powershell.exe', [], {
  cols,
  rows,
  cwd: process.cwd(), // Initial working directory
  env: process.env
});

const session: PtySession = {
  pty,
  sessionId,
  cols,
  rows,
  onDataCallback,
  workingDirectory: process.cwd() // Initialize with spawn cwd
};
```

**3. Parse PowerShell prompt from output:**

```typescript
// Add prompt parser method to PtyManager
private parsePromptForDirectory(data: string): string | null {
  // PowerShell prompt format: "PS D:\project> " or "PS C:\Users\admin> "
  const promptMatch = data.match(/PS\s+([A-Za-z]:[^\r\n>]+)>/);
  if (promptMatch) {
    return promptMatch[1].trim();
  }
  return null;
}

// In onData handler, update working directory when prompt appears
pty.onData((data: string) => {
  const newDir = this.parsePromptForDirectory(data);
  if (newDir) {
    session.workingDirectory = newDir;
  }
  session.onDataCallback(data);
});
```

**4. Add getter method:**

```typescript
// In PtyManager
getWorkingDirectory(sessionId: string): string | null {
  const session = this.sessions.get(sessionId);
  return session?.workingDirectory ?? null;
}
```

**5. File validation handler uses PtyManager:**

```typescript
// In packages/agent/src/file.ts (or new validation handler)
import { ptyManager } from './pty';

// Handle file:validate message
const handleFileValidate = (payload: FileValidatePayload) => {
  const { path, sessionId } = payload;

  // Get working directory from session
  const cwd = ptyManager.getWorkingDirectory(sessionId);

  // Resolve path
  let resolvedPath = path;
  if (!path.match(/^[A-Za-z]:/)) {
    // Relative path - resolve against cwd
    resolvedPath = cwd ? path.resolve(cwd, path) : path;
  }

  // Check existence
  const exists = fs.existsSync(resolvedPath);

  return {
    originalPath: path,
    resolvedPath,
    exists
  };
};
```

### Agent Tunnel Handler

**Note**: Unlike other file operations, `file:validate` requires sessionId because it needs to resolve relative paths against the session's working directory.

```typescript
// In packages/agent/src/tunnel.ts

// Add to switch statement (handle incoming browser messages)
case 'file:validate':
  this.handleFileValidate(payload, sessionId);
  break;

// Add new handler method
private handleFileValidate(payload: FileValidatePayload, sessionId: string) {
  // Import the validation function from validation.ts
  const result = validateFilePath({ ...payload, sessionId });

  // Send result back to browser
  this.send({
    type: 'file:validated',
    sessionId,
    payload: result,
    timestamp: Date.now(),
  });
}
```

### Frontend WebSocket Service Methods

**fileWebSocket.ts additions:**

```typescript
// Validate a file path (returns via file:validated message)
validatePath(path: string, sessionId: string, agentId: string) {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not connected');
    return;
  }

  this.ws.send(JSON.stringify({
    type: 'file:validate',
    payload: { path, sessionId },
    sessionId,  // Include at message level for server routing
    timestamp: Date.now(),
  }));
}

// Download file for viewing (in-memory, not browser download)
// Uses a flag to distinguish from regular downloads
downloadForView(path: string, agentId: string) {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not connected');
    return;
  }

  // Store the path as "for viewing" flag
  this.viewingPath = path;

  this.ws.send(JSON.stringify({
    type: 'file:download',
    payload: { path },
    timestamp: Date.now(),
  }));
}

// Modified handleFileData to support in-memory viewing
private handleFileData(msg: Message) {
  const payload = msg.payload as FileDataPayload;

  // Check if this is a "for viewing" download
  if (this.viewingPath === payload.path) {
    // Assemble chunks in memory, store to fileStore when complete
    this.assembleViewContent(payload);
    return;
  }

  // Regular download: trigger browser file download
  // ... existing code ...
}
```

### File Store State Additions

**stores/file.ts additions:**

```typescript
// New state refs for markdown viewer
const validatingPath = ref<string | null>(null);    // Path being validated
const validatedPath = ref<ValidatedPath | null>(null); // Validation result
const viewerVisible = ref(false);                    // Viewer popup visibility
const viewerContent = ref<string>('');               // Markdown content in memory
const viewerLoading = ref(false);                    // Loading indicator
const viewerPath = ref<string>('');                  // Current viewing file path

interface ValidatedPath {
  originalPath: string;
  resolvedPath: string;
  exists: boolean;
}

// New methods
function setValidatingPath(path: string | null) {
  validatingPath.value = path;
}

function setValidatedPath(result: ValidatedPath | null) {
  validatedPath.value = result;
}

function setViewerVisible(visible: boolean) {
  viewerVisible.value = visible;
}

function setViewerContent(content: string) {
  viewerContent.value = content;
}

function setViewerLoading(loading: boolean) {
  viewerLoading.value = loading;
}

function setViewerPath(path: string) {
  viewerPath.value = path;
}

function clearViewer() {
  viewerVisible.value = false;
  viewerContent.value = '';
  viewerPath.value = '';
  validatedPath.value = null;
  validatingPath.value = null;
}
```

## UI/UX Specifications

### MarkdownViewer Layout

```
┌─────────────────────────────────────┐
│ ← Back         file.md       [Save] │  Header bar
├─────────────────────────────────────┤
│                                     │
│                                     │
│     Markdown Content Area           │  Main content
│     (preview or edit)               │
│                                     │
│                                     │
├─────────────────────────────────────┤
│   ← Swipe to edit | Swipe right →   │  Hint bar (optional)
└─────────────────────────────────────┤
```

### Visual States

1. **Loading**: Spinner while fetching file content
2. **Preview**: Rendered markdown with styled dark theme
3. **Edit**: Editor with toolbar, syntax highlighting
4. **Saving**: "Syncing..." overlay
5. **Saved**: Green toast notification "已同步到 Agent"

### Dark Theme Colors (consistent with existing)

- Background: `#1E1E1E`
- Header: `#252526`
- Border: `#3C3C3C`
- Text: `#D4D4D4`
- Accent: `#FF8E53` (headers, highlights)
- Success: `#4CAF50` (save confirmation)

## Error Handling

### Path Validation Errors

| Scenario | Handling |
|----------|----------|
| File not found | Toast: "文件不存在" |
| Path invalid | Toast: "路径格式无效" |
| Agent offline | Toast: "Agent 离线" |
| Network error | Toast: "网络连接失败" |

### File Operation Errors

| Scenario | Handling |
|----------|----------|
| Download failed | Toast: "文件加载失败" |
| Upload failed | Toast: "同步失败，请重试" |
| Permission denied | Toast: "无权限访问此文件" |

## Testing Considerations

### Unit Tests

- Path regex matching for various formats
- Swipe gesture detection logic
- Message payload validation

### Integration Tests

- Full flow: click → validate → load → edit → save
- Relative path resolution accuracy
- Offline Agent handling

### Manual Testing Checklist

- [ ] Click absolute path (D:\path\file.md)
- [ ] Click relative path (./docs/spec.md)
- [ ] Click relative path (../README.md)
- [ ] Click relative path (docs/file.md)
- [ ] Click relative path (file.md)
- [ ] Swipe left to enter edit mode
- [ ] Swipe right to return preview mode
- [ ] Edit and save successfully
- [ ] Handle non-existent file click
- [ ] Handle Agent offline scenario

## File Changes Summary

| Package | File | Action | Description |
|---------|------|--------|-------------|
| shared | `src/types.ts` | Modify | Add `file:validate`, `file:validated` message types and `FileValidatePayload`, `FileValidatedPayload` interfaces |
| agent | `src/pty.ts` | Modify | Extend `PtySession` interface to include `workingDirectory`, add `getWorkingDirectory()` method, parse PowerShell prompts |
| agent | `src/validation.ts` | Create | New file validation handler with dependency on PtyManager |
| agent | `src/tunnel.ts` | Modify | Handle `file:validate` and `file:validated` message routing |
| server | `src/ws/router.ts` | Modify | Add switch cases for routing `file:validate` and `file:validated` messages |
| web | `package.json` | Modify | Add `md-editor-v3` dependency |
| web | `components/MarkdownViewer.vue` | Create | New fullscreen markdown viewer/editor component with swipe gesture support |
| web | `components/TerminalTab.vue` | Modify | Add LinkMatcher for .md paths, import fileWebSocket, integrate MarkdownViewer |
| web | `services/fileWebSocket.ts` | Modify | Add `validatePath()` method and `file:validated` response handler, add `downloadForView()` method |
| web | `stores/file.ts` | Modify | Add `validatingPath`, `viewerContent`, `viewerVisible` state and methods |

## Implementation Order

1. **shared/types.ts** - Add `file:validate`, `file:validated` message types and payload interfaces
2. **agent/src/pty.ts** - Extend PtySession with workingDirectory, add getWorkingDirectory() method
3. **agent/src/validation.ts** - Create file validation handler module
4. **agent/src/tunnel.ts** - Handle file:validate/file:validated messages
5. **server/src/ws/router.ts** - Add message routing switch cases
6. **web/package.json** - Add md-editor-v3 dependency
7. **web/services/fileWebSocket.ts** - Add validatePath() and downloadForView() methods
8. **web/stores/file.ts** - Add viewer state and methods
9. **web/components/MarkdownViewer.vue** - Create component
10. **web/components/TerminalTab.vue** - Add LinkMatcher and integration

## Out of Scope

- Other file types (.txt, .json, etc.)
- Directory path clicking
- Multiple file selection
- File creation from popup
- File rename/delete operations