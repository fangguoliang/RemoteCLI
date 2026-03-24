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
  | 'file:error';

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