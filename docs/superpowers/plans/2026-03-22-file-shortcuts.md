# File Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file shortcuts feature to FileView that allows users to save and quickly navigate to frequently used directory paths.

**Architecture:** Create a dedicated `fileShortcuts` store using Pinia with localStorage persistence. Add shortcuts dropdown and save button to FileView, mirroring the terminal shortcuts pattern.

**Tech Stack:** Vue 3, Pinia, TypeScript, localStorage

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `packages/web/src/stores/fileShortcuts.ts` | Create | New store for file shortcuts |
| `packages/web/src/views/FileView.vue` | Modify | Add shortcuts UI |

---

### Task 1: Create File Shortcuts Store

**Files:**
- Create: `packages/web/src/stores/fileShortcuts.ts`

- [ ] **Step 1: Create the fileShortcuts store**

```typescript
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface FileShortcut {
  id: string;
  name: string;
  path: string;
  agentId: string;
  createdAt: number;
}

const SHORTCUTS_KEY = 'remotecli-file-shortcuts';
const MAX_SHORTCUTS = 10;

function loadShortcuts(): FileShortcut[] {
  try {
    const data = localStorage.getItem(SHORTCUTS_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load file shortcuts:', e);
  }
  return [];
}

function saveShortcuts(shortcuts: FileShortcut[]): void {
  try {
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
  } catch (e) {
    console.error('Failed to save file shortcuts:', e);
  }
}

export const useFileShortcutsStore = defineStore('fileShortcuts', () => {
  const shortcuts = ref<FileShortcut[]>(loadShortcuts());

  watch(
    shortcuts,
    () => {
      saveShortcuts(shortcuts.value);
    },
    { deep: true }
  );

  function saveShortcut(name: string, path: string, agentId: string): boolean {
    if (!name.trim() || !path.trim() || !agentId) return false;

    const shortcut: FileShortcut = {
      id: 'file-shortcut-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11),
      name: name.trim(),
      path: path.trim(),
      agentId,
      createdAt: Date.now(),
    };

    shortcuts.value.unshift(shortcut);
    if (shortcuts.value.length > MAX_SHORTCUTS) {
      shortcuts.value = shortcuts.value.slice(0, MAX_SHORTCUTS);
    }

    return true;
  }

  function deleteShortcut(id: string) {
    const index = shortcuts.value.findIndex(s => s.id === id);
    if (index !== -1) {
      shortcuts.value.splice(index, 1);
    }
  }

  function clearAll() {
    shortcuts.value = [];
  }

  return {
    shortcuts,
    saveShortcut,
    deleteShortcut,
    clearAll,
  };
});
```

- [ ] **Step 2: Commit the store**

```bash
git add packages/web/src/stores/fileShortcuts.ts
git commit -m "feat(web): add fileShortcuts store for directory shortcuts"
```

---

### Task 2: Add Shortcuts UI to FileView

**Files:**
- Modify: `packages/web/src/views/FileView.vue`

- [ ] **Step 1: Add imports and store reference**

Add after line 101 (after `import FileTransferProgress`):

```typescript
import { useFileShortcutsStore } from '@/stores/fileShortcuts';
```

Add after line 111 (after `const terminalStore = useTerminalStore();`):

```typescript
const fileShortcutsStore = useFileShortcutsStore();
```

- [ ] **Step 2: Add reactive refs for shortcuts UI**

Add after line 119 (after `const gotoPath = ref('');`):

```typescript
const showShortcuts = ref(false);
const showSaveModal = ref(false);
const shortcutName = ref('');
const fileShortcuts = computed(() => fileShortcutsStore.shortcuts);
```

- [ ] **Step 3: Add shortcuts dropdown to agent-bar**

Replace the agent-bar section (lines 3-31) with:

```vue
    <!-- Agent Selection Bar -->
    <div class="agent-bar">
      <div class="agents-dropdown">
        <button class="dropdown-btn" @click="showAgents = !showAgents">
          <span class="status-dot" :class="{ online: selectedAgentOnline }"></span>
          {{ selectedAgentName }}
          <span class="arrow" :class="{ open: showAgents }">v</span>
        </button>
        <div class="dropdown-menu" v-show="showAgents">
          <div v-if="loadingAgents" class="menu-item loading">Loading...</div>
          <div v-else-if="agents.length === 0" class="menu-item no-agents">
            No agents available
          </div>
          <div v-else>
            <div
              v-for="agent in agents"
              :key="agent.agentId"
              class="menu-item"
              :class="{ disabled: !agent.online }"
              @click="selectAgent(agent.agentId)"
            >
              <span class="status-dot" :class="{ online: agent.online }"></span>
              {{ agent.name || agent.agentId }}
            </div>
          </div>
        </div>
      </div>
      <!-- Shortcuts Dropdown -->
      <div class="shortcuts-dropdown">
        <button class="dropdown-btn" @click="showShortcuts = !showShortcuts" :disabled="fileShortcuts.length === 0">
          快捷方式 ({{ fileShortcuts.length }})
          <span class="arrow" :class="{ open: showShortcuts }">v</span>
        </button>
        <div class="dropdown-menu" v-show="showShortcuts">
          <div v-if="fileShortcuts.length === 0" class="menu-item no-shortcuts">
            暂无快捷方式
          </div>
          <div v-else>
            <div v-for="shortcut in fileShortcuts" :key="shortcut.id" class="menu-item shortcut-item" @click="executeFileShortcut(shortcut)">
              <div class="shortcut-info">
                <span class="shortcut-name">{{ shortcut.name }}</span>
                <span class="shortcut-path">{{ shortcut.path }}</span>
              </div>
              <button class="delete-btn" @click.stop="deleteFileShortcut(shortcut.id)" title="删除" aria-label="删除快捷方式">×</button>
            </div>
          </div>
        </div>
      </div>
      <router-link to="/terminal" class="nav-btn" title="Terminal">Terminal</router-link>
    </div>
```

- [ ] **Step 4: Add save button to action-bar**

Replace action-bar section (lines 60-77) with:

```vue
    <!-- Action Bar -->
    <div class="action-bar" v-if="selectedAgentId">
      <input
        ref="pathInput"
        type="text"
        class="path-input"
        v-model="gotoPath"
        placeholder="D: or path..."
        @keyup.enter="goToPath"
      />
      <button class="action-btn" @click="goToPath">Go</button>
      <button class="action-btn" @click="triggerUpload">
        <span>^</span> Upload
      </button>
      <button class="action-btn" @click="refresh">
        <span>~</span> Refresh
      </button>
      <button class="action-btn save-btn" @click="openSaveModal" :disabled="!currentPath">
        <span>📍</span> 保存
      </button>
    </div>
```

- [ ] **Step 5: Add save modal before footer-bar**

Add after `<!-- Hidden File Input -->` section (after line 85):

```vue
    <!-- Save Shortcut Modal -->
    <div class="modal-overlay" v-if="showSaveModal" @click.self="closeSaveModal" @keydown.escape="closeSaveModal">
      <div class="modal">
        <div class="modal-header">
          <h3>保存快捷方式</h3>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称</label>
            <input v-model="shortcutName" placeholder="输入快捷方式名称" @keyup.enter="saveShortcutHandler" />
          </div>
          <div class="form-group">
            <label>路径</label>
            <div class="current-path">{{ currentPath }}</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="closeSaveModal">取消</button>
          <button class="btn-save" @click="saveShortcutHandler" :disabled="!shortcutName.trim()">保存</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 6: Add shortcut handler functions**

Add before `function handleClickOutside` (around line 292):

```typescript
// Open save shortcut modal
function openSaveModal() {
  if (!currentPath.value || !selectedAgentId.value) return;
  shortcutName.value = '';
  showSaveModal.value = true;
}

// Close save shortcut modal
function closeSaveModal() {
  showSaveModal.value = false;
  shortcutName.value = '';
}

// Save shortcut handler
function saveShortcutHandler() {
  if (!shortcutName.value.trim() || !currentPath.value || !selectedAgentId.value) return;

  const success = fileShortcutsStore.saveShortcut(
    shortcutName.value,
    currentPath.value,
    selectedAgentId.value
  );

  if (success) {
    closeSaveModal();
  }
}

// Execute file shortcut (navigate to path)
function executeFileShortcut(shortcut: typeof fileShortcuts.value[0]) {
  showShortcuts.value = false;

  // Check if agent is online
  const agent = agents.value.find(a => a.agentId === shortcut.agentId);
  if (!agent?.online) {
    alert(`Agent "${shortcut.agentId}" 离线，无法跳转`);
    return;
  }

  // If different agent, switch to it first
  if (shortcut.agentId !== selectedAgentId.value) {
    selectedAgentId.value = shortcut.agentId;
  }

  // Navigate to the path
  fileStore.setLoading(true);
  fileWebSocket.browse(shortcut.path, shortcut.agentId);
}

// Delete file shortcut
function deleteFileShortcut(id: string) {
  if (confirm('确定删除此快捷方式？')) {
    fileShortcutsStore.deleteShortcut(id);
  }
}
```

- [ ] **Step 7: Update handleClickOutside to include shortcuts dropdown**

Replace the existing `handleClickOutside` function with:

```typescript
// Close dropdown when clicking outside
function handleClickOutside(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (!target.closest('.agents-dropdown')) {
    showAgents.value = false;
  }
  if (!target.closest('.shortcuts-dropdown')) {
    showShortcuts.value = false;
  }
}
```

- [ ] **Step 8: Add CSS styles for shortcuts**

Add at the end of the `<style scoped>` section (before `</style>`):

```css
/* Shortcuts dropdown */
.shortcuts-dropdown {
  position: relative;
}

.shortcuts-dropdown .dropdown-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.shortcut-item {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.shortcut-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.shortcut-name {
  color: #e0e0e0;
}

.shortcut-path {
  font-size: 0.75rem;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-btn {
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 1rem;
  flex-shrink: 0;
}

.delete-btn:hover {
  color: #e94560;
}

/* Save button */
.save-btn {
  background: #e94560;
}

.save-btn:hover:not(:disabled) {
  background: #ff6b6b;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: #16213e;
  border-radius: 8px;
  width: 90%;
  max-width: 400px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: 1rem;
  border-bottom: 1px solid #333;
}

.modal-header h3 {
  margin: 0;
  color: #e0e0e0;
}

.modal-body {
  padding: 1rem;
  overflow-y: auto;
  flex: 1;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  color: #888;
  font-size: 0.85rem;
}

.form-group input[type="text"] {
  width: 100%;
  padding: 0.5rem;
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 1rem;
  box-sizing: border-box;
}

.form-group input[type="text"]:focus {
  outline: none;
  border-color: #e94560;
}

.current-path {
  padding: 0.5rem;
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 4px;
  color: #4fc3f7;
  font-family: monospace;
  font-size: 0.9rem;
  word-break: break-all;
}

.modal-footer {
  padding: 1rem;
  border-top: 1px solid #333;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.btn-cancel,
.btn-save {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-cancel {
  background: #333;
  color: #e0e0e0;
}

.btn-cancel:hover {
  background: #444;
}

.btn-save {
  background: #e94560;
  color: #fff;
}

.btn-save:hover:not(:disabled) {
  background: #ff6b6b;
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.menu-item.no-shortcuts {
  color: #888;
  cursor: default;
}
```

- [ ] **Step 9: Commit FileView changes**

```bash
git add packages/web/src/views/FileView.vue
git commit -m "feat(web): add file shortcuts UI to FileView"
```

---

### Task 3: Verify and Test

- [ ] **Step 1: Run type check**

```bash
cd packages/web && pnpm typecheck
```

Expected: No type errors

- [ ] **Step 2: Manual testing checklist**

1. Start the development server: `pnpm dev`
2. Navigate to FileView
3. Select an agent and browse to a directory
4. Click "保存" button - modal should open
5. Enter a name and save - shortcut should appear in dropdown
6. Navigate to a different directory
7. Click shortcuts dropdown and select saved shortcut - should navigate back
8. Delete a shortcut - should be removed from list
9. Refresh the page - shortcuts should persist

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(web): address any issues found during testing"
```

---

## Summary

| Task | Files | Commits |
|------|-------|---------|
| 1. Create store | `stores/fileShortcuts.ts` | 1 |
| 2. Add UI | `views/FileView.vue` | 1 |
| 3. Verify | - | 0-1 |

**Total: 2-3 commits**