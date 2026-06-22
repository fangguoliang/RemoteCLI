// packages/shared/src/voice-types.ts

// === 上行消息（浏览器 → Server）===

export interface VoiceStartPayload {
  sampleRate: number;
}

export interface VoiceAudioPayload {
  chunk: ArrayBuffer;   // 二进制 PCM 数据（性能优化：替代 base64）
  seq: number;
}

export interface VoiceVadStatePayload {
  speaking: boolean;
  reason?: 'silence' | 'manual';
}

// === 下行消息（Server → 浏览器）===

export interface VoiceInterimPayload {
  text: string;
}

export interface VoiceFinalPayload {
  text: string;
}

export interface VoiceActionPayload {
  action_id: string;
  params?: Record<string, unknown>;
  feedback_tts?: string;
  explanation?: string;
  needs_confirm?: boolean;
}

export interface VoiceModePayload {
  mode: 'command' | 'input';
  message?: string;
}

export interface VoiceTtsPayload {
  audio: ArrayBuffer;   // 二进制 MP3 数据（性能优化：替代 base64）
  format: 'mp3';
}

export interface VoiceErrorPayload {
  code: string;
  message: string;
}

// === Server ↔ Agent ===

export interface VoiceInterpretPayload {
  text: string;
  context: {
    terminal_type: string;
    os: string;
    cwd: string;
    action_map?: unknown;
  };
}

export interface VoiceActionResultPayload {
  action_id: string;
  params?: Record<string, unknown>;
  dangerous: boolean;
  explanation?: string;
}

export interface VoiceInterpretErrorPayload {
  code: string;
  message: string;
}

// === UI 状态同步 ===

export interface UIStateSyncPayload {
  currentView: string;
  activeTabId: string;
  terminalType: string;
  cwd: string;
  claudeIsStreaming: boolean;
  tabCount: number;
}

// === Action Map ===

export interface ActionMapEntry {
  id: string;
  description: string;
  category: string;
  params: Record<string, { type: string; description?: string; values?: string[] }>;
  available_when: string;
}

export interface ActionMap {
  version: string;
  generated_at: string;
  actions: ActionMapEntry[];
}
