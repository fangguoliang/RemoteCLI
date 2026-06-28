import type { FileListPayload, FileProgressPayload, FileDataPayload, FileUploadedPayload, FileErrorPayload, FileValidatedPayload } from '@remotecli/shared';
import { useFileStore } from '@/stores/file';
import { useAuthStore } from '@/stores/auth';
import { blackbox } from '@/utils/eventLogger';

type MessageHandler = (data: unknown) => void;

class FileWebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers = new Map<string, MessageHandler[]>();
  private transferChunks = new Map<string, { chunks: Map<number, string>; totalChunks: number; totalSize: number }>();
  private viewingPath: string | null = null;
  private viewingRequested = new Set<string>(); // track all viewing download requests
  private regularDownloadRequested = new Set<string>(); // track paths requested for regular download
  private currentAgentId: string | null = null;
  private viewContentHandlers: ((path: string, content: string) => void)[] = [];
  private viewErrorHandlers: ((path: string, error: string) => void)[] = [];

  /**
   * Set the active agent ID for routing file operations.
   * Must be called before any file:download/file:validate operations.
   */
  public setAgentId(agentId: string | null) {
    this.currentAgentId = agentId;
    blackbox.log('ws', 'filews:set-agent', { agentId });
  }

  connect(url: string, agentId?: string): Promise<void> {
    // [pdf-fix] Close old WebSocket before creating new one.
    // Without this, navigating Terminal→Files repeatedly creates stale connections
    // that the server still thinks are active, causing duplicate chunk delivery.
    if (this.ws) {
      blackbox.log('ws', 'filews:closing-stale', { readyState: this.ws.readyState });
      const oldWs = this.ws;
      // Clear old handlers to prevent them from affecting new connection
      oldWs.onopen = null;
      oldWs.onerror = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      try { oldWs.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    return new Promise((resolve, reject) => {
      console.log('[fileWebSocket] Connecting to URL:', url, 'agentId:', agentId);
      blackbox.log('ws', 'filews:connecting', { url, agentId });
      this.currentAgentId = agentId || null;
      const ws = new WebSocket(url);
      this.ws = ws;
      console.log('[fileWebSocket] WebSocket created, readyState:', ws.readyState);

      ws.onopen = () => {
        console.log('[fileWebSocket] WebSocket OPENED, readyState:', ws.readyState);
        blackbox.log('ws', 'filews:opened', { readyState: ws.readyState });
        const authStore = useAuthStore();
        console.log('[fileWebSocket] Sending auth with userId:', authStore.userId, 'agentId:', this.currentAgentId);
        blackbox.log('ws', 'filews:auth-sending', { userId: authStore.userId, agentId: this.currentAgentId });
        this.send({
          type: 'auth',
          payload: { userId: authStore.userId, agentId: this.currentAgentId },
          timestamp: Date.now(),
        });
      };

      ws.onerror = (err) => {
        console.error('[fileWebSocket] WebSocket error:', err);
        blackbox.log('error', 'filews:error', { error: String(err) });
        reject(err);
      };

      ws.onmessage = (event) => {
        try {
          const rawSize = typeof event.data === 'string' ? event.data.length : 0;
          const message = JSON.parse(event.data);
          // [pdf-debug] Log file:data messages with size info
          if (message.type === 'file:data') {
            blackbox.log('pdf', 'ws:raw-message', {
              type: 'file:data',
              rawSize,
              chunkIndex: message.payload?.chunkIndex,
              totalChunks: message.payload?.totalChunks,
              contentLen: message.payload?.content?.length ?? 0,
              path: message.payload?.path,
            });
          }
          console.log('[fileWebSocket] Received message:', message.type, message);
          // Handle auth:result
          if (message.type === 'auth:result') {
            console.log('[fileWebSocket] Auth result:', message.payload);
            blackbox.log('ws', 'filews:auth-result', { success: message.payload?.success, error: message.payload?.error });
            if (message.payload?.success) {
              blackbox.log('ws', 'filews:connected', {});
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

      ws.onclose = () => {
        // [pdf-fix] Only clean up if this is still the active WebSocket
        if (this.ws !== ws) return;
        console.log('[fileWebSocket] WebSocket closed');
        blackbox.log('ws', 'filews:closed', {});
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
        // Clean up view handlers (no auto-reconnect, so they'd never fire)
        this.viewContentHandlers = [];
        this.viewErrorHandlers = [];
        this.viewingRequested.clear();
        this.regularDownloadRequested.clear();
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
    blackbox.log('pdf', 'ws:file-data', {
      payloadPath: payload.path,
      viewingPath: this.viewingPath,
      chunkIndex: payload.chunkIndex,
      totalChunks: payload.totalChunks,
      contentLen: payload.content?.length ?? 0,
      viewingRequested: Array.from(this.viewingRequested),
      regularDownloadRequested: Array.from(this.regularDownloadRequested),
    });

    // Check if this is a "for viewing" download
    if (normalizedViewingPath && normalizedViewingPath === normalizedPayloadPath) {
      blackbox.log('pdf', 'ws:file-data-branch', { branch: 'viewing', chunkIndex: payload.chunkIndex });
      this.assembleViewContent(payload);
      return;
    }

    // If this path was requested for viewing but has been superseded, discard it
    // (prevents stale viewing downloads from triggering unexpected file downloads)
    if (this.viewingRequested.has(normalizedPayloadPath)) {
      blackbox.log('pdf', 'ws:file-data-branch', { branch: 'discarded-superseded', chunkIndex: payload.chunkIndex });
      this.viewingRequested.delete(normalizedPayloadPath);
      return;
    }

    // Only proceed with regular download if this path was explicitly requested
    // (prevents orphaned chunks from triggering unexpected browser downloads)
    if (!this.regularDownloadRequested.has(normalizedPayloadPath)) {
      blackbox.log('pdf', 'ws:file-data-branch', { branch: 'discarded-unrequested', chunkIndex: payload.chunkIndex });
      console.log('[fileWebSocket] handleFileData: discarding unrequested data for', payload.path);
      return;
    }

    blackbox.log('pdf', 'ws:file-data-branch', { branch: 'regular-download', chunkIndex: payload.chunkIndex });

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

      // Clean up tracking
      this.regularDownloadRequested.delete(filePath.replace(/\\/g, '/'));

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

  // 将 Uint8Array 转换为 Base64 字符串（分块避免调用栈溢出）
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  }

  private assembleViewContent(payload: FileDataPayload) {
    const store = useFileStore();
    const viewId = 'viewer-' + payload.path;

    blackbox.log('pdf', 'ws:assemble-start', {
      path: payload.path,
      chunkIndex: payload.chunkIndex,
      totalChunks: payload.totalChunks,
      contentLen: payload.content?.length ?? 0,
    });

    // Initialize chunks on first chunk
    if (payload.chunkIndex === 0) {
      if (this.transferChunks.has(viewId)) {
        blackbox.log('pdf', 'ws:assemble-reinit', {
          viewId,
          reason: 'chunk-0-again',
          existingChunks: this.transferChunks.get(viewId)?.chunks.size ?? 0,
        });
      }
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
      blackbox.log('pdf', 'ws:assemble-chunk-stored', {
        chunkIndex: payload.chunkIndex,
        mapSize: transfer.chunks.size,
        totalChunks: transfer.totalChunks,
        keys: Array.from(transfer.chunks.keys()),
      });

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

        // Determine if binary file (needs base64) or text file (needs UTF-8 decode)
        const fileName = payload.path.split(/[/\\]/).pop() || '';
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const isBinaryType = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'pdf'].includes(ext);

        let content: string;
        if (isBinaryType) {
          // Keep as base64 for binary types (images, PDF)
          content = this.uint8ArrayToBase64(allBytes);
        } else {
          // Detect encoding from BOM and decode accordingly
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
        }

        // Store content and show viewer
        console.log('[fileWebSocket] viewer showing file:', payload.path, 'content length:', content.length);
        blackbox.log('pdf', 'ws:assemble-complete', {
          path: payload.path,
          contentLen: content.length,
          isBinary: isBinaryType,
          totalSize: transfer.totalSize,
        });
        store.setViewerContent(content);
        store.setViewerLoading(false);
        store.setViewerVisible(true);
        store.setValidatingPath(null);

        // Notify view content handlers
        this.viewContentHandlers.forEach(h => h(payload.path, content));

        // Cleanup
        this.transferChunks.delete(viewId);
        this.viewingPath = null;
        this.viewingRequested.delete(payload.path.replace(/\\/g, '/'));
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

  private handleFileError(payload: FileErrorPayload) {
    const store = useFileStore();
    store.setError(payload.message);
    store.setLoading(false);

    // Handle viewing download error
    if (payload.path && this.viewingPath === payload.path) {
      const errorPath = payload.path;
      store.setViewerLoading(false);
      store.setValidatingPath(null);
      this.viewingPath = null;
      this.viewingRequested.delete(errorPath.replace(/\\/g, '/'));
      // Clean up viewer chunks
      const viewId = 'viewer-' + errorPath;
      this.transferChunks.delete(viewId);
      // Notify error handlers so overlay can stop loading
      this.viewErrorHandlers.forEach(h => h(errorPath, payload.message));
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
    const normalizedPath = path.replace(/\\/g, '/');

    blackbox.log('ws', 'filews:download', { path, agentId: this.currentAgentId });

    // Track this as an expected regular download
    this.regularDownloadRequested.add(normalizedPath);

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
      payload: { path, agentId: this.currentAgentId },
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
    if (!this.isConnected()) {
      // Emit error result asynchronously so callers' handlers still work
      queueMicrotask(() => {
        const handlers = this.messageHandlers.get('file:create:result') || [];
        handlers.forEach(h => h({ success: false, error: 'Not connected' }));
      });
      return;
    }
    this.send({
      type: 'file:create',
      payload: { dirPath, name: fileName, agentId },
      timestamp: Date.now(),
    });
  }

  renameFile(oldPath: string, newName: string) {
    if (!this.isConnected()) {
      queueMicrotask(() => {
        const handlers = this.messageHandlers.get('file:rename:result') || [];
        handlers.forEach(h => h({ success: false, error: 'Not connected' }));
      });
      return;
    }
    this.send({
      type: 'file:rename',
      payload: { oldPath, newName },
      timestamp: Date.now(),
    });
  }

  deleteFile(path: string, isDirectory: boolean) {
    if (!this.isConnected()) {
      queueMicrotask(() => {
        const handlers = this.messageHandlers.get('file:delete:result') || [];
        handlers.forEach(h => h({ success: false, error: 'Not connected' }));
      });
      return;
    }
    this.send({
      type: 'file:delete',
      payload: { path, isDirectory },
      timestamp: Date.now(),
    });
  }

  onViewContent(handler: (path: string, content: string) => void) {
    this.viewContentHandlers.push(handler);
  }

  offViewContent(handler: (path: string, content: string) => void) {
    const idx = this.viewContentHandlers.indexOf(handler);
    if (idx !== -1) this.viewContentHandlers.splice(idx, 1);
  }

  onViewError(handler: (path: string, error: string) => void) {
    this.viewErrorHandlers.push(handler);
  }

  offViewError(handler: (path: string, error: string) => void) {
    const idx = this.viewErrorHandlers.indexOf(handler);
    if (idx !== -1) this.viewErrorHandlers.splice(idx, 1);
  }

  // Check actual connection state before validating
  private isActuallyConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  validatePath(path: string, sessionId: string) {
    console.log('[fileWebSocket] validatePath:', path, 'sessionId:', sessionId, 'agentId:', this.currentAgentId, 'ws state:', this.ws?.readyState);

    // Always check actual state
    if (!this.isActuallyConnected()) {
      console.warn('[fileWebSocket] validatePath: WebSocket not actually connected, state:', this.ws?.readyState);
      // Clear stale connection
      this.ws = null;
      return;
    }

    blackbox.log('ws', 'filews:validate', { path, sessionId, agentId: this.currentAgentId });

    const msg = {
      type: 'file:validate',
      payload: { path, agentId: this.currentAgentId },
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
    console.log('[fileWebSocket] downloadForView:', path, 'agentId:', this.currentAgentId);
    blackbox.log('pdf', 'ws:download-for-view', { path, agentId: this.currentAgentId });
    const store = useFileStore();

    // Set loading state
    store.setViewerLoading(true);
    store.setViewerPath(path);

    // Mark this as a "for viewing" download
    this.viewingPath = path;
    this.viewingRequested.add(path);

    this.send({
      type: 'file:download',
      payload: { path, agentId: this.currentAgentId },
      timestamp: Date.now(),
    });
  }

  public sendMessage(message: unknown) {
    this.send(message);
  }

  public isConnected(): boolean {
    return this.isActuallyConnected();
  }

  /**
   * Cancel any pending viewing downloads.
   * Called when the file overlay/viewer is closed to prevent orphaned
   * file:data chunks from triggering unexpected browser downloads.
   */
  public cancelViewing() {
    this.viewingPath = null;
    this.viewingRequested.clear();
    this.viewContentHandlers = [];
    this.viewErrorHandlers = [];
    // Clean up viewer-specific transfer chunks
    for (const key of this.transferChunks.keys()) {
      if (key.startsWith('viewer-')) {
        this.transferChunks.delete(key);
      }
    }
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