# 快捷方式功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现一键记录当前会话命令并创建快捷方式，支持一键执行系列命令。

**Architecture:** 纯前端实现。在 terminal store 中管理命令捕获和快捷方式状态，TerminalTab 组件捕获用户输入命令，TerminalView 组件提供快捷方式下拉框和保存弹窗 UI。

**Tech Stack:** Vue 3, Pinia, xterm.js, localStorage, sessionStorage

---

### Task 1: 扩展 terminal store - 添加命令捕获和快捷方式状态管理

**Files:**
- Modify: `packages/web/src/stores/terminal.ts`

**Step 1: 添加类型定义和存储函数**

在文件顶部，`Tab` 接口之后添加：

```typescript
// Captured command from terminal session
export interface CapturedCommand {
  text: string;
  timestamp: number;
}

// User-created shortcut for executing command sequences
export interface Shortcut {
  id: string;
  name: string;
  commands: string[];
  agentId: string;
  createdAt: number;
}

const CAPTURED_KEY = 'remotecli-captured-commands';
const SHORTCUTS_KEY = 'remotecli-shortcuts';
const MAX_SHORTCUTS = 10;

// Captured commands storage (session-based)
function loadCapturedCommands(): CapturedCommand[] {
  try {
    const data = sessionStorage.getItem(CAPTURED_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load captured commands:', e);
  }
  return [];
}

function saveCapturedCommands(commands: CapturedCommand[]): void {
  try {
    sessionStorage.setItem(CAPTURED_KEY, JSON.stringify(commands));
  } catch (e) {
    console.error('Failed to save captured commands:', e);
  }
}

function clearCapturedCommands(): void {
  try {
    sessionStorage.removeItem(CAPTURED_KEY);
  } catch (e) {
    console.error('Failed to clear captured commands:', e);
  }
}

// Shortcuts storage (persistent)
function loadShortcuts(): Shortcut[] {
  try {
    const data = localStorage.getItem(SHORTCUTS_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load shortcuts:', e);
  }
  return [];
}

function saveShortcuts(shortcuts: Shortcut[]): void {
  try {
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
  } catch (e) {
    console.error('Failed to save shortcuts:', e);
  }
}
```

**Step 2: 添加状态和方法到 store**

在 `defineStore` 内部，`historyTabs` 之后添加状态：

```typescript
const capturedCommands = ref<CapturedCommand[]>(loadCapturedCommands());
const shortcuts = ref<Shortcut[]>(loadShortcuts());
```

在 `watch` 块之后添加自动保存：

```typescript
// Watch captured commands and auto-save to sessionStorage
watch(
  capturedCommands,
  () => {
    saveCapturedCommands(capturedCommands.value);
  },
  { deep: true }
);

// Watch shortcuts and auto-save to localStorage
watch(
  shortcuts,
  () => {
    saveShortcuts(shortcuts.value);
  },
  { deep: true }
);
```

在 return 之前添加方法：

```typescript
// Capture a command from terminal
function captureCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return; // Skip empty commands
  capturedCommands.value.push({
    text: trimmed,
    timestamp: Date.now(),
  });
}

// Clear captured commands for current session
function clearCapturedCommands() {
  capturedCommands.value = [];
  clearCapturedCommands();
}

// Save a new shortcut
function saveShortcut(name: string, commands: string[], agentId: string): boolean {
  if (!name.trim() || commands.length === 0 || !agentId) return false;

  const shortcut: Shortcut = {
    id: 'shortcut-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    name: name.trim(),
    commands,
    agentId,
    createdAt: Date.now(),
  };

  // Add to beginning, keep max MAX_SHORTCUTS
  shortcuts.value.unshift(shortcut);
  if (shortcuts.value.length > MAX_SHORTCUTS) {
    shortcuts.value = shortcuts.value.slice(0, MAX_SHORTCUTS);
  }

  return true;
}

// Delete a shortcut
function deleteShortcut(id: string) {
  const index = shortcuts.value.findIndex(s => s.id === id);
  if (index !== -1) {
    shortcuts.value.splice(index, 1);
  }
}
```

更新 return 语句：

```typescript
return {
  // ... existing exports
  capturedCommands,
  shortcuts,
  captureCommand,
  clearCapturedCommands,
  saveShortcut,
  deleteShortcut,
};
```

**Step 3: 验证类型检查**

Run: `cd packages/web && pnpm typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/web/src/stores/terminal.ts
git commit -m "feat(web): add captured commands and shortcuts state to terminal store"
```

---

### Task 2: TerminalTab 组件 - 添加命令捕获逻辑

**Files:**
- Modify: `packages/web/src/components/TerminalTab.vue`

**Step 1: 添加命令捕获逻辑**

在 `terminal.onData` 回调中捕获用户输入命令。在现有的 `terminal.onData` 回调（约第 66 行）修改：

```typescript
terminal.onData((data) => {
  // Capture command when user presses Enter
  if (data === '\r' || data === '\n') {
    // Get current line content from terminal buffer
    const buffer = terminal.buffer.active;
    const currentLine = buffer.getLine(buffer.cursorY + buffer.baseY);
    if (currentLine) {
      const lineText = currentLine.translateToString(true);
      // Remove prompt prefix (PS C:\path> format)
      const commandMatch = lineText.match(/^PS\s+[^>]*>\s*(.*)$/);
      const commandText = commandMatch ? commandMatch[1] : lineText;
      if (commandText.trim()) {
        terminalStore.captureCommand(commandText);
      }
    }
  }
  sendInput(data);
});
```

**Step 2: 添加批量命令执行功能**

添加新的 props 和方法支持批量执行命令。在 `<script setup>` 顶部添加：

```typescript
const props = defineProps<{
  tab: Tab;
  visible: boolean;
  autoExecuteCommands?: string[];  // Optional: commands to auto-execute
}>();
```

在 `handleWsMessage` 函数中，在 `session:created` case 之后添加：

```typescript
case 'session:created':
  if (msg.payload.success) {
    sessionId = msg.payload.sessionId;
    status.value = 'connected';
    // Update the tab with the sessionId for persistence
    if (sessionId) {
      terminalStore.updateTabSessionId(props.tab.id, sessionId);
    }
    // Auto-execute commands if provided
    if (props.autoExecuteCommands && props.autoExecuteCommands.length > 0) {
      executeCommandsSequentially(props.autoExecuteCommands);
    }
  }
  break;
```

在 `cleanup` 函数之前添加辅助函数：

```typescript
// Check if terminal prompt is ready (PowerShell: PS ...>)
function isPromptReady(): boolean {
  if (!terminal) return false;
  const buffer = terminal.buffer.active;
  const lastLine = buffer.getLine(buffer.length - 1);
  if (!lastLine) return false;
  const lineText = lastLine.translateToString(true).trim();
  // Match PowerShell prompt: PS followed by path and >
  return /^PS\s+.+>\s*$/.test(lineText);
}

// Execute commands sequentially, waiting for prompt between each
async function executeCommandsSequentially(commands: string[]) {
  if (!terminal || commands.length === 0) return;

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  for (const command of commands) {
    // Wait for prompt to be ready
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds max
    while (!isPromptReady() && attempts < maxAttempts) {
      await delay(500);
      attempts++;
    }

    if (!isPromptReady()) {
      console.warn('Prompt not ready, skipping remaining commands');
      break;
    }

    // Small delay before sending command
    await delay(300);

    // Send the command
    sendInput(command + '\r');

    // Wait a bit for command to start executing
    await delay(500);
  }
}

// Expose method for parent component to trigger command execution
defineExpose({
  executeCommands: executeCommandsSequentially,
});
```

**Step 3: 验证类型检查**

Run: `cd packages/web && pnpm typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/web/src/components/TerminalTab.vue
git commit -m "feat(web): add command capture and sequential execution to TerminalTab"
```

---

### Task 3: TerminalView 组件 - 添加快捷方式 UI

**Files:**
- Modify: `packages/web/src/views/TerminalView.vue`

**Step 1: 添加快捷方式下拉框到顶部工具栏**

在 template 中，`agents-dropdown` div 之后（约第 24 行），添加快捷方式下拉框：

```html
<!-- 快捷方式下拉框 -->
<div class="shortcuts-dropdown">
  <button class="dropdown-btn" @click="showShortcuts = !showShortcuts" :disabled="shortcuts.length === 0">
    快捷方式 ({{ shortcuts.length }})
    <span class="arrow" :class="{ open: showShortcuts }">▼</span>
  </button>
  <div class="dropdown-menu" v-show="showShortcuts">
    <div v-if="shortcuts.length === 0" class="menu-item no-shortcuts">
      暂无快捷方式
    </div>
    <div v-else>
      <div v-for="shortcut in shortcuts" :key="shortcut.id" class="menu-item shortcut-item" @click="executeShortcut(shortcut)">
        <div class="shortcut-info">
          <span class="shortcut-name">{{ shortcut.name }}</span>
          <span class="shortcut-meta">{{ shortcut.commands.length }} 条命令 · {{ agents.find(a => a.agentId === shortcut.agentId)?.name || shortcut.agentId }}</span>
        </div>
        <button class="delete-btn" @click.stop="deleteShortcut(shortcut.id)" title="删除">×</button>
      </div>
    </div>
  </div>
</div>
```

**Step 2: 添加记录按钮到底部快捷键栏**

修改底部快捷键栏（约第 67 行），在 Tab 按钮后添加记录按钮：

```html
<!-- 底部快捷键按钮 -->
<div class="bottom-bar" v-if="tabs.length > 0">
  <button class="key-btn tab-btn" @click="sendKey('Tab')">Tab</button>
  <button class="key-btn capture-btn" @click="openSaveModal" :disabled="capturedCommands.length === 0" title="保存为快捷方式">📝</button>
  <div class="spacer"></div>
  <button class="key-btn arrow-btn" @click="sendKey('ArrowLeft')">←</button>
  <button class="key-btn arrow-btn" @click="sendKey('ArrowUp')">↑</button>
  <button class="key-btn arrow-btn" @click="sendKey('ArrowDown')">↓</button>
  <button class="key-btn arrow-btn" @click="sendKey('ArrowRight')">→</button>
  <button class="key-btn bottom-btn" @click="scrollToBottom" title="滚动到底部">⬇</button>
</div>
```

**Step 3: 添加保存弹窗**

在 `footer-bar` 之后添加弹窗：

```html
<!-- 保存快捷方式弹窗 -->
<div class="modal-overlay" v-if="showSaveModal" @click.self="closeSaveModal">
  <div class="modal">
    <div class="modal-header">
      <h3>保存快捷方式</h3>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>名称</label>
        <input v-model="shortcutName" placeholder="输入快捷方式名称" />
      </div>
      <div class="form-group">
        <label>命令清单 ({{ selectedCommands.length }} 条已选)</label>
        <div class="command-list">
          <div v-for="(cmd, index) in capturedCommands" :key="index" class="command-item">
            <input type="checkbox" v-model="selectedCommands[index]" />
            <span class="command-text">{{ cmd.text }}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" @click="closeSaveModal">取消</button>
      <button class="btn-save" @click="saveShortcut" :disabled="!shortcutName.trim() || selectedCommandTexts.length === 0">保存</button>
    </div>
  </div>
</div>
```

**Step 4: 添加 script 逻辑**

在 `<script setup>` 中添加新的状态和方法：

```typescript
// Shortcuts state
const shortcuts = computed(() => terminalStore.shortcuts);
const capturedCommands = computed(() => terminalStore.capturedCommands);
const showShortcuts = ref(false);
const showSaveModal = ref(false);
const shortcutName = ref('');
const selectedCommands = ref<boolean[]>([]);

// Selected command texts
const selectedCommandTexts = computed(() => {
  return capturedCommands.value
    .filter((_, index) => selectedCommands.value[index])
    .map(cmd => cmd.text);
});

// Open save modal
function openSaveModal() {
  if (capturedCommands.value.length === 0) return;
  // Select all by default
  selectedCommands.value = capturedCommands.value.map(() => true);
  shortcutName.value = '';
  showSaveModal.value = true;
}

// Close save modal
function closeSaveModal() {
  showSaveModal.value = false;
  shortcutName.value = '';
  selectedCommands.value = [];
}

// Save shortcut
function saveShortcutHandler() {
  const activeTab = tabs.value.find(t => t.id === activeTabId.value);
  if (!activeTab) return;

  const success = terminalStore.saveShortcut(
    shortcutName.value,
    selectedCommandTexts.value,
    activeTab.agentId
  );

  if (success) {
    closeSaveModal();
    // Clear captured commands after saving
    terminalStore.clearCapturedCommands();
  }
}

// Execute shortcut
function executeShortcut(shortcut: typeof shortcuts.value[0]) {
  showShortcuts.value = false;

  // Check if agent is online
  const agent = agents.value.find(a => a.agentId === shortcut.agentId);
  if (!agent?.online) {
    alert(`Agent "${shortcut.agentId}" 离线，无法执行快捷方式`);
    return;
  }

  // Create new terminal with auto-execute commands
  const now = Date.now();
  const tabId = 'tab-' + now + '-' + Math.random().toString(36).substr(2, 9);
  terminalStore.addTab({
    id: tabId,
    title: shortcut.name,
    agentId: shortcut.agentId,
    createdAt: now,
    autoExecuteCommands: shortcut.commands,
  });
}

// Delete shortcut
function deleteShortcutHandler(id: string) {
  if (confirm('确定删除此快捷方式？')) {
    terminalStore.deleteShortcut(id);
  }
}
```

更新 `handleClickOutside` 函数以关闭快捷方式下拉：

```typescript
function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.agents-dropdown')) {
    showAgents.value = false;
  }
  if (!target.closest('.shortcuts-dropdown')) {
    showShortcuts.value = false;
  }
  if (!target.closest('.history-dropdown')) {
    showHistory.value = false;
  }
}
```

**Step 5: 添加样式**

在 `<style scoped>` 末尾添加：

```css
/* 快捷方式下拉框 */
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
}

.shortcut-name {
  color: #e0e0e0;
}

.shortcut-meta {
  font-size: 0.75rem;
  color: #666;
}

.delete-btn {
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 1rem;
}

.delete-btn:hover {
  color: #e94560;
}

/* 记录按钮 */
.capture-btn {
  background: #e94560;
  min-width: 40px;
  padding: 0.6rem 0.8rem;
}

.capture-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.capture-btn:not(:disabled):active {
  background: #ff6b6b;
}

/* 弹窗样式 */
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
}

.form-group input[type="text"]:focus {
  outline: none;
  border-color: #e94560;
}

.command-list {
  max-height: 200px;
  overflow-y: auto;
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 4px;
}

.command-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border-bottom: 1px solid #333;
}

.command-item:last-child {
  border-bottom: none;
}

.command-item input[type="checkbox"] {
  accent-color: #e94560;
}

.command-text {
  color: #e0e0e0;
  font-family: monospace;
  font-size: 0.85rem;
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
```

**Step 6: 更新 Tab 接口以支持 autoExecuteCommands**

需要修改 `stores/terminal.ts` 中的 Tab 接口：

```typescript
export interface Tab {
  id: string;
  title: string;
  agentId: string;
  createdAt: number;
  sessionId?: string;
  autoExecuteCommands?: string[]; // Optional: commands to auto-execute on session start
}
```

**Step 7: 验证类型检查**

Run: `cd packages/web && pnpm typecheck`
Expected: No errors

**Step 8: Commit**

```bash
git add packages/web/src/views/TerminalView.vue packages/web/src/stores/terminal.ts
git commit -m "feat(web): add shortcuts dropdown and save modal to TerminalView"
```

---

### Task 4: 更新 TerminalTab 组件以支持 autoExecuteCommands

**Files:**
- Modify: `packages/web/src/components/TerminalTab.vue`

**Step 1: 确保命令自动执行在会话创建后触发**

这个逻辑在 Task 2 中已经添加。需要确保 `session:created` 事件处理后触发命令执行。

检查代码是否正确处理 `autoExecuteCommands` prop。

**Step 2: 测试验证**

手动测试流程：
1. 登录系统
2. 打开终端执行几条命令
3. 点击底部 📝 按钮
4. 在弹窗中输入名称，选择命令，保存
5. 点击顶部"快捷方式"下拉，选择刚创建的快捷方式
6. 验证新会话自动执行了命令

**Step 3: Commit**

```bash
git add packages/web/src/components/TerminalTab.vue
git commit -m "feat(web): ensure auto-execute commands run after session creation"
```

---

### Task 5: 最终测试和清理

**Step 1: 运行类型检查**

Run: `cd packages/web && pnpm typecheck`
Expected: No errors

**Step 2: 手动测试完整流程**

1. 登录系统
2. 打开终端，执行命令如 `dir`, `cd ..`, `dir`
3. 点击底部 📝 按钮
4. 在弹窗中：
   - 取消勾选一些命令
   - 输入名称如"测试快捷方式"
   - 点击保存
5. 点击顶部"快捷方式"下拉
6. 选择刚创建的快捷方式
7. 验证：
   - 新终端会话打开
   - 命令按顺序执行
   - 每条命令等待上一条完成

**Step 3: 测试边界情况**

1. 快捷方式超过 10 个时，删除最旧的
2. Agent 离线时点击快捷方式，显示错误提示
3. 空命令不保存
4. 会话页面刷新后，捕获的命令清空（sessionStorage）

**Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat(web): complete shortcut feature implementation"
```

---

## 文件变更总结

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/web/src/stores/terminal.ts` | 修改 | 新增 CapturedCommand、Shortcut 类型，capturedCommands 和 shortcuts 状态，相关方法 |
| `packages/web/src/components/TerminalTab.vue` | 修改 | 新增命令捕获逻辑，批量命令执行功能，提示符检测 |
| `packages/web/src/views/TerminalView.vue` | 修改 | 新增快捷方式下拉框、记录按钮、保存弹窗 UI |