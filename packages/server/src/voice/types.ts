// packages/server/src/voice/types.ts
export interface VoiceSession {
  browserWs: import('ws').WebSocket;
  agentId: string;
  mode: 'command' | 'input';
  inputBuffer: string;
  state: 'idle' | 'recording' | 'processing';
  stt: import('./stt.js').STTService;
  uiState: {
    currentView: string;
    activeTabId: string;
    terminalType: string;
    cwd: string;
    claudeIsStreaming: boolean;
    tabCount: number;
  } | null;
}

export interface VoiceConfig {
  stt: {
    provider: string;
    appId: string;
    apiKey: string;
    secretKey: string;
  };
  tts: {
    provider: string;
    voice: string;
    rate: string;
  };
  llm: {
    timeout_ms: number;
    max_retries: number;
  };
  vad: {
    command_silence_ms: number;
    terminal_command_silence_ms: number;
  };
}
