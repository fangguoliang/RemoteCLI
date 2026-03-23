# 会话保持与自动恢复功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现认证状态和终端会话的 sessionStorage 持久化，支持刷新页面后自动恢复最后一个终端，并提供历史终端管理功能。

**Architecture:** 前端使用 sessionStorage 存储认证信息和终端会话状态，页面加载时自动恢复。终端标签页数据包含 agentId、title、createdAt，历史记录最多保留 10 条。

**Tech Stack:** Vue 3, Pinia, TypeScript, sessionStorage

---

### Task 1: 修改认证存储方式

**Files:**
- Modify: `packages/web/src/stores/auth.ts`

**Step 1: 将 localStorage 改为 sessionStorage**

修改 `packages/web/src/stores/auth.ts`，将所有 `localStorage` 替换为 `sessionStorage`：

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  // 从 sessionStorage 读取初始值
  const accessToken = ref<string | null>(sessionStorage.getItem('accessToken'));
  const refreshToken = ref<string | null>(sessionStorage.getItem('refreshToken'));
  const userId = ref<number | null>(null);
  const username = ref<string | null>(null);

  // 页面加载时从 sessionStorage 恢复 userId 和 username
  const storedUserId = sessionStorage.getItem('userId');
  const storedUsername = sessionStorage.getItem('username');
  if (storedUserId) userId.value = parseInt(storedUserId, 10);
  if (storedUsername) username.value = storedUsername;

  const isAuthenticated = computed(() => !!accessToken.value);

  function setTokens(access: string, refresh: string, uid?: number, user?: string) {
    accessToken.value = access;
    refreshToken.value = refresh;
    if (uid !== undefined) {
      userId.value = uid;
      sessionStorage.setItem('userId', uid.toString());
    }
    if (user !== undefined) {
      username.value = user;
      sessionStorage.setItem('username', user);
    }
    sessionStorage.setItem('accessToken', access);
    sessionStorage.setItem('refreshToken', refresh);
  }

  function clearTokens() {
    accessToken.value = null;
    refreshToken.value = null;
    userId.value = null;
    username.value = null;
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('username');
  }

  async function login(user: string, pass: string, apiUrl: string) {
    const response = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    const data = await response.json();
    if (data.success) {
      setTokens(data.accessToken, data.refreshToken, data.userId, data.username);
      return true;
    }
    throw new Error(data.error || 'Login failed');
  }

  async function refresh(apiUrl: string) {
    if (!refreshToken.value || !userId.value) return false;
    try {
      const response = await fetch(`${apiUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken.value, userId: userId.value }),
      });
      const data = await response.json();
      if (data.success) {
        setTokens(data.accessToken, data.refreshToken);
        return true;
      }
    } catch {}
    clearTokens();
    return false;
  }

  return { accessToken, refreshToken, userId, username, isAuthenticated, setTokens, clearTokens, login, refresh };
});
```

**Step 2: 验证修改**

运行构建确认无类型错误：

```bash
cd packages/web && pnpm build
```

Expected: 构建成功

**Step 3: 提交**

```bash
git add packages/web/src/stores/auth.ts
git commit -m "feat(web): use sessionStorage for auth tokens instead of localStorage"
```

---

### Task 2: 扩展终端 Store 支持持久化

**Files:**
- Modify: `packages/web/src/stores/terminal.ts`

**Step 1: 扩展 Tab 接口并添加持久化逻辑**

修改 `packages/web/src/stores/terminal.ts`：

```typescript
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface Tab {
  id: string;
  title: string;
  agentId: string;
  createdAt: number;
}

interface StoredSession {
  tabs: Tab[];
  activeTabId: string | null;
  historyTabs: Tab[];
}

const SESSION_KEY = 'remotecli-terminal-session';
const MAX_HISTORY = 10;

// Key sender function type
type KeySender = (key: string) => void;

// 从 sessionStorage 加载会话
function loadSession(): StoredSession | null {
  try {
    const data = sessionStorage.getItem(SESSION_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch {}
  return null;
}

// 保存会话到 sessionStorage
function saveSession(data: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {}
}

// 清除会话
function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export const useTerminalStore = defineStore('terminal', () => {
  // 从 sessionStorage 恢复初始状态
  const savedSession = loadSession();

  const tabs = ref<Tab[]>(savedSession?.tabs || []);
  const activeTabId = ref<string | null>(savedSession?.activeTabId || null);
  const agents = ref<{ agentId: string; name: string; online: boolean }[]>([]);
  const historyTabs = ref<Tab[]>(savedSession?.historyTabs || []);

  // Registry for key senders (tabId -> sendKey function)
  const keySenders = new Map<string, KeySender>();

  // 监听变化并保存
  watch([tabs, activeTabId, historyTabs], () => {
    saveSession({
      tabs: tabs.value,
      activeTabId: activeTabId.value,
      historyTabs: historyTabs.value,
    });
  }, { deep: true });

  function addTab(tab: Tab) {
    tabs.value.push(tab);
    activeTabId.value = tab.id;

    // 添加到历史记录（避免重复）
    const existingIndex = historyTabs.value.findIndex(t => t.agentId === tab.agentId);
    if (existingIndex !== -1) {
      historyTabs.value.splice(existingIndex, 1);
    }
    historyTabs.value.unshift(tab);

    // 限制历史记录数量
    if (historyTabs.value.length > MAX_HISTORY) {
      historyTabs.value = historyTabs.value.slice(0, MAX_HISTORY);
    }
  }

  function removeTab(id: string) {
    const index = tabs.value.findIndex(t => t.id === id);
    if (index !== -1) {
      tabs.value.splice(index, 1);
      keySenders.delete(id);
      if (activeTabId.value === id) {
        activeTabId.value = tabs.value[0]?.id || null;
      }
    }
  }

  function setActiveTab(id: string) {
    activeTabId.value = id;
  }

  function setAgents(list: typeof agents.value) {
    agents.value = list;
  }

  // Register a key sender for a tab
  function registerKeySender(tabId: string, sender: KeySender) {
    keySenders.set(tabId, sender);
  }

  // Unregister a key sender
  function unregisterKeySender(tabId: string) {
    keySenders.delete(tabId);
  }

  // Send a key to the active tab
  function sendKeyToActive(key: string) {
    if (activeTabId.value) {
      const sender = keySenders.get(activeTabId.value);
      if (sender) {
        sender(key);
      }
    }
  }

  // 清除所有会话数据
  function clearAll() {
    tabs.value = [];
    activeTabId.value = null;
    historyTabs.value = [];
    clearSession();
  }

  return {
    tabs,
    activeTabId,
    agents,
    historyTabs,
    addTab,
    removeTab,
    setActiveTab,
    setAgents,
    registerKeySender,
    unregisterKeySender,
    sendKeyToActive,
    clearAll,
  };
});
```

**Step 2: 验证修改**

运行构建确认无类型错误：

```bash
cd packages/web && pnpm build
```

Expected: 构建成功

**Step 3: 提交**

```bash
git add packages/web/src/stores/terminal.ts
git commit -m "feat(web): add sessionStorage persistence for terminal tabs"
```

---

### Task 3: 更新 TerminalView 创建终端时传入 createdAt

**Files:**
- Modify: `packages/web/src/views/TerminalView.vue`

**Step 1: 修改 selectAgent 函数添加 createdAt**

找到 `selectAgent` 函数，修改为：

```typescript
function selectAgent(agentId: string) {
  showAgents.value = false;
  const tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const agent = agents.value.find(a => a.agentId === agentId);
  const agentName = agent?.name || agentId;
  terminalStore.addTab({
    id: tabId,
    title: `${agentName}`,
    agentId,
    createdAt: Date.now(),
  });
}
```

**Step 2: 验证修改**

运行构建确认无类型错误：

```bash
cd packages/web && pnpm build
```

Expected: 构建成功

**Step 3: 提交**

```bash
git add packages/web/src/views/TerminalView.vue
git commit -m "feat(web): add createdAt to terminal tab creation"
```

---

### Task 4: 添加历史终端 UI 组件

**Files:**
- Modify: `packages/web/src/views/TerminalView.vue`

**Step 1: 在 template 中添加历史按钮和下拉菜单**

在 `<div class="tabs">` 之后、`<div class="actions">` 之前添加历史按钮：

```vue
<!-- 历史终端按钮 -->
<div class="history-dropdown" v-if="historyTabs.length > 0">
  <button class="history-btn" @click="showHistory = !showHistory" title="历史终端">
    📜
  </button>
  <div class="history-menu" v-show="showHistory">
    <div class="history-header">历史终端</div>
    <div
      v-for="tab in historyTabs"
      :key="tab.id"
      class="history-item"
      @click="restoreFromHistory(tab)"
    >
      <span class="history-title">{{ tab.title }}</span>
      <span class="history-time">{{ formatTime(tab.createdAt) }}</span>
    </div>
  </div>
</div>
```

**Step 2: 在 script 中添加相关变量和函数**

添加：

```typescript
const historyTabs = computed(() => terminalStore.historyTabs);
const showHistory = ref(false);

// 格式化时间
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 从历史记录恢复终端
function restoreFromHistory(tab: Tab) {
  showHistory.value = false;
  // 检查 Agent 是否在线
  const agent = agents.value.find(a => a.agentId === tab.agentId);
  if (!agent?.online) {
    alert('Agent 已离线');
    return;
  }
  // 创建新终端
  selectAgent(tab.agentId);
}

// 点击外部关闭历史菜单
function handleHistoryClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.history-dropdown')) {
    showHistory.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleHistoryClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleHistoryClickOutside);
});
```

**Step 3: 在 style 中添加历史组件样式**

添加：

```css
/* 历史终端下拉 */
.history-dropdown {
  position: relative;
}

.history-btn {
  padding: 0.4rem 0.5rem;
  background: #1a1a2e;
  border: none;
  border-radius: 4px;
  color: #888;
  cursor: pointer;
  font-size: 1rem;
}

.history-btn:hover {
  color: #e0e0e0;
  background: #252547;
}

.history-menu {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 200px;
  max-height: 300px;
  overflow-y: auto;
  background: #16213e;
  border: 1px solid #333;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 100;
}

.history-header {
  padding: 0.5rem 0.75rem;
  color: #888;
  font-size: 0.75rem;
  border-bottom: 1px solid #333;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  color: #e0e0e0;
  cursor: pointer;
  border-bottom: 1px solid #333;
}

.history-item:last-child {
  border-bottom: none;
}

.history-item:hover {
  background: #1a1a2e;
}

.history-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  color: #666;
  font-size: 0.75rem;
  margin-left: 0.5rem;
}
```

**Step 4: 验证修改**

运行构建确认无错误：

```bash
cd packages/web && pnpm build
```

Expected: 构建成功

**Step 5: 提交**

```bash
git add packages/web/src/views/TerminalView.vue
git commit -m "feat(web): add history dropdown for terminal tabs"
```

---

### Task 5: 实现页面加载时自动恢复终端

**Files:**
- Modify: `packages/web/src/views/TerminalView.vue`

**Step 1: 在 onMounted 中添加恢复逻辑**

修改 `onMounted` 部分：

```typescript
onMounted(() => {
  loadAgents();
  intervalId = window.setInterval(loadAgents, 5000);
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('click', handleHistoryClickOutside);

  // 恢复最后一个活动的终端
  restoreActiveTerminal();
});

// 恢复最后活动的终端
async function restoreActiveTerminal() {
  // 等待 agents 加载完成
  await loadAgents();

  const savedActiveTabId = terminalStore.activeTabId;
  const savedTabs = terminalStore.tabs;

  if (savedActiveTabId && savedTabs.length > 0) {
    const activeTab = savedTabs.find(t => t.id === savedActiveTabId);
    if (activeTab) {
      // 检查 Agent 是否在线
      const agent = agents.value.find(a => a.agentId === activeTab.agentId);
      if (agent?.online) {
        // 清除旧的 tabs，只恢复活动的那个
        terminalStore.tabs.splice(0, terminalStore.tabs.length);
        terminalStore.activeTabId = null;
        // 创建新终端
        selectAgent(activeTab.agentId);
      } else {
        // Agent 离线，清除会话
        terminalStore.tabs.splice(0, terminalStore.tabs.length);
        terminalStore.activeTabId = null;
      }
    }
  }
}
```

**Step 2: 验证修改**

运行构建确认无错误：

```bash
cd packages/web && pnpm build
```

Expected: 构建成功

**Step 3: 提交**

```bash
git add packages/web/src/views/TerminalView.vue
git commit -m "feat(web): auto-restore last active terminal on page load"
```

---

### Task 6: 更新登出逻辑清除会话数据

**Files:**
- Modify: `packages/web/src/views/TerminalView.vue`

**Step 1: 修改 logout 函数**

```typescript
function logout() {
  authStore.clearTokens();
  terminalStore.clearAll();
  router.push('/login');
}
```

**Step 2: 验证修改**

运行构建确认无错误：

```bash
cd packages/web && pnpm build
```

Expected: 构建成功

**Step 3: 提交**

```bash
git add packages/web/src/views/TerminalView.vue
git commit -m "fix(web): clear terminal session on logout"
```

---

### Task 7: 构建并部署

**Step 1: 完整构建**

```bash
pnpm build
```

Expected: 所有包构建成功

**Step 2: 部署到服务器**

```bash
ssh root@123.57.34.57 'rm -rf /opt/remotecli/web/*' && scp -r packages/web/dist/* root@123.57.34.57:/opt/remotecli/web/
```

**Step 3: 提交最终更改**

```bash
git add -A
git commit -m "feat(web): complete session persistence and auto-restore feature"
```

---

## 测试清单

- [ ] 登录后刷新页面，仍然保持登录状态
- [ ] 打开终端后刷新页面，自动恢复最后一个终端
- [ ] 历史终端列表显示正确
- [ ] 点击历史记录可以快速创建新终端
- [ ] Agent 离线时不会自动恢复终端
- [ ] 登出后清除所有会话数据
- [ ] 关闭浏览器标签页后重新打开，需要重新登录