# 文件管理功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 remoteCli 添加文件管理功能，支持浏览 Windows Agent 文件系统并上传/下载文件。

**Architecture:** 纯 WebSocket 方案，复用现有连接，服务器作为消息路由器。文件分块传输（1MB/块），Base64 编码，支持进度显示。

**Tech Stack:** TypeScript, Vue 3, Pinia, xterm.js, Fastify, ws, node-pty

---

## Task 1: Shared 类型定义

**Files:**
- Modify: `packages/shared/src/types.ts`

**Step 1: 添加文件消息类型**

在 `MessageType` 类型中添加新类型：

```typescript
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
  | 'file:error';
```

**Step 2: 添加文件相关接口**

在文件末尾添加：

```typescript
// 文件管理相关类型
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

export interface FileUploadedPayload {
  path: string;
  success: boolean;
  error?: string;
}

export interface FileErrorPayload {
  code: string;
  message: string;
  path?: string;
}
```

**Step 3: 构建 shared 包**

Run: `cd packages/shared && pnpm build`

Expected: 构建成功，无错误

**Step 4: 提交**

```bash
git add packages/shared/src/types.ts packages/shared/dist/
git commit -m "feat(shared): add file management types"
```

---

## Task 2: Agent FileManager 类 - 目录浏览

**Files:**
- Create: `packages/agent/src/file.ts`

**Step 1: 创建 FileManager 类骨架**

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileEntry } from '@remotecli/shared';

export class FileManager {
  async browse(dirPath: string): Promise<FileEntry[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const result: FileEntry[] = [];

      for (const entry of entries) {
        const fileEntry: FileEntry = {
          name: entry.name,
          isDirectory: entry.isDirectory(),
        };

        if (!entry.isDirectory()) {
          try {
            const stat = await fs.stat(path.join(dirPath, entry.name));
            fileEntry.size = stat.size;
            fileEntry.modifiedAt = stat.mtimeMs;
          } catch {
            // 忽略无法访问的文件
          }
        }

        result.push(fileEntry);
      }

      // 目录在前，然后按名称排序
      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return result;
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'ENOENT') {
        throw new Error('DIR_NOT_FOUND');
      }
      if (error.code === 'EACCES') {
        throw new Error('PERMISSION_DENIED');
      }
      throw err;
    }
  }
}
```

**Step 2: 导出**

在 `packages/agent/src/index.ts` 末尾添加：

```typescript
export { FileManager } from './file.js';
```

**Step 3: 验证编译**

Run: `cd packages/agent && pnpm build`

Expected: 编译成功

**Step 4: 提交**

```bash
git add packages/agent/src/file.ts packages/agent/src/index.ts packages/agent/dist/
git commit -m "feat(agent): add FileManager with browse capability"
```

---

## Task 3: Agent FileManager 类 - 文件下载

**Files:**
- Modify: `packages/agent/src/file.ts`

**Step 1: 添加 readFileChunked 方法**

在 FileManager 类中添加：

```typescript
private chunkSize = 1024 * 1024; // 1MB

async readFileChunked(
  filePath: string,
  onChunk: (data: { chunkIndex: number; totalChunks: number; content: string }) => void
): Promise<void> {
  try {
    const stat = await fs.stat(filePath);

    if (stat.isDirectory()) {
      throw new Error('IS_DIRECTORY');
    }

    const totalSize = stat.size;
    const totalChunks = Math.ceil(totalSize / this.chunkSize);

    const handle = await fs.open(filePath, 'r');

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * this.chunkSize;
        const length = Math.min(this.chunkSize, totalSize - start);
        const buffer = Buffer.alloc(length);

        await handle.read(buffer, 0, length, start);
        const content = buffer.toString('base64');

        onChunk({ chunkIndex, totalChunks, content });
      }
    } finally {
      await handle.close();
    }
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === 'ENOENT') {
      throw new Error('FILE_NOT_FOUND');
    }
    if (error.code === 'EACCES') {
      throw new Error('PERMISSION_DENIED');
    }
    throw err;
  }
}
```

**Step 2: 验证编译**

Run: `cd packages/agent && pnpm build`

Expected: 编译成功

**Step 3: 提交**

```bash
git add packages/agent/src/file.ts packages/agent/dist/
git commit -m "feat(agent): add chunked file read for download"
```

---

## Task 4: Agent FileManager 类 - 文件上传

**Files:**
- Modify: `packages/agent/src/file.ts`

**Step 1: 添加上传状态管理**

在 FileManager 类中添加：

```typescript
private uploadBuffers = new Map<string, { chunks: Map<number, string>; totalChunks: number; totalSize: number }>();

startUpload(sessionId: string, totalChunks: number, totalSize: number): void {
  this.uploadBuffers.set(sessionId, {
    chunks: new Map(),
    totalChunks,
    totalSize,
  });
}

writeChunk(
  sessionId: string,
  chunkIndex: number,
  content: string
): { done: boolean; percent: number } {
  const upload = this.uploadBuffers.get(sessionId);
  if (!upload) {
    throw new Error('UPLOAD_NOT_FOUND');
  }

  upload.chunks.set(chunkIndex, content);
  const percent = Math.round((upload.chunks.size / upload.totalChunks) * 100);

  return {
    done: upload.chunks.size === upload.totalChunks,
    percent,
  };
}

async completeUpload(sessionId: string, filePath: string): Promise<void> {
  const upload = this.uploadBuffers.get(sessionId);
  if (!upload) {
    throw new Error('UPLOAD_NOT_FOUND');
  }

  try {
    // 确保目录存在
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // 合并所有块并写入文件
    const handle = await fs.open(filePath, 'w');

    try {
      for (let i = 0; i < upload.totalChunks; i++) {
        const content = upload.chunks.get(i);
        if (!content) {
          throw new Error(`Missing chunk ${i}`);
        }
        const buffer = Buffer.from(content, 'base64');
        await handle.write(buffer, 0, buffer.length, i * this.chunkSize);
      }
    } finally {
      await handle.close();
    }
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === 'EACCES') {
      throw new Error('PERMISSION_DENIED');
    }
    if (error.code === 'ENOSPC') {
      throw new Error('DISK_FULL');
    }
    throw err;
  } finally {
    this.uploadBuffers.delete(sessionId);
  }
}

cancelUpload(sessionId: string): void {
  this.uploadBuffers.delete(sessionId);
}
```

**Step 2: 验证编译**

Run: `cd packages/agent && pnpm build`

Expected: 编译成功

**Step 3: 提交**

```bash
git add packages/agent/src/file.ts packages/agent/dist/
git commit -m "feat(agent): add chunked file upload support"
```

---

## Task 5: Agent Tunnel 集成文件消息

**Files:**
- Modify: `packages/agent/src/tunnel.ts`

**Step 1: 导入 FileManager**

在文件顶部添加：

```typescript
import { FileManager } from './file.js';
```

**Step 2: 初始化 FileManager**

在 Tunnel 类中添加属性：

```typescript
private fileManager = new FileManager();
private uploadSessions = new Map<string, string>(); // sessionId -> uploadId
```

**Step 3: 添加文件消息处理**

在 `handleMessage` 方法的 switch 语句中添加：

```typescript
case 'file:browse':
  this.handleFileBrowse(payload);
  break;

case 'file:download':
  this.handleFileDownload(sessionId, payload);
  break;

case 'file:upload':
  this.handleFileUpload(sessionId, payload);
  break;
```

**Step 4: 实现处理方法**

在 Tunnel 类中添加：

```typescript
private handleFileBrowse(payload: { path: string }) {
  this.fileManager.browse(payload.path)
    .then((entries) => {
      this.send({
        type: 'file:list',
        payload: { path: payload.path, entries },
        timestamp: Date.now(),
      });
    })
    .catch((err: Error) => {
      this.send({
        type: 'file:error',
        payload: { code: err.message, message: err.message, path: payload.path },
        timestamp: Date.now(),
      });
    });
}

private handleFileDownload(sessionId: string | undefined, payload: { path: string }) {
  if (!sessionId) return;

  this.fileManager.readFileChunked(payload.path, (data) => {
    this.send({
      type: 'file:data',
      sessionId,
      payload: {
        path: payload.path,
        content: data.content,
        chunkIndex: data.chunkIndex,
        totalChunks: data.totalChunks,
        totalSize: 0, // 将在第一次调用时设置
      },
      timestamp: Date.now(),
    });

    // 发送进度
    this.send({
      type: 'file:progress',
      sessionId,
      payload: {
        path: payload.path,
        direction: 'download',
        chunkIndex: data.chunkIndex,
        totalChunks: data.totalChunks,
        percent: Math.round(((data.chunkIndex + 1) / data.totalChunks) * 100),
      },
      timestamp: Date.now(),
    });
  }).catch((err: Error) => {
    this.send({
      type: 'file:error',
      sessionId,
      payload: { code: err.message, message: err.message, path: payload.path },
      timestamp: Date.now(),
    });
  });
}

private handleFileUpload(
  sessionId: string | undefined,
  payload: { path: string; content: string; chunkIndex: number; totalChunks: number; totalSize: number; overwrite: boolean }
) {
  if (!sessionId) return;

  const { path: filePath, content, chunkIndex, totalChunks, totalSize, overwrite } = payload;

  // 首块：初始化上传会话
  if (chunkIndex === 0) {
    const uploadId = `${sessionId}-${Date.now()}`;
    this.uploadSessions.set(sessionId, uploadId);
    this.fileManager.startUpload(uploadId, totalChunks, totalSize);
  }

  const uploadId = this.uploadSessions.get(sessionId);
  if (!uploadId) {
    this.send({
      type: 'file:error',
      sessionId,
      payload: { code: 'UPLOAD_NOT_FOUND', message: 'Upload session not found', path: filePath },
      timestamp: Date.now(),
    });
    return;
  }

  try {
    const result = this.fileManager.writeChunk(uploadId, chunkIndex, content);

    // 发送进度
    this.send({
      type: 'file:progress',
      sessionId,
      payload: {
        path: filePath,
        direction: 'upload',
        chunkIndex,
        totalChunks,
        percent: result.percent,
      },
      timestamp: Date.now(),
    });

    // 最后一块：完成上传
    if (result.done) {
      this.fileManager.completeUpload(uploadId, filePath)
        .then(() => {
          this.send({
            type: 'file:uploaded',
            sessionId,
            payload: { path: filePath, success: true },
            timestamp: Date.now(),
          });
        })
        .catch((err: Error) => {
          this.send({
            type: 'file:error',
            sessionId,
            payload: { code: err.message, message: err.message, path: filePath },
            timestamp: Date.now(),
          });
        })
        .finally(() => {
          this.uploadSessions.delete(sessionId);
        });
    }
  } catch (err: unknown) {
    const error = err as Error;
    this.send({
      type: 'file:error',
      sessionId,
      payload: { code: error.message, message: error.message, path: filePath },
      timestamp: Date.now(),
    });
    this.uploadSessions.delete(sessionId);
  }
}
```

**Step 5: 验证编译**

Run: `cd packages/agent && pnpm build`

Expected: 编译成功

**Step 6: 提交**

```bash
git add packages/agent/src/tunnel.ts packages/agent/dist/
git commit -m "feat(agent): integrate file messages in tunnel"
```

---

## Task 6: Server WebSocket 路由文件消息

**Files:**
- Modify: `packages/server/src/ws/router.ts`

**Step 1: 添加文件消息路由**

在 `handleBrowserMessage` 函数的 switch 语句中添加：

```typescript
case 'file:browse':
case 'file:download':
case 'file:upload':
  // 路由到绑定的 Agent
  if (browser.agentId) {
    tunnelManager.routeToAgent(browser.agentId, message);
  } else {
    ws.send(JSON.stringify({
      type: 'file:error',
      payload: { code: 'NO_AGENT', message: 'No agent selected' },
      timestamp: Date.now(),
    }));
  }
  break;
```

**Step 2: 添加 Agent 消息路由**

在 `handleAgentMessage` 函数的 switch 语句中添加：

```typescript
case 'file:list':
case 'file:data':
case 'file:progress':
case 'file:uploaded':
case 'file:error':
  // 路由到对应的浏览器会话
  if (sessionId) {
    tunnelManager.routeToBrowser(sessionId, message);
  }
  break;
```

**Step 3: 验证编译**

Run: `cd packages/server && pnpm build`

Expected: 编译成功

**Step 4: 提交**

```bash
git add packages/server/src/ws/router.ts packages/server/dist/
git commit -m "feat(server): route file messages between browser and agent"
```

---

## Task 7: Web 文件状态管理

**Files:**
- Create: `packages/web/src/stores/file.ts`

**Step 1: 创建 file store**

```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FileEntry } from '@remotecli/shared';

export interface TransferProgress {
  id: string;
  path: string;
  fileName: string;
  direction: 'upload' | 'download';
  percent: number;
  status: 'in_progress' | 'completed' | 'error';
  error?: string;
}

export const useFileStore = defineStore('file', () => {
  const currentPath = ref<string>('');
  const entries = ref<FileEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const transfers = ref<TransferProgress[]>([]);

  function setPath(path: string) {
    currentPath.value = path;
  }

  function setEntries(list: FileEntry[]) {
    entries.value = list;
  }

  function setLoading(value: boolean) {
    loading.value = value;
  }

  function setError(err: string | null) {
    error.value = err;
  }

  function addTransfer(transfer: TransferProgress) {
    transfers.value.push(transfer);
  }

  function updateTransfer(id: string, updates: Partial<TransferProgress>) {
    const index = transfers.value.findIndex(t => t.id === id);
    if (index !== -1) {
      transfers.value[index] = { ...transfers.value[index], ...updates };
    }
  }

  function removeTransfer(id: string) {
    const index = transfers.value.findIndex(t => t.id === id);
    if (index !== -1) {
      transfers.value.splice(index, 1);
    }
  }

  function clearCompletedTransfers() {
    transfers.value = transfers.value.filter(t => t.status === 'in_progress');
  }

  return {
    currentPath,
    entries,
    loading,
    error,
    transfers,
    setPath,
    setEntries,
    setLoading,
    setError,
    addTransfer,
    updateTransfer,
    removeTransfer,
    clearCompletedTransfers,
  };
});
```

**Step 2: 导出 store**

在 `packages/web/src/stores/index.ts` 中添加：

```typescript
export { useFileStore } from './file';
```

**Step 3: 验证编译**

Run: `cd packages/web && pnpm typecheck`

Expected: 无类型错误

**Step 4: 提交**

```bash
git add packages/web/src/stores/file.ts packages/web/src/stores/index.ts
git commit -m "feat(web): add file store for state management"
```

---

## Task 8: Web 文件 WebSocket 服务

**Files:**
- Create: `packages/web/src/services/fileWebSocket.ts`

**Step 1: 创建文件 WebSocket 服务**

```typescript
import type { FileEntry, FileListPayload, FileProgressPayload, FileDataPayload, FileUploadedPayload, FileErrorPayload } from '@remotecli/shared';
import { useFileStore } from '@/stores/file';

type MessageHandler = (data: unknown) => void;

class FileWebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers = new Map<string, MessageHandler[]>();
  private transferChunks = new Map<string, { chunks: Map<number, string>; totalChunks: number; totalSize: number }>();

  connect(url: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        // 发送认证
        this.send({
          type: 'auth',
          payload: { token },
          timestamp: Date.now(),
        });
        resolve();
      };

      this.ws.onerror = (err) => {
        reject(err);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private send(message: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: { type: string; payload: unknown; sessionId?: string }) {
    const { type, payload } = message;

    // 触发注册的处理器
    const handlers = this.messageHandlers.get(type) || [];
    handlers.forEach(handler => handler(payload));

    // 处理文件相关消息
    switch (type) {
      case 'file:list':
        this.handleFileList(payload as FileListPayload);
        break;
      case 'file:progress':
        this.handleFileProgress(payload as FileProgressPayload);
        break;
      case 'file:data':
        this.handleFileData(message.sessionId || '', payload as FileDataPayload);
        break;
      case 'file:uploaded':
        this.handleFileUploaded(payload as FileUploadedPayload);
        break;
      case 'file:error':
        this.handleFileError(payload as FileErrorPayload);
        break;
    }
  }

  private handleFileList(payload: FileListPayload) {
    const store = useFileStore();
    store.setEntries(payload.entries);
    store.setPath(payload.path);
    store.setLoading(false);
    store.setError(null);
  }

  private handleFileProgress(payload: FileProgressPayload) {
    const store = useFileStore();
    const transferId = payload.path;
    store.updateTransfer(transferId, {
      percent: payload.percent,
    });
  }

  private handleFileData(sessionId: string, payload: FileDataPayload) {
    const store = useFileStore();
    const transferId = payload.path;

    // 初始化分块缓冲
    if (payload.chunkIndex === 0) {
      this.transferChunks.set(transferId, {
        chunks: new Map(),
        totalChunks: payload.totalChunks,
        totalSize: payload.totalSize,
      });
    }

    // 存储块
    const transfer = this.transferChunks.get(transferId);
    if (transfer) {
      transfer.chunks.set(payload.chunkIndex, payload.content);

      // 更新进度
      store.updateTransfer(transferId, {
        percent: Math.round((transfer.chunks.size / transfer.totalChunks) * 100),
      });

      // 所有块接收完成
      if (transfer.chunks.size === transfer.totalChunks) {
        this.completeDownload(transferId, payload.path, transfer);
        this.transferChunks.delete(transferId);
      }
    }
  }

  private completeDownload(transferId: string, filePath: string, transfer: { chunks: Map<number, string>; totalChunks: number; totalSize: number }) {
    const store = useFileStore();

    // 合并所有块
    const chunks: string[] = [];
    for (let i = 0; i < transfer.totalChunks; i++) {
      const chunk = transfer.chunks.get(i);
      if (chunk) {
        chunks.push(chunk);
      }
    }

    const base64Content = chunks.join('');
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 创建 Blob 并下载
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split(/[/\\]/).pop() || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // 更新状态
    store.updateTransfer(transferId, { status: 'completed', percent: 100 });

    // 2秒后移除
    setTimeout(() => {
      store.removeTransfer(transferId);
    }, 2000);
  }

  private handleFileUploaded(payload: FileUploadedPayload) {
    const store = useFileStore();
    const transferId = payload.path;

    if (payload.success) {
      store.updateTransfer(transferId, { status: 'completed', percent: 100 });
      setTimeout(() => {
        store.removeTransfer(transferId);
      }, 2000);
    } else {
      store.updateTransfer(transferId, { status: 'error', error: payload.error });
    }
  }

  private handleFileError(payload: FileErrorPayload) {
    const store = useFileStore();
    store.setError(payload.message);
    store.setLoading(false);

    // 更新相关传输状态
    if (payload.path) {
      store.updateTransfer(payload.path, { status: 'error', error: payload.message });
    }
  }

  // 公共 API
  browse(path: string, agentId: string) {
    const store = useFileStore();
    store.setLoading(true);
    store.setError(null);
    this.send({
      type: 'file:browse',
      payload: { path, agentId },
      timestamp: Date.now(),
    });
  }

  download(path: string) {
    const store = useFileStore();
    const fileName = path.split(/[/\\]/).pop() || 'file';

    store.addTransfer({
      id: path,
      path,
      fileName,
      direction: 'download',
      percent: 0,
      status: 'in_progress',
    });

    this.send({
      type: 'file:download',
      payload: { path },
      timestamp: Date.now(),
    });
  }

  upload(path: string, file: File) {
    const store = useFileStore();
    const fileName = file.name;

    store.addTransfer({
      id: path,
      path,
      fileName,
      direction: 'upload',
      percent: 0,
      status: 'in_progress',
    });

    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const chunkSize = 1024 * 1024; // 1MB
      const totalChunks = Math.ceil(base64.length / chunkSize);
      const totalSize = file.size;

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, base64.length);
        const chunk = base64.substring(start, end);

        this.send({
          type: 'file:upload',
          payload: {
            path,
            content: chunk,
            chunkIndex: i,
            totalChunks,
            totalSize,
            overwrite: false,
          },
          timestamp: Date.now(),
        });
      }
    };

    reader.readAsArrayBuffer(file);
  }

  on(type: string, handler: MessageHandler) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)?.push(handler);
  }

  off(type: string, handler: MessageHandler) {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }
}

export const fileWebSocket = new FileWebSocketService();
```

**Step 2: 验证编译**

Run: `cd packages/web && pnpm typecheck`

Expected: 无类型错误

**Step 3: 提交**

```bash
git add packages/web/src/services/fileWebSocket.ts
git commit -m "feat(web): add file WebSocket service"
```

---

## Task 9: Web 文件列表组件

**Files:**
- Create: `packages/web/src/components/FileList.vue`

**Step 1: 创建 FileList 组件**

```vue
<template>
  <div class="file-list">
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="entries.length === 0" class="empty">目录为空</div>
    <div v-else class="entries">
      <div
        v-for="entry in entries"
        :key="entry.name"
        class="entry"
        :class="{ directory: entry.isDirectory }"
        @click="onEntryClick(entry)"
      >
        <span class="icon">{{ entry.isDirectory ? '📁' : '📄' }}</span>
        <span class="name">{{ entry.name }}</span>
        <span v-if="!entry.isDirectory && entry.size" class="size">{{ formatSize(entry.size) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FileEntry } from '@remotecli/shared';

defineProps<{
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  browse: [path: string];
  download: [path: string];
}>();

function onEntryClick(entry: FileEntry) {
  // 这里需要父组件传入当前路径来拼接
  emit(entry.isDirectory ? 'browse' : 'download', entry.name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
</script>

<style scoped>
.file-list {
  flex: 1;
  overflow-y: auto;
}

.loading, .error, .empty {
  padding: 20px;
  text-align: center;
  color: #888;
}

.error {
  color: #f44336;
}

.entry {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #333;
  cursor: pointer;
}

.entry:hover {
  background: #2a2a3e;
}

.entry.directory {
  color: #4fc3f7;
}

.icon {
  margin-right: 12px;
  font-size: 18px;
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size {
  color: #888;
  font-size: 12px;
  margin-left: 12px;
}
</style>
```

**Step 2: 验证编译**

Run: `cd packages/web && pnpm typecheck`

Expected: 无类型错误

**Step 3: 提交**

```bash
git add packages/web/src/components/FileList.vue
git commit -m "feat(web): add FileList component"
```

---

## Task 10: Web 传输进度组件

**Files:**
- Create: `packages/web/src/components/FileTransferProgress.vue`

**Step 1: 创建 FileTransferProgress 组件**

```vue
<template>
  <div v-if="transfers.length > 0" class="transfer-progress">
    <div v-for="transfer in transfers" :key="transfer.id" class="transfer-item">
      <div class="transfer-header">
        <span class="icon">{{ transfer.direction === 'upload' ? '📤' : '📥' }}</span>
        <span class="filename">{{ transfer.fileName }}</span>
        <span class="percent">{{ transfer.percent }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${transfer.percent}%` }"></div>
      </div>
      <div v-if="transfer.status === 'error'" class="error">{{ transfer.error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TransferProgress } from '@/stores/file';

defineProps<{
  transfers: TransferProgress[];
}>();
</script>

<style scoped>
.transfer-progress {
  position: fixed;
  bottom: 60px;
  left: 10px;
  right: 10px;
  z-index: 100;
}

.transfer-item {
  background: #2a2a3e;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.transfer-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.icon {
  margin-right: 8px;
}

.filename {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.percent {
  font-size: 12px;
  color: #888;
  margin-left: 8px;
}

.progress-bar {
  height: 4px;
  background: #444;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #4fc3f7;
  transition: width 0.3s ease;
}

.error {
  color: #f44336;
  font-size: 12px;
  margin-top: 8px;
}
</style>
```

**Step 2: 验证编译**

Run: `cd packages/web && pnpm typecheck`

Expected: 无类型错误

**Step 3: 提交**

```bash
git add packages/web/src/components/FileTransferProgress.vue
git commit -m "feat(web): add FileTransferProgress component"
```

---

## Task 11: Web 文件管理页面

**Files:**
- Create: `packages/web/src/views/FileView.vue`

**Step 1: 创建 FileView 页面**

```vue
<template>
  <div class="file-view">
    <!-- 路径栏 -->
    <div class="path-bar">
      <div class="path-segments">
        <span
          v-for="(segment, index) in pathSegments"
          :key="index"
          class="path-segment"
          @click="navigateToSegment(index)"
        >
          {{ segment }}
        </span>
      </div>
    </div>

    <!-- 文件列表 -->
    <FileList
      :entries="entries"
      :loading="loading"
      :error="error"
      @browse="onBrowseEntry"
      @download="onDownloadEntry"
    />

    <!-- 底部操作栏 -->
    <div class="action-bar">
      <button class="action-btn" @click="triggerUpload">
        <span>📤</span> 上传
      </button>
      <button class="action-btn" @click="refresh">
        <span>🔄</span> 刷新
      </button>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInput"
      type="file"
      style="display: none"
      @change="onFileSelected"
    />

    <!-- 传输进度 -->
    <FileTransferProgress :transfers="transfers" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useFileStore } from '@/stores/file';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import FileList from '@/components/FileList.vue';
import FileTransferProgress from '@/components/FileTransferProgress.vue';

const fileStore = useFileStore();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();

const { entries, loading, error, currentPath, transfers } = storeToRefs(fileStore);

const fileInput = ref<HTMLInputElement | null>(null);

const pathSegments = computed(() => {
  if (!currentPath.value) return [];
  return currentPath.value.split(/[/\\]/).filter(Boolean);
});

onMounted(() => {
  // 初始化：浏览用户主目录
  fileStore.browse('~');
});

onUnmounted(() => {
  fileStore.clearCompletedTransfers();
});

function navigateToSegment(index: number) {
  const segments = pathSegments.value.slice(0, index + 1);
  const newPath = segments.join('\\');
  fileStore.browse(newPath);
}

function onBrowseEntry(name: string) {
  const newPath = currentPath.value ? `${currentPath.value}\\${name}` : name;
  fileStore.browse(newPath);
}

function onDownloadEntry(name: string) {
  const filePath = currentPath.value ? `${currentPath.value}\\${name}` : name;
  fileStore.download(filePath);
}

function triggerUpload() {
  fileInput.value?.click();
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    const filePath = currentPath.value ? `${currentPath.value}\\${file.name}` : file.name;
    fileStore.upload(filePath, file);
  }
  input.value = '';
}

function refresh() {
  if (currentPath.value) {
    fileStore.browse(currentPath.value);
  }
}
</script>

<style scoped>
.file-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a2e;
  color: #fff;
}

.path-bar {
  padding: 12px 16px;
  background: #16162a;
  border-bottom: 1px solid #333;
  overflow-x: auto;
}

.path-segments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.path-segment {
  color: #4fc3f7;
  cursor: pointer;
}

.path-segment:hover {
  text-decoration: underline;
}

.path-segment::after {
  content: ' > ';
  color: #888;
}

.path-segment:last-child::after {
  content: '';
}

.action-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  background: #16162a;
  border-top: 1px solid #333;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  background: #2a2a4e;
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.action-btn:hover {
  background: #3a3a5e;
}
</style>
```

**Step 2: 验证编译**

Run: `cd packages/web && pnpm typecheck`

Expected: 无类型错误

**Step 3: 提交**

```bash
git add packages/web/src/views/FileView.vue
git commit -m "feat(web): add FileView page"
```

---

## Task 12: Web 路由配置

**Files:**
- Modify: `packages/web/src/router/index.ts`

**Step 1: 添加文件管理路由**

导入 FileView：

```typescript
import FileView from '@/views/FileView.vue';
```

在 routes 数组中添加：

```typescript
{
  path: '/files',
  name: 'files',
  component: FileView,
  meta: { requiresAuth: true },
},
```

**Step 2: 验证编译**

Run: `cd packages/web && pnpm typecheck`

Expected: 无类型错误

**Step 3: 提交**

```bash
git add packages/web/src/router/index.ts
git commit -m "feat(web): add file management route"
```

---

## Task 13: Web 导航入口

**Files:**
- Modify: `packages/web/src/views/TerminalView.vue`

**Step 1: 添加文件按钮到工具栏**

在工具栏区域添加文件按钮（参考现有设置按钮样式）：

```vue
<button class="tool-btn" @click="goToFiles" title="文件">
  📁
</button>
```

**Step 2: 添加导航方法**

```typescript
import { useRouter } from 'vue-router';

const router = useRouter();

function goToFiles() {
  router.push('/files');
}
```

**Step 3: 验证编译**

Run: `cd packages/web && pnpm typecheck`

Expected: 无类型错误

**Step 4: 提交**

```bash
git add packages/web/src/views/TerminalView.vue
git commit -m "feat(web): add files navigation button"
```

---

## Task 14: 端到端测试

**Files:**
- 无新文件

**Step 1: 启动服务端**

Run: `cd packages/server && pnpm dev`

Expected: 服务端在 3000 端口启动

**Step 2: 启动 Agent**

Run: `cd packages/agent && pnpm dev`

Expected: Agent 连接到服务器并注册

**Step 3: 启动前端**

Run: `cd packages/web && pnpm dev`

Expected: 前端在 5173 端口启动

**Step 4: 测试文件浏览**

1. 打开浏览器访问 `http://localhost:5173`
2. 登录
3. 点击文件按钮
4. 验证能看到文件列表

**Step 5: 测试文件下载**

1. 点击一个文件
2. 验证进度条显示
3. 验证文件下载成功

**Step 6: 测试文件上传**

1. 点击上传按钮
2. 选择文件
3. 验证进度条显示
4. 刷新目录验证文件存在

**Step 7: 最终提交**

```bash
git add -A
git commit -m "feat: complete file management implementation"
```

---

## 任务摘要

| Task | 描述 | 文件 |
|------|------|------|
| 1 | Shared 类型定义 | `packages/shared/src/types.ts` |
| 2 | Agent 目录浏览 | `packages/agent/src/file.ts` |
| 3 | Agent 文件下载 | `packages/agent/src/file.ts` |
| 4 | Agent 文件上传 | `packages/agent/src/file.ts` |
| 5 | Agent Tunnel 集成 | `packages/agent/src/tunnel.ts` |
| 6 | Server 消息路由 | `packages/server/src/ws/router.ts` |
| 7 | Web 文件状态管理 | `packages/web/src/stores/file.ts` |
| 8 | Web WebSocket 服务 | `packages/web/src/services/fileWebSocket.ts` |
| 9 | Web 文件列表组件 | `packages/web/src/components/FileList.vue` |
| 10 | Web 传输进度组件 | `packages/web/src/components/FileTransferProgress.vue` |
| 11 | Web 文件管理页面 | `packages/web/src/views/FileView.vue` |
| 12 | Web 路由配置 | `packages/web/src/router/index.ts` |
| 13 | Web 导航入口 | `packages/web/src/views/TerminalView.vue` |
| 14 | 端到端测试 | - |