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
file:download content → MarkdownViewer popup opens (preview mode) →
Swipe right → Edit mode → Save → file:upload → Auto-sync → Toast notification
```

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

2. **agent/src/file.ts** - New handler
   - Receive `file:validate` request
   - Get current working directory from PTY process
   - Resolve relative path to absolute path
   - Check if file exists
   - Return `file:validated` response

3. **server/src/ws/router.ts** - Route new message type
   - Forward `file:validate` to Agent
   - Forward `file:validated` back to browser

## Technical Details

### Path Detection Regex

```typescript
// Match .md file paths in various formats
const mdPathRegex = new RegExp(
  // Absolute Windows paths: D:\path\file.md, C:\Users\...\file.md
  '[A-Za-z]:[\\\\/][^\\s]*\\.md' +
  '|' +
  // Relative paths with ./ or ../ prefix
  '\\.\\.?[\\\\/][^\\s]*\\.md' +
  '|' +
  // Simple relative paths: docs/file.md, file.md
  '(?<![A-Za-z]:)[^\\s\\\\/][^\\s]*\\.md',
  'g'
);
```

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

Use xterm.js addon system or inline link matching:

```typescript
// In TerminalTab.vue
terminal.registerLinkMatcher(mdPathRegex, (event, matchedPath) => {
  // Send validation request
  fileWebSocket.validatePath(matchedPath, sessionId);
}, {
  matchIndex: 0,
  priority: 0
});
```

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

Agent maintains session working directory:
- On PTY spawn, record initial directory
- Monitor `cd` commands in terminal output
- Parse PowerShell prompt: `PS D:\project>` format
- Store in session state for path resolution

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
| shared | `src/types.ts` | Modify | Add `file:validate`, `file:validated` message types and payload interfaces |
| web | `components/MarkdownViewer.vue` | Create | New fullscreen markdown viewer/editor component |
| web | `components/TerminalTab.vue` | Modify | Add LinkMatcher for .md paths, integrate MarkdownViewer |
| web | `services/fileWebSocket.ts` | Modify | Add validate method and validated response handler |
| web | `stores/file.ts` | Modify | Add file validation state and methods |
| agent | `src/file.ts` | Modify | Add file validation handler with path resolution |
| server | `src/ws/router.ts` | Modify | Route file:validate and file:validated messages |

## Implementation Order

1. shared/types.ts - Add message types
2. agent/src/file.ts - Add validation handler
3. server/src/ws/router.ts - Add message routing
4. web/services/fileWebSocket.ts - Add validate method
5. web/stores/file.ts - Add validation state
6. web/components/MarkdownViewer.vue - Create component
7. web/components/TerminalTab.vue - Add LinkMatcher and integration

## Out of Scope

- Other file types (.txt, .json, etc.)
- Directory path clicking
- Multiple file selection
- File creation from popup
- File rename/delete operations