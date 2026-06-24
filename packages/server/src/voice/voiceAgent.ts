// packages/server/src/voice/voiceAgent.ts
import { STTService } from './stt.js';
import { TTSService } from './tts.js';
import { CommandDictionary } from './commandDictionary.js';
import { ActionExecutor } from './actionExecutor.js';
import { LLMService } from './llmService.js';
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
  private llmService: LLMService;
  private actionMap: ActionMap | null = null;
  private config: VoiceConfig;

  constructor(config: VoiceConfig) {
    this.config = config;
    this.tts = new TTSService({ voice: config.tts.voice, rate: config.tts.rate });
    this.dictionary = new CommandDictionary();
    this.dictionary.load();
    this.executor = new ActionExecutor();

    // 初始化服务器端 LLM 服务（作为 agent 不可用时的后备）
    console.log(`[VoiceAgent] Initializing LLM service with provider: ${config.llm?.provider || 'none'}`);
    this.llmService = new LLMService({
      provider: config.llm?.provider || 'none',
      apiUrl: config.llm?.apiUrl,
      apiKey: config.llm?.apiKey,
      model: config.llm?.model,
      baiduApiKey: config.llm?.baiduApiKey || config.stt.apiKey,
      baiduSecretKey: config.llm?.baiduSecretKey || config.stt.secretKey,
    });
    console.log(`[VoiceAgent] LLM service initialized`);
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
      activeTerminalSessionId: null,
      uiState: null,
    };
    this.sessions.set(browserWs, session);
    this.wsToSessionId.set(browserWs, sessionId);
    this.sessionIdToWs.set(sessionId, browserWs);
    return session;
  }

  setActiveTerminalSessionId(browserWs: import('ws').WebSocket, sessionId: string | null) {
    const session = this.sessions.get(browserWs);
    if (session) {
      session.activeTerminalSessionId = sessionId;
      console.log(`[VoiceAgent] Active terminal session updated: ${sessionId}`);
    }
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
      console.log(`[VoiceAgent] STT result: "${text}"`);
      this.sendToBrowser(browserWs, {
        type: 'voice:final',
        payload: { text },
        timestamp: Date.now(),
      });

      // Input mode: send text directly to terminal without any matching
      if (session.mode === 'input') {
        console.log(`[VoiceAgent] Input mode: sending text directly to terminal`);
        if (session.agentId) {
          tunnelManager.routeToAgent(session.agentId, {
            type: 'session:input',
            sessionId: this.getTerminalSessionId(browserWs),
            payload: { data: text + '\n' },
            timestamp: Date.now(),
          });
        }
        session.state = 'idle';
        return;
      }

      // Command dictionary (fast path)
      const dictMatch = this.dictionary.match(text);
      console.log(`[VoiceAgent] Dictionary match:`, dictMatch);
      if (dictMatch) {
        console.log(`[VoiceAgent] Executing dictionary action: ${dictMatch.action_id}`);
        await this.executeAndRespond(browserWs, session, dictMatch.action_id, dictMatch.params as Record<string, unknown>);
        return;
      }

      // 服务器端 LLM 服务（从 action_map 中选择最匹配的 UI 操作）
      console.log(`[VoiceAgent] Calling LLM service for: "${text}"`);
      console.log(`[VoiceAgent] LLM service provider: ${this.llmService ? 'initialized' : 'NOT initialized'}`);
      const llmMatch = await this.llmService.interpretVoiceCommand(text);
      console.log(`[VoiceAgent] LLM service result:`, JSON.stringify(llmMatch));
      if (llmMatch && llmMatch.action_id) {
        console.log(`[VoiceAgent] LLM service matched: ${llmMatch.action_id}`);
        await this.executeAndRespond(browserWs, session, llmMatch.action_id, llmMatch.params);
        return;
      }

      // Fallback: if no match and we have an agent, send text directly to terminal
      // This is useful when Claude Code is running and user wants to send arbitrary text
      if (session.agentId) {
        console.log(`[VoiceAgent] No match, sending text directly to terminal as fallback`);
        tunnelManager.routeToAgent(session.agentId, {
          type: 'session:input',
          sessionId: this.getTerminalSessionId(browserWs),
          payload: { data: text + '\n' },
          timestamp: Date.now(),
        });
        session.state = 'idle';
        return;
      }

      // Forward to Agent for LLM interpretation (terminal commands, complex cases)
      console.log(`[VoiceAgent] No dictionary/LLM match, forwarding to Agent's Claude Code`);
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
    console.log(`[VoiceAgent] executeAndRespond called: actionId=${actionId}, params=${JSON.stringify(params)}`);
    const resolved = this.executor.resolve({ action_id: actionId, params });
    console.log(`[VoiceAgent] Resolved action type: ${resolved.type}, data: ${resolved.data}`);

    switch (resolved.type) {
      case 'terminal':
        // 需要 agent 才能执行终端命令
        if (!session.agentId) {
          console.warn('[VoiceAgent] Cannot execute terminal command: no agent bound');
          this.sendToBrowser(browserWs, {
            type: 'voice:error',
            payload: { code: 'no_agent', message: '请先打开一个终端会话再执行终端命令' },
            timestamp: Date.now(),
          });
          break;
        }
        // Send terminal command or enter key
        if (resolved.data !== undefined) {
          // Send Enter first to clear any pending input, then send the command
          const dataToSend = '\r' + resolved.data + '\r';  // \r = Enter
          console.log(`[VoiceAgent] Sending to terminal: "${resolved.data}" (with Enter prefix)`);
          tunnelManager.routeToAgent(session.agentId, {
            type: 'session:input',
            sessionId: this.getTerminalSessionId(browserWs),
            payload: { data: dataToSend },
            timestamp: Date.now(),
          });
        }
        break;

      case 'ui_navigation':
        console.log(`[VoiceAgent] Sending ui_navigation action to browser: ${actionId}`);
        this.sendToBrowser(browserWs, {
          type: 'voice:action',
          payload: { action_id: actionId, params },
          timestamp: Date.now(),
        });
        console.log(`[VoiceAgent] ui_navigation message sent`);
        break;

      case 'claude_input':
        if (!session.agentId) {
          console.warn('[VoiceAgent] Cannot send Claude input: no agent bound');
          this.sendToBrowser(browserWs, {
            type: 'voice:error',
            payload: { code: 'no_agent', message: '请先打开一个终端会话' },
            timestamp: Date.now(),
          });
          break;
        }
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
    // LLM 解读需要 agent 才能路由
    if (!session.agentId) {
      console.warn('[VoiceAgent] Cannot request LLM interpretation: no agent bound');
      this.sendToBrowser(browserWs, {
        type: 'voice:error',
        payload: { code: 'no_agent', message: '无法理解该命令，请先打开一个终端会话' },
        timestamp: Date.now(),
      });
      return;
    }
    console.log(`[VoiceAgent] Requesting LLM interpretation for: "${text}"`);
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
    const session = this.sessions.get(browserWs);
    // Use the active terminal session ID tracked from frontend
    if (session?.activeTerminalSessionId) {
      return session.activeTerminalSessionId;
    }
    // Fallback to browser's bound session
    const browser = tunnelManager.getBrowser(browserWs);
    return browser?.sessionId || null;
  }

  private sendToBrowser(browserWs: import('ws').WebSocket, message: unknown) {
    if (browserWs.readyState === 1) {
      browserWs.send(typeof message === 'string' ? message : JSON.stringify(message));
    }
  }
}
