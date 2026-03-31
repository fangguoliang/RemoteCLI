# Terminal Markdown Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable .md file path detection in terminal output, opening a fullscreen markdown viewer/editor with swipe-to-edit and auto-sync to Agent.

**Architecture:** xterm.js LinkMatcher detects paths → WebSocket validation → Agent resolves relative paths via working directory tracking → Fullscreen md-editor-v3 popup with preview/edit modes → Auto-upload on save.

**Tech Stack:** Vue 3, Pinia, xterm.js, md-editor-v3, WebSocket, node-pty

---

## File Structure

```
packages/
├── shared/src/types.ts          # Add file:validate/file:validated types
├── agent/src/
│   ├── pty.ts                   # Extend PtySession with workingDirectory
│   ├── validation.ts            # NEW: file path validation logic
│   └── tunnel.ts                # Handle file:validate message
├── server/src/ws/router.ts      # Route new message types
└── web/src/
    ├── components/
    │   ├── MarkdownViewer.vue   # NEW: fullscreen viewer/editor
    │   └── TerminalTab.vue      # Add LinkMatcher
    ├── services/fileWebSocket.ts # Add validatePath, downloadForView
    └── stores/file.ts           # Add viewer state
```

---

### Task 1: Add Message Types to Shared Package

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add new message types to MessageType union**

Add `file:validate` and `file:validated` to the existing MessageType union:

```typescript
// In packages/shared/src/types.ts
// Find the MessageType union and add new types
export type MessageType =
  | 'auth'
  | 'auth:result'
  | 'register'
  | 'register:result'
  | 'session:create'
  | 'session:start'
  | 'session:input'
  | 'session:output'
  | 'session:resize'
  | 'session:close'
  | 'ping'
  | 'pong'
  | 'file:browse'
  | 'file:list'
  | 'file:upload'
  | 'file:progress'
  | 'file:uploaded'
  | 'file:download'
  | 'file:data'
  | 'file:error'
  | 'file:validate'      // NEW
  | 'file:validated';    // NEW
```

- [ ] **Step 2: Add payload interfaces**

Add the new payload interfaces after existing file interfaces:

```typescript
// In packages/shared/src/types.ts, after FileErrorPayload

export interface FileValidatePayload {
  path: string;        // The detected path (may be relative)
  sessionId: string;   // Session to get working directory from
}

export interface FileValidatedPayload {
  originalPath: string;    // Original detected path
  resolvedPath: string;    // Full resolved path
  exists: boolean;         // Whether file exists
  error?: string;          // Error message if validation failed
}
```

- [ ] **Step 3: Commit changes**

```bash
cd packages/shared && git add src/types.ts && git commit -m "feat(shared): add file:validate and file:validated message types"
```

---

### Task 2: Extend PtyManager with Working Directory Tracking

**Files:**
- Modify: `packages/agent/src/pty.ts`

- [ ] **Step 1: Extend PtySession interface**

Add `workingDirectory` property at the end of the interface to preserve existing property order:

```typescript
// In packages/agent/src/pty.ts
export interface PtySession {
  pty: pty.IPty;
  sessionId: string;
  cols: number;
  rows: number;
  onDataCallback: ((data: string) => void) | null;
  workingDirectory: string;  // NEW: Track current working directory
}
```

- [ ] **Step 2: Initialize workingDirectory in create() method**

Find the `create()` method and add workingDirectory initialization. Around line 34-40, modify the session creation:

```typescript
// In PtyManager.create() method
const cwd = process.platform === 'win32'
  ? (process.env.USERPROFILE || process.cwd())
  : (process.env.HOME || process.cwd());

// ... pty spawn code ...

const session: PtySession = {
  pty: ptyProcess,
  sessionId,
  cols,
  rows,
  onDataCallback: onData,
  workingDirectory: cwd,  // NEW: Initialize with spawn cwd
};
```

- [ ] **Step 3: Add prompt parser method to PtyManager class**

Add a new private method after the `get()` method:

```typescript
// In PtyManager class
private parsePromptForDirectory(data: string): string | null {
  // PowerShell prompt format: "PS D:\project> " or "PS C:\Users\admin> "
  const promptMatch = data.match(/PS\s+([A-Za-z]:[^\r\n>]+)>/);
  if (promptMatch) {
    return promptMatch[1].trim();
  }
  return null;
}
```

- [ ] **Step 4: Update onData handler to track directory changes**

Find the `ptyProcess.onData()` callback in the `create()` method and add prompt parsing. Around line 42-52:

```typescript
// In PtyManager.create(), modify the onData handler
ptyProcess.onData((data) => {
  // NEW: Update working directory from PowerShell prompt
  const newDir = this.parsePromptForDirectory(data);
  if (newDir) {
    session.workingDirectory = newDir;
  }

  if (session.onDataCallback) {
    session.onDataCallback(data);
  } else {
    // Buffer output if no callback (paused session)
    const buffer = this.sessionBuffers.get(sessionId);
    if (buffer) {
      buffer.push(data);
    }
  }
});
```

- [ ] **Step 5: Add getWorkingDirectory() public method**

Add a new public method after the `has()` method:

```typescript
// In PtyManager class
getWorkingDirectory(sessionId: string): string | null {
  const session = this.sessions.get(sessionId);
  return session?.workingDirectory ?? null;
}
```

- [ ] **Step 6: Commit changes**

```bash
cd packages/agent && git add src/pty.ts && git commit -m "feat(agent): add working directory tracking to PtyManager"
```

---

### Task 3: Create File Validation Handler

**Files:**
- Create: `packages/agent/src/validation.ts`

- [ ] **Step 1: Create validation.ts file**

Create the new file with path validation logic:

```typescript
// packages/agent/src/validation.ts
import * as path from 'path';
import * as fs from 'fs';
import { PtyManager } from './pty.js';
import type { FileValidatePayload, FileValidatedPayload } from '@remotecli/shared';

export function validateFilePath(
  payload: FileValidatePayload,
  ptyManager: PtyManager
): FileValidatedPayload {
  const { path: inputPath, sessionId } = payload;

  // Get working directory from PtyManager
  const cwd = ptyManager.getWorkingDirectory(sessionId);
  if (!cwd) {
    return {
      originalPath: inputPath,
      resolvedPath: inputPath,
      exists: false,
      error: 'Session not found or no working directory',
    };
  }

  // Resolve relative paths
  let resolvedPath = inputPath;
  if (!inputPath.match(/^[A-Za-z]:/)) {
    // Relative path - resolve against cwd
    resolvedPath = path.resolve(cwd, inputPath);
  }

  // Check existence
  let exists = false;
  try {
    exists = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile();
  } catch {
    exists = false;
  }

  return {
    originalPath: inputPath,
    resolvedPath,
    exists,
    error: exists ? undefined : 'File not found',
  };
}
```

- [ ] **Step 2: Commit changes**

```bash
cd packages/agent && git add src/validation.ts && git commit -m "feat(agent): add file path validation module"
```

---

### Task 4: Handle file:validate in Agent Tunnel

**Files:**
- Modify: `packages/agent/src/tunnel.ts`

- [ ] **Step 1: Import validation function**

Add import at the top of the file:

```typescript
// In packages/agent/src/tunnel.ts, after existing imports
import { validateFilePath } from './validation.js';
```

- [ ] **Step 2: Add file:validate case to handleMessage switch**

Find the switch statement in `handleMessage()` and add the new case after `case 'file:upload'`:

```typescript
// In Tunnel.handleMessage(), add to switch statement
case 'file:validate':
  this.handleFileValidate(payload, sessionId);
  break;
```

- [ ] **Step 3: Add handleFileValidate method**

Add the new handler method after `handleFileUpload()`:

```typescript
// In Tunnel class, after handleFileUpload method
private handleFileValidate(payload: FileValidatePayload, sessionId?: string) {
  if (!sessionId) {
    this.send({
      type: 'file:validated',
      payload: {
        originalPath: payload.path,
        resolvedPath: payload.path,
        exists: false,
        error: 'No session ID provided',
      },
      timestamp: Date.now(),
    });
    return;
  }

  const result = validateFilePath(
    { path: payload.path, sessionId },
    this.ptyManager
  );

  this.send({
    type: 'file:validated',
    sessionId,
    payload: result,
    timestamp: Date.now(),
  });
}
```

**Note**: Import `FileValidatePayload` type at the top of the file:
```typescript
import type { FileValidatePayload } from '@remotecli/shared';
```

- [ ] **Step 4: Commit changes**

```bash
cd packages/agent && git add src/tunnel.ts && git commit -m "feat(agent): handle file:validate messages in tunnel"
```

---

### Task 5: Route file:validate Messages in Server

**Files:**
- Modify: `packages/server/src/ws/router.ts`

- [ ] **Step 1: Add file:validate case for browser-to-agent routing**

Find the switch statement and add after `case 'file:upload'` (around line 110):

```typescript
// In handleMessage switch, after file operations block
case 'file:validate':
  // Browser requests path validation
  // Note: Requires sessionId for working directory resolution
  if (sessionId) {
    const browser = tunnelManager.getBrowser(ws);
    if (browser?.agentId) {
      tunnelManager.routeToAgent(browser.agentId, message);
    } else {
      ws.send(JSON.stringify({
        type: 'file:validated',
        payload: {
          originalPath: payload?.path,
          resolvedPath: '',
          exists: false,
          error: 'No agent session',
        },
        timestamp: Date.now(),
      }));
    }
  }
  break;
```

- [ ] **Step 2: Add file:validated case for agent-to-browser routing**

Find the agent-to-browser file message cases (around line 112-127) and add:

```typescript
// In handleMessage switch, with other agent-to-browser cases
case 'file:validated':
  // Agent returns validation result to specific browser session
  if (isAgent && sessionId) {
    tunnelManager.routeToBrowser(sessionId, message);
  }
  break;
```

- [ ] **Step 3: Commit changes**

```bash
cd packages/server && git add src/ws/router.ts && git commit -m "feat(server): route file:validate and file:validated messages"
```

---

### Task 6: Add md-editor-v3 Dependency

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Add md-editor-v3 dependency**

Run the install command:

```bash
cd packages/web && pnpm add md-editor-v3
```

- [ ] **Step 2: Commit changes**

```bash
cd packages/web && git add package.json pnpm-lock.yaml && git commit -m "feat(web): add md-editor-v3 dependency"
```

---

### Task 7: Add Viewer State to File Store

**Files:**
- Modify: `packages/web/src/stores/file.ts`

- [ ] **Step 1: Add ValidatedPath interface**

Add the interface after the existing TransferProgress interface:

```typescript
// In packages/web/src/stores/file.ts, after TransferProgress interface
export interface ValidatedPath {
  originalPath: string;
  resolvedPath: string;
  exists: boolean;
}
```

- [ ] **Step 2: Add viewer state refs**

Add new state refs inside the `defineStore` callback, after existing refs:

```typescript
// In useFileStore defineStore callback, after existing refs
// Markdown viewer state
const validatingPath = ref<string | null>(null);
const validatedPath = ref<ValidatedPath | null>(null);
const viewerVisible = ref(false);
const viewerContent = ref<string>('');
const viewerLoading = ref(false);
const viewerPath = ref<string>('');
const viewerSaving = ref(false);
```

- [ ] **Step 3: Add viewer methods**

Add new methods before the return statement:

```typescript
// Viewer methods
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

function setViewerSaving(saving: boolean) {
  viewerSaving.value = saving;
}

function clearViewer() {
  viewerVisible.value = false;
  viewerContent.value = '';
  viewerPath.value = '';
  viewerLoading.value = false;
  viewerSaving.value = false;
  validatedPath.value = null;
  validatingPath.value = null;
}
```

- [ ] **Step 4: Export new state and methods in return statement**

Add to the return object:

```typescript
return {
  // ... existing exports
  // Markdown viewer
  validatingPath,
  validatedPath,
  viewerVisible,
  viewerContent,
  viewerLoading,
  viewerPath,
  viewerSaving,
  setValidatingPath,
  setValidatedPath,
  setViewerVisible,
  setViewerContent,
  setViewerLoading,
  setViewerPath,
  setViewerSaving,
  clearViewer,
};
```

- [ ] **Step 5: Commit changes**

```bash
cd packages/web && git add src/stores/file.ts && git commit -m "feat(web): add markdown viewer state to file store"
```

---

### Task 8: Add Validation and Viewing Methods to fileWebSocket

**Files:**
- Modify: `packages/web/src/services/fileWebSocket.ts`

**Dependencies:** Task 1 must be completed first (defines `FileValidatedPayload` type).

- [ ] **Step 1: Add viewingPath property**

Add the property declaration at the top of the class:

```typescript
// In FileWebSocketService class, after existing properties
private viewingPath: string | null = null;
```

- [ ] **Step 2: Add import for new types**

Update the import at the top:

```typescript
// In packages/web/src/services/fileWebSocket.ts, update import
import type {
  FileListPayload,
  FileProgressPayload,
  FileDataPayload,
  FileUploadedPayload,
  FileErrorPayload,
  FileValidatedPayload,  // NEW
} from '@remotecli/shared';
```

- [ ] **Step 3: Add validatePath method**

Add new public method after the `upload()` method:

```typescript
// In FileWebSocketService class, after upload method
validatePath(path: string, sessionId: string) {
  console.log('[fileWebSocket] validatePath:', path, 'sessionId:', sessionId);
  this.send({
    type: 'file:validate',
    payload: { path, sessionId },
    sessionId,
    timestamp: Date.now(),
  });
}
```

- [ ] **Step 4: Add downloadForView method**

Add new public method after `validatePath`:

```typescript
// In FileWebSocketService class
downloadForView(path: string) {
  console.log('[fileWebSocket] downloadForView:', path);
  const store = useFileStore();

  // Set loading state
  store.setViewerLoading(true);
  store.setViewerPath(path);

  // Mark this as a "for viewing" download
  this.viewingPath = path;

  this.send({
    type: 'file:download',
    payload: { path },
    timestamp: Date.now(),
  });
}
```

- [ ] **Step 5: Add handleFileValidated method**

Add handler method:

```typescript
// In FileWebSocketService class
private handleFileValidated(payload: FileValidatedPayload) {
  console.log('[fileWebSocket] handleFileValidated:', payload);
  const store = useFileStore();

  store.setValidatedPath({
    originalPath: payload.originalPath,
    resolvedPath: payload.resolvedPath,
    exists: payload.exists,
  });

  if (payload.exists) {
    // File exists - trigger download for viewing
    this.downloadForView(payload.resolvedPath);
  } else {
    // File not found - show error
    store.setValidatingPath(null);
    store.setViewerLoading(false);
    // Error will be shown by component
  }
}
```

- [ ] **Step 6: Update handleMessage to include file:validated**

Find the switch statement in `handleMessage()` and add the case:

```typescript
// In handleMessage switch, add case
case 'file:validated':
  this.handleFileValidated(payload as FileValidatedPayload);
  break;
```

- [ ] **Step 7: Modify handleFileData to support in-memory viewing**

Find the `handleFileData()` method and modify it to check for viewing downloads:

```typescript
// Modify handleFileData method
private handleFileData(payload: FileDataPayload) {
  const store = useFileStore();

  // Check if this is a "for viewing" download
  if (this.viewingPath === payload.path) {
    this.assembleViewContent(payload);
    return;
  }

  // Regular download: existing logic
  const transferId = payload.path;

  // ... rest of existing code ...
}
```

- [ ] **Step 8: Add assembleViewContent method**

Add new private method after `completeDownload`:

```typescript
// In FileWebSocketService class
private assembleViewContent(payload: FileDataPayload) {
  const store = useFileStore();
  const viewId = 'viewer-' + payload.path;

  // Initialize chunks on first chunk
  if (payload.chunkIndex === 0) {
    this.transferChunks.set(viewId, {
      chunks: new Map(),
      totalChunks: payload.totalChunks,
      totalSize: payload.totalSize,
    });
  }

  // Store chunk
  const transfer = this.transferChunks.get(viewId);
  if (transfer) {
    transfer.chunks.set(payload.chunkIndex, payload.content);

    // All chunks received
    if (transfer.chunks.size === transfer.totalChunks) {
      // Assemble content
      let content = '';
      for (let i = 0; i < transfer.totalChunks; i++) {
        const chunk = transfer.chunks.get(i);
        if (chunk) {
          // Decode base64 to text
          content += this.base64ToText(chunk);
        }
      }

      // Store content and show viewer
      store.setViewerContent(content);
      store.setViewerLoading(false);
      store.setViewerVisible(true);
      store.setValidatingPath(null);

      // Cleanup
      this.transferChunks.delete(viewId);
      this.viewingPath = null;
    }
  }
}

// Helper: base64 to text
private base64ToText(base64: string): string {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}
```

- [ ] **Step 9: Add public sendMessage method**

Add a public wrapper for the private send method (needed by MarkdownViewer for save functionality):

```typescript
// In FileWebSocketService class, add public method
public sendMessage(message: unknown) {
  this.send(message);
}
```

- [ ] **Step 10: Commit changes**

```bash
cd packages/web && git add src/services/fileWebSocket.ts && git commit -m "feat(web): add validatePath and downloadForView to fileWebSocket"
```

---

### Task 9: Create MarkdownViewer Component

**Files:**
- Create: `packages/web/src/components/MarkdownViewer.vue`

- [ ] **Step 1: Create the component file**

```vue
<template>
  <Teleport to="body">
    <div v-if="visible" class="markdown-viewer-overlay" @touchstart="handleTouchStart" @touchend="handleTouchEnd">
      <!-- Header -->
      <div class="viewer-header">
        <button class="back-btn" @click="handleClose">←</button>
        <span class="file-name">{{ fileName }}</span>
        <button class="save-btn" @click="handleSave" :disabled="saving">
          {{ saving ? '同步中...' : '保存' }}
        </button>
      </div>

      <!-- Content -->
      <div class="viewer-content">
        <div v-if="loading" class="loading-overlay">
          <div class="spinner"></div>
        </div>
        <MdEditor
          v-else
          v-model="content"
          theme="dark"
          :previewOnly="!isEditMode"
          style="height: 100%"
        />
      </div>

      <!-- Hint bar -->
      <div class="hint-bar">
        <span v-if="!isEditMode">← 左滑进入编辑模式</span>
        <span v-else>右滑返回预览模式 →</span>
      </div>

      <!-- Toast -->
      <Transition name="fade">
        <div v-if="showToast" class="toast">{{ toastMessage }}</div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { MdEditor } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { useFileStore } from '@/stores/file';
import { fileWebSocket } from '@/services/fileWebSocket';

const store = useFileStore();

const visible = computed(() => store.viewerVisible);
const loading = computed(() => store.viewerLoading);
const saving = computed(() => store.viewerSaving);
const storeContent = computed(() => store.viewerContent);
const filePath = computed(() => store.viewerPath);

const content = ref('');
const isEditMode = ref(false);
const showToast = ref(false);
const toastMessage = ref('');

const fileName = computed(() => {
  const path = filePath.value;
  return path ? path.split(/[/\\]/).pop() || path : 'file.md';
});

// Sync content from store
watch(storeContent, (newContent) => {
  content.value = newContent;
});

// Swipe gesture handling
let touchStartX = 0;

function handleTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX;
}

function handleTouchEnd(e: TouchEvent) {
  const touchEndX = e.changedTouches[0].clientX;
  const deltaX = touchEndX - touchStartX;

  if (deltaX < -50) {
    // Swipe left → edit mode
    isEditMode.value = true;
  } else if (deltaX > 50) {
    // Swipe right → preview mode
    isEditMode.value = false;
  }
}

function handleClose() {
  store.clearViewer();
  isEditMode.value = false;
}

async function handleSave() {
  if (saving.value) return;

  store.setViewerSaving(true);

  // Upload content back to agent
  // Convert text to base64
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content.value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  // Send as upload (reuse existing upload mechanism)
  const chunkSize = 1024 * 1024;
  const totalChunks = Math.ceil(base64.length / chunkSize);
  const totalSize = bytes.length;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, base64.length);
    const chunk = base64.substring(start, end);

    fileWebSocket.sendMessage({
      type: 'file:upload',
      payload: {
        path: filePath.value,
        content: chunk,
        chunkIndex: i,
        totalChunks,
        totalSize,
        overwrite: true,
      },
      timestamp: Date.now(),
    });
  }
}

// Watch for upload completion
watch(() => store.transfers.find(t => t.path === filePath.value)?.status, (status) => {
  if (status === 'completed') {
    store.setViewerSaving(false);
    showSuccessToast('已同步到 Agent');
  } else if (status === 'error') {
    store.setViewerSaving(false);
    showErrorToast('同步失败，请重试');
  }
});

function showSuccessToast(message: string) {
  toastMessage.value = message;
  showToast.value = true;
  setTimeout(() => {
    showToast.value = false;
  }, 3000);
}

function showErrorToast(message: string) {
  toastMessage.value = message;
  showToast.value = true;
  setTimeout(() => {
    showToast.value = false;
  }, 3000);
}
</script>

<style scoped>
.markdown-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #1E1E1E;
  display: flex;
  flex-direction: column;
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #252526;
  border-bottom: 1px solid #3C3C3C;
  flex-shrink: 0;
}

.back-btn, .save-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.back-btn {
  background: transparent;
  color: #e0e0e0;
}

.save-btn {
  background: rgba(76, 175, 80, 0.15);
  border: 1px solid rgba(76, 175, 80, 0.3);
  color: #4CAF50;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-name {
  color: #D4D4D4;
  font-size: 14px;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1E1E1E;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #3C3C3C;
  border-top-color: #FF8E53;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.hint-bar {
  padding: 8px;
  text-align: center;
  background: #252526;
  border-top: 1px solid #3C3C3C;
  color: #8B92A5;
  font-size: 12px;
}

.toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background: rgba(76, 175, 80, 0.9);
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
  z-index: 1001;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>

<style>
/* Global styles for md-editor-v3 dark theme */
.markdown-viewer-overlay .md-editor {
  --md-bk-color: #1E1E1E !important;
  background: #1E1E1E !important;
  height: 100% !important;
}

.markdown-viewer-overlay .md-editor-toolbar-wrapper {
  background: #252526 !important;
  border-bottom: 1px solid #3C3C3C !important;
}

.markdown-viewer-overlay .md-editor-content {
  background: #1E1E1E !important;
}

.markdown-viewer-overlay .md-editor-input {
  background: #1E1E1E !important;
  color: #D4D4D4 !important;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace !important;
}

.markdown-viewer-overlay .md-editor-preview {
  background: #252526 !important;
  color: #D4D4D4 !important;
}

.markdown-viewer-overlay .md-editor-preview h1,
.markdown-viewer-overlay .md-editor-preview h2,
.markdown-viewer-overlay .md-editor-preview h3,
.markdown-viewer-overlay .md-editor-preview h4,
.markdown-viewer-overlay .md-editor-preview h5,
.markdown-viewer-overlay .md-editor-preview h6 {
  color: #FF8E53 !important;
  border-bottom-color: #3C3C3C !important;
}

.markdown-viewer-overlay .md-editor-preview code {
  background: #2D2D2D !important;
  color: #CE9178 !important;
}

.markdown-viewer-overlay .md-editor-preview pre {
  background: #2D2D2D !important;
  border: 1px solid #3C3C3C !important;
}

.markdown-viewer-overlay .md-editor-preview blockquote {
  border-left-color: #FF8E53 !important;
  background: rgba(255, 142, 83, 0.1) !important;
  color: #B8C1EC !important;
}
</style>
```

- [ ] **Step 2: Commit changes**

```bash
cd packages/web && git add src/components/MarkdownViewer.vue && git commit -m "feat(web): create MarkdownViewer component with swipe gesture support"
```

---

### Task 10: Integrate LinkMatcher in TerminalTab

**Files:**
- Modify: `packages/web/src/components/TerminalTab.vue`

- [ ] **Step 1: Import MarkdownViewer and fileStore**

Add imports in the script setup section:

```typescript
// In TerminalTab.vue script setup, add imports
import { useFileStore } from '@/stores/file';
import { fileWebSocket } from '@/services/fileWebSocket';
import MarkdownViewer from './MarkdownViewer.vue';
```

- [ ] **Step 2: Add fileStore instance**

Add after the store declarations:

```typescript
// In TerminalTab.vue script setup
const fileStore = useFileStore();
```

- [ ] **Step 3: Define the path detection regex**

Add the regex constant. This regex excludes URLs (http/https) to avoid conflict with WebLinksAddon:

```typescript
// In TerminalTab.vue script setup, after imports
// Regex to detect .md file paths (absolute and relative)
// Excludes URLs (http/https) to avoid conflict with WebLinksAddon
const mdPathRegex = /[A-Za-z]:[\\/][^\s]+\.md|\.{1,2}[\\/][^\s]+\.md|[^\s]+\.md/g;
```

**Note**: This regex may partially match URLs. For stricter URL exclusion, use the spec version:
```typescript
const mdPathRegex = /[A-Za-z]:[\\/][^\s]+\.md|\.{1,2}[\\/][^\s]+\.md|(?:^(?![A-Za-z]:|https?:)[^\s]+\.md)/g;
```

- [ ] **Step 4: Add LinkMatcher registration in initTerminal**

Find the `initTerminal()` function and add LinkMatcher registration after `terminal.open()`:

```typescript
// In TerminalTab.vue, in initTerminal() after terminal.open()
// Register link matcher for .md file paths
terminal.registerLinkMatcher(mdPathRegex, (_event, matchedPath) => {
  console.log('[TerminalTab] .md path clicked:', matchedPath);

  // Validate: sessionId must exist
  if (!sessionId) {
    console.warn('[TerminalTab] No session ID, cannot validate path');
    return;
  }

  // Set validation state
  fileStore.setValidatingPath(matchedPath);

  // Send validation request
  fileWebSocket.validatePath(matchedPath, sessionId);
}, {
  priority: 0,
});
```

- [ ] **Step 5: Add MarkdownViewer to template**

Update the template to include the MarkdownViewer component:

```vue
<!-- In TerminalTab.vue template, at the end -->
<MarkdownViewer />
```

- [ ] **Step 6: Commit changes**

```bash
cd packages/web && git add src/components/TerminalTab.vue && git commit -m "feat(web): add LinkMatcher for .md paths in TerminalTab"
```

---

### Task 11: Build and Test

- [ ] **Step 1: Build all packages**

```bash
pnpm build
```

- [ ] **Step 2: Manual testing checklist**

Test the following scenarios:
- [ ] Click absolute path (D:\path\file.md)
- [ ] Click relative path (./docs/spec.md)
- [ ] Click relative path (../README.md)
- [ ] Click relative path (docs/file.md)
- [ ] Swipe left to enter edit mode
- [ ] Swipe right to return preview mode
- [ ] Edit and save successfully
- [ ] Handle non-existent file click
- [ ] Handle Agent offline scenario

- [ ] **Step 3: Final commit**

```bash
git add -A && git commit -m "feat: complete terminal markdown viewer feature"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add message types | shared/types.ts |
| 2 | Working directory tracking | agent/pty.ts |
| 3 | Validation handler | agent/validation.ts (new) |
| 4 | Agent tunnel handler | agent/tunnel.ts |
| 5 | Server routing | server/ws/router.ts |
| 6 | Add dependency | web/package.json |
| 7 | Store state | web/stores/file.ts |
| 8 | WebSocket methods | web/services/fileWebSocket.ts |
| 9 | MarkdownViewer component | web/components/MarkdownViewer.vue (new) |
| 10 | Terminal integration | web/components/TerminalTab.vue |
| 11 | Build and test | - |