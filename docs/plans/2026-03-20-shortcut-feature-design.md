# 快捷方式功能设计

## 概述

一键记录当前会话已执行的命令清单，创建快捷方式，后续可一键执行系列命令。

## 功能流程

```
用户操作终端 → 命令自动捕获 → 点击"记录"按钮 → 弹窗显示命令清单
    → 用户删除不需要的命令 → 输入名称 → 保存快捷方式
    → 点击快捷方式下拉 → 选择快捷方式 → 新建会话 → 顺序执行命令
```

## 数据结构

### 捕获的命令

```typescript
interface CapturedCommand {
  text: string;        // 命令文本
  timestamp: number;   // 执行时间
}
```

### 快捷方式

```typescript
interface Shortcut {
  id: string;
  name: string;           // 用户命名
  commands: string[];     // 命令列表
  agentId: string;        // 绑定的 Agent
  createdAt: number;
}
```

## 存储方案

| 数据 | 存储位置 | 说明 |
|------|---------|------|
| 当前会话捕获的命令 | sessionStorage | 页面关闭即清除 |
| 快捷方式列表 | localStorage | 持久化，最多保留 10 个 |

存储键名：
- `ccremote-captured-commands` - 当前会话命令
- `ccremote-shortcuts` - 快捷方式列表

## UI 布局

### 顶部工具栏

```
[Agents ▼] [快捷方式 ▼]     [Files] [📋] [⚙] [⏻]
```

- 快捷方式下拉框在 Agents 右边
- 下拉菜单显示快捷方式列表（名称 + 命令数量）
- 点击即执行
- Agent 离线时提示错误，不执行

### 底部快捷键栏

```
[Tab] [📝] | [←] [↑] [↓] [→] [⬇]
```

- 新增 📝 按钮用于记录当前会话命令
- 适当缩小按钮尺寸以容纳新按钮

### 弹窗设计

```
┌─────────────────────────────────┐
│  保存快捷方式                    │
├─────────────────────────────────┤
│  名称: [________________]       │
│                                 │
│  命令清单:                       │
│  ┌─────────────────────────────┐│
│  │ ☑ cd D:\projects            ││
│  │ ☑ npm install               ││
│  │ ☐ echo "hello"              ││  ← 可取消勾选删除
│  │ ☑ npm run build             ││
│  └─────────────────────────────┘│
│                                 │
│       [取消]  [保存]            │
└─────────────────────────────────┘
```

- 显示当前会话捕获的所有命令
- 复选框可选择/取消选择要保留的命令
- 必须输入名称才能保存
- 保存时检查快捷方式数量，超过 10 个则删除最旧的

## 命令捕获逻辑

在 `TerminalTab.vue` 中，当用户按 Enter 键发送命令时：

1. 获取当前输入缓冲区的命令文本
2. 过滤空输入和纯空白字符
3. 添加到 `capturedCommands` 数组
4. 自动保存到 sessionStorage

## 命令执行逻辑

```
1. 用户点击快捷方式
2. 检查绑定的 Agent 是否在线
   - 离线：提示"Agent 离线"，不执行
   - 在线：继续
3. 创建新终端会话
4. 等待会话启动完成（收到 session:created）
5. 延迟 500ms 后检查提示符
6. 发送第一条命令 + "\r"
7. 循环：等待 500ms → 检查最后一行是否为提示符 → 发送下一条
8. 直到所有命令执行完毕
```

### 提示符检测

```javascript
function isPromptReady(): boolean {
  // 获取终端最后一行
  const buffer = terminal.buffer.active;
  const lastLine = buffer.getLine(buffer.length - 1)?.translateToString();
  // 匹配 PowerShell 提示符模式：PS 开头，> 结尾
  return /^PS\s+.+>\s*$/.test(lastLine.trim());
}
```

## 文件变更

| 文件 | 变更 |
|------|------|
| `packages/web/src/stores/terminal.ts` | 新增 capturedCommands、shortcuts 状态和管理方法 |
| `packages/web/src/views/TerminalView.vue` | 新增快捷方式下拉框、记录按钮、保存弹窗 |
| `packages/web/src/components/TerminalTab.vue` | 新增命令捕获逻辑、提示符检测、批量执行命令功能 |

## 错误处理

- 快捷方式绑定的 Agent 离线：显示错误提示，不执行
- 会话创建失败：显示错误提示
- 命令执行过程中用户关闭标签：停止执行