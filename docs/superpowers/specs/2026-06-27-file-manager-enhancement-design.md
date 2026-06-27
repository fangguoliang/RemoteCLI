# 文件管理器增强设计

**日期**: 2026-06-27
**状态**: 待审核

## 概述

为移动端远程文件管理器增加三项功能：

1. **新建文件** — 输入文件名（含后缀），根据后缀自动创建对应格式文件
2. **浏览文件** — 支持 html、md、txt、json、pdf 格式的内联预览
3. **编辑文件** — 支持 md、txt、json 格式的在线编辑

## 需求澄清记录

| 问题 | 用户选择 |
|------|----------|
| Office 文件（Word/Excel/PPT）浏览 | 不支持，移除 |
| 浏览交互方式 | 全屏覆盖层 |
| 编辑器类型 | md 复用现有组件，txt/json 简单文本框，html/pdf 浏览器原生 |
| 新建文件触发方式 | 顶部工具栏按钮 |
| 工具栏功能范围 | 仅"新建文件"，保持简洁 |
| 浏览与下载的冲突 | 智能判断：可浏览格式→预览，其他→下载 |
| 保存按钮文字 | "Save"（非"保存"） |
| 架构方案 | 方案 A：统一覆盖层 |

## 文件类型处理策略

| 格式 | 点击行为 | 预览方式 | 可编辑 |
|------|----------|----------|--------|
| .md | 打开预览 | Markdown 渲染（复用现有组件） | ✓ |
| .txt | 打开预览 | 等宽字体文本 | ✓ |
| .json | 打开预览 | 等宽字体文本 | ✓ |
| .html | 打开预览 | iframe 浏览器原生渲染 | ✗ |
| .pdf | 打开预览 | iframe 浏览器原生渲染 | ✗ |
| 其他格式 | 触发下载 | — | — |

## UI 设计

### 主界面变更

在 Agent Bar 和 Path Bar 之间新增**工具栏**：

```
┌─────────────────────────────────┐
│ Agent Bar (现有)                 │
├─────────────────────────────────┤
│ [+ 新建文件]        ← 新增工具栏 │
├─────────────────────────────────┤
│ Path Bar (现有)                  │
├─────────────────────────────────┤
│ File List (现有)                 │
├─────────────────────────────────┤
│ Action Bar (现有)                │
└─────────────────────────────────┘
```

### 新建文件弹窗

- 输入框提示："例如: notes.txt、config.json"
- 说明文字："支持格式：md、txt、json、html 等任意后缀"
- 按钮：取消 / 创建

### 文件预览覆盖层

**预览模式（顶部栏）：**
- 左侧：← 返回
- 中间：文件名
- 右侧：编辑按钮（仅 md/txt/json）、下载按钮

**编辑模式（顶部栏）：**
- 左侧：取消
- 中间：文件名
- 右侧：Save 按钮（绿色）

**内容区：**
- md：Markdown 渲染 / 编辑（复用现有组件）
- txt/json：等宽字体文本显示 / textarea 编辑
- html/pdf：iframe 原生渲染（不可编辑）

## 架构设计

### 组件结构

```
Browser (packages/web)
├── FileView.vue (修改)
│   ├── 新增工具栏 + 新建文件按钮
│   └── 新增 FileOverlay 引用
├── FileOverlay.vue (新增)
│   ├── 预览模式组件
│   │   ├── MarkdownViewer (复用现有)
│   │   ├── TextViewer (新增)
│   │   └── IframeViewer (新增)
│   └── 编辑模式组件
│       ├── MarkdownEditor (复用现有)
│       └── TextEditor (新增, txt/json)
├── FileStore (修改)
│   └── 新增 overlay 相关状态
└── fileWebSocket.ts (修改)
    └── 新增 createFile() / saveFile()

Server (packages/server)
└── browserTunnel.ts (修改)
    └── 新增 file:create / file:save 消息路由

Agent (packages/agent)
└── file.ts (修改)
    └── 新增 createFile() / saveFile()
```

### 数据流

```
创建文件流程:
Browser → file:create {path, name} → Server → Agent
Agent: fs.writeFile() → 返回结果
Server → file:create:result {success, error?} → Browser
Browser: 刷新文件列表

保存文件流程:
Browser → file:save {path, content} → Server → Agent
Agent: fs.writeFile() → 返回结果
Server → file:save:result {success, error?} → Browser

浏览文件流程 (复用现有):
Browser → file:download → Server → Agent
Agent: readFileChunked() → 分块传输
Browser: assembleViewContent() → 显示覆盖层
```

### WebSocket 消息协议

新增 4 个消息类型：

```typescript
// 创建文件
file:create {
  path: string;        // 目标目录路径
  name: string;        // 文件名（含后缀）
}

file:create:result {
  success: boolean;
  error?: string;      // 错误信息
  path?: string;       // 创建成功的文件路径
}

// 保存文件
file:save {
  path: string;        // 文件完整路径
  content: string;     // 文件内容（UTF-8）
}

file:save:result {
  success: boolean;
  error?: string;
  path?: string;
}
```

## Agent 端实现

### FileManager 新增方法

```typescript
// 创建文件
async createFile(dirPath: string, fileName: string): Promise<{ path: string }> {
  const expandedDir = this.expandPath(dirPath);
  const filePath = path.join(expandedDir, fileName);

  // 检查文件是否已存在
  try {
    await fs.access(filePath);
    throw new Error('FILE_ALREADY_EXISTS');
  } catch (err: any) {
    if (err.message === 'FILE_ALREADY_EXISTS') throw err;
    // 文件不存在，可以创建
  }

  // 创建空文件
  await fs.writeFile(filePath, '', 'utf-8');
  return { path: filePath };
}

// 保存文件
async saveFile(filePath: string, content: string): Promise<void> {
  const expandedPath = this.expandPath(filePath);
  await fs.writeFile(expandedPath, content, 'utf-8');
}
```

## Web 端实现

### FileStore 新增状态

```typescript
// Overlay 状态
const overlayVisible = ref(false);
const overlayMode = ref<'view' | 'edit'>('view');
const overlayPath = ref('');
const overlayContent = ref('');
const overlayLoading = ref(false);
const overlaySaving = ref(false);
const overlayFileType = ref<'md' | 'txt' | 'json' | 'html' | 'pdf'>('txt');

// 新建文件弹窗
const showCreateModal = ref(false);
const newFileName = ref('');
```

### FileWebSocket 新增方法

```typescript
createFile(dirPath: string, fileName: string) {
  this.send({
    type: 'file:create',
    payload: { path: dirPath, name: fileName },
    timestamp: Date.now(),
  });
}

saveFile(filePath: string, content: string) {
  this.send({
    type: 'file:save',
    payload: { path: filePath, content },
    timestamp: Date.now(),
  });
}
```

### 文件类型判断

```typescript
function getFileType(fileName: string): 'md' | 'txt' | 'json' | 'html' | 'pdf' | 'other' {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const typeMap: Record<string, 'md' | 'txt' | 'json' | 'html' | 'pdf'> = {
    'md': 'md',
    'txt': 'txt',
    'json': 'json',
    'html': 'html',
    'pdf': 'pdf',
  };
  return ext && typeMap[ext] || 'other';
}

function isViewable(fileName: string): boolean {
  return getFileType(fileName) !== 'other';
}

function isEditable(fileName: string): boolean {
  const type = getFileType(fileName);
  return ['md', 'txt', 'json'].includes(type);
}
```

## 错误处理

| 场景 | 错误码 | 用户提示 |
|------|--------|----------|
| 文件已存在 | FILE_ALREADY_EXISTS | "文件已存在，请使用其他名称" |
| 权限不足 | PERMISSION_DENIED | "无权访问该目录" |
| 磁盘已满 | DISK_FULL | "磁盘空间不足" |
| 文件不存在 | FILE_NOT_FOUND | "文件不存在" |
| 保存失败 | SAVE_FAILED | "保存失败，请重试" |

## 测试计划

### 单元测试

1. **Agent 端**
   - `createFile()` 创建新文件
   - `createFile()` 文件已存在时抛错
   - `saveFile()` 保存文件内容
   - 路径展开（~、Windows 反斜杠）

2. **Web 端**
   - `getFileType()` 格式识别
   - `isViewable()` / `isEditable()` 判断
   - FileStore overlay 状态管理

### 集成测试

1. 创建文件 → 刷新列表 → 文件出现
2. 点击可浏览文件 → 覆盖层打开
3. 编辑内容 → Save → 重新打开验证
4. 点击不可浏览文件 → 触发下载
5. html/pdf 在 iframe 中正确渲染

### 手动测试

- [ ] 移动端 Chrome/Safari 测试覆盖层触控
- [ ] 大文件（>1MB）预览性能
- [ ] 中文文件名创建
- [ ] 网络断开时保存的错误提示
- [ ] 横竖屏切换时覆盖层自适应

## 实现顺序

1. **Phase 1: 基础架构**
   - Agent 端 `createFile()` / `saveFile()`
   - WebSocket 消息路由
   - Web 端 `fileWebSocket.createFile()` / `saveFile()`

2. **Phase 2: 新建文件**
   - 工具栏 UI
   - 新建文件弹窗
   - 创建流程联调

3. **Phase 3: 文件浏览**
   - FileOverlay 组件骨架
   - TextViewer（txt/json）
   - IframeViewer（html/pdf）
   - 复用现有 MdViewer

4. **Phase 4: 文件编辑**
   - TextEditor（txt/json）
   - 复用现有 MdEditor
   - Save 流程联调

5. **Phase 5: 打磨**
   - 错误处理完善
   - 加载状态优化
   - 移动端适配测试

## 依赖项

- **无新增依赖** — 复用现有组件和浏览器原生能力
- 现有 Markdown 组件需确认是否支持编辑模式（若不支持需扩展）

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 大文件编辑卡顿 | 限制编辑文件大小（建议 <500KB），超出提示下载编辑 |
| iframe 安全性 | html 预览使用 `sandbox` 属性限制脚本执行 |
| 编码问题 | 保存时统一使用 UTF-8，读取时检测 BOM |
| 并发编辑冲突 | 简单覆盖写入，不实现锁机制（单用户场景） |

## 未来扩展（不在本次范围）

- 代码编辑器集成（CodeMirror/Monaco）支持语法高亮
- 文件搜索功能
- 批量操作（多选删除/移动）
- 文件版本历史
