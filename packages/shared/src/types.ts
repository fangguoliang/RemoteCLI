// packages/shared/src/types.ts

// WebSocket 消息类型
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
  | 'file:error'
  | 'file:validate'
  | 'file:validated'
  | 'http:request'      // HTTP proxy request
  | 'http:response'     // HTTP proxy response
  // Voice types
  | 'voice:start'
  | 'voice:audio'
  | 'voice:vad-state'
  | 'voice:end'
  | 'voice:send'
  | 'voice:cancel'
  | 'voice:interim'
  | 'voice:final'
  | 'voice:action'
  | 'voice:mode'
  | 'voice:tts'
  | 'voice:error'
  | 'voice:interpret'
  | 'voice:action-result'
  | 'voice:interpret-error'
  | 'ui:state-sync'
  | 'file:create'
  | 'file:create:result'
  | 'file:rename'
  | 'file:rename:result'
  | 'file:delete'
  | 'file:delete:result';

export interface Message {
  type: MessageType;
  payload: unknown;
  sessionId?: string;
  timestamp: number;
}

// 认证相关
export interface AuthPayload {
  username: string;
  password: string;
}

export interface AuthResultPayload {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
}

// Agent 注册
export interface RegisterPayload {
  agentId: string;
  username?: string;
  secret: string;
  name?: string;
}

// 会话相关
export interface SessionStartPayload {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface SessionInputPayload {
  data: string;
}

export interface SessionOutputPayload {
  data: string;
}

export interface SessionResizePayload {
  cols: number;
  rows: number;
}

// 用户配置
export interface TerminalSettings {
  theme: 'dark' | 'light';
  fontFamily: string;
  fontSize: number;
}

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

// 文件路径验证 (用于终端 Markdown 查看器)
export interface FileValidatePayload {
  path: string;        // 检测到的路径 (可能是相对路径)
}

export interface FileValidatedPayload {
  originalPath: string;    // 原始检测到的路径
  resolvedPath: string;    // 解析后的完整路径
  exists: boolean;         // 文件是否存在
  error?: string;          // 验证失败时的错误信息
}

// File create/rename/delete types
export interface FileCreatePayload {
  dirPath: string;
  name: string;
}

export interface FileCreateResultPayload {
  success: boolean;
  error?: string;
  path?: string;
}

export interface FileRenamePayload {
  oldPath: string;
  newName: string;
}

export interface FileRenameResultPayload {
  success: boolean;
  error?: string;
}

export interface FileDeletePayload {
  path: string;
  isDirectory: boolean;
}

export interface FileDeleteResultPayload {
  success: boolean;
  error?: string;
}

// HTTP Proxy 相关类型
export interface HttpRequestPayload {
  requestId: string;      // Unique request ID for response matching
  url: string;            // Target URL (e.g., http://localhost:3000/api/data)
  method: string;         // HTTP method (GET, POST, PUT, DELETE)
  headers?: Record<string, string | string[]>;  // Request headers (supports multi-value)
  body?: string;          // Request body (base64 encoded, for POST/PUT)
}

export interface HttpResponsePayload {
  requestId: string;      // Request ID for matching
  status: number;         // HTTP status code (200, 404, 500, etc.)
  headers: Record<string, string | string[]>;  // Response headers (supports multi-value like Set-Cookie)
  body: string;           // Response body (base64 encoded)
  error?: string;         // Error message if request failed
}