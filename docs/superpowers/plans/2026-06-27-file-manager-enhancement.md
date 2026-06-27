# File Manager Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file creation, multi-format preview, editing, and context menu operations to the mobile file manager.

**Architecture:** Unified FileOverlay component with useFileOverlay composable for state management. Agent-side file operations (create/rename/delete) with security validation. Server routes new WebSocket message types to agents. Save reuses existing file:upload mechanism with overwrite:true.

**Tech Stack:** Vue 3 + Pinia, WebSocket, Node.js fs/promises, md-editor-v3

**Spec:** `docs/superpowers/specs/2026-06-27-file-manager-enhancement-design.md`

---

## File Structure

```
packages/shared/src/types.ts          — Add 6 new message types + payload interfaces
packages/agent/src/file.ts            — Add createFile/renameFile/deleteFile/validateFileName
packages/server/src/ws/router.ts      — Add file:create/rename/delete routing
packages/web/src/utils/fileType.ts    — NEW: getFileType/isViewable/isEditable helpers
packages/web/src/composables/useFileOverlay.ts — NEW: overlay state composable
packages/web/src/components/FileOverlay.vue    — NEW: unified file viewer/editor overlay
packages/web/src/components/ContextMenu.vue    — NEW: long-press context menu
packages/web/src/views/FileView.vue            — Add "+ New" button, wire overlay + context menu
packages/web/src/components/FileList.vue       — Add long-press handler, smart click behavior
packages/web/src/services/fileWebSocket.ts     — Add createFile/renameFile/deleteFile methods
packages/web/src/stores/file.ts                — Remove viewer* state (migrated to composable)
packages/web/src/components/MarkdownViewer.vue — Fix save bug, English button text
```

---

### Task 1: Shared Types — New Message Types

**Files:**
- Modify: `packages/shared/src/types.ts:4-45`

- [ ] **Step 1: Add new message types to MessageType union**

In `packages/shared/src/types.ts`, add to the `MessageType` union (after line 45, before the closing `;`):

```typescript
  | 'file:create'
  | 'file:create:result'
  | 'file:rename'
  | 'file:rename:result'
  | 'file:delete'
  | 'file:delete:result'
```

- [ ] **Step 2: Add payload interfaces**

Add after the existing `FileValidatedPayload` interface (around line 170):

```typescript
// File create/rename/delete types
export interface FileCreatePayload {
  dirPath: string;
  name: string;
}

export interface FileCreateResultPayload {
  success: boolean;
  error?: string;
  path?: string;
}

export interface FileRenamePayload {
  oldPath: string;
  newName: string;
}

export interface FileRenameResultPayload {
  success: boolean;
  error?: string;
}

export interface FileDeletePayload {
  path: string;
  isDirectory: boolean;
}

export interface FileDeleteResultPayload {
  success: boolean;
  error?: string;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add file create/rename/delete message types"
```

---

### Task 2: Agent — File Operations with Security

**Files:**
- Modify: `packages/agent/src/file.ts`
- Test: `packages/agent/src/__tests__/file.test.ts` (create if not exists)

- [ ] **Step 1: Write failing tests for validateFileName**

Create `packages/agent/src/__tests__/file.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileManager } from '../file.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FileManager', () => {
  let fm: FileManager;
  let tmpDir: string;

  beforeEach(async () => {
    fm = new FileManager();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('validateFileName', () => {
    it('accepts valid filenames', () => {
      expect(() => (fm as any).validateFileName('notes.txt')).not.toThrow();
      expect(() => (fm as any).validateFileName('config.json')).not.toThrow();
      expect(() => (fm as any).validateFileName('readme.md')).not.toThrow();
      expect(() => (fm as any).validateFileName('中文文件.txt')).not.toThrow();
    });

    it('rejects empty filenames', () => {
      expect(() => (fm as any).validateFileName('')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('   ')).toThrow('INVALID_FILENAME');
    });

    it('rejects illegal characters', () => {
      expect(() => (fm as any).validateFileName('file<name.txt')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('file:name.txt')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('file/name.txt')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('file\\name.txt')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('file|name.txt')).toThrow('INVALID_FILENAME');
    });

    it('rejects path traversal', () => {
      expect(() => (fm as any).validateFileName('../etc/passwd')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('..')).toThrow('INVALID_FILENAME');
    });

    it('rejects dots-only names', () => {
      expect(() => (fm as any).validateFileName('...')).toThrow('INVALID_FILENAME');
    });
  });

  describe('createFile', () => {
    it('creates a new empty file', async () => {
      const result = await fm.createFile(tmpDir, 'newfile.txt');
      expect(result.path).toContain('newfile.txt');
      const content = await fs.readFile(result.path, 'utf-8');
      expect(content).toBe('');
    });

    it('throws FILE_ALREADY_EXISTS if file exists', async () => {
      await fs.writeFile(path.join(tmpDir, 'exists.txt'), 'content');
      await expect(fm.createFile(tmpDir, 'exists.txt')).rejects.toThrow('FILE_ALREADY_EXISTS');
    });

    it('throws INVALID_FILENAME for bad names', async () => {
      await expect(fm.createFile(tmpDir, '../bad.txt')).rejects.toThrow('INVALID_FILENAME');
    });
  });

  describe('renameFile', () => {
    it('renames a file', async () => {
      const filePath = path.join(tmpDir, 'old.txt');
      await fs.writeFile(filePath, 'content');
      await fm.renameFile(filePath, 'new.txt');
      const newPath = path.join(tmpDir, 'new.txt');
      const content = await fs.readFile(newPath, 'utf-8');
      expect(content).toBe('content');
    });

    it('throws for invalid new name', async () => {
      const filePath = path.join(tmpDir, 'file.txt');
      await fs.writeFile(filePath, 'content');
      await expect(fm.renameFile(filePath, '../bad.txt')).rejects.toThrow('INVALID_FILENAME');
    });
  });

  describe('deleteFile', () => {
    it('deletes a file', async () => {
      const filePath = path.join(tmpDir, 'todelete.txt');
      await fs.writeFile(filePath, 'content');
      await fm.deleteFile(filePath, false);
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('deletes a directory recursively', async () => {
      const subDir = path.join(tmpDir, 'subdir');
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(subDir, 'file.txt'), 'content');
      await fm.deleteFile(subDir, true);
      await expect(fs.access(subDir)).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest run src/__tests__/file.test.ts`
Expected: FAIL — methods don't exist yet

- [ ] **Step 3: Implement validateFileName, createFile, renameFile, deleteFile**

Add to `packages/agent/src/file.ts` (inside the `FileManager` class):

```typescript
  // Validate filename safety
  private validateFileName(fileName: string): void {
    if (!fileName || !fileName.trim()) {
      throw new Error('INVALID_FILENAME: empty');
    }
    if (/[<>:"/\\|?*\x00-\x1f]/.test(fileName)) {
      throw new Error('INVALID_FILENAME: illegal characters');
    }
    if (/^[\s.]+$/.test(fileName)) {
      throw new Error('INVALID_FILENAME: dots or spaces only');
    }
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      throw new Error('INVALID_FILENAME: path traversal');
    }
  }

  // Create a new empty file
  async createFile(dirPath: string, fileName: string): Promise<{ path: string }> {
    this.validateFileName(fileName);
    const expandedDir = this.expandPath(dirPath);
    const filePath = path.join(expandedDir, fileName);

    // Security: resolved path must be within target directory
    const resolvedDir = path.resolve(expandedDir);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
      throw new Error('PATH_TRAVERSAL');
    }

    // Check if file already exists
    try {
      await fs.access(filePath);
      throw new Error('FILE_ALREADY_EXISTS');
    } catch (err: any) {
      if (err.message === 'FILE_ALREADY_EXISTS' || err.code === 'FILE_ALREADY_EXISTS') throw err;
      // ENOENT = file doesn't exist, proceed
    }

    await fs.writeFile(filePath, '', 'utf-8');
    return { path: filePath };
  }

  // Rename a file
  async renameFile(oldPath: string, newName: string): Promise<void> {
    this.validateFileName(newName);
    const expandedOld = this.expandPath(oldPath);
    const dir = path.dirname(expandedOld);
    const newPath = path.join(dir, newName);

    const resolvedDir = path.resolve(dir);
    const resolvedNew = path.resolve(newPath);
    if (!resolvedNew.startsWith(resolvedDir + path.sep)) {
      throw new Error('PATH_TRAVERSAL');
    }

    await fs.rename(expandedOld, newPath);
  }

  // Delete a file or directory
  async deleteFile(filePath: string, isDirectory: boolean): Promise<void> {
    const expandedPath = this.expandPath(filePath);
    if (isDirectory) {
      await fs.rm(expandedPath, { recursive: true });
    } else {
      await fs.unlink(expandedPath);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest run src/__tests__/file.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/file.ts packages/agent/src/__tests__/file.test.ts
git commit -m "feat(agent): add file create/rename/delete with security validation"
```

---

### Task 3: Server — WebSocket Message Routing

**Files:**
- Modify: `packages/server/src/ws/router.ts:87-153`

- [ ] **Step 1: Add routing for file:create/rename/delete**

In `packages/server/src/ws/router.ts`, add to the switch statement (after the `case 'file:upload':` block, around line 112):

```typescript
    case 'file:create':
    case 'file:rename':
    case 'file:delete':
      // Browser-initiated file operations, route to bound agent
      {
        console.log(`[file] ${type} received, payload:`, JSON.stringify(payload));
        if (payload?.agentId) {
          const bindResult = tunnelManager.bindBrowserToAgent(ws, payload.agentId);
          console.log(`[file] bindBrowserToAgent result:`, bindResult);
        }
        const browser = tunnelManager.getBrowser(ws);
        if (browser?.agentId) {
          console.log(`[file] routing to agent:`, browser.agentId);
          tunnelManager.routeToAgent(browser.agentId, message);
        } else {
          console.log(`[file] NO_AGENT error`);
          ws.send(JSON.stringify({
            type: type + ':result' as any,
            payload: { success: false, error: 'No agent selected' },
            timestamp: Date.now(),
          }));
        }
      }
      break;
```

Also add the result message types to the agent-response routing block (around line 138-153, where `file:list`, `file:data`, etc. are routed):

```typescript
    case 'file:create:result':
    case 'file:rename:result':
    case 'file:delete:result':
```

Add these alongside the existing `case 'file:list':` etc.

- [ ] **Step 2: Verify server compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ws/router.ts
git commit -m "feat(server): add routing for file:create/rename/delete messages"
```

---

### Task 4: Agent — Handle New Message Types

**Files:**
- Modify: `packages/agent/src/tunnel.ts` (or wherever agent handles file messages)

First, find where the agent handles `file:browse` and `file:upload` messages:

- [ ] **Step 1: Find the agent file message handler**

Run: `grep -n "file:browse\|file:upload" packages/agent/src/*.ts`

Note the file and line where file messages are handled.

- [ ] **Step 2: Add handlers for file:create/rename/delete**

In the agent's message handler, add cases for the new message types:

```typescript
    case 'file:create': {
      const { dirPath, name } = payload;
      try {
        const result = await fileManager.createFile(dirPath, name);
        ws.send(JSON.stringify({
          type: 'file:create:result',
          payload: { success: true, path: result.path },
          timestamp: Date.now(),
        }));
      } catch (err: any) {
        ws.send(JSON.stringify({
          type: 'file:create:result',
          payload: { success: false, error: err.message },
          timestamp: Date.now(),
        }));
      }
      break;
    }

    case 'file:rename': {
      const { oldPath, newName } = payload;
      try {
        await fileManager.renameFile(oldPath, newName);
        ws.send(JSON.stringify({
          type: 'file:rename:result',
          payload: { success: true },
          timestamp: Date.now(),
        }));
      } catch (err: any) {
        ws.send(JSON.stringify({
          type: 'file:rename:result',
          payload: { success: false, error: err.message },
          timestamp: Date.now(),
        }));
      }
      break;
    }

    case 'file:delete': {
      const { path: filePath, isDirectory } = payload;
      try {
        await fileManager.deleteFile(filePath, isDirectory);
        ws.send(JSON.stringify({
          type: 'file:delete:result',
          payload: { success: true },
          timestamp: Date.now(),
        }));
      } catch (err: any) {
        ws.send(JSON.stringify({
          type: 'file:delete:result',
          payload: { success: false, error: err.message },
          timestamp: Date.now(),
        }));
      }
      break;
    }
```

- [ ] **Step 3: Verify agent compiles**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/
git commit -m "feat(agent): handle file:create/rename/delete WebSocket messages"
```

---

### Task 5: Web — File Type Utilities

**Files:**
- Create: `packages/web/src/utils/fileType.ts`

- [ ] **Step 1: Create fileType utility**

Create `packages/web/src/utils/fileType.ts`:

```typescript
export type OverlayFileType = 'md' | 'txt' | 'json' | 'html' | 'pdf' | 'image';

const EDITABLE_TYPES = new Set(['md', 'txt', 'json']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);

export function getFileType(fileName: string): OverlayFileType | 'other' {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'md') return 'md';
  if (ext === 'txt') return 'txt';
  if (ext === 'json') return 'json';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}

export function isViewable(fileName: string): boolean {
  return getFileType(fileName) !== 'other';
}

export function isEditable(fileName: string): boolean {
  const type = getFileType(fileName);
  return type !== 'other' && EDITABLE_TYPES.has(type);
}

export const LARGE_FILE_THRESHOLD = 500 * 1024; // 500KB

export function isLargeFile(size: number | undefined): boolean {
  return (size ?? 0) > LARGE_FILE_THRESHOLD;
}
```

- [ ] **Step 2: Verify web package compiles**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/utils/fileType.ts
git commit -m "feat(web): add file type utility functions"
```

---

### Task 6: Web — useFileOverlay Composable

**Files:**
- Create: `packages/web/src/composables/useFileOverlay.ts`

- [ ] **Step 1: Create the composable**

Create `packages/web/src/composables/useFileOverlay.ts`:

```typescript
import { ref } from 'vue';
import type { OverlayFileType } from '@/utils/fileType';

export function useFileOverlay() {
  const visible = ref(false);
  const mode = ref<'view' | 'edit'>('view');
  const path = ref('');
  const content = ref('');
  const loading = ref(false);
  const saving = ref(false);
  const fileType = ref<OverlayFileType>('txt');
  const dirty = ref(false);

  function open(filePath: string, type: OverlayFileType, fileContent: string) {
    path.value = filePath;
    fileType.value = type;
    content.value = fileContent;
    mode.value = 'view';
    dirty.value = false;
    loading.value = false;
    saving.value = false;
    visible.value = true;
  }

  function openForEdit(filePath: string, type: OverlayFileType, fileContent: string) {
    open(filePath, type, fileContent);
    mode.value = 'edit';
  }

  function close() {
    visible.value = false;
    content.value = '';
    path.value = '';
    dirty.value = false;
  }

  function updateContent(newContent: string) {
    content.value = newContent;
    dirty.value = true;
  }

  function setMode(newMode: 'view' | 'edit') {
    mode.value = newMode;
  }

  return {
    visible, mode, path, content, loading, saving, fileType, dirty,
    open, openForEdit, close, updateContent, setMode,
  };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/composables/useFileOverlay.ts
git commit -m "feat(web): add useFileOverlay composable for overlay state"
```

---

### Task 7: Web — FileWebSocket New Methods

**Files:**
- Modify: `packages/web/src/services/fileWebSocket.ts`

- [ ] **Step 1: Add createFile/renameFile/deleteFile methods**

In `packages/web/src/services/fileWebSocket.ts`, add public methods (after the existing `upload()` method):

```typescript
  createFile(dirPath: string, fileName: string, agentId: string) {
    this.send({
      type: 'file:create',
      payload: { dirPath, name: fileName, agentId },
      timestamp: Date.now(),
    });
  }

  renameFile(oldPath: string, newName: string) {
    this.send({
      type: 'file:rename',
      payload: { oldPath, newName },
      timestamp: Date.now(),
    });
  }

  deleteFile(path: string, isDirectory: boolean) {
    this.send({
      type: 'file:delete',
      payload: { path, isDirectory },
      timestamp: Date.now(),
    });
  }
```

- [ ] **Step 2: Add result message handlers**

In the `handleMessage()` switch statement, add:

```typescript
      case 'file:create:result':
      case 'file:rename:result':
      case 'file:delete:result':
        // Handled by registered handlers via this.messageHandlers
        break;
```

- [ ] **Step 3: Add view content delivery mechanism**

The existing `assembleViewContent()` writes to `store.setViewerContent()`. Since we're migrating overlay state to the composable (Task 13), we need a new delivery path. Add a callback system to fileWebSocket.ts:

```typescript
// Add to FileWebSocketService class
private viewContentHandlers: ((path: string, content: string) => void)[] = [];

onViewContent(handler: (path: string, content: string) => void) {
  this.viewContentHandlers.push(handler);
}

offViewContent(handler: (path: string, content: string) => void) {
  const idx = this.viewContentHandlers.indexOf(handler);
  if (idx !== -1) this.viewContentHandlers.splice(idx, 1);
}
```

Then in `assembleViewContent()`, after the content is assembled (at the end of the method), add:

```typescript
// Notify view content handlers (in addition to store for backward compat)
this.viewContentHandlers.forEach(h => h(payload.path, content));
```

This allows FileOverlay/FileView to receive content without depending on FileStore viewer state.

- [ ] **Step 3: Verify compilation**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/services/fileWebSocket.ts
git commit -m "feat(web): add createFile/renameFile/deleteFile WebSocket methods"
```

---

### Task 8: Fix MdViewer Save Bug + English Text

**Files:**
- Modify: `packages/web/src/components/MarkdownViewer.vue`

- [ ] **Step 1: Fix Save triggering download**

In `MarkdownViewer.vue`, replace the `handleSave()` function (lines 110-164) to NOT call `store.addTransfer()`:

```typescript
function handleSave() {
  if (saving.value) return;

  if (!fileWebSocket.isConnected()) {
    showErrorToast('Not connected');
    return;
  }

  saving.value = true;

  // Send upload directly, no transfer tracking
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content.value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  const chunkSize = 1024 * 1024;
  const totalChunks = Math.ceil(base64.length / chunkSize);
  const totalSize = bytes.length;

  // Listen for file:uploaded to detect completion
  const handleUploaded = (data: unknown) => {
    const payload = data as { path: string; success: boolean; error?: string };
    if (payload.path === filePath.value) {
      if (payload.success) {
        showSuccessToast('Saved');
      } else {
        showErrorToast('Save failed, retry');
      }
      saving.value = false;
      fileWebSocket.off('file:uploaded', handleUploaded);
    }
  };
  fileWebSocket.on('file:uploaded', handleUploaded);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = base64.substring(i * chunkSize, Math.min((i + 1) * chunkSize, base64.length));
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
```

Also remove the old `watch(() => store.transfers.find(...))` block (lines 167-179) — this watch tracked transfer status for the **save** flow (not download). Since save no longer creates a transfer record, this watch is dead code. The download flow is handled separately by `handleFileData()` in fileWebSocket.ts.

- [ ] **Step 2: Change button text to English**

In the template, change:
- `{{ saving ? '同步中...' : '保存' }}` → `{{ saving ? 'Saving...' : 'Save' }}`
- `'未连接到服务器，请稍后重试'` → `'Not connected'`
- `'已同步到 Agent'` → `'Saved'`
- `'同步失败，请重试'` → `'Save failed, retry'`

- [ ] **Step 3: Verify compilation**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/MarkdownViewer.vue
git commit -m "fix(web): separate save from download flow in MdViewer, use English text"
```

---

### Task 9: FileList — Smart Click + Long Press

**Files:**
- Modify: `packages/web/src/components/FileList.vue`

- [ ] **Step 1: Add smart click behavior**

Modify `FileList.vue` to emit different events based on file type:

```vue
<script setup lang="ts">
import type { FileEntry } from '@remotecli/shared';
import { isViewable, isLargeFile } from '@/utils/fileType';

defineProps<{
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  browse: [name: string];
  download: [name: string];
  preview: [name: string];       // New: open preview overlay
  longpress: [name: string, entry: FileEntry]; // New: context menu
}>();

function onEntryClick(entry: FileEntry) {
  if (entry.isDirectory) {
    emit('browse', entry.name);
  } else if (isViewable(entry.name) && !isLargeFile(entry.size)) {
    emit('preview', entry.name);
  } else {
    emit('download', entry.name);
  }
}
```

- [ ] **Step 2: Add long-press handler**

Add long-press detection with 500ms threshold and haptic feedback:

```vue
<template>
  <div class="file-list">
    <!-- ... existing template ... -->
    <div
      v-for="entry in entries"
      :key="entry.name"
      class="entry"
      :class="{ directory: entry.isDirectory }"
      @click="onEntryClick(entry)"
      @touchstart.passive="onTouchStart(entry, $event)"
      @touchend="onTouchEnd"
      @touchmove="onTouchMove"
    >
      <!-- ... existing entry content ... -->
    </div>
  </div>
</template>
```

Add in `<script setup>`:

```typescript
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let touchStartX = 0;
let touchStartY = 0;
let longPressTriggered = false;

function onTouchStart(entry: FileEntry, e: TouchEvent) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  longPressTriggered = false;

  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    // Haptic feedback
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
    emit('longpress', entry.name, entry);
  }, 500);
}

function onTouchEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  // If long press triggered, prevent the click event
  if (longPressTriggered) {
    // Click handler will still fire, but we need to prevent it
    // Use a flag to skip the next click
  }
}

function onTouchMove(e: TouchEvent) {
  // Cancel long press if finger moves too much
  if (longPressTimer) {
    const dx = Math.abs(e.touches[0].clientX - touchStartX);
    const dy = Math.abs(e.touches[0].clientY - touchStartY);
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }
}
```

Update `onEntryClick` to check for long press:

```typescript
function onEntryClick(entry: FileEntry) {
  if (longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  // ... rest of existing logic
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/FileList.vue
git commit -m "feat(web): add smart click and long-press to FileList"
```

---

### Task 10: FileOverlay Component

**Files:**
- Create: `packages/web/src/components/FileOverlay.vue`

- [ ] **Step 1: Create FileOverlay.vue**

This is a large component. Create it with all viewer modes:

```vue
<template>
  <Teleport to="body">
    <Transition name="overlay-slide">
      <div v-if="overlay.visible.value" class="file-overlay" role="dialog" aria-modal="true" aria-label="File viewer" @keydown.esc="handleClose">
        <!-- Header -->
        <div class="overlay-header">
          <button class="back-btn" @click="handleClose">←</button>
          <span class="file-name">{{ fileName }}</span>
          <div class="header-actions">
            <button v-if="canEdit && overlay.mode.value === 'view'" class="edit-btn" @click="overlay.setMode('edit')">Edit</button>
            <button v-if="overlay.mode.value === 'edit'" class="save-btn" @click="handleSave" :disabled="overlay.saving.value">
              {{ overlay.saving.value ? 'Saving...' : 'Save' }}
            </button>
            <button v-if="overlay.mode.value === 'edit'" class="cancel-edit-btn" @click="handleCancelEdit">Cancel</button>
            <button class="download-btn" @click="handleDownload">↓</button>
          </div>
        </div>

        <!-- Content -->
        <div class="overlay-content">
          <div v-if="overlay.loading.value" class="loading-spinner">
            <div class="spinner"></div>
          </div>

          <!-- Markdown preview/edit -->
          <template v-else-if="overlay.fileType.value === 'md'">
            <MdPreview v-if="overlay.mode.value === 'view'" :modelValue="overlay.content.value" theme="dark" class="overlay-md" />
            <MdEditor v-else v-model="overlay.content.value" theme="dark" class="overlay-md" @update:modelValue="onContentChange" />
          </template>

          <!-- Text/JSON preview/edit -->
          <template v-else-if="overlay.fileType.value === 'txt' || overlay.fileType.value === 'json'">
            <pre v-if="overlay.mode.value === 'view'" class="text-preview">{{ overlay.content.value }}</pre>
            <textarea v-else class="text-editor" :value="overlay.content.value" @input="onTextInput" spellcheck="false"></textarea>
          </template>

          <!-- HTML/PDF iframe -->
          <iframe v-else-if="overlay.fileType.value === 'html' || overlay.fileType.value === 'pdf'"
            :src="iframeSrc" class="iframe-viewer" sandbox="allow-same-origin"></iframe>

          <!-- Image -->
          <div v-else-if="overlay.fileType.value === 'image'" class="image-viewer">
            <img :src="imageSrc" :alt="fileName" @error="onImageError" />
          </div>
        </div>

        <!-- Toast -->
        <Transition name="fade">
          <div v-if="showToast" class="toast" :class="{ 'toast-error': isErrorToast }">{{ toastMessage }}</div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { MdEditor, MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';
import { useFileOverlay } from '@/composables/useFileOverlay';
import { fileWebSocket } from '@/services/fileWebSocket';

const overlay = useFileOverlay();
const showToast = ref(false);
const toastMessage = ref('');
const isErrorToast = ref(false);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

const fileName = computed(() => {
  const p = overlay.path.value;
  return p ? p.split(/[/\\]/).pop() || p : '';
});

const canEdit = computed(() => {
  const type = overlay.fileType.value;
  return type === 'md' || type === 'txt' || type === 'json';
});

const iframeSrc = computed(() => {
  if (overlay.fileType.value !== 'html' && overlay.fileType.value !== 'pdf') return '';
  const content = overlay.content.value;
  if (overlay.fileType.value === 'html') {
    return `data:text/html;charset=utf-8,${encodeURIComponent(content)}`;
  }
  // PDF: data URL with base64 content
  return `data:application/pdf;base64,${content}`;
});

const imageSrc = computed(() => {
  if (overlay.fileType.value !== 'image') return '';
  return `data:image;base64,${overlay.content.value}`;
});

function onContentChange(val: string) {
  overlay.updateContent(val);
}

function onTextInput(e: Event) {
  const target = e.target as HTMLTextAreaElement;
  overlay.updateContent(target.value);
}

function onImageError() {
  showErrorToast('Failed to load image');
}

function handleClose() {
  if (overlay.dirty.value && overlay.mode.value === 'edit') {
    if (!confirm('Discard changes?')) return;
  }
  overlay.close();
}

function handleCancelEdit() {
  if (overlay.dirty.value) {
    if (!confirm('Discard changes?')) return;
  }
  overlay.setMode('view');
}

function handleDownload() {
  fileWebSocket.download(overlay.path.value);
}

function handleSave() {
  if (overlay.saving.value) return;
  if (!fileWebSocket.isConnected()) {
    showErrorToast('Not connected');
    return;
  }

  overlay.saving.value = true;

  const encoder = new TextEncoder();
  const bytes = encoder.encode(overlay.content.value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const chunkSize = 1024 * 1024;
  const totalChunks = Math.ceil(base64.length / chunkSize);

  const handleUploaded = (data: unknown) => {
    const payload = data as { path: string; success: boolean };
    if (payload.path === overlay.path.value) {
      if (payload.success) {
        showSuccessToast('Saved');
        overlay.dirty.value = false;
        overlay.setMode('view');
      } else {
        showErrorToast('Save failed, retry');
      }
      overlay.saving.value = false;
      fileWebSocket.off('file:uploaded', handleUploaded);
    }
  };
  fileWebSocket.on('file:uploaded', handleUploaded);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = base64.substring(i * chunkSize, Math.min((i + 1) * chunkSize, base64.length));
    fileWebSocket.sendMessage({
      type: 'file:upload',
      payload: {
        path: overlay.path.value,
        content: chunk,
        chunkIndex: i,
        totalChunks,
        totalSize: bytes.length,
        overwrite: true,
      },
      timestamp: Date.now(),
    });
  }
}

function showSuccessToast(msg: string) {
  isErrorToast.value = false;
  toastMessage.value = msg;
  showToast.value = true;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { showToast.value = false; }, 3000);
}

function showErrorToast(msg: string) {
  isErrorToast.value = true;
  toastMessage.value = msg;
  showToast.value = true;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { showToast.value = false; }, 3000);
}

// Expose overlay for parent to call open/close
defineExpose({ overlay });
</script>

<style scoped>
.file-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--bg-root);
  display: flex;
  flex-direction: column;
}

.overlay-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-strong);
  flex-shrink: 0;
}

.back-btn, .edit-btn, .save-btn, .cancel-edit-btn, .download-btn {
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  cursor: pointer;
  min-height: 44px;
  min-width: 44px;
}

.back-btn { background: transparent; color: var(--text-primary); }
.edit-btn { background: var(--bg-surface-elevated); color: var(--info); border: 1px solid var(--border-default); }
.save-btn { background: var(--success); color: #fff; }
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.cancel-edit-btn { background: transparent; color: var(--text-secondary); }
.download-btn { background: var(--bg-surface-elevated); color: var(--text-primary); border: 1px solid var(--border-default); }

.file-name {
  flex: 1;
  color: var(--text-primary);
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions { display: flex; gap: var(--space-2); }

.overlay-content { flex: 1; overflow: hidden; position: relative; }

.loading-spinner {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
}
.spinner {
  width: 40px; height: 40px;
  border: 3px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.text-preview {
  padding: var(--space-4);
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
  height: 100%;
  margin: 0;
}

.text-editor {
  width: 100%; height: 100%;
  background: var(--bg-root);
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: var(--space-4);
  border: none;
  resize: none;
  outline: none;
}

.iframe-viewer { width: 100%; height: 100%; border: none; }

.image-viewer {
  display: flex; align-items: center; justify-content: center;
  height: 100%; padding: var(--space-4);
}
.image-viewer img { max-width: 100%; max-height: 100%; object-fit: contain; }

.overlay-md { height: 100%; overflow: auto; }

.toast {
  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
  padding: var(--space-3) var(--space-6);
  background: rgba(34, 197, 94, 0.9); color: #fff;
  border-radius: var(--radius-lg); font-size: 14px; z-index: 1001;
}
.toast-error { background: rgba(239, 68, 68, 0.9); }

/* Slide animation */
.overlay-slide-enter-active { transition: transform 300ms ease-out; }
.overlay-slide-leave-active { transition: transform 200ms ease-in; }
.overlay-slide-enter-from { transform: translateY(100%); }
.overlay-slide-leave-to { transform: translateY(100%); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

<style>
/* Global md-editor-v3 dark theme overrides */
.file-overlay .md-editor { --md-bk-color: #1E1E1E !important; background: #1E1E1E !important; height: 100% !important; }
.file-overlay .md-editor-content { background: #1E1E1E !important; }
</style>
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors (may have warnings about unused vars, that's fine)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/FileOverlay.vue
git commit -m "feat(web): add FileOverlay component with multi-format viewer/editor"
```

---

### Task 11: ContextMenu Component

**Files:**
- Create: `packages/web/src/components/ContextMenu.vue`

- [ ] **Step 1: Create ContextMenu.vue**

```vue
<template>
  <Teleport to="body">
    <div v-if="visible" class="context-menu-overlay" @click="close" @contextmenu.prevent="close">
      <div class="context-menu" :style="menuStyle" role="menu">
        <button class="menu-item" @click.stop="handleRename" role="menuitem">Rename</button>
        <button class="menu-item danger" @click.stop="handleDelete" role="menuitem">Delete</button>
        <div class="menu-divider"></div>
        <button class="menu-item" @click.stop="handleDetails" role="menuitem">Details</button>
      </div>
    </div>

    <!-- Rename dialog -->
    <div v-if="showRename" class="modal-overlay" @click.self="showRename = false">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header"><h3>Rename</h3></div>
        <div class="modal-body">
          <input ref="renameInput" v-model="newName" @keyup.enter="confirmRename" @keyup.esc="showRename = false" />
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="showRename = false">Cancel</button>
          <button class="btn-save" @click="confirmRename" :disabled="!newName.trim()">Rename</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <div v-if="showDelete" class="modal-overlay" @click.self="showDelete = false">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header"><h3>Delete</h3></div>
        <div class="modal-body">
          <p>Delete "{{ entryName }}"? This cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="showDelete = false">Cancel</button>
          <button class="btn-danger" @click="confirmDelete">Delete</button>
        </div>
      </div>
    </div>

    <!-- Details dialog -->
    <div v-if="showDetails" class="modal-overlay" @click.self="showDetails = false">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header"><h3>Details</h3></div>
        <div class="modal-body">
          <div class="detail-row"><span class="label">Name</span><span>{{ entryName }}</span></div>
          <div class="detail-row"><span class="label">Path</span><span class="mono">{{ entryPath }}</span></div>
          <div class="detail-row" v-if="entrySize"><span class="label">Size</span><span>{{ formatSize(entrySize) }}</span></div>
          <div class="detail-row" v-if="entryModified"><span class="label">Modified</span><span>{{ formatTime(entryModified) }}</span></div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="showDetails = false">Close</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import type { FileEntry } from '@remotecli/shared';
import { fileWebSocket } from '@/services/fileWebSocket';

const emit = defineEmits<{
  refresh: [];
}>();

const props = defineProps<{
  currentPath: string;
}>();

const visible = ref(false);
const menuStyle = ref({ top: '0px', left: '0px' });
const entryName = ref('');
const entryPath = ref('');
const entrySize = ref<number | undefined>();
const entryModified = ref<number | undefined>();
const entryIsDir = ref(false);

const showRename = ref(false);
const showDelete = ref(false);
const showDetails = ref(false);
const newName = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

function open(x: number, y: number, name: string, entry: FileEntry) {
  entryName.value = name;
  entryPath.value = props.currentPath ? `${props.currentPath}\\${name}` : name;
  entrySize.value = entry.size;
  entryModified.value = entry.modifiedAt;
  entryIsDir.value = entry.isDirectory;

  // Position menu near touch point, with boundary detection
  const menuW = 160, menuH = 140;
  const vw = window.innerWidth, vh = window.innerHeight;
  menuStyle.value = {
    top: `${Math.min(y, vh - menuH)}px`,
    left: `${Math.min(x, vw - menuW)}px`,
  };
  visible.value = true;
}

function close() {
  visible.value = false;
}

function handleRename() {
  close();
  newName.value = entryName.value;
  showRename.value = true;
  nextTick(() => renameInput.value?.focus());
}

function handleDelete() {
  close();
  showDelete.value = true;
}

function handleDetails() {
  close();
  showDetails.value = true;
}

function confirmRename() {
  if (!newName.value.trim()) return;
  fileWebSocket.renameFile(entryPath.value, newName.value.trim());
  showRename.value = false;
  // Listen for result
  const handler = (data: unknown) => {
    const payload = data as { success: boolean; error?: string };
    if (payload.success) {
      emit('refresh');
    }
    fileWebSocket.off('file:rename:result', handler);
  };
  fileWebSocket.on('file:rename:result', handler);
}

function confirmDelete() {
  fileWebSocket.deleteFile(entryPath.value, entryIsDir.value);
  showDelete.value = false;
  const handler = (data: unknown) => {
    const payload = data as { success: boolean; error?: string };
    if (payload.success) {
      emit('refresh');
    }
    fileWebSocket.off('file:delete:result', handler);
  };
  fileWebSocket.on('file:delete:result', handler);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

defineExpose({ open });
</script>

<style scoped>
/* ... styles for context menu, modals ... */
/* Use existing design system variables */
</style>
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/ContextMenu.vue
git commit -m "feat(web): add ContextMenu component with rename/delete/details"
```

---

### Task 12: FileView — Wire Everything Together

**Files:**
- Modify: `packages/web/src/views/FileView.vue`

- [ ] **Step 1: Add "+ New" button to Action Bar**

In FileView.vue template, add a "+ New" button to the action-bar div:

```html
<button class="icon-btn new-btn" @click="showCreateModal = true" title="New file" aria-label="New file">
  <span style="font-size: 18px;">+</span>
</button>
```

- [ ] **Step 2: Add Create File Modal**

Add to the template (after the existing Save Shortcut Modal):

```html
<!-- Create File Modal -->
<div class="modal-overlay" v-if="showCreateModal" @click.self="closeCreateModal" @keydown.esc="closeCreateModal">
  <div class="modal" role="dialog" aria-modal="true">
    <div class="modal-header"><h3>New File</h3></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Filename (with extension)</label>
        <input ref="createInput" v-model="newFileName" placeholder="e.g. notes.txt, config.json" @keyup.enter="handleCreateFile" />
        <p class="form-hint">Supported: md, txt, json, html, etc.</p>
        <p v-if="createError" class="form-error">{{ createError }}</p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" @click="closeCreateModal">Cancel</button>
      <button class="btn-save" @click="handleCreateFile" :disabled="!newFileName.trim()">Create</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add FileOverlay and ContextMenu references**

In the template, add:

```html
<FileOverlay ref="fileOverlayRef" />
<ContextMenu ref="contextMenuRef" :currentPath="currentPath" @refresh="refresh" />
```

Import them in script:

```typescript
import FileOverlay from '@/components/FileOverlay.vue';
import ContextMenu from '@/components/ContextMenu.vue';
```

- [ ] **Step 4: Add create file logic**

In `<script setup>`:

```typescript
const fileOverlayRef = ref<InstanceType<typeof FileOverlay> | null>(null);
const contextMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null);
const showCreateModal = ref(false);
const newFileName = ref('');
const createError = ref('');
const createInput = ref<HTMLInputElement | null>(null);

watch(showCreateModal, (val) => {
  if (val) {
    nextTick(() => createInput.value?.focus());
  } else {
    newFileName.value = '';
    createError.value = '';
  }
});

function closeCreateModal() {
  showCreateModal.value = false;
}

function handleCreateFile() {
  if (!newFileName.value.trim() || !currentPath.value || !selectedAgentId.value) return;
  createError.value = '';

  fileWebSocket.createFile(currentPath.value, newFileName.value.trim(), selectedAgentId.value);

  const handler = (data: unknown) => {
    const payload = data as { success: boolean; error?: string; path?: string };
    if (payload.success) {
      closeCreateModal();
      refresh();
      // Auto-open for editing if txt/json/md
      const ext = newFileName.value.split('.').pop()?.toLowerCase();
      if (ext && ['txt', 'json', 'md'].includes(ext) && payload.path) {
        // Open in editor after refresh
        setTimeout(() => {
          const overlay = fileOverlayRef.value?.overlay;
          if (overlay) {
            overlay.openForEdit(payload.path!, ext as any, '');
          }
        }, 500);
      }
    } else {
      createError.value = payload.error || 'Failed to create file';
    }
    fileWebSocket.off('file:create:result', handler);
  };
  fileWebSocket.on('file:create:result', handler);
}
```

- [ ] **Step 5: Wire FileList events**

Update FileList usage in template:

```html
<FileList
  :entries="entries"
  :loading="loading"
  :error="error"
  @browse="onBrowseEntry"
  @download="onDownloadEntry"
  @preview="onPreviewEntry"
  @longpress="onLongPressEntry"
/>
```

Add handlers:

```typescript
function onPreviewEntry(name: string) {
  const filePath = currentPath.value ? `${currentPath.value}\\${name}` : name;
  const entry = entries.value.find(e => e.name === name);
  const type = getFileType(name);

  if (type === 'other') {
    fileWebSocket.download(filePath);
    return;
  }

  const overlay = fileOverlayRef.value?.overlay;
  if (!overlay) return;

  overlay.loading.value = true;
  overlay.open(filePath, type, '');

  // Register content handler for this specific file
  const contentHandler = (path: string, content: string) => {
    // Normalize paths for comparison
    const normalizedPath = path.replace(/\//g, '\\');
    const normalizedOverlay = overlay.path.value.replace(/\//g, '\\');
    if (normalizedPath === normalizedOverlay) {
      overlay.content.value = content;
      overlay.loading.value = false;
      // Empty file → auto enter edit mode for editable types
      if (!content && isEditable(name)) {
        overlay.setMode('edit');
      }
      fileWebSocket.offViewContent(contentHandler);
    }
  };
  fileWebSocket.onViewContent(contentHandler);

  // Trigger download for viewing (uses existing downloadForView)
  fileWebSocket.downloadForView(filePath);
}

function onLongPressEntry(name: string, entry: FileEntry) {
  // Get touch position from event (need to pass from FileList)
  // For now, use center of screen
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  contextMenuRef.value?.open(x, y, name, entry);
}
```

- [ ] **Step 6: Import utilities**

```typescript
import { getFileType, isEditable } from '@/utils/fileType';
```

- [ ] **Step 7: Verify compilation**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/views/FileView.vue
git commit -m "feat(web): wire FileView with overlay, context menu, and new file creation"
```

---

### Task 13: Migrate FileStore viewer* State

**Files:**
- Modify: `packages/web/src/stores/file.ts`

- [ ] **Step 1: Remove viewer* state from FileStore**

The viewer state is now managed by `useFileOverlay` composable. Remove the following from `packages/web/src/stores/file.ts`:

- Remove refs: `validatingPath`, `validatedPath`, `viewerVisible`, `viewerContent`, `viewerLoading`, `viewerPath`, `viewerSaving`
- Remove setter methods: `setValidatingPath`, `setValidatedPath`, `setViewerVisible`, `setViewerContent`, `setViewerLoading`, `setViewerPath`, `setViewerSaving`, `clearViewer`
- Remove the `ValidatedPath` interface

Keep these (still used): `currentPath`, `entries`, `loading`, `error`, `transfers`, and their setters.

- [ ] **Step 2: Update fileWebSocket.ts assembleViewContent**

The existing `assembleViewContent()` method writes assembled content to `store.setViewerContent()`. Since the store viewer state is being removed, update this method to:
1. Keep the `store.setViewerContent()` call temporarily (for backward compat with any terminal-based md viewer)
2. Add the new `viewContentHandlers` notification (already added in Task 7 Step 3)

The content delivery path is now:
```
Agent sends file:data chunks → fileWebSocket.handleFileData()
  → if viewingPath matches → assembleViewContent()
    → decodes base64 → detects encoding
    → calls viewContentHandlers.forEach(h => h(path, content))
      → FileView.onPreviewEntry's contentHandler receives it
        → sets overlay.content.value
```

Note: `downloadForView()` already exists in fileWebSocket.ts (line 531). It sets `this.viewingPath` and sends `file:download`. No changes needed to this method.

- [ ] **Step 3: Update MarkdownViewer.vue to use composable instead of store**

If MarkdownViewer is still used (for the existing terminal md viewer), update it to work with the composable or keep its own local state.

- [ ] **Step 4: Verify compilation**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/stores/file.ts packages/web/src/services/fileWebSocket.ts packages/web/src/components/MarkdownViewer.vue
git commit -m "refactor(web): migrate viewer state from FileStore to useFileOverlay composable"
```

---

### Task 14: Build and Integration Test

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 2: Start dev environment and test manually**

Run: `pnpm dev`

Test the following:
1. Navigate to file manager
2. Click "+ New" → create `test.txt` → should auto-open editor
3. Type content → click Save → should show "Saved" toast, no download triggered
4. Click a `.json` file → should open in overlay
5. Click Edit → modify → click Save
6. Long-press a file → context menu appears
7. Click Rename → rename file → list refreshes
8. Click Delete → confirm → file removed
9. Open an image file → displays in overlay
10. Open an HTML file → renders in iframe

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes from manual testing"
```

---

## Summary

**14 tasks**, following the design spec's 6 phases:

| Phase | Tasks | What's built |
|-------|-------|-------------|
| 1: Protocol & Agent | 1-4 | Shared types, Agent file ops, Server routing |
| 2: Web Infrastructure | 5-8 | Utilities, composable, WebSocket methods, MdViewer fix |
| 3: New File Creation | 9, 12 | FileList smart click, FileView wiring |
| 4: File Preview | 10 | FileOverlay component |
| 5: File Editing | (in FileOverlay) | Edit mode + Save flow |
| 6: Context Menu | 11, 12 | ContextMenu component |
| Final | 13-14 | Store migration, integration test |
