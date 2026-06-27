# 文件管理器增强设计 (v3 — Design Review 修订)

**日期**: 2026-06-27
**状态**: 已审核（CEO + Design Review）

## 概述

为移动端远程文件管理器增加功能：

1. **新建文件** — 输入文件名（含后缀），根据后缀自动创建空文件
2. **浏览文件** — 支持 md、txt、json、html、pdf、图片(jpg/png/gif/webp) 内联预览
3. **编辑文件** — 支持 md、txt、json 在线编辑
4. **文件操作** — 长按弹出快捷菜单（重命名/删除/详情）

## CEO Review 决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 实现方案 | A: 最小化新增 | 只新增 `file:create`，保存复用 `file:upload` |
| 审核模式 | SELECTIVE EXPANSION | 功能迭代，逐个挑选扩展 |
| 安全校验 | 全部加 | 路径遍历 + 非法字符 + iframe sandbox |
| Overlay 状态 | 抽离 composable | `useFileOverlay()` 避免 FileStore 膨胀 |
| Save 按钮 | 统一英文 "Save" | "保存"易误解为"下载" |
| Save 触发下载 bug | 分离保存与下载流程 | Save 不创建 transfer 记录 |
| 大文件保护 | 500KB 阈值 | txt/json 超过阈值提示下载 |
| 扩展: 自动聚焦 | 加入 | 新建弹窗自动聚焦 + 键盘弹出 |
| 扩展: 图片预览 | 加入 | jpg/png/gif/webp 用 `<img>` 渲染 |
| 扩展: 未保存提示 | 加入 | 关闭编辑时检测 dirty 状态 |
| 扩展: 长按菜单 | 加入 | 重命名/删除/详情 |

## Design Review 决策记录

| 维度 | 决策 | 理由 |
|------|------|------|
| 信息架构 | "+ New" 合并到底部 Action Bar | 减少层级，文件列表成为主角，拇指热区更好 |
| 空文件 | 提示 "Empty file" + 自动进入编辑模式 | 刚创建的文件需要写入内容 |
| 保存失败 | 本地缓存编辑内容 + 手动重试 | 防止用户丢失编辑内容 |
| 错误展示 | 弹窗内红色文字提示（非 alert） | 用户可原地修改文件名 |
| 新建后 | txt/json/md 自动打开编辑，其他格式只刷新列表 | 减少操作步骤 |
| 触觉反馈 | 长按触发 navigator.vibrate(50) | 触觉确认感 |
| Save 颜色 | 使用 var(--success) 而非 #4ade80 | 与设计系统一致 |
| 无障碍 | 覆盖层 role=dialog + aria-modal + Esc 关闭 + 焦点管理 | 基础无障碍支持 |
| 动效 | 覆盖层从底部滑入 (300ms ease-out) | 与现有 modal-in 动画一致 |
| 手势冲突 | 长按只在文件列表，滑动只在覆盖层，区域分离 | 不冲突 |
| 文件图标 | 保持 📁/📄 emoji 不变 | 风格一致，无需额外工作 |

## 文件类型处理策略

| 格式 | 点击行为 | 预览方式 | 可编辑 |
|------|----------|----------|--------|
| .md | 打开预览 | MdPreview 渲染（复用现有 MdViewer） | ✓ |
| .txt | 打开预览 | 等宽字体文本 | ✓ |
| .json | 打开预览 | 等宽字体文本 | ✓ |
| .html | 打开预览 | iframe + `sandbox="allow-same-origin"` | ✗ |
| .pdf | 打开预览 | iframe 原生渲染 | ✗ |
| .jpg/.png/.gif/.webp | 打开预览 | `<img>` 标签 + base64 解码 | ✗ |
| 其他格式 | 触发下载 | — | — |

**大文件保护：** txt/json 文件 >500KB 时，提示"文件较大，建议下载查看"而非直接预览。

## UI 设计

### 主界面变更

"+ New" 按钮合并到底部 Action Bar（减少视觉层级）：

```
┌─────────────────────────────────┐
│ Agent Bar (现有)                 │
├─────────────────────────────────┤
│ Path Bar (现有)                  │
├─────────────────────────────────┤
│ File List (修改: 智能点击+长按)  │
├─────────────────────────────────┤
│ Action Bar: [Path] [+ New] [⬆][↻]│  ← "+ New" 合并至此
└─────────────────────────────────┘
```

### 新建文件弹窗

- 输入框自动聚焦（`autofocus` + `nextTick` 确保移动端键盘弹出）
- 输入框提示："例如: notes.txt、config.json"
- 说明文字："支持格式：md、txt、json、html 等任意后缀"
- 按钮：Cancel / Create

### 文件预览覆盖层

**预览模式（顶部栏）：**
- 左侧：← 返回
- 中间：文件名
- 右侧：Edit 按钮（仅 md/txt/json）、Download 按钮

**编辑模式（顶部栏）：**
- 左侧：Cancel
- 中间：文件名
- 右侧：Save 按钮（绿色）

**未保存保护：** 编辑模式下点击返回/关闭，若有未保存修改，弹出"放弃更改？"确认框。

**内容区：**
- md：MdPreview / MdEditor（复用现有 md-editor-v3）
- txt/json：等宽字体 `<pre>` / `<textarea>`
- html/pdf：`<iframe>` 原生渲染
- 图片：`<img>` + base64 data URL

### 长按快捷菜单

文件列表条目长按 500ms 弹出上下文菜单：
- **重命名** — 弹出输入框，预填当前名称
- **删除** — 弹出确认框
- **详情** — 显示文件大小、修改时间、完整路径

### 交互状态规范

```
FEATURE              | LOADING              | EMPTY                    | ERROR                     | SUCCESS          | PARTIAL
---------------------|----------------------|--------------------------|---------------------------|------------------|--------
文件列表              | spinner              | "此目录为空" + 文件夹图标 | "Permission denied" 红色  | —                | —
新建文件弹窗          | —                    | N/A                      | 弹窗内红色 "File exists"  | 关闭弹窗+刷新列表 | N/A
文件预览              | spinner              | "Empty file" → 进编辑    | "Load failed" + 下载按钮  | 显示内容         | N/A
文件编辑              | —                    | N/A                      | "Save failed, retry" toast| "Saved" toast    | N/A
图片预览              | spinner              | N/A                      | broken image → 下载按钮   | <img> 渲染       | N/A
长按菜单              | —                    | N/A                      | "Operation failed" toast  | toast 确认       | N/A
新建后自动打开        | —                    | N/A                      | N/A                       | txt/json/md→编辑 | 其他→列表
```

### 动效规范

| 交互 | 动效 | 时长 | 缓动 |
|------|------|------|------|
| 覆盖层打开 | 从底部滑入 | 300ms | ease-out |
| 覆盖层关闭 | 向底部滑出 | 200ms | ease-in |
| 弹窗打开 | fade + scale(0.96→1) | 200ms | ease |
| 弹窗关闭 | fade + scale(1→0.96) | 150ms | ease |
| Toast 出现 | fade + translateY | 200ms | ease |
| Toast 消失 | fade out | 300ms | ease |

### 无障碍规范

- **覆盖层：** `role="dialog"` + `aria-modal="true"` + `aria-label="File viewer"`
- **弹窗：** `role="dialog"` + `aria-modal="true"`
- **焦点管理：** 打开时聚焦首个可交互元素，关闭时焦点回到触发按钮
- **键盘：** Esc 关闭覆盖层/弹窗
- **触屏：** 长按触发 `navigator.vibrate(50)` 触觉反馈
- **对比度：** 所有文字 ≥4.5:1（现有设计系统已满足）
- **触摸目标：** 所有可点击元素 ≥44×44px

## 架构设计

### 组件结构

```
Browser (packages/web)
├── FileView.vue (修改)
│   ├── Action Bar 新增 "+ New" 按钮
│   ├── FileList 长按事件绑定
│   └── FileOverlay + ContextMenu 引用
├── FileOverlay.vue (新增)
│   ├── 使用 useFileOverlay() composable
│   ├── 预览模式:
│   │   ├── MdViewer (复用现有, 修改按钮文字为英文)
│   │   ├── TextViewer (新增, <pre> 渲染)
│   │   ├── ImageViewer (新增, <img> 渲染)
│   │   └── IframeViewer (新增, <iframe sandbox>)
│   └── 编辑模式:
│       ├── MdEditor (复用现有 md-editor-v3)
│       └── TextEditor (新增, <textarea>)
├── ContextMenu.vue (新增)
│   └── 长按弹出: 重命名/删除/详情
├── composables/useFileOverlay.ts (新增)
│   └── overlay 状态管理 (从 FileStore 抽离)
├── FileStore (修改)
│   └── 移除 viewer* 状态 → 迁移到 useFileOverlay
├── fileWebSocket.ts (修改)
│   ├── 新增 createFile()
│   ├── 新增 renameFile() / deleteFile()
│   └── 修复: Save 不再 addTransfer()
└── utils/fileType.ts (新增)
    ├── getFileType()
    ├── isViewable()
    ├── isEditable()
    └── isImage()

Server (packages/server)
└── router.ts (修改)
    ├── 新增 file:create 路由
    ├── 新增 file:rename 路由
    └── 新增 file:delete 路由

Agent (packages/agent)
└── file.ts (修改)
    ├── 新增 createFile()
    ├── 新增 renameFile()
    ├── 新增 deleteFile()
    └── 新增 validateFileName() (安全校验)

shared (packages/shared)
└── types.ts (修改)
    ├── 新增 'file:create' | 'file:create:result'
    ├── 新增 'file:rename' | 'file:rename:result'
    ├── 新增 'file:delete' | 'file:delete:result'
    └── 新增 FileCreatePayload / FileRenamePayload / FileDeletePayload
```

### 数据流

```
创建文件流程:
Browser → file:create {dirPath, name} → Server → Agent
Agent: validateFileName() → fs.writeFile('', 'utf-8') → 返回结果
Server → file:create:result {success, error?, path?} → Browser
Browser: 刷新文件列表 + 关闭弹窗

重命名文件流程:
Browser → file:rename {oldPath, newName} → Server → Agent
Agent: validateFileName() → fs.rename() → 返回结果
Server → file:rename:result {success, error?} → Browser
Browser: 刷新文件列表

删除文件流程:
Browser → file:delete {path, isDirectory} → Server → Agent
Agent: fs.rm(path, {recursive}) → 返回结果
Server → file:delete:result {success, error?} → Browser
Browser: 刷新文件列表

保存文件流程 (复用现有 upload 机制):
Browser → file:upload {path, content(base64), overwrite:true} → Server → Agent
Agent: completeUpload() (已有逻辑) → 返回 file:uploaded
Browser: toast "Saved" + 刷新

浏览文件流程 (复用现有):
Browser → file:download → Server → Agent
Agent: readFileChunked() → 分块传输
Browser: assembleViewContent() → 按类型渲染覆盖层
```

### WebSocket 消息协议

新增 6 个消息类型（不含 save，save 复用 file:upload）：

```typescript
// 创建文件
file:create {
  dirPath: string;       // 目标目录路径
  name: string;          // 文件名（含后缀）
}

file:create:result {
  success: boolean;
  error?: string;
  path?: string;
}

// 重命名文件
file:rename {
  oldPath: string;
  newName: string;
}

file:rename:result {
  success: boolean;
  error?: string;
}

// 删除文件
file:delete {
  path: string;
  isDirectory: boolean;
}

file:delete:result {
  success: boolean;
  error?: string;
}
```

### Save 流程修复

**Bug：** 现有 MdViewer 保存时调用 `store.addTransfer()`，导致 FileTransferProgress 组件显示进度条，且 `handleFileUploaded` 可能触发额外下载行为。

**修复：**
1. Save 时**不调用** `store.addTransfer()`
2. 使用独立的 `saving` 状态 + toast 反馈
3. 直接通过 `fileWebSocket.sendMessage()` 发送 `file:upload` 消息
4. 监听 `file:uploaded` 事件确认保存成功

```typescript
// 修复后的 handleSave()
function handleSave() {
  if (!fileWebSocket.isConnected()) {
    showErrorToast('Not connected');
    return;
  }
  saving.value = true;

  // 直接发送 upload 消息，不创建 transfer 记录
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content.value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  const chunkSize = 1024 * 1024;
  const totalChunks = Math.ceil(base64.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = base64.substring(i * chunkSize, Math.min((i + 1) * chunkSize, base64.length));
    fileWebSocket.sendMessage({
      type: 'file:upload',
      payload: { path: filePath.value, content: chunk, chunkIndex: i, totalChunks, totalSize: bytes.length, overwrite: true },
      timestamp: Date.now(),
    });
  }

  // 监听 file:uploaded 事件（不通过 transfer 状态）
  // 由组件内部 handler 处理成功/失败
}
```

## Agent 端实现

### FileManager 新增方法

```typescript
// 安全校验文件名
private validateFileName(fileName: string): void {
  // 不允许空名称
  if (!fileName || !fileName.trim()) {
    throw new Error('INVALID_FILENAME: empty');
  }
  // Windows 非法字符: < > : " / \ | ? *
  if (/[<>:"/\\|?*\x00-\x1f]/.test(fileName)) {
    throw new Error('INVALID_FILENAME: illegal characters');
  }
  // 不允许纯空格或纯点
  if (/^[\s.]+$/.test(fileName)) {
    throw new Error('INVALID_FILENAME: dots or spaces only');
  }
  // 路径遍历检查（文件名不应包含路径分隔符）
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('INVALID_FILENAME: path traversal');
  }
}

// 创建文件
async createFile(dirPath: string, fileName: string): Promise<{ path: string }> {
  this.validateFileName(fileName);
  const expandedDir = this.expandPath(dirPath);
  const filePath = path.join(expandedDir, fileName);

  // 安全检查：解析后的路径必须在目标目录内
  const resolvedDir = path.resolve(expandedDir);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
    throw new Error('PATH_TRAVERSAL');
  }

  // 检查文件是否已存在
  try {
    await fs.access(filePath);
    throw new Error('FILE_ALREADY_EXISTS');
  } catch (err: any) {
    if (err.message === 'FILE_ALREADY_EXISTS' || err.code === 'FILE_ALREADY_EXISTS') throw err;
  }

  await fs.writeFile(filePath, '', 'utf-8');
  return { path: filePath };
}

// 重命名文件
async renameFile(oldPath: string, newName: string): Promise<void> {
  this.validateFileName(newName);
  const expandedOld = this.expandPath(oldPath);
  const dir = path.dirname(expandedOld);
  const newPath = path.join(dir, newName);

  // 安全检查
  const resolvedDir = path.resolve(dir);
  const resolvedNew = path.resolve(newPath);
  if (!resolvedNew.startsWith(resolvedDir + path.sep)) {
    throw new Error('PATH_TRAVERSAL');
  }

  await fs.rename(expandedOld, newPath);
}

// 删除文件/目录
async deleteFile(filePath: string, isDirectory: boolean): Promise<void> {
  const expandedPath = this.expandPath(filePath);
  if (isDirectory) {
    await fs.rm(expandedPath, { recursive: true });
  } else {
    await fs.unlink(expandedPath);
  }
}
```

## Web 端实现

### useFileOverlay composable

```typescript
// packages/web/src/composables/useFileOverlay.ts
import { ref, computed } from 'vue';

export type OverlayFileType = 'md' | 'txt' | 'json' | 'html' | 'pdf' | 'image';

export function useFileOverlay() {
  const visible = ref(false);
  const mode = ref<'view' | 'edit'>('view');
  const path = ref('');
  const content = ref('');
  const loading = ref(false);
  const saving = ref(false);
  const fileType = ref<OverlayFileType>('txt');
  const dirty = ref(false); // 未保存修改标记

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

  return {
    visible, mode, path, content, loading, saving, fileType, dirty,
    open, close, updateContent,
  };
}
```

### 文件类型工具

```typescript
// packages/web/src/utils/fileType.ts
import type { OverlayFileType } from '@/composables/useFileOverlay';

const VIEWABLE_TYPES = new Set(['md', 'txt', 'json', 'html', 'pdf', 'image']);
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

// 大文件阈值: 500KB
export const LARGE_FILE_THRESHOLD = 500 * 1024;
export function isLargeFile(size: number | undefined): boolean {
  return (size ?? 0) > LARGE_FILE_THRESHOLD;
}
```

## 安全设计

### 路径遍历防护

Agent 端 `createFile()` / `renameFile()` 中：
1. `validateFileName()` 拒绝包含 `..`、`/`、`\` 的文件名
2. `path.resolve()` 后检查最终路径是否仍在目标目录内

### iframe XSS 防护

HTML 预览使用 `<iframe sandbox="allow-same-origin">`：
- 禁止脚本执行（无 `allow-scripts`）
- 允许同源内容渲染（PDF/HTML 需要）
- 如需 PDF 渲染且浏览器原生支持，`sandbox` 不阻止 PDF plugin

### 文件名合法性校验

`validateFileName()` 检查：
- 非空
- 无 Windows 非法字符 `<>:"/\|?*`
- 非纯空格/纯点
- 无路径遍历

## 错误处理

| 场景 | 错误码 | 用户提示 |
|------|--------|----------|
| 文件已存在 | FILE_ALREADY_EXISTS | "File already exists" |
| 文件名非法 | INVALID_FILENAME | "Invalid file name" |
| 路径遍历 | PATH_TRAVERSAL | "Invalid path" |
| 权限不足 | PERMISSION_DENIED | "Permission denied" |
| 磁盘已满 | DISK_FULL | "Disk full" |
| 文件不存在 | FILE_NOT_FOUND | "File not found" |
| 保存失败 | SAVE_FAILED | "Save failed, retry" |
| 连接断开 | NO_CONNECTION | "Not connected" |
| 大文件 | FILE_TOO_LARGE | "File too large, download instead" |

## 测试计划

### 单元测试

1. **Agent 端**
   - `validateFileName()` 各种非法输入
   - `createFile()` 正常创建 + 已存在 + 路径遍历
   - `renameFile()` 正常重命名 + 非法名称
   - `deleteFile()` 文件 + 目录

2. **Web 端**
   - `getFileType()` 各种后缀识别
   - `isViewable()` / `isEditable()` / `isImage()` 判断
   - `useFileOverlay()` 状态机（open/close/dirty）

### 集成测试

1. 创建文件 → 刷新列表 → 文件出现
2. 点击可浏览文件 → 覆盖层打开
3. 编辑 → Save → toast 显示 "Saved" → 无下载触发
4. 编辑中点返回 → "放弃更改？" 弹出
5. 长按文件 → 菜单弹出 → 重命名/删除
6. 图片文件 → `<img>` 正确渲染
7. HTML 文件 → iframe sandbox 阻止脚本

### 手动测试

- [ ] 移动端 Chrome/Safari 新建文件键盘自动弹出
- [ ] 大文件（>500KB）提示下载而非预览
- [ ] 中文文件名创建
- [ ] 网络断开时保存的错误提示
- [ ] 横竖屏切换时覆盖层自适应
- [ ] iframe HTML 预览不执行 JS

## 实现顺序

1. **Phase 1: 协议与 Agent**
   - shared/types.ts 新增消息类型
   - Agent `createFile()` / `renameFile()` / `deleteFile()` / `validateFileName()`
   - Server router 新增路由

2. **Phase 2: Web 基础设施**
   - `useFileOverlay()` composable
   - `utils/fileType.ts`
   - `fileWebSocket.createFile()` / `renameFile()` / `deleteFile()`
   - 修复 MdViewer Save 触发下载 bug

3. **Phase 3: 新建文件**
   - 工具栏 UI + 弹窗
   - 自动聚焦 + 键盘弹出
   - 创建流程联调

4. **Phase 4: 文件预览**
   - FileOverlay.vue 骨架
   - TextViewer / ImageViewer / IframeViewer
   - 复用 MdViewer（修改按钮文字为英文）
   - 大文件阈值保护

5. **Phase 5: 文件编辑**
   - TextEditor (textarea)
   - 复用 MdEditor
   - Save 流程（不触发下载）
   - 未保存退出确认

6. **Phase 6: 长按菜单**
   - ContextMenu.vue
   - 重命名/删除/详情
   - Agent 端联调

## NOT in scope

- Office 文件浏览（Word/Excel/PPT）
- 代码编辑器（CodeMirror/Monaco）语法高亮
- 文件搜索
- 批量操作
- 文件版本历史
- 新建文件模板

## What already exists

| 现有代码 | 复用方式 |
|----------|----------|
| MarkdownViewer.vue | 整体复用，修改按钮文字 |
| file:upload + overwrite:true | Save 保存机制 |
| fileWebSocket.downloadForView() | 文件内容获取 |
| assembleViewContent() | base64 解码 + 编码检测 |
| FileTransferProgress | 下载进度（Save 不使用） |
| MdPreview / MdEditor (md-editor-v3) | md 渲染/编辑 |
| 现有 CSS 变量 + 暗色主题 | 新组件样式复用 |

## Dream State Delta

```
CURRENT STATE                  THIS PLAN                  12-MONTH IDEAL
文件浏览 + 下载         →     文件浏览/编辑/创建    →    完整文件管理
(仅下载)                      /重命名/删除               (搜索/批量/版本)
(单一 md 预览)                (6 种格式预览)             (语法高亮/模板)
(无文件操作)                  (长按菜单)                 (拖拽排序)
```

本次计划从"只能看和下载"进化到"完整的文件管理能力"，为后续的搜索、批量操作、版本管理打下基础。

## 依赖项

- **无新增 npm 依赖** — md-editor-v3 已安装，图片/iframe 为浏览器原生
- md-editor-v3 已支持编辑模式（确认无需扩展）

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 大文件预览卡顿 | 500KB 阈值，超出提示下载 |
| iframe HTML XSS | `sandbox="allow-same-origin"` 禁止脚本 |
| 路径遍历攻击 | Agent 端双重校验（文件名 + 路径解析） |
| Save 触发下载 | 分离保存流程，不用 addTransfer |
| 编码问题 | 保存统一 UTF-8，读取检测 BOM |
| 并发编辑冲突 | 最后写入覆盖（单用户场景可接受） |
| 长按与滑动冲突 | 长按 500ms 阈值，与 MdViewer 的滑动切换区分 |
