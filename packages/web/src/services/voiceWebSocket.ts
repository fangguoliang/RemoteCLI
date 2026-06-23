// packages/web/src/services/voiceWebSocket.ts
import { useVoiceStore } from '../stores/voice';
import { useAudioPlayer } from '../composables/useAudioPlayer';

let ws: WebSocket | null = null;
let audioPlayer: ReturnType<typeof useAudioPlayer> | null = null;

export function initVoiceWebSocket(terminalWs: WebSocket) {
  ws = terminalWs;
  audioPlayer = useAudioPlayer();

  // 处理文本消息（JSON 控制消息）
  terminalWs.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data);
        handleVoiceMessage(msg);
      } catch { /* not JSON */ }
    } else if (event.data instanceof ArrayBuffer) {
      // 性能优化：处理二进制 TTS 消息
      handleBinaryTtsMessage(event.data);
    }
  });
}

function handleVoiceMessage(msg: any) {
  const voiceStore = useVoiceStore();

  switch (msg.type) {
    case 'voice:interim':
      voiceStore.setInterimText(msg.payload.text);
      break;

    case 'voice:final':
      voiceStore.setInterimText(msg.payload.text);
      break;

    case 'voice:action':
      if (msg.payload.needs_confirm) {
        // 危险操作: 弹出确认对话框而非直接执行
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
      // 注意：TTS 音频现在通过二进制消息接收，不在这里处理
      break;

    case 'voice:error':
      voiceStore.setError(msg.payload.message);
      break;

    case 'voice:clear-error':
      voiceStore.clearError();
      break;
  }
}

// 性能优化：处理二进制 TTS 消息
function handleBinaryTtsMessage(data: ArrayBuffer) {
  if (!audioPlayer) return;

  // 二进制消息格式：[JSON header][0x00 separator][MP3 audio]
  const bytes = new Uint8Array(data);
  const separatorIndex = Array.from(bytes).indexOf(0x00);

  if (separatorIndex === -1) {
    console.error('Invalid binary TTS message: no separator found');
    return;
  }

  // 提取音频数据（分隔符之后）
  const audioData = bytes.subarray(separatorIndex + 1);

  // 转换为 base64 以便 enqueue 处理
  const binary = String.fromCharCode(...audioData);
  const base64 = btoa(binary);
  audioPlayer.enqueue(base64);
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
  }
}

export function sendVoiceStart(sampleRate: number) {
  ws?.send(JSON.stringify({ type: 'voice:start', payload: { sampleRate }, timestamp: Date.now() }));
}

export function sendVoiceAudio(chunk: Uint8Array, seq: number) {
  // 性能优化：发送二进制帧而非 base64
  if (ws && ws.readyState === WebSocket.OPEN) {
    // 创建二进制消息：[seq(4 bytes)][audio data]
    const buffer = new ArrayBuffer(4 + chunk.length);
    const view = new DataView(buffer);
    view.setUint32(0, seq, true); // little-endian
    new Uint8Array(buffer, 4).set(chunk);
    ws.send(buffer);
  }
}

export function sendVoiceVadState(speaking: boolean, reason?: 'silence' | 'manual') {
  ws?.send(JSON.stringify({
    type: 'voice:vad-state',
    payload: { speaking, reason },
    timestamp: Date.now(),
  }));
}

export function sendVoiceEnd() {
  ws?.send(JSON.stringify({ type: 'voice:end', payload: {}, timestamp: Date.now() }));
}

export function sendVoiceSend() {
  ws?.send(JSON.stringify({ type: 'voice:send', payload: {}, timestamp: Date.now() }));
}

export function sendUIStateSync(state: any) {
  ws?.send(JSON.stringify({ type: 'ui:state-sync', payload: state, timestamp: Date.now() }));
}
