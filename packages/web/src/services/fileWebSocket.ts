import type { FileListPayload, FileProgressPayload, FileDataPayload, FileUploadedPayload, FileErrorPayload } from '@ccremote/shared';
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

  private handleFileData(_sessionId: string, payload: FileDataPayload) {
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