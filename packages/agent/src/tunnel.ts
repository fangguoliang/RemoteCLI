import WebSocket from 'ws';
import { config } from './config.js';
import { PtyManager } from './pty.js';
import { FileManager } from './file.js';
import { getAgentName } from './shell.js';

export class Tunnel {
  private ws: WebSocket | null = null;
  private ptyManager = new PtyManager();
  private fileManager = new FileManager();
  private uploadSessions = new Map<string, string>(); // sessionId -> uploadId
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  connect() {
    console.log(`Connecting to ${config.serverUrl}...`);

    this.ws = new WebSocket(config.serverUrl);

    this.ws.on('open', () => {
      console.log('Connected to server');
      this.register();
      this.startHeartbeat();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('close', () => {
      console.log('Disconnected from server');
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
    });
  }

  private register() {
    this.send({
      type: 'register',
      payload: {
        agentId: config.agentId,
        userId: config.userId,
        name: getAgentName(),
      },
      timestamp: Date.now(),
    });
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping', timestamp: Date.now() });
    }, config.heartbeatInterval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, config.reconnectInterval);
  }

  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data);
      const { type, payload, sessionId } = message;

      switch (type) {
        case 'register:result':
          console.log('Registration result:', payload);
          break;

        case 'session:start':
          this.handleSessionStart(payload);
          break;

        case 'session:input':
          if (sessionId) {
            this.ptyManager.write(sessionId, payload.data);
          }
          break;

        case 'session:resize':
          if (sessionId) {
            this.ptyManager.resize(sessionId, payload.cols, payload.rows);
          }
          break;

        case 'session:close':
          if (sessionId) {
            this.ptyManager.close(sessionId);
          }
          break;

        case 'session:pause':
          if (sessionId) {
            this.ptyManager.pause(sessionId);
          }
          break;

        case 'session:resume':
          if (sessionId) {
            this.handleSessionResume(sessionId, payload);
          }
          break;

        case 'pong':
          break;

        case 'file:browse':
          this.handleFileBrowse(payload);
          break;

        case 'file:download':
          this.handleFileDownload(payload);
          break;

        case 'file:upload':
          this.handleFileUpload(payload);
          break;
      }
    } catch (err) {
      console.error('Failed to handle message:', err);
    }
  }

  private handleSessionStart(payload: { sessionId: string; cols: number; rows: number }) {
    const { sessionId, cols, rows } = payload;
    console.log(`[Agent] handleSessionStart: sessionId=${sessionId}, cols=${cols}, rows=${rows}`);

    try {
      this.ptyManager.create(sessionId, cols, rows, (data) => {
        this.send({
          type: 'session:output',
          sessionId,
          payload: { data },
          timestamp: Date.now(),
        });
      });

      console.log(`[Agent] PTY created successfully, sending session:started`);
      this.send({
        type: 'session:started',
        sessionId,
        payload: { success: true },
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error(`[Agent] Failed to create PTY:`, err);
      this.send({
        type: 'session:started',
        sessionId,
        payload: { success: false, error: String(err) },
        timestamp: Date.now(),
      });
    }
  }

  private handleSessionResume(sessionId: string, payload: { cols: number; rows: number }) {
    const { cols, rows } = payload;

    // Check if session exists
    if (!this.ptyManager.has(sessionId)) {
      // Session doesn't exist, report failure
      this.send({
        type: 'session:resumed',
        sessionId,
        payload: { success: false, error: 'Session not found' },
        timestamp: Date.now(),
      });
      return;
    }

    // Resize to new dimensions
    this.ptyManager.resize(sessionId, cols, rows);

    // Resume the session
    const result = this.ptyManager.resume(sessionId, (data) => {
      this.send({
        type: 'session:output',
        sessionId,
        payload: { data },
        timestamp: Date.now(),
      });
    });

    this.send({
      type: 'session:resumed',
      sessionId,
      payload: { success: result.success },
      timestamp: Date.now(),
    });
  }

  private handleFileBrowse(payload: { path: string }) {
    this.fileManager.browse(payload.path)
      .then((result) => {
        this.send({
          type: 'file:list',
          payload: { path: result.path, entries: result.entries },
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

  private handleFileDownload(payload: { path: string }) {
    console.log('[Agent] handleFileDownload, path:', payload.path);
    this.fileManager.readFileChunked(payload.path, (data) => {
      this.send({
        type: 'file:data',
        payload: {
          path: payload.path,
          content: data.content,
          chunkIndex: data.chunkIndex,
          totalChunks: data.totalChunks,
          totalSize: data.totalSize,
        },
        timestamp: Date.now(),
      });

      // 发送进度
      this.send({
        type: 'file:progress',
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
      console.error('[Agent] handleFileDownload error:', err);
      this.send({
        type: 'file:error',
        payload: { code: err.message, message: err.message, path: payload.path },
        timestamp: Date.now(),
      });
    });
  }

  private handleFileUpload(
    payload: { path: string; content: string; chunkIndex: number; totalChunks: number; totalSize: number; overwrite: boolean }
  ) {
    console.log('[Agent] handleFileUpload, path:', payload.path, 'chunk:', payload.chunkIndex, '/', payload.totalChunks);
    const { path: filePath, content, chunkIndex, totalChunks, totalSize, overwrite } = payload;

    // 首块：初始化上传会话
    if (chunkIndex === 0) {
      const uploadId = `upload-${Date.now()}`;
      this.uploadSessions.set(filePath, uploadId);
      this.fileManager.startUpload(uploadId, totalChunks, totalSize);
    }

    const uploadId = this.uploadSessions.get(filePath);
    if (!uploadId) {
      console.error('[Agent] Upload session not found for:', filePath);
      this.send({
        type: 'file:error',
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
            console.log('[Agent] Upload completed:', filePath);
            this.send({
              type: 'file:uploaded',
              payload: { path: filePath, success: true },
              timestamp: Date.now(),
            });
          })
          .catch((err: Error) => {
            console.error('[Agent] Upload complete error:', err);
            this.send({
              type: 'file:error',
              payload: { code: err.message, message: err.message, path: filePath },
              timestamp: Date.now(),
            });
          })
          .finally(() => {
            this.uploadSessions.delete(filePath);
          });
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[Agent] Upload chunk error:', error);
      this.send({
        type: 'file:error',
        payload: { code: error.message, message: error.message, path: filePath },
        timestamp: Date.now(),
      });
      this.uploadSessions.delete(filePath);
    }
  }

  private send(message: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}