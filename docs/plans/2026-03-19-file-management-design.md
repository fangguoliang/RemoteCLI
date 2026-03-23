# 文件管理功能设计文档

## 概述

为 remoteCli 添加文件管理功能，允许用户通过手机浏览器浏览 Windows Agent 机器的文件系统，并支持文件上传/下载。

## 需求范围

- **操作对象：** Windows Agent 所在机器的文件系统
- **功能：** 目录浏览 + 文件上传 + 文件下载
- **文件大小：** 先支持中小文件（< 100MB），后续可扩展
- **界面：** 独立页面，从导航栏进入

## 架构设计

```
┌─────────────┐    WebSocket    ┌─────────────┐    WebSocket    ┌─────────────┐
│   Browser   │ ◄──────────────►│   Server    │ ◄──────────────►│    Agent    │
│  (Vue Web)  │                 │  (Fastify)  │                 │ (node-pty)  │
└─────────────┘                 └─────────────┘                 └─────────────┘
      │                               │                               │
      │  file:browse                  │  file:browse                  │
      │  file:list                    │  file:list                    │ fs.readdir
      │  file:upload                  │  file:upload                  │ fs.writeFile
      │  file:download                │  file:download                │ fs.readFile
      │  file:progress                │  file:progress                │
      │  file:data                    │  file:data                    │
      └───────────────────────────────┴───────────────────────────────┘
```

**技术方案：** 纯 WebSocket，复用现有连接，服务器作为消息路由器。

**文件传输：**
- 分块传输，块大小 1MB
- 文件内容使用 Base64 编码
- 支持进度显示，不支持断点续传和暂停

## WebSocket 消息协议

### 消息类型

| 类型 | 方向 | 描述 |
|------|------|------|
| `file:browse` | Browser → Server → Agent | 请求浏览目录 |
| `file:list` | Agent → Server → Browser | 返回目录内容 |
| `file:upload` | Browser → Server → Agent | 上传文件（分块） |
| `file:progress` | Agent → Server → Browser | 传输进度通知 |
| `file:uploaded` | Agent → Server → Browser | 上传完成确认 |
| `file:download` | Browser → Server → Agent | 下载文件 |
| `file:data` | Agent → Server → Browser | 文件数据响应（分块） |
| `file:error` | Agent → Server → Browser | 错误响应 |

### 消息结构

**目录浏览请求：**
```typescript
{
  type: 'file:browse',
  payload: { path: 'C:\\Users\\Admin' },
  timestamp: 1234567890
}
```

**目录列表响应：**
```typescript
{
  type: 'file:list',
  payload: {
    path: 'C:\\Users\\Admin',
    entries: [
      { name: 'Desktop', isDirectory: true },
      { name: 'config.txt', isDirectory: false, size: 1024 }
    ]
  },
  timestamp: 1234567890
}
```

**上传文件（分块）：**
```typescript
{
  type: 'file:upload',
  payload: {
    path: 'C:\\Users\\Admin\\test.txt',
    content: 'Base64Chunk',
    chunkIndex: 0,
    totalChunks: 5,
    totalSize: 4500000,
    overwrite: false
  },
  timestamp: 1234567890
}
```

**进度通知：**
```typescript
{
  type: 'file:progress',
  payload: {
    path: 'C:\\Users\\Admin\\test.txt',
    direction: 'upload',
    chunkIndex: 2,
    totalChunks: 5,
    percent: 40
  },
  timestamp: 1234567890
}
```

**下载文件响应（分块）：**
```typescript
{
  type: 'file:data',
  payload: {
    path: 'C:\\Users\\Admin\\test.txt',
    content: 'Base64Chunk',
    chunkIndex: 0,
    totalChunks: 5,
    totalSize: 4500000
  },
  timestamp: 1234567890
}
```

**错误响应：**
```typescript
{
  type: 'file:error',
  payload: {
    code: 'PERMISSION_DENIED',
    message: '无法访问目录',
    path: 'C:\\System'
  },
  timestamp: 1234567890
}
```

## Agent 端实现

**新增模块：** `packages/agent/src/file.ts`

```typescript
class FileManager {
  private chunkSize = 1024 * 1024; // 1MB

  // 浏览目录
  async browse(path: string): Promise<FileEntry[]>;

  // 分块读取文件
  async readFileChunked(
    path: string,
    onChunk: (data: { chunkIndex: number; totalChunks: number; content: string }) => void
  ): Promise<void>;

  // 分块写入文件
  async writeFileChunked(
    path: string,
    chunks: AsyncIterable<{ chunkIndex: number; content: string }>,
    totalSize: number,
    onProgress: (chunkIndex: number) => void
  ): Promise<void>;
}
```

**集成：** 在 `Tunnel.handleMessage()` 中添加文件消息处理。

## Server 端实现

**修改模块：** `packages/server/src/ws/tunnel.ts`

- 复用现有 session 绑定机制
- 文件消息路由：Browser → Server → Agent → Server → Browser
- 无需新增 HTTP API

**权限控制：**
- 复用现有 JWT 认证
- Browser 必须先认证并绑定 Agent

## Web 前端实现

### 新增文件

- `src/views/FileView.vue` - 文件管理页面
- `src/stores/file.ts` - 文件状态管理
- `src/components/FileList.vue` - 文件列表组件
- `src/components/FileTransferProgress.vue` - 传输进度组件

### 页面布局

```
┌─────────────────────────────────────┐
│  路径: C:\Users\Admin               │  ← 路径栏（可点击导航）
├─────────────────────────────────────┤
│  📁 Desktop                          │
│  📁 Documents                        │  ← 文件/目录列表
│  📄 config.txt            1.2 KB    │
│  📄 log.txt               5.0 KB    │
├─────────────────────────────────────┤
│  [上传文件] [新建文件夹] [刷新]       │  ← 底部操作栏
└─────────────────────────────────────┘
```

### 传输进度展示

```
┌─────────────────────────────────────┐
│  📤 上传中: config.txt               │
│  ████████████░░░░░░░░  60%          │
│                           [取消]    │
└─────────────────────────────────────┘
```

### 状态管理

```typescript
interface FileState {
  currentPath: string;
  entries: FileEntry[];
  loading: boolean;
  transfers: Map<string, TransferProgress>;
}

interface TransferProgress {
  path: string;
  direction: 'upload' | 'download';
  percent: number;
  status: 'in_progress' | 'completed' | 'error';
}
```

### 路由配置

```typescript
{ path: '/files', name: 'files', component: FileView }
```

### 导航入口

顶部工具栏添加"文件"按钮，与"设置"并列。

## 错误处理

| 场景 | 错误码 | 前端展示 |
|------|--------|---------|
| 目录不存在 | `DIR_NOT_FOUND` | Toast 提示"目录不存在" |
| 文件不存在 | `FILE_NOT_FOUND` | Toast 提示"文件不存在" |
| 权限不足 | `PERMISSION_DENIED` | Toast 提示"无访问权限" |
| 磁盘空间不足 | `DISK_FULL` | Toast 提示"磁盘空间不足" |
| 文件已存在 | `FILE_EXISTS` | 弹窗询问是否覆盖 |
| 传输中断 | 超时无响应 | Toast 提示"传输失败，请重试" |
| Agent 离线 | 无响应/连接断开 | Toast 提示"Agent 已断开连接" |

**超时设置：**
- 文件操作超时：30 秒
- 单块传输超时：10 秒

## Shared 类型定义

**新增类型：** `packages/shared/src/types.ts`

```typescript
export type MessageType =
  | 'file:browse'
  | 'file:list'
  | 'file:upload'
  | 'file:progress'
  | 'file:uploaded'
  | 'file:download'
  | 'file:data'
  | 'file:error'
  // ... 现有类型

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: number;
}

export interface FileBrowsePayload {
  path: string;
}

export interface FileListPayload {
  path: string;
  entries: FileEntry[];
}

export interface FileUploadPayload {
  path: string;
  content: string;
  chunkIndex: number;
  totalChunks: number;
  totalSize: number;
  overwrite: boolean;
}

export interface FileDownloadPayload {
  path: string;
}

export interface FileDataPayload {
  path: string;
  content: string;
  chunkIndex: number;
  totalChunks: number;
  totalSize: number;
}

export interface FileProgressPayload {
  path: string;
  direction: 'upload' | 'download';
  chunkIndex: number;
  totalChunks: number;
  percent: number;
}

export interface FileErrorPayload {
  code: string;
  message: string;
  path?: string;
}
```

## 不在范围内

- 断点续传
- 暂停/恢复传输
- 大文件优化（> 100MB）
- 文件编辑
- 文件删除/重命名/新建文件夹