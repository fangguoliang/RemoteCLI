// packages/server/src/__tests__/voiceAgent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceAgentManager } from '../voice/voiceAgent.js';
import { WebSocket } from 'ws';

describe('VoiceAgentManager', () => {
  let manager: VoiceAgentManager;
  const mockConfig = {
    stt: { provider: 'baidu', appId: 'test-app-id', apiKey: 'test', secretKey: 'test-secret' },
    tts: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural', rate: '+10%' },
    llm: { timeout_ms: 10000, max_retries: 2 },
    vad: { command_silence_ms: 800, terminal_command_silence_ms: 1200 },
  };

  beforeEach(() => {
    manager = new VoiceAgentManager(mockConfig);
  });

  describe('Session Management', () => {
    it('should create session with independent STT instance', () => {
      const mockWs = { readyState: 1 } as any;
      const session = manager.createSession(mockWs, 'agent-1');

      expect(session).toBeDefined();
      expect(session.stt).toBeDefined();
      expect(session.agentId).toBe('agent-1');
      expect(session.uiState).toBeNull();
    });

    it('should create separate STT instances for each session', () => {
      const ws1 = { readyState: 1 } as any;
      const ws2 = { readyState: 1 } as any;

      const session1 = manager.createSession(ws1, 'agent-1');
      const session2 = manager.createSession(ws2, 'agent-1');

      expect(session1.stt).not.toBe(session2.stt);
    });

    it('should remove session', () => {
      const mockWs = { readyState: 1 } as any;
      manager.createSession(mockWs, 'agent-1');
      manager.removeSession(mockWs);

      expect(manager.getSession(mockWs)).toBeUndefined();
    });
  });

  describe('UI State Management', () => {
    it('should update UI state for session', () => {
      const mockWs = { readyState: 1 } as any;
      const session = manager.createSession(mockWs, 'agent-1');

      const uiState = {
        currentView: 'terminal',
        activeTabId: 'tab-1',
        terminalType: 'powershell',
        cwd: 'C:\\Users\\test',
        claudeIsStreaming: false,
        tabCount: 2,
      };

      manager.updateUIState(mockWs, uiState);
      expect(session.uiState).toEqual(uiState);
    });
  });

  describe('Audio Processing', () => {
    it('should accumulate audio chunks in session STT', async () => {
      const mockWs = { readyState: 1 } as any;
      const session = manager.createSession(mockWs, 'agent-1');

      const chunk1 = Buffer.alloc(1600);
      const chunk2 = Buffer.alloc(1600);

      await manager.handleAudioChunk(mockWs, chunk1);
      await manager.handleAudioChunk(mockWs, chunk2);

      expect(session.stt.getBufferSize()).toBe(3200);
    });
  });
});
