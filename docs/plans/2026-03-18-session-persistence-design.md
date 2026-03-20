# 会话保持与自动恢复功能设计

## 概述

实现认证状态和终端会话的持久化，支持刷新页面后自动恢复最后一个终端，并提供历史终端会话管理功能。

## 需求

1. **认证保持**：使用 sessionStorage，关闭浏览器标签页后清除
2. **会话恢复**：刷新页面后自动恢复最后一个终端
3. **历史管理**：折叠的历史终端会话管理页签，显示本次浏览器会话期间创建过的终端

## 技术方案

采用前端状态持久化方案，使用 `sessionStorage` 存储会话状态。

### 一、认证状态持久化

**改动文件：** `packages/web/src/stores/auth.ts`

**实现：**
- `localStorage` → `sessionStorage`
- 存储：accessToken, refreshToken, userId, username
- 页面加载时自动从 sessionStorage 读取
- 登出时清除 sessionStorage

### 二、终端会话状态持久化

**改动文件：** `packages/web/src/stores/terminal.ts`

**存储结构：**
```typescript
interface StoredSession {
  tabs: Tab[];           // 当前打开的终端
  activeTabId: string | null;
  historyTabs: Tab[];    // 历史终端记录
}

interface Tab {
  id: string;
  title: string;
  agentId: string;
  createdAt?: number;    // 创建时间戳
}
```

**操作时机：**
- 添加/关闭/切换终端时 → 保存到 sessionStorage
- 页面加载时 → 从 sessionStorage 恢复
- 关闭浏览器标签页 → 自动清除

**历史终端逻辑：**
- 创建终端时，同时加入 `tabs` 和 `historyTabs`
- 关闭终端时，仅从 `tabs` 移除，保留在 `historyTabs`
- 历史记录最多保留 10 条，超出时删除最旧的

### 三、历史终端会话管理页签 UI

**改动文件：** `packages/web/src/views/TerminalView.vue`

**位置：** 在顶部工具栏的 tabs 区域最右侧添加一个固定的"历史"图标按钮

**交互：**
- 点击后展开下拉菜单，显示历史终端列表
- 每条记录显示：终端标题、Agent名称、创建时间
- 点击历史记录 → 快速创建新终端并连接该 Agent

**UI 样式：**
```
┌─────────────────────────────────────────────────────┐
│ [Agents ▼]  [Terminal 1 ×] [Terminal 2 ×]  [📜] [⚙] [⏻] │
└─────────────────────────────────────────────────────┘

点击 [📜] 后展开：
┌─────────────────────┐
│ Terminal 1 - 10:30  │
│ Terminal 2 - 10:25  │
│ Terminal 3 - 10:20  │
└─────────────────────┘
```

### 四、页面加载恢复流程

**改动文件：** `packages/web/src/views/TerminalView.vue`

**恢复顺序：**
```
页面加载
  ↓
检查 sessionStorage 是否有认证信息
  ↓ 有
恢复 authStore 状态（userId, username）
  ↓
检查 sessionStorage 是否有终端会话
  ↓ 有
恢复 terminalStore 状态
  ↓
如果有 activeTabId，自动创建并连接该终端
```

**自动连接逻辑：**
- 只恢复最后一个活动的终端
- 其他之前打开的终端记录在历史列表中，用户可手动重新打开

**边界情况处理：**
- Agent 离线时：显示提示"Agent 已离线"，终端不自动连接
- Token 过期时：尝试刷新，失败则跳转登录页

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `packages/web/src/stores/auth.ts` | 修改 | localStorage → sessionStorage |
| `packages/web/src/stores/terminal.ts` | 修改 | 添加持久化和历史记录功能 |
| `packages/web/src/views/TerminalView.vue` | 修改 | 添加历史按钮和恢复逻辑 |

## 不在范围内

- 跨浏览器/设备恢复
- 后端会话存储
- 终端内容历史记录（仅记录会话元数据）