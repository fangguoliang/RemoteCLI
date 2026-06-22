// packages/server/src/voice/voiceAgent.ts
import { STTService } from './stt.js';
import { TTSService } from './tts.js';
import { CommandDictionary } from './commandDictionary.js';
import { ActionExecutor } from './actionExecutor.js';
import type { VoiceSession, VoiceConfig } from './types.js';
import type { ActionMap } from '@remotecli/shared';
import { tunnelManager } from '../ws/tunnel.js';
import crypto from 'crypto';

export class VoiceAgentManager {
  private sessions = new Map<import('ws').WebSocket, VoiceSession>();
  private wsToSessionId = new WeakMap<import('ws').WebSocket, string>();
  private sessionIdToWs = new Map<string, import('ws').WebSocket>();
  private tts: TTSService;
  private dictionary: CommandDictionary;
  private executor: ActionExecutor;
  private actionMap: ActionMap | null = null;
  private config: VoiceConfig;

  constructor(config: VoiceConfig) {
    this.config = config;
    this.tts = new TTSService({ voice: config.tts.voice, rate: config.tts.rate });
    this.dictionary = new CommandDictionary();
    this.dictionary.load();
    this.executor = new ActionExecutor();
  }

  setActionMap(actionMap: ActionMap) {
    this.actionMap = actionMap;
  }

  updateUIState(browserWs: import('ws').WebSocket, uiState: VoiceSession['uiState']) {
    const session = this.sessions.get(browserWs);
    if (session) {
      session.uiState = uiState;
    }
  }

  createSession(browserWs: import('ws').WebSocket, agentId: string): VoiceSession {
    const sessionId = crypto.randomUUID();
    const session: VoiceSession = {
      browserWs,
      agentId,
      mode: 'command',
      inputBuffer: '',
      state: 'idle',
      stt: new STTService({
        appId: this.config.stt.appId,
        apiKey: this.config.stt.apiKey,
        secretKey: this.config.stt.secretKey,
      }),
      uiState: null,
    };
    this.sessions.set(browserWs, session);
    this.wsToSessionId.set(browserWs, sessionId);
    this.sessionIdToWs.set(sessionId, browserWs);
    return session;
  }

  removeSession(browserWs: import('ws').WebSocket) {
    const sessionId = this.wsToSessionId.get(browserWs);
    if (sessionId) {
      this.sessionIdToWs.delete(sessionId);
    }
    this.sessions.delete(browserWs);
  }

  getSession(browserWs: import('ws').WebSocket): VoiceSession | undefined {
    return this.sessions.get(browserWs);
  }

  async handleAudioChunk(browserWs: import('ws').WebSocket, chunk: Buffer) {
    const session = this.sessions.get(browserWs);
    if (!session) return;

    session.stt.addChunk(chunk);
  }

  async handleVadEnd(browserWs: import('ws').WebSocket) {
    const session = this.sessions.get(browserWs);
    if (!session) return;

    session.state = 'processing';

    try {
      // STT
      const text = await session.stt.transcribeBuffer();
      if (!text) {
        session.state = 'idle';
        return;
      }

      // Send final result
      this.sendToBrowser(browserWs, {
        type: 'voice:final',
        payload: { text },
        timestamp: Date.now(),
      });

      // Command dictionary (fast path)
      const dictMatch = this.dictionary.match(text);
      if (dictMatch) {
        await this.executeAndRespond(browserWs, session, dictMatch.action_id, dictMatch.params as Record<string, unknown>);
        return;
      }

      // Forward to Agent for LLM interpretation
      const sessionId = this.wsToSessionId.get(browserWs);
      await this.requestLLMInterpretation(browserWs, session, text, sessionId || '');
    } catch (err) {
      console.error('Voice processing error:', err);
      this.sendToBrowser(browserWs, {
        type: 'voice:error',
        payload: { code: 'processing_error', message: '语音处理失败' },
        timestamp: Date.now(),
      });
      session.state = 'idle';
    }
  }

  async handleActionResult(browserWs: import('ws').WebSocket, result: {
    action_id: string;
    params?: Record<string, unknown>;
    dangerous: boolean;
    explanation?: string;
  }) {
    const session = this.sessions.get(browserWs);
    if (!session) return;

    if (result.dangerous) {
      this.sendToBrowser(browserWs, {
        type: 'voice:action',
        payload: {
          action_id: result.action_id,
          params: result.params,
          explanation: result.explanation,
          feedback_tts: '检测到危险操作，请在界面上确认',
          needs_confirm: true,
        },
        timestamp: Date.now(),
      });
    } else {
      await this.executeAndRespond(browserWs, session, result.action_id, result.params);
    }

    session.state = 'idle';
  }

  routeToOriginatingBrowser(voiceSessionId: string, message: any) {
    const ws = this.sessionIdToWs.get(voiceSessionId);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }

  private async executeAndRespond(
    browserWs: import('ws').WebSocket,
    session: VoiceSession,
    actionId: string,
    params?: Record<string, unknown>,
  ) {
    const resolved = this.executor.resolve({ action_id: actionId, params });

    switch (resolved.type) {
      case 'terminal':
        if (resolved.data) {
          tunnelManager.routeToAgent(session.agentId, {
            type: 'session:input',
            sessionId: this.getTerminalSessionId(browserWs),
            payload: { data: resolved.data + '\n' },
            timestamp: Date.now(),
          });
        }
        break;

      case 'ui_navigation':
        this.sendToBrowser(browserWs, {
          type: 'voice:action',
          payload: { action_id: actionId, params },
          timestamp: Date.now(),
        });
        break;

      case 'claude_input':
        if (resolved.data) {
          tunnelManager.routeToAgent(session.agentId, {
            type: 'session:input',
            sessionId: this.getTerminalSessionId(browserWs),
            payload: { data: resolved.data + '\n' },
            timestamp: Date.now(),
          });
        }
        break;
    }

    // TTS feedback
    const ttsText = this.getTtsFeedback(actionId, resolved.type);
    if (ttsText) {
      const audio = await this.tts.synthesize(ttsText);
      if (audio.length > 0) {
        const binaryMsg = Buffer.concat([
          Buffer.from(JSON.stringify({
            type: 'voice:tts',
            payload: { format: 'mp3' },
            timestamp: Date.now(),
          })),
          Buffer.from([0x00]),
          audio,
        ]);
        this.sendToBrowser(browserWs, binaryMsg);
      }
    }

    session.state = 'idle';
  }

  private async requestLLMInterpretation(
    browserWs: import('ws').WebSocket,
    session: VoiceSession,
    text: string,
    voiceSessionId: string,
  ) {
    const terminalType = session.uiState?.terminalType || 'powershell';
    const os = terminalType === 'powershell' ? 'windows' : 'linux';
    const cwd = session.uiState?.cwd || '';

    tunnelManager.routeToAgent(session.agentId, {
      type: 'voice:interpret',
      payload: {
        text,
        voiceSessionId,
        context: {
          terminal_type: terminalType,
          os: os,
          cwd: cwd,
          action_map: this.actionMap,
        },
      },
      timestamp: Date.now(),
    });
  }

  private getTtsFeedback(actionId: string, type: string): string | null {
    if (type === 'ui_navigation') {
      const feedbackMap: Record<string, string> = {
        'navigate_file_view': '已打开文件管理器',
        'navigate_terminal': '已切换到终端',
        'navigate_settings': '已打开设置',
      };
      return feedbackMap[actionId] || null;
    }
    return null;
  }

  private getTerminalSessionId(browserWs: import('ws').WebSocket): string | null {
    const browser = tunnelManager.getBrowser(browserWs);
    return browser?.sessionId || null;
  }

  private sendToBrowser(browserWs: import('ws').WebSocket, message: unknown) {
    if (browserWs.readyState === 1) {
      browserWs.send(typeof message === 'string' ? message : JSON.stringify(message));
    }
  }
}
