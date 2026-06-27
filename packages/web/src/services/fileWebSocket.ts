import type { FileListPayload, FileProgressPayload, FileDataPayload, FileUploadedPayload, FileErrorPayload, FileValidatedPayload } from '@remotecli/shared';
import { useFileStore } from '@/stores/file';
import { useAuthStore } from '@/stores/auth';

type MessageHandler = (data: unknown) => void;

class FileWebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers = new Map<string, MessageHandler[]>();
  private transferChunks = new Map<string, { chunks: Map<number, string>; totalChunks: number; totalSize: number }>();
  private viewingPath: string | null = null;
  private currentAgentId: string | null = null;

  // View content delivery callbacks
  private viewContentHandlers: ((path: string, content: string) => void)[] = [];

  connect(url: string, agentId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('[fileWebSocket] Connecting to URL:', url, 'agentId:', agentId);
      this.currentAgentId = agentId || null;
      const ws = new WebSocket(url);
      this.ws = ws;
      console.log('[fileWebSocket] WebSocket created, readyState:', ws.readyState);

      ws.onopen = () => {
        console.log('[fileWebSocket] WebSocket OPENED, readyState:', ws.readyState);
        const authStore = useAuthStore();
        console.log('[fileWebSocket] Sending auth with userId:', authStore.userId, 'agentId:', this.currentAgentId);
        this.send({
          type: 'auth',
          payload: { userId: authStore.userId, agentId: this.currentAgentId },
          timestamp: Date.now(),
        });
      };

      this.ws.onerror = (err) => {
        console.error('[fileWebSocket] WebSocket error:', err);
        reject(err);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[fileWebSocket] Received message:', message.type, message);
          // Handle auth:result
          if (message.type === 'auth:result') {
            console.log('[fileWebSocket] Auth result:', message.payload);
            if (message.payload?.success) {
              resolve();
            } else {
              reject(new Error(message.payload?.error || 'Auth failed'));
            }
            return;
          }
          this.handleMessage(message);
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('[fileWebSocket] WebSocket closed');
        // Clean up connection state
        this.ws = null;
        // Clean up viewing state
        this.viewingPath = null;
        // Clean up viewer-specific chunks
        for (const key of this.transferChunks.keys()) {
          if (key.startsWith('viewer-')) {
            this.transferChunks.delete(key);
          }
        }
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
    console.log('[fileWebSocket] send called, ws state:', this.ws?.readyState);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msgStr = JSON.stringify(message);
      console.log('[fileWebSocket] sending:', msgStr.substring(0, 200));
      this.ws.send(msgStr);
    } else {
      console.warn('[fileWebSocket] Cannot send - WebSocket not open');
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
        this.handleFileData(payload as FileDataPayload);
        break;
      case 'file:uploaded':
        this.handleFileUploaded(payload as FileUploadedPayload);
        break;
      case 'file:error':
        this.handleFileError(payload as FileErrorPayload);
        break;
      case 'file:validated':
        this.handleFileValidated(payload as FileValidatedPayload);
        break;
      case 'file:create:result':
      case 'file:rename:result':
      case 'file:delete:result':
        // Handled by registered handlers via this.messageHandlers
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

  private handleFileData(payload: FileDataPayload) {
    const store = useFileStore();

    // Normalize paths for comparison (handle both \ and /)
    const normalizedViewingPath = this.viewingPath?.replace(/\\/g, '/');
    const normalizedPayloadPath = payload.path.replace(/\\/g, '/');

    console.log('[fileWebSocket] handleFileData: payload.path=', payload.path, 'viewingPath=', this.viewingPath);

    // Check if this is a "for viewing" download
    if (normalizedViewingPath && normalizedViewingPath === normalizedPayloadPath) {
      this.assembleViewContent(payload);
      return;
    }

    // Regular download
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

    // Get file extension and set MIME type
    const fileName = filePath.split(/[/\\]/).pop() || 'download';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      'gif': 'image/gif',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'zip': 'application/zip',
      'txt': 'text/plain',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    // 合并所有块 - 使用更高效的方式处理大文件
    try {
      // 先计算总大小
      let totalLength = 0;
      for (let i = 0; i < transfer.totalChunks; i++) {
        const chunk = transfer.chunks.get(i);
        if (chunk) {
          totalLength += chunk.length;
        }
      }

      // 直接解码到 Uint8Array
      const bytes = new Uint8Array(transfer.totalSize);
      let offset = 0;

      for (let i = 0; i < transfer.totalChunks; i++) {
        const chunk = transfer.chunks.get(i);
        if (chunk) {
          // 分段解码避免字符串长度限制
          const chunkBytes = this.base64ToUint8Array(chunk);
          bytes.set(chunkBytes, offset);
          offset += chunkBytes.length;
        }
      }

      // 创建 Blob 并下载
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
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
    } catch (err) {
      console.error('Download error:', err);
      store.updateTransfer(transferId, { status: 'error', error: 'Download failed' });
    }
  }

  // 安全地将 Base64 转换为 Uint8Array，避免字符串长度限制
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  private assembleViewContent(payload: FileDataPayload) {
    const store = useFileStore();
    const viewId = 'viewer-' + payload.path;

    // Initialize chunks on first chunk
    if (payload.chunkIndex === 0) {
      this.transferChunks.set(viewId, {
        chunks: new Map(),
        totalChunks: payload.totalChunks,
        totalSize: payload.totalSize,
      });
    }

    // Store chunk
    const transfer = this.transferChunks.get(viewId);
    if (transfer) {
      transfer.chunks.set(payload.chunkIndex, payload.content);

      // All chunks received
      if (transfer.chunks.size === transfer.totalChunks) {
        // Assemble all raw bytes first
        const allBytes = new Uint8Array(transfer.totalSize);
        let offset = 0;
        for (let i = 0; i < transfer.totalChunks; i++) {
          const chunk = transfer.chunks.get(i);
          if (chunk) {
            const binaryString = atob(chunk);
            const chunkBytes = new Uint8Array(binaryString.length);
            for (let j = 0; j < binaryString.length; j++) {
              chunkBytes[j] = binaryString.charCodeAt(j);
            }
            allBytes.set(chunkBytes, offset);
            offset += chunkBytes.length;
          }
        }

        // Detect encoding from BOM and decode accordingly
        let content: string;
        if (allBytes.length >= 2 && allBytes[0] === 0xff && allBytes[1] === 0xfe) {
          // UTF-16LE BOM
          content = new TextDecoder('utf-16le').decode(allBytes.subarray(2));
        } else if (allBytes.length >= 2 && allBytes[0] === 0xfe && allBytes[1] === 0xff) {
          // UTF-16BE BOM
          content = new TextDecoder('utf-16be').decode(allBytes.subarray(2));
        } else if (allBytes.length >= 3 && allBytes[0] === 0xef && allBytes[1] === 0xbb && allBytes[2] === 0xbf) {
          // UTF-8 BOM
          content = new TextDecoder('utf-8').decode(allBytes.subarray(3));
        } else {
          // Default: UTF-8 (no BOM)
          content = new TextDecoder('utf-8').decode(allBytes);
        }

        // Store content and show viewer
        console.log('[fileWebSocket] viewer showing file:', payload.path, 'content length:', content.length);
        store.setViewerContent(content);
        store.setViewerLoading(false);
        store.setViewerVisible(true);
        store.setValidatingPath(null);

        // Notify view content handlers
        this.viewContentHandlers.forEach(h => h(payload.path, content));

        // Cleanup
        this.transferChunks.delete(viewId);
        this.viewingPath = null;
      }
    }
  }

  private handleFileUploaded(payload: FileUploadedPayload) {
    const store = useFileStore();
    const transferId = payload.path;

    if (payload.success) {
      store.updateTransfer(transferId, { status: 'completed', percent: 100 });

      // Extract parent directory from the uploaded file path
      const parts = payload.path.split(/[/\\]/).filter(Boolean);
      parts.pop(); // remove filename
      const parentDir = parts.join('\\');

      // Notify view to refresh if parent dir matches current view
      setTimeout(() => {
        const currentStore = useFileStore();
        const normalizedCurrent = currentStore.currentPath.replace(/\//g, '\\');
        const normalizedParent = (parentDir || '').replace(/\//g, '\\');
        if (normalizedCurrent === normalizedParent) {
          this.emitUploadComplete(parentDir);
        }
      }, 300);

      setTimeout(() => {
        store.removeTransfer(transferId);
      }, 2000);
    } else {
      store.updateTransfer(transferId, { status: 'error', error: payload.error });
    }
  }

  private uploadCompleteHandlers: ((dir: string) => void)[] = [];

  private emitUploadComplete(dir: string) {
    this.uploadCompleteHandlers.forEach(handler => handler(dir));
  }

  onUploadComplete(handler: (dir: string) => void) {
    this.uploadCompleteHandlers.push(handler);
  }

  offUploadComplete(handler: (dir: string) => void) {
    const index = this.uploadCompleteHandlers.indexOf(handler);
    if (index !== -1) {
      this.uploadCompleteHandlers.splice(index, 1);
    }
  }

  onViewContent(handler: (path: string, content: string) => void) {
    this.viewContentHandlers.push(handler);
  }

  offViewContent(handler: (path: string, content: string) => void) {
    const idx = this.viewContentHandlers.indexOf(handler);
    if (idx !== -1) this.viewContentHandlers.splice(idx, 1);
  }

  private handleFileError(payload: FileErrorPayload) {
    const store = useFileStore();
    store.setError(payload.message);
    store.setLoading(false);

    // Handle viewing download error
    if (payload.path && this.viewingPath === payload.path) {
      store.setViewerLoading(false);
      store.setValidatingPath(null);
      this.viewingPath = null;
      // Clean up viewer chunks
      const viewId = 'viewer-' + payload.path;
      this.transferChunks.delete(viewId);
    }

    // 更新相关传输状态
    if (payload.path) {
      store.updateTransfer(payload.path, { status: 'error', error: payload.message });
    }
  }

  private handleFileValidated(payload: FileValidatedPayload) {
    console.log('[fileWebSocket] handleFileValidated:', payload);
    const store = useFileStore();

    store.setValidatedPath({
      originalPath: payload.originalPath,
      resolvedPath: payload.resolvedPath,
      exists: payload.exists,
    });

    if (payload.exists) {
      // File exists - trigger download for viewing
      this.downloadForView(payload.resolvedPath);
    } else {
      // File not found - show error
      store.setValidatingPath(null);
      store.setViewerLoading(false);
    }
  }

  // 公共 API
  browse(path: string, agentId: string) {
    console.log('[fileWebSocket] browse called, path:', path, 'agentId:', agentId);
    console.log('[fileWebSocket] ws state:', this.ws?.readyState);
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

  // Check actual connection state before validating
  private isActuallyConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  validatePath(path: string, sessionId: string) {
    console.log('[fileWebSocket] validatePath:', path, 'sessionId:', sessionId, 'ws state:', this.ws?.readyState);

    // Always check actual state
    if (!this.isActuallyConnected()) {
      console.warn('[fileWebSocket] validatePath: WebSocket not actually connected, state:', this.ws?.readyState);
      // Clear stale connection
      this.ws = null;
      return;
    }

    const msg = {
      type: 'file:validate',
      payload: { path },
      sessionId,
      timestamp: Date.now(),
    };
    const msgStr = JSON.stringify(msg);
    console.log('[fileWebSocket] Sending message:', msgStr.substring(0, 200));

    // Actually send
    if (this.ws) {
      this.ws.send(msgStr);
      console.log('[fileWebSocket] Message sent successfully');
    }
  }

  downloadForView(path: string) {
    console.log('[fileWebSocket] downloadForView:', path);
    const store = useFileStore();

    // Set loading state
    store.setViewerLoading(true);
    store.setViewerPath(path);

    // Mark this as a "for viewing" download
    this.viewingPath = path;

    this.send({
      type: 'file:download',
      payload: { path },
      timestamp: Date.now(),
    });
  }

  public sendMessage(message: unknown) {
    this.send(message);
  }

  public isConnected(): boolean {
    return this.isActuallyConnected();
  }

  public getWsState(): number | null {
    return this.ws?.readyState ?? null;
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