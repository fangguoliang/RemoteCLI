// packages/web/src/services/voiceWebSocket.ts
import { useVoiceStore } from '../stores/voice';
import { useAudioPlayer } from '../composables/useAudioPlayer';

// 终端 WebSocket 复用（当有终端会话时）
let terminalWs: WebSocket | null = null;
// 独立语音连接（当没有终端会话时）
let standaloneVoiceWs: WebSocket | null = null;
let standaloneVoiceAgentId: string | null = null;  // 记录当前连接的 agentId
let audioPlayer: ReturnType<typeof useAudioPlayer> | null = null;

// 返回当前活跃的语音 WebSocket
function getActiveVoiceWs(): WebSocket | null {
  if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
    return terminalWs;
  }
  if (standaloneVoiceWs && standaloneVoiceWs.readyState === WebSocket.OPEN) {
    return standaloneVoiceWs;
  }
  return null;
}

export function isVoiceWebSocketReady(): boolean {
  return getActiveVoiceWs() !== null;
}

// 终端标签页调用：复用终端 WebSocket 用于语音
export function initVoiceWebSocket(ws: WebSocket) {
  console.log('[Voice WS] initVoiceWebSocket called, ws readyState:', ws.readyState);
  terminalWs = ws;
  audioPlayer = useAudioPlayer();

  ws.addEventListener('message', (event) => {
    if (event.data instanceof ArrayBuffer || typeof event.data === 'string') {
      handleVoiceEvent(event);
    }
  });

  ws.addEventListener('close', () => {
    if (terminalWs === ws) {
      terminalWs = null;
    }
  });
}

// 终端标签页卸载时调用：立即清除 terminalWs 引用，避免录音时路由到已关闭的连接
export function clearTerminalVoiceWebSocket() {
  if (terminalWs) {
    console.log('[Voice WS] clearTerminalVoiceWebSocket: clearing terminal WS reference');
    terminalWs = null;
  }
}

// App 级别调用：创建独立语音 WebSocket（无需终端会话）
// 当 agentId 变化时需要重新创建连接（因为服务器端的 voice session 绑定了 agentId）
export function initAppVoiceConnection(userId: string, agentId?: string) {
  const normalizedAgentId = agentId || null;

  // 如果连接已打开且 agentId 没变，跳过
  if (standaloneVoiceWs && standaloneVoiceWs.readyState === WebSocket.OPEN && standaloneVoiceAgentId === normalizedAgentId) {
    console.log('[Voice WS] Standalone voice WS already active with same agentId, skip');
    return;
  }

  // agentId 变了（从 null 变成有值，或从一个 agent 切换到另一个），需要重连
  if (standaloneVoiceWs && standaloneVoiceAgentId !== normalizedAgentId) {
    console.log('[Voice WS] agentId changed:', standaloneVoiceAgentId, '->', normalizedAgentId, ', recreating');
    try { standaloneVoiceWs.close(); } catch {}
    standaloneVoiceWs = null;
  }

  const apiUrl = (window as any).__SETTINGS__?.apiUrl || '';
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = apiUrl
    ? apiUrl.replace(/^http/, 'ws') + '/ws/browser'
    : `${wsProtocol}//${window.location.host}/ws/browser`;

  console.log('[Voice WS] Creating standalone voice connection to:', wsUrl, 'agentId:', normalizedAgentId);
  const ws = new WebSocket(wsUrl);
  standaloneVoiceWs = ws;
  standaloneVoiceAgentId = normalizedAgentId;
  audioPlayer = audioPlayer || useAudioPlayer();

  ws.onopen = () => {
    console.log('[Voice WS] Standalone voice WS opened, sending auth with agentId:', normalizedAgentId);
    ws.send(JSON.stringify({
      type: 'auth',
      payload: { userId, agentId: normalizedAgentId || '' },
      timestamp: Date.now(),
    }));
  };

  ws.onmessage = (event) => {
    // 只处理独立连接的消息（避免重复处理）
    if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
      return; // 终端连接优先
    }
    handleVoiceEvent(event);
  };

  ws.onclose = () => {
    console.log('[Voice WS] Standalone voice WS closed');
    if (standaloneVoiceWs === ws) {
      standaloneVoiceWs = null;
      standaloneVoiceAgentId = null;
    }
  };

  ws.onerror = (err) => {
    console.error('[Voice WS] Standalone voice WS error:', err);
  };
}

function handleVoiceEvent(event: MessageEvent) {
  if (typeof event.data === 'string') {
    try {
      const msg = JSON.parse(event.data);
      handleVoiceMessage(msg);
    } catch { /* not JSON */ }
  } else if (event.data instanceof ArrayBuffer) {
    handleBinaryTtsMessage(event.data);
  }
}

function handleVoiceMessage(msg: any) {
  const voiceStore = useVoiceStore();

  switch (msg.type) {
    case 'voice:interim':
      voiceStore.setInterimText(msg.payload.text);
      break;

    case 'voice:final':
      // 保存最终识别文本（用于关闭面板后再次打开时显示）
      voiceStore.setInterimText(msg.payload.text);
      voiceStore.setLastRecognizedText(msg.payload.text);
      // 只在执行模式下检查快捷方式命令
      if (voiceStore.mode === 'command') {
        handleShortcutCommand(msg.payload.text);
      }
      break;

    case 'voice:action':
      // 输入模式下不处理 UI 动作
      if (voiceStore.mode === 'input') {
        console.log('[Voice WS] Ignoring voice:action in input mode');
        break;
      }
      if (msg.payload.needs_confirm) {
        voiceStore.requestConfirm(
          msg.payload.action_id,
          msg.payload.explanation || '此操作可能存在风险,是否继续?'
        ).then(confirmed => {
          if (confirmed) {
            handleUIAction(msg.payload);
          }
        });
      } else {
        handleUIAction(msg.payload);
      }
      break;

    case 'voice:mode':
      if (msg.payload.mode === 'input') {
        voiceStore.switchToInputMode();
      } else {
        voiceStore.switchToCommandMode();
      }
      break;

    case 'voice:tts':
      break;

    case 'voice:error':
      voiceStore.setError(msg.payload.message);
      break;

    case 'voice:clear-error':
      voiceStore.clearError();
      break;
  }
}

function handleBinaryTtsMessage(data: ArrayBuffer) {
  if (!audioPlayer) return;

  const bytes = new Uint8Array(data);
  const separatorIndex = Array.from(bytes).indexOf(0x00);

  if (separatorIndex === -1) {
    console.error('Invalid binary TTS message: no separator found');
    return;
  }

  const audioData = bytes.subarray(separatorIndex + 1);
  const binary = String.fromCharCode(...audioData);
  const base64 = btoa(binary);
  audioPlayer.enqueue(base64);
}

// 处理快捷方式语音命令（本地匹配，不经过服务器）
function handleShortcutCommand(text: string) {
  // 检查是否包含快捷方式相关词
  if (!text.match(/快捷方式|shortcut/i)) return;

  import('../stores/terminal').then(({ useTerminalStore }) => {
    const terminalStore = useTerminalStore();
    const shortcuts = terminalStore.shortcuts;
    if (!shortcuts || shortcuts.length === 0) {
      console.log('[Voice] No shortcuts available');
      return;
    }

    let targetShortcut = null;

    // 匹配"第N个快捷方式"
    const indexMatch = text.match(/第\s*(\d+|一|二|三|四|五|六|七|八|九|十)\s*(个)?\s*快捷/);
    if (indexMatch) {
      const numStr = indexMatch[1];
      const numMap: Record<string, number> = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
        '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
      };
      const index = numMap[numStr] || parseInt(numStr, 10);
      if (index >= 1 && index <= shortcuts.length) {
        targetShortcut = shortcuts[index - 1];
      }
    }

    // 匹配快捷方式名称
    if (!targetShortcut) {
      for (const shortcut of shortcuts) {
        if (text.includes(shortcut.name)) {
          targetShortcut = shortcut;
          break;
        }
      }
    }

    if (targetShortcut) {
      console.log('[Voice] Executing shortcut:', targetShortcut.name);
      // 导航到终端页面
      import('../router').then(({ default: router }) => {
        router.push('/terminal');
      });
      // 创建新终端并执行快捷方式命令
      const onlineAgent = terminalStore.agents.find(a => a.online);
      if (onlineAgent) {
        const now = Date.now();
        const tabId = 'tab-' + now + '-' + Math.random().toString(36).substr(2, 9);
        terminalStore.addTab({
          id: tabId,
          title: targetShortcut.name,
          agentId: onlineAgent.agentId,
          createdAt: now,
          autoExecuteCommands: targetShortcut.commands,
        });
      }
    } else {
      console.log('[Voice] No matching shortcut found for:', text);
    }
  });
}

function handleUIAction(payload: any) {
  const { action_id } = payload;

  if (action_id.startsWith('navigate_')) {
    const view = action_id.replace('navigate_', '');
    import('../router').then(({ default: router }) => {
      const routeMap: Record<string, string> = {
        'file_view': '/files',
        'terminal': '/terminal',
        'settings': '/settings',
      };
      const path = routeMap[view];
      if (path) router.push(path);
    });
  } else if (action_id === 'session:create' || action_id === 'session_create') {
    // 创建新终端会话
    import('../stores/terminal').then(({ useTerminalStore }) => {
      const terminalStore = useTerminalStore();
      const onlineAgent = terminalStore.agents.find(a => a.online);
      if (!onlineAgent) {
        console.warn('[Voice] No online agents available');
        // 导航到终端页面让用户选择
        import('../router').then(({ default: router }) => {
          router.push('/terminal');
        });
        return;
      }
      const now = Date.now();
      const tabId = 'tab-' + now + '-' + Math.random().toString(36).substr(2, 9);
      terminalStore.addTab({
        id: tabId,
        title: 'Terminal ' + new Date(now).toLocaleTimeString(),
        agentId: onlineAgent.agentId,
        createdAt: now,
      });
      // 导航到终端页面
      import('../router').then(({ default: router }) => {
        router.push('/terminal');
      });
    });
  } else if (action_id === 'session:close' || action_id === 'session_close') {
    // 关闭当前终端会话
    import('../stores/terminal').then(({ useTerminalStore }) => {
      const terminalStore = useTerminalStore();
      if (terminalStore.activeTabId) {
        terminalStore.removeTab(terminalStore.activeTabId);
      }
    });
  }
}

function getWs(): WebSocket | null {
  return getActiveVoiceWs();
}

export function sendVoiceStart(sampleRate: number) {
  const ws = getWs();
  console.log('[Voice WS] Sending voice:start, sampleRate:', sampleRate, 'ws state:', ws?.readyState);
  ws?.send(JSON.stringify({ type: 'voice:start', payload: { sampleRate }, timestamp: Date.now() }));
}

export function sendVoiceAudio(chunk: Uint8Array, seq: number) {
  const ws = getWs();
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (seq === 0) {
      console.log('[Voice WS] Sending first audio chunk, size:', chunk.length);
    }
    const buffer = new ArrayBuffer(4 + chunk.length);
    const view = new DataView(buffer);
    view.setUint32(0, seq, true);
    new Uint8Array(buffer, 4).set(chunk);
    ws.send(buffer);
  } else {
    console.warn('[Voice WS] Cannot send audio, ws state:', ws?.readyState);
  }
}

export function sendVoiceVadState(speaking: boolean, reason?: 'silence' | 'manual') {
  const ws = getWs();
  ws?.send(JSON.stringify({
    type: 'voice:vad-state',
    payload: { speaking, reason },
    timestamp: Date.now(),
  }));
}

export function sendVoiceEnd() {
  const ws = getWs();
  ws?.send(JSON.stringify({ type: 'voice:end', payload: {}, timestamp: Date.now() }));
}

export function sendVoiceSend() {
  const ws = getWs();
  ws?.send(JSON.stringify({ type: 'voice:send', payload: {}, timestamp: Date.now() }));
}

export function sendVoiceModeChange(mode: 'command' | 'input') {
  const ws = getWs();
  console.log('[Voice WS] Sending voice:mode-change, mode:', mode);
  ws?.send(JSON.stringify({ type: 'voice:mode-change', payload: { mode }, timestamp: Date.now() }));
}

export function sendActiveTerminalSession(sessionId: string | null) {
  const ws = getWs();
  if (ws) {
    console.log('[Voice WS] Sending voice:active-session, sessionId:', sessionId);
    ws.send(JSON.stringify({ type: 'voice:active-session', payload: { sessionId }, timestamp: Date.now() }));
  }
}

export function sendUIStateSync(state: any) {
  const ws = getWs();
  ws?.send(JSON.stringify({ type: 'ui:state-sync', payload: state, timestamp: Date.now() }));
}
