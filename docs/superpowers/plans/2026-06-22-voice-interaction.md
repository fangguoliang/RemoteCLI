# RemoteCLI 语音交互系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 remotecli 移动端 Web 终端增加语音交互能力，用户通过语音完成所有界面操作（终端命令、文件管理器、Claude 对话、UI 导航）。

**Architecture:** 服务端语音代理 + Agent 端 LLM。Browser 录音 → Server STT (Groq Whisper) → Server 命令词典快速匹配 / Agent 端 Claude Code 后台进程 LLM 兜底 → Server 执行动作 → Server TTS (Edge-TTS) → Browser 播放反馈。

**Tech Stack:** Groq Whisper API (STT), Edge-TTS (TTS), Claude Code CLI (LLM), MediaRecorder + PCM (audio), WebSocket (transport), Vue 3 + Pinia (frontend)

**Spec:** `docs/superpowers/specs/2026-06-22-voice-interaction-design.md`

---

## File Structure

### New Files

| File | Package | Responsibility |
|------|---------|----------------|
| `packages/shared/src/voice-types.ts` | shared | 语音交互所有 TypeScript 类型定义 |
| `packages/server/src/voice/stt.ts` | server | Groq Whisper STT 服务 |
| `packages/server/src/voice/tts.ts` | server | Edge-TTS 语音合成服务 |
| `packages/server/src/voice/commandDictionary.ts` | server | 命令词典快速匹配 |
| `packages/server/src/voice/voiceAgent.ts` | server | 语音代理主模块，协调 STT→路由→TTS |
| `packages/server/src/voice/actionExecutor.ts` | server | 执行动作：终端/文件管理器/Claude/UI |
| `packages/server/src/voice/types.ts` | server | Server 端语音内部类型 |
| `packages/agent/src/voiceLLM.ts` | agent | 持久化 Claude Code 后台会话 |
| `packages/agent/src/voiceConfig.ts` | agent | Agent 端语音配置 |
| `packages/web/src/composables/useAudioRecorder.ts` | web | 麦克风录音 + VAD + PCM 编码 |
| `packages/web/src/composables/useAudioPlayer.ts` | web | TTS 音频解码播放 |
| `packages/web/src/components/VoiceFloatingBar.vue` | web | 顶部悬浮条 UI 组件 |
| `packages/web/src/stores/voice.ts` | web | 语音状态管理 Pinia store |
| `scripts/generate-action-map.ts` | root | Action Map 自动生成脚本 |
| `packages/server/src/voice/actionMap.json` | server | 生成的 UI 动作地图（构建产物） |

### Modified Files

| File | Changes |
|------|---------|
| `packages/shared/src/types.ts` | 添加语音消息类型到 MessageType union |
| `packages/server/src/ws/router.ts` | 添加 voice:* 消息路由处理 |
| `packages/server/src/ws/tunnel.ts` | 添加 voice 消息路由方法 |
| `packages/server/src/config/index.ts` | 添加语音配置项 |
| `packages/agent/src/tunnel.ts` | 添加 voice:interpret 处理 |
| `packages/agent/src/config.ts` | 添加语音配置项 |
| `packages/web/src/App.vue` | 挂载 VoiceFloatingBar 组件 |
| `packages/server/.env.example` | 添加 GROQ_API_KEY |
| `packages/agent/.env.example` | 添加语音相关配置 |

---

## Task 1: Shared 语音类型定义

**Files:**
- Create: `packages/shared/src/voice-types.ts`
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Create voice-types.ts**

```typescript
// packages/shared/src/voice-types.ts

// === 上行消息（浏览器 → Server）===

export interface VoiceStartPayload {
  sampleRate: number;
}

export interface VoiceAudioPayload {
  chunk: string;        // base64 encoded PCM
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
  audio: string;        // base64 encoded
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
```

- [ ] **Step 2: Update MessageType union in types.ts**

Add voice message types to the union in `packages/shared/src/types.ts`:

```typescript
export type MessageType =
  | 'auth'
  | 'auth:result'
  // ... existing types ...
  | 'http:request'
  | 'http:response'
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
  | 'ui:state-sync';
```

- [ ] **Step 3: Export from shared index**

Add to `packages/shared/src/index.ts`:
```typescript
export * from './voice-types.js';
```

- [ ] **Step 4: Verify build**

Run: `cd packages/shared && pnpm build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add voice interaction type definitions"
```

---

## Task 2: Server STT Service (Groq Whisper)

**Files:**
- Create: `packages/server/src/voice/stt.ts`
- Test: `packages/server/src/__tests__/stt.test.ts`

- [ ] **Step 1: Install dependencies**

```bash
cd packages/server && pnpm add node-fetch
```

- [ ] **Step 2: Write failing test**

```typescript
// packages/server/src/__tests__/stt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STTService } from '../voice/stt.js';

describe('STTService', () => {
  let stt: STTService;

  beforeEach(() => {
    vi.useFakeTimers();
    stt = new STTService({ apiKey: 'test-key', model: 'whisper-large-v3-turbo' });
  });

  it('should transcribe audio buffer to text', async () => {
    const mockTranscription = { text: '打开文件管理器' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTranscription),
    });

    const audioBuffer = Buffer.alloc(16000); // 1 second of silence
    const result = await stt.transcribe(audioBuffer, 'zh');
    expect(result).toBe('打开文件管理器');
  });

  it('should throw on API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limited'),
    });

    const audioBuffer = Buffer.alloc(16000);
    await expect(stt.transcribe(audioBuffer, 'zh')).rejects.toThrow('STT API error');
  });

  it('should accumulate audio chunks', () => {
    const chunk1 = Buffer.alloc(1600);
    const chunk2 = Buffer.alloc(1600);
    stt.addChunk(chunk1);
    stt.addChunk(chunk2);
    expect(stt.getBufferSize()).toBe(3200);
  });

  it('should clear buffer after transcription', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'test' }),
    });

    stt.addChunk(Buffer.alloc(1600));
    await stt.transcribeBuffer('zh');
    expect(stt.getBufferSize()).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- --run src/__tests__/stt.test.ts`
Expected: FAIL — "Cannot find module '../voice/stt.js'"

- [ ] **Step 4: Implement STTService**

```typescript
// packages/server/src/voice/stt.ts
import { config } from '../config/index.js';

interface STTConfig {
  apiKey: string;
  model: string;
}

export class STTService {
  private buffer: Buffer[] = [];
  private config: STTConfig;

  constructor(cfg: STTConfig) {
    this.config = cfg;
  }

  addChunk(chunk: Buffer) {
    this.buffer.push(chunk);
  }

  getBufferSize(): number {
    return this.buffer.reduce((sum, b) => sum + b.length, 0);
  }

  clearBuffer() {
    this.buffer = [];
  }

  async transcribeBuffer(language: string): Promise<string> {
    const audioBuffer = Buffer.concat(this.buffer);
    this.clearBuffer();
    if (audioBuffer.length === 0) return '';
    return this.transcribe(audioBuffer, language);
  }

  async transcribe(audioBuffer: Buffer, language: string): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/pcm' });
    formData.append('file', blob, 'audio.pcm');
    formData.append('model', this.config.model);
    formData.append('language', language);
    formData.append('response_format', 'json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`STT API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as { text: string };
    return result.text.trim();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- --run src/__tests__/stt.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/voice/stt.ts packages/server/src/__tests__/stt.test.ts packages/server/package.json
git commit -m "feat(server): add STTService with Groq Whisper API"
```

---

## Task 3: Server TTS Service (Edge-TTS)

**Files:**
- Create: `packages/server/src/voice/tts.ts`
- Test: `packages/server/src/__tests__/tts.test.ts`

- [ ] **Step 1: Install edge-tts dependency**

```bash
cd packages/server && pnpm add edge-tts
```

> Note: edge-tts is a Node.js wrapper for Microsoft Edge's TTS service. If this package doesn't exist, use `say` or implement via WebSocket to Edge TTS endpoint. As fallback, implement a mock that returns silence for now and add real TTS in a follow-up.

- [ ] **Step 2: Write failing test**

```typescript
// packages/server/src/__tests__/tts.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TTSService } from '../voice/tts.js';

describe('TTSService', () => {
  it('should synthesize text to audio buffer', async () => {
    const tts = new TTSService({ voice: 'zh-CN-XiaoxiaoNeural', rate: '+10%' });
    const audio = await tts.synthesize('搞定');
    expect(audio).toBeInstanceOf(Buffer);
    expect(audio.length).toBeGreaterThan(0);
  });

  it('should truncate long text', async () => {
    const tts = new TTSService({ voice: 'zh-CN-XiaoxiaoNeural', rate: '+10%', maxLength: 10 });
    // Should not throw even with long input
    const audio = await tts.synthesize('这是一段很长很长的文字超过了最大长度限制');
    expect(audio).toBeInstanceOf(Buffer);
  });

  it('should return empty buffer for empty text', async () => {
    const tts = new TTSService({ voice: 'zh-CN-XiaoxiaoNeural', rate: '+10%' });
    const audio = await tts.synthesize('');
    expect(audio.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- --run src/__tests__/tts.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement TTSService**

```typescript
// packages/server/src/voice/tts.ts
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

interface TTSConfig {
  voice: string;
  rate: string;
  maxLength?: number;
}

export class TTSService {
  private config: TTSConfig;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!text.trim()) return Buffer.alloc(0);

    // Truncate if too long
    const maxLen = this.config.maxLength || 30;
    const truncated = text.length > maxLen ? text.substring(0, maxLen) : text;

    const tmpFile = join(tmpdir(), `tts-${randomUUID()}.mp3`);

    try {
      // Use edge-tts CLI (pip install edge-tts)
      await execFileAsync('edge-tts', [
        '--voice', this.config.voice,
        '--rate', this.config.rate,
        '--text', truncated,
        '--write-media', tmpFile,
      ]);

      const audio = await readFile(tmpFile);
      return audio;
    } catch (err) {
      console.error('TTS synthesis failed:', err);
      return Buffer.alloc(0);
    } finally {
      try { await unlink(tmpFile); } catch { /* ignore */ }
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- --run src/__tests__/tts.test.ts`
Expected: PASS (requires `edge-tts` CLI installed: `pip install edge-tts`)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/voice/tts.ts packages/server/src/__tests__/tts.test.ts packages/server/package.json
git commit -m "feat(server): add TTSService with Edge-TTS"
```

---

## Task 4: Server 命令词典

**Files:**
- Create: `packages/server/src/voice/commandDictionary.ts`
- Create: `packages/server/src/voice/commands.json`
- Test: `packages/server/src/__tests__/commandDictionary.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/server/src/__tests__/commandDictionary.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandDictionary } from '../voice/commandDictionary.js';

describe('CommandDictionary', () => {
  let dict: CommandDictionary;

  beforeEach(() => {
    dict = new CommandDictionary();
    dict.load();
  });

  it('should match "打开文件管理器" to navigate_file_view', () => {
    const result = dict.match('打开文件管理器');
    expect(result).not.toBeNull();
    expect(result!.action_id).toBe('navigate_file_view');
  });

  it('should match "清屏" to terminal_clear', () => {
    const result = dict.match('清屏');
    expect(result).not.toBeNull();
    expect(result!.action_id).toBe('terminal_clear');
  });

  it('should match "新建会话" to terminal_new_session', () => {
    const result = dict.match('新建会话');
    expect(result).not.toBeNull();
    expect(result!.action_id).toBe('terminal_new_session');
  });

  it('should return null for unrecognized text', () => {
    const result = dict.match('查看哪个进程占用了8080端口');
    expect(result).toBeNull();
  });

  it('should match with fuzzy text (contains keyword)', () => {
    const result = dict.match('帮我打开文件管理器看看');
    expect(result).not.toBeNull();
    expect(result!.action_id).toBe('navigate_file_view');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- --run src/__tests__/commandDictionary.test.ts`
Expected: FAIL

- [ ] **Step 3: Create commands.json**

```json
// packages/server/src/voice/commands.json
{
  "commands": [
    {
      "keywords": ["打开文件管理器", "文件管理", "文件浏览", "打开文件"],
      "action_id": "navigate_file_view",
      "params": {}
    },
    {
      "keywords": ["切换到终端", "打开终端", "回到终端"],
      "action_id": "navigate_terminal",
      "params": {}
    },
    {
      "keywords": ["打开设置", "设置", "配置"],
      "action_id": "navigate_settings",
      "params": {}
    },
    {
      "keywords": ["新建会话", "新建终端", "新标签"],
      "action_id": "terminal_new_session",
      "params": {}
    },
    {
      "keywords": ["关闭标签", "关闭会话", "关闭当前"],
      "action_id": "terminal_close_session",
      "params": {}
    },
    {
      "keywords": ["向上滚动", "往上滚", "滚动上面"],
      "action_id": "terminal_scroll",
      "params": { "direction": "up" }
    },
    {
      "keywords": ["向下滚动", "往下滚", "滚动下面"],
      "action_id": "terminal_scroll",
      "params": { "direction": "down" }
    },
    {
      "keywords": ["清屏", "清除屏幕"],
      "action_id": "terminal_clear",
      "params": {}
    },
    {
      "keywords": ["复制"],
      "action_id": "terminal_copy",
      "params": {}
    },
    {
      "keywords": ["粘贴"],
      "action_id": "terminal_paste",
      "params": {}
    },
    {
      "keywords": ["上一级", "返回上级", "上级目录"],
      "action_id": "file_go_up",
      "params": {}
    },
    {
      "keywords": ["刷新", "刷新列表"],
      "action_id": "file_refresh",
      "params": {}
    },
    {
      "keywords": ["停止录音", "停止语音", "关闭语音"],
      "action_id": "voice_stop",
      "params": {}
    },
    {
      "keywords": ["最小化", "收起"],
      "action_id": "voice_minimize",
      "params": {}
    }
  ]
}
```

- [ ] **Step 4: Implement CommandDictionary**

```typescript
// packages/server/src/voice/commandDictionary.ts
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CommandEntry {
  keywords: string[];
  action_id: string;
  params: Record<string, unknown>;
}

export interface DictionaryMatch {
  action_id: string;
  params: Record<string, unknown>;
}

export class CommandDictionary {
  private commands: CommandEntry[] = [];

  load() {
    const configPath = join(__dirname, 'commands.json');
    const data = JSON.parse(readFileSync(configPath, 'utf-8'));
    this.commands = data.commands || [];
  }

  match(text: string): DictionaryMatch | null {
    const normalized = text.trim();

    // Exact match first
    for (const cmd of this.commands) {
      for (const keyword of cmd.keywords) {
        if (normalized === keyword) {
          return { action_id: cmd.action_id, params: cmd.params };
        }
      }
    }

    // Contains match (fuzzy)
    for (const cmd of this.commands) {
      for (const keyword of cmd.keywords) {
        if (normalized.includes(keyword)) {
          return { action_id: cmd.action_id, params: cmd.params };
        }
      }
    }

    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- --run src/__tests__/commandDictionary.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/voice/commandDictionary.ts packages/server/src/voice/commands.json packages/server/src/__tests__/commandDictionary.test.ts
git commit -m "feat(server): add CommandDictionary for fast-path UI commands"
```

---

## Task 5: Server ActionExecutor

**Files:**
- Create: `packages/server/src/voice/actionExecutor.ts`
- Test: `packages/server/src/__tests__/actionExecutor.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/server/src/__tests__/actionExecutor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ActionExecutor } from '../voice/actionExecutor.js';

describe('ActionExecutor', () => {
  it('should resolve terminal command action', () => {
    const executor = new ActionExecutor();
    const result = executor.resolve({
      action_id: 'terminal_execute',
      params: { command: 'ls -la' },
    });
    expect(result.type).toBe('terminal');
    expect(result.data).toBe('ls -la');
  });

  it('should resolve navigation action', () => {
    const executor = new ActionExecutor();
    const result = executor.resolve({
      action_id: 'navigate_file_view',
      params: {},
    });
    expect(result.type).toBe('ui_navigation');
  });

  it('should resolve claude prompt action', () => {
    const executor = new ActionExecutor();
    const result = executor.resolve({
      action_id: 'claude_prompt',
      params: { text: '帮我写一个脚本' },
    });
    expect(result.type).toBe('claude_input');
    expect(result.data).toBe('帮我写一个脚本');
  });
});
```

- [ ] **Step 2: Implement ActionExecutor**

```typescript
// packages/server/src/voice/actionExecutor.ts

export interface ResolvedAction {
  type: 'terminal' | 'ui_navigation' | 'claude_input' | 'file_operation' | 'voice_control';
  data?: string;
  params?: Record<string, unknown>;
}

export interface VoiceAction {
  action_id: string;
  params?: Record<string, unknown>;
  dangerous?: boolean;
  explanation?: string;
}

export class ActionExecutor {
  resolve(action: VoiceAction): ResolvedAction {
    const { action_id, params } = action;

    // Terminal commands
    if (action_id === 'terminal_execute') {
      return { type: 'terminal', data: params?.command as string, params };
    }
    if (action_id === 'terminal_clear' || action_id === 'terminal_scroll' ||
        action_id === 'terminal_copy' || action_id === 'terminal_paste') {
      return { type: 'terminal', params };
    }
    if (action_id === 'terminal_new_session' || action_id === 'terminal_close_session') {
      return { type: 'terminal', params };
    }

    // UI navigation
    if (action_id.startsWith('navigate_')) {
      return { type: 'ui_navigation', data: action_id.replace('navigate_', ''), params };
    }

    // Claude input
    if (action_id === 'claude_prompt') {
      return { type: 'claude_input', data: params?.text as string, params };
    }

    // File operations
    if (action_id.startsWith('file_')) {
      return { type: 'file_operation', params };
    }

    // Voice control
    if (action_id.startsWith('voice_')) {
      return { type: 'voice_control', params };
    }

    return { type: 'ui_navigation', params };
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- --run src/__tests__/actionExecutor.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/voice/actionExecutor.ts packages/server/src/__tests__/actionExecutor.test.ts
git commit -m "feat(server): add ActionExecutor for voice action resolution"
```

---

## Task 6: Server VoiceAgent 主模块

**Files:**
- Create: `packages/server/src/voice/voiceAgent.ts`
- Create: `packages/server/src/voice/types.ts`

- [ ] **Step 1: Create voice internal types**

```typescript
// packages/server/src/voice/types.ts
export interface VoiceSession {
  browserWs: import('ws').WebSocket;
  agentId: string;
  mode: 'command' | 'input';
  inputBuffer: string;
  state: 'idle' | 'recording' | 'processing';
}

export interface VoiceConfig {
  stt: {
    provider: string;
    apiKey: string;
    model: string;
    language: string;
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
```

- [ ] **Step 2: Implement VoiceAgent**

```typescript
// packages/server/src/voice/voiceAgent.ts
import { STTService } from './stt.js';
import { TTSService } from './tts.js';
import { CommandDictionary } from './commandDictionary.js';
import { ActionExecutor } from './actionExecutor.js';
import type { VoiceSession, VoiceConfig } from './types.js';
import type { ActionMap } from '@remotecli/shared';
import { tunnelManager } from '../ws/tunnel.js';

export class VoiceAgentManager {
  private sessions = new Map<string, VoiceSession>(); // browserWs -> session
  private stt: STTService;
  private tts: TTSService;
  private dictionary: CommandDictionary;
  private executor: ActionExecutor;
  private actionMap: ActionMap | null = null;
  private config: VoiceConfig;

  constructor(config: VoiceConfig) {
    this.config = config;
    this.stt = new STTService({ apiKey: config.stt.apiKey, model: config.stt.model });
    this.tts = new TTSService({ voice: config.tts.voice, rate: config.tts.rate });
    this.dictionary = new CommandDictionary();
    this.dictionary.load();
    this.executor = new ActionExecutor();
  }

  setActionMap(actionMap: ActionMap) {
    this.actionMap = actionMap;
  }

  createSession(browserWs: import('ws').WebSocket, agentId: string): VoiceSession {
    const session: VoiceSession = {
      browserWs,
      agentId,
      mode: 'command',
      inputBuffer: '',
      state: 'idle',
    };
    this.sessions.set(browserWs, session);
    return session;
  }

  removeSession(browserWs: import('ws').WebSocket) {
    this.sessions.delete(browserWs);
  }

  getSession(browserWs: import('ws').WebSocket): VoiceSession | undefined {
    return this.sessions.get(browserWs);
  }

  async handleAudioChunk(browserWs: import('ws').WebSocket, chunk: Buffer) {
    const session = this.sessions.get(browserWs);
    if (!session) return;

    this.stt.addChunk(chunk);
  }

  async handleVadEnd(browserWs: import('ws').WebSocket) {
    const session = this.sessions.get(browserWs);
    if (!session) return;

    session.state = 'processing';

    try {
      // STT
      const text = await this.stt.transcribeBuffer(this.config.stt.language);
      if (!text) {
        session.state = 'idle';
        return;
      }

      // Send interim result
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
      await this.requestLLMInterpretation(browserWs, session, text);
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
      // Send dangerous action confirmation to browser
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

  private async executeAndRespond(
    browserWs: import('ws').WebSocket,
    session: VoiceSession,
    actionId: string,
    params?: Record<string, unknown>,
  ) {
    const resolved = this.executor.resolve({ action_id: actionId, params });

    // Execute based on type
    switch (resolved.type) {
      case 'terminal':
        // Route terminal command to agent
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
        // Send navigation command to browser
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

    // TTS feedback (if applicable)
    const ttsText = this.getTtsFeedback(actionId, resolved.type);
    if (ttsText) {
      const audio = await this.tts.synthesize(ttsText);
      if (audio.length > 0) {
        this.sendToBrowser(browserWs, {
          type: 'voice:tts',
          payload: { audio: audio.toString('base64'), format: 'mp3' },
          timestamp: Date.now(),
        });
      }
    }

    session.state = 'idle';
  }

  private async requestLLMInterpretation(
    browserWs: import('ws').WebSocket,
    session: VoiceSession,
    text: string,
  ) {
    // Send to agent for LLM processing
    tunnelManager.routeToAgent(session.agentId, {
      type: 'voice:interpret',
      payload: {
        text,
        context: {
          terminal_type: 'powershell', // TODO: get from ui:state-sync
          os: 'windows',
          cwd: '',
          action_map: this.actionMap,
        },
      },
      timestamp: Date.now(),
    });
  }

  private getTtsFeedback(actionId: string, type: string): string | null {
    // UI navigation actions get TTS feedback
    if (type === 'ui_navigation') {
      const feedbackMap: Record<string, string> = {
        'navigate_file_view': '已打开文件管理器',
        'navigate_terminal': '已切换到终端',
        'navigate_settings': '已打开设置',
      };
      return feedbackMap[actionId] || null;
    }
    // Terminal commands and claude input are silent
    return null;
  }

  private getTerminalSessionId(browserWs: import('ws').WebSocket): string | null {
    const browser = tunnelManager.getBrowser(browserWs);
    return browser?.sessionId || null;
  }

  private sendToBrowser(browserWs: import('ws').WebSocket, message: unknown) {
    if (browserWs.readyState === 1) { // OPEN
      browserWs.send(JSON.stringify(message));
    }
  }
}
}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/server && pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/voice/
git commit -m "feat(server): add VoiceAgentManager orchestrating STT, dictionary, LLM, TTS"
```

---

## Task 7: Server WebSocket 语音路由

**Files:**
- Modify: `packages/server/src/ws/router.ts`
- Modify: `packages/server/src/ws/tunnel.ts`
- Modify: `packages/server/src/config/index.ts`

- [ ] **Step 1: Add voice config to server config**

```typescript
// Add to packages/server/src/config/index.ts
voice: {
  enabled: process.env.VOICE_ENABLED !== 'false',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
  sttLanguage: process.env.STT_LANGUAGE || 'zh',
  ttsVoice: process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural',
  ttsRate: process.env.TTS_RATE || '+10%',
},
```

- [ ] **Step 2: Add voice route handling in router.ts**

Add voice cases to the `handleMessage` switch statement:

```typescript
case 'voice:start':
case 'voice:audio':
case 'voice:vad-state':
case 'voice:end':
case 'voice:send':
case 'voice:cancel':
  handleVoiceMessage(ws, message);
  break;

case 'voice:action-result':
case 'voice:interpret-error':
  // Agent returns LLM result, route to browser's voice session
  if (isAgent) {
    const agentId = tunnelManager.getAgentIdByWs(ws);
    if (agentId) {
      tunnelManager.routeVoiceResultToBrowser(agentId, message);
    }
  }
  break;

case 'ui:state-sync':
  // Browser sends UI state, store for LLM context
  handleUIStateSync(ws, message);
  break;
```

- [ ] **Step 3: Add routeVoiceResultToBrowser to TunnelManager**

Add method to `packages/server/src/ws/tunnel.ts`:

```typescript
routeVoiceResultToBrowser(agentId: string, message: any) {
  // Find browsers connected to this agent and forward voice result
  for (const [ws, browser] of this.browsers) {
    if (browser.agentId === agentId) {
      ws.send(JSON.stringify(message));
    }
  }
}
```

- [ ] **Step 4: Verify build**

Run: `cd packages/server && pnpm build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/ packages/server/src/config/
git commit -m "feat(server): add voice message routing in WebSocket handler"
```

---

## Task 8: Agent VoiceLLM 模块

**Files:**
- Create: `packages/agent/src/voiceLLM.ts`
- Create: `packages/agent/src/voiceConfig.ts`
- Modify: `packages/agent/src/tunnel.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Add voice config**

```typescript
// packages/agent/src/voiceConfig.ts
import 'dotenv/config';

export const voiceConfig = {
  claudePath: process.env.CLAUDE_PATH || 'claude',
  workDir: process.env.VOICE_WORK_DIR || process.cwd(),
  timeout: parseInt(process.env.VOICE_LLM_TIMEOUT || '10000', 10),
  maxRetries: parseInt(process.env.VOICE_MAX_RETRIES || '2', 10),
};
```

- [ ] **Step 2: Implement VoiceLLM**

```typescript
// packages/agent/src/voiceLLM.ts
import { spawn, ChildProcess } from 'child_process';
import { voiceConfig } from './voiceConfig.js';

interface InterpretRequest {
  text: string;
  context: {
    terminal_type: string;
    os: string;
    cwd: string;
    action_map?: unknown;
  };
}

interface InterpretResult {
  action_id: string;
  params?: Record<string, unknown>;
  dangerous: boolean;
  explanation?: string;
}

export class VoiceLLM {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<string, {
    resolve: (result: InterpretResult) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private requestCounter = 0;
  private restartCount = 0;
  private maxRestarts = 3;

  start() {
    this.spawnClaude();
  }

  private spawnClaude() {
    // Persistent session mode: NOT using --print flag.
    // We maintain a long-running Claude Code process and communicate via stdin/stdout.
    // Each request is delimited by ---VOICE-COMMAND-{id}--- / ---END--- markers.
    const args = [
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
    ];

    this.process = spawn(voiceConfig.claudePath, args, {
      cwd: voiceConfig.workDir,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';

    this.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      // Parse stream-json lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'result' && msg.content) {
            this.handleResult(msg.content);
          }
        } catch { /* not JSON, skip */ }
      }
    });

    this.process.on('close', (code) => {
      console.log(`VoiceLLM Claude process exited with code ${code}`);
      this.process = null;
      if (this.restartCount < this.maxRestarts) {
        this.restartCount++;
        const delay = this.restartCount * 2000;
        console.log(`Restarting VoiceLLM in ${delay}ms (attempt ${this.restartCount})`);
        setTimeout(() => this.spawnClaude(), delay);
      }
    });

    this.process.on('error', (err) => {
      console.error('VoiceLLM process error:', err);
    });
  }

  async interpret(request: InterpretRequest): Promise<InterpretResult> {
    if (!this.process) {
      throw new Error('VoiceLLM not available');
    }

    const requestId = `req-${++this.requestCounter}`;
    const prompt = this.buildPrompt(request, requestId);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('VoiceLLM timeout'));
      }, voiceConfig.timeout);

      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.process?.stdin?.write(prompt + '\n');
    });
  }

  private buildPrompt(request: InterpretRequest, requestId: string): string {
    return `---VOICE-COMMAND-${requestId}---
你是 remotecli 的语音命令翻译器。请根据用户语音输入，输出 JSON 动作指令。

## 当前环境
- 终端类型: ${request.context.terminal_type}
- 操作系统: ${request.context.os}
- 当前目录: ${request.context.cwd}

## 用户语音
${request.text}

## 输出格式 (仅输出 JSON，不要其他内容)
{"requestId":"${requestId}","action_id":"...","params":{},"dangerous":false,"explanation":"..."}

---END---`;
  }

  private handleResult(content: string) {
    try {
      // Try to parse the JSON from content
      const jsonMatch = content.match(/\{[\s\S]*"requestId"[\s\S]*\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]);
      const requestId = parsed.requestId;
      const pending = this.pendingRequests.get(requestId);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve({
        action_id: parsed.action_id || 'unknown',
        params: parsed.params || {},
        dangerous: parsed.dangerous || false,
        explanation: parsed.explanation || '',
      });
    } catch (err) {
      console.error('VoiceLLM result parse error:', err);
    }
  }

  stop() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('VoiceLLM shutting down'));
    }
    this.pendingRequests.clear();
  }
}
```

- [ ] **Step 3: Wire VoiceLLM into agent tunnel**

Modify `packages/agent/src/tunnel.ts` to handle `voice:interpret`:

```typescript
// In handleMessage():
case 'voice:interpret':
  this.handleVoiceInterpret(payload, sessionId);
  break;

// Add method:
private async handleVoiceInterpret(payload: any, sessionId?: string) {
  if (!this.voiceLLM) return;

  try {
    const result = await this.voiceLLM.interpret(payload);
    this.send({
      type: 'voice:action-result',
      payload: result,
      sessionId,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    this.send({
      type: 'voice:interpret-error',
      payload: { code: 'llm_error', message: err.message },
      sessionId,
      timestamp: Date.now(),
    });
  }
}
```

- [ ] **Step 4: Initialize VoiceLLM in agent index.ts**

```typescript
// Modify packages/agent/src/index.ts
import 'dotenv/config';
import { Tunnel } from './tunnel.js';
import { VoiceLLM } from './voiceLLM.js';

console.log('remoteCli Agent starting...');

// Create persistent VoiceLLM session
const voiceLLM = new VoiceLLM();
voiceLLM.start();

// Pass voiceLLM to tunnel
const tunnel = new Tunnel(voiceLLM);
tunnel.connect();

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  voiceLLM.stop();
  tunnel.disconnect();
  process.exit(0);
});

export { FileManager } from './file.js';
```

- [ ] **Step 4b: Modify Tunnel constructor to accept VoiceLLM**

```typescript
// In packages/agent/src/tunnel.ts, add:
import { VoiceLLM } from './voiceLLM.js';

export class Tunnel {
  private voiceLLM: VoiceLLM | null = null;
  // ... existing fields ...

  constructor(voiceLLM?: VoiceLLM) {
    this.voiceLLM = voiceLLM || null;
  }

  // ... existing methods ...
}
```

- [ ] **Step 5: Verify build**

Run: `cd packages/agent && pnpm build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/voiceLLM.ts packages/agent/src/voiceConfig.ts packages/agent/src/tunnel.ts packages/agent/src/index.ts
git commit -m "feat(agent): add VoiceLLM with persistent Claude Code session"
```

---

## Task 9: Frontend Audio Recorder (录音 + VAD)

**Files:**
- Create: `packages/web/src/composables/useAudioRecorder.ts`

- [ ] **Step 1: Implement useAudioRecorder composable**

```typescript
// packages/web/src/composables/useAudioRecorder.ts
import { ref, onUnmounted } from 'vue';

interface UseAudioRecorderOptions {
  onAudioChunk: (chunk: Uint8Array, seq: number) => void;
  onVadStart: () => void;
  onVadEnd: (reason: 'silence' | 'manual') => void;
  silenceThresholdMs?: number;
  energyThreshold?: number;
}

export function useAudioRecorder(options: UseAudioRecorderOptions) {
  const isRecording = ref(false);
  const isSupported = ref(!!navigator.mediaDevices?.getUserMedia);
  const error = ref<string | null>(null);

  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let seq = 0;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let isSpeaking = false;

  const SILENCE_MS = options.silenceThresholdMs || 800;
  const ENERGY_THRESHOLD = options.energyThreshold || 0.01;

  async function start() {
    if (!isSupported.value) {
      error.value = '浏览器不支持麦克风';
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
      audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(mediaStream);

      // Use ScriptProcessorNode for PCM access (simpler than AudioWorklet)
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const energy = computeEnergy(inputData);

        if (energy > ENERGY_THRESHOLD) {
          // Speaking
          if (!isSpeaking) {
            isSpeaking = true;
            options.onVadStart();
          }
          resetSilenceTimer();

          // Convert float32 to 16-bit PCM
          const pcm = float32ToPCM16(inputData);
          options.onAudioChunk(pcm, seq++);
        } else {
          // Silence
          resetSilenceTimer();
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      isRecording.value = true;
      error.value = null;
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        error.value = '麦克风权限被拒绝';
      } else {
        error.value = `麦克风错误: ${err.message}`;
      }
    }
  }

  function stop() {
    if (silenceTimer) clearTimeout(silenceTimer);
    processor?.disconnect();
    mediaStream?.getTracks().forEach(t => t.stop());
    audioContext?.close();
    processor = null;
    mediaStream = null;
    audioContext = null;
    isRecording.value = false;
    isSpeaking = false;
    seq = 0;
  }

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (isSpeaking) {
        isSpeaking = false;
        options.onVadEnd('silence');
      }
    }, SILENCE_MS);
  }

  function forceVadEnd() {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (isSpeaking) {
      isSpeaking = false;
      options.onVadEnd('manual');
    }
  }

  function computeEnergy(buffer: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  function float32ToPCM16(float32: Float32Array): Uint8Array {
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return new Uint8Array(pcm16.buffer);
  }

  onUnmounted(() => stop());

  return { isRecording, isSupported, error, start, stop, forceVadEnd };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/composables/useAudioRecorder.ts
git commit -m "feat(web): add useAudioRecorder composable with VAD"
```

---

## Task 10: Frontend Audio Player

**Files:**
- Create: `packages/web/src/composables/useAudioPlayer.ts`

- [ ] **Step 1: Implement useAudioPlayer composable**

```typescript
// packages/web/src/composables/useAudioPlayer.ts
import { ref, onUnmounted } from 'vue';

export function useAudioPlayer() {
  const isPlaying = ref(false);
  const queue: ArrayBuffer[] = [];
  let audioContext: AudioContext | null = null;

  function init() {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
  }

  async function enqueue(base64Audio: string) {
    init();
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    try {
      const audioBuffer = await audioContext!.decodeAudioData(bytes.buffer);
      queue.push(audioBuffer);
      if (!isPlaying.value) {
        playNext();
      }
    } catch (err) {
      console.error('Audio decode error:', err);
    }
  }

  function playNext() {
    if (queue.length === 0 || !audioContext) {
      isPlaying.value = false;
      return;
    }

    isPlaying.value = true;
    const buffer = queue.shift()!;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => playNext();
    source.start();
  }

  function clear() {
    queue.length = 0;
    isPlaying.value = false;
  }

  onUnmounted(() => {
    audioContext?.close();
  });

  return { isPlaying, enqueue, clear };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/composables/useAudioPlayer.ts
git commit -m "feat(web): add useAudioPlayer composable for TTS playback"
```

---

## Task 11: Frontend Voice Store (Pinia)

**Files:**
- Create: `packages/web/src/stores/voice.ts`

- [ ] **Step 1: Implement voice store**

```typescript
// packages/web/src/stores/voice.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type VoiceMode = 'command' | 'input';
export type VoiceBarState = 'disabled' | 'stopped' | 'recording' | 'expanded';

export const useVoiceStore = defineStore('voice', () => {
  // State
  const enabled = ref(false);              // global enable (from settings)
  const barState = ref<VoiceBarState>('stopped');
  const mode = ref<VoiceMode>('command');
  const interimText = ref('');
  const inputBuffer = ref('');
  const errorText = ref<string | null>(null);
  const isTtsPlaying = ref(false);

  // Computed
  const isRecording = computed(() => barState.value === 'recording');
  const isExpanded = computed(() => barState.value === 'expanded');
  const displayText = computed(() => {
    if (mode.value === 'input') return inputBuffer.value;
    return interimText.value;
  });

  // Actions
  function toggleSession() {
    if (barState.value === 'stopped') {
      barState.value = 'recording';
      mode.value = 'command';
      interimText.value = '';
      inputBuffer.value = '';
    } else {
      barState.value = 'stopped';
    }
  }

  function toggleExpand() {
    if (barState.value === 'expanded') {
      barState.value = isRecording.value ? 'recording' : 'stopped';
    } else {
      barState.value = 'expanded';
    }
  }

  function setInterimText(text: string) {
    interimText.value = text;
  }

  function appendToInputBuffer(text: string) {
    inputBuffer.value += text;
  }

  function clearInputBuffer() {
    inputBuffer.value = '';
  }

  function switchToInputMode() {
    mode.value = 'input';
  }

  function switchToCommandMode() {
    mode.value = 'command';
    inputBuffer.value = '';
  }

  function setError(text: string | null) {
    errorText.value = text;
  }

  return {
    enabled, barState, mode, interimText, inputBuffer, errorText, isTtsPlaying,
    isRecording, isExpanded, displayText,
    toggleSession, toggleExpand, setInterimText, appendToInputBuffer,
    clearInputBuffer, switchToInputMode, switchToCommandMode, setError,
  };
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/stores/voice.ts
git commit -m "feat(web): add voice Pinia store for state management"
```

---

## Task 12: Frontend VoiceFloatingBar 组件

**Files:**
- Create: `packages/web/src/components/VoiceFloatingBar.vue`
- Modify: `packages/web/src/App.vue`

- [ ] **Step 1: Create VoiceFloatingBar.vue**

```vue
<!-- packages/web/src/components/VoiceFloatingBar.vue -->
<template>
  <div v-if="voiceStore.enabled" class="voice-bar" :class="[voiceStore.barState]">
    <!-- Minimized / Stopped state -->
    <div v-if="!voiceStore.isExpanded" class="voice-bar-mini" @click="handleMicClick" @dblclick="handleMicDblClick">
      <span class="mic-icon">{{ voiceStore.isRecording ? '🔴' : '🎤' }}</span>
    </div>

    <!-- Expanded state -->
    <div v-else class="voice-bar-full">
      <div class="voice-bar-header">
        <span class="voice-bar-title">{{ voiceStore.mode === 'input' ? '📝' : '🎤' }} 语音助手</span>
        <div class="voice-bar-controls">
          <button class="voice-btn" @click="voiceStore.toggleExpand" title="最小化">─</button>
        </div>
      </div>

      <!-- Recording display -->
      <div v-if="voiceStore.isRecording" class="voice-bar-content">
        <div class="voice-text">
          {{ voiceStore.displayText }}<span v-if="voiceStore.isRecording" class="cursor">▌</span>
        </div>
        <div class="voice-status">{{ statusText }}</div>
      </div>

      <!-- Input mode controls -->
      <div v-if="voiceStore.mode === 'input' && voiceStore.inputBuffer" class="voice-bar-actions">
        <button class="voice-btn cancel" @click="handleCancel">取消</button>
        <button class="voice-btn send" @click="handleSend">发送 📤</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useVoiceStore } from '../stores/voice';
import { useAudioRecorder } from '../composables/useAudioRecorder';
import { useAudioPlayer } from '../composables/useAudioPlayer';
import {
  sendVoiceStart, sendVoiceAudio, sendVoiceVadState,
  sendVoiceEnd, sendVoiceSend, initVoiceWebSocket,
} from '../services/voiceWebSocket';

const voiceStore = useVoiceStore();
const audioPlayer = useAudioPlayer();

const { isRecording, start: startRecording, stop: stopRecording, forceVadEnd } = useAudioRecorder({
  onAudioChunk: (chunk, seq) => sendVoiceAudio(chunk, seq),
  onVadStart: () => {},
  onVadEnd: (reason) => {
    sendVoiceVadState(false, reason);
    if (voiceStore.mode === 'command') {
      // Auto-submit in command mode
      stopRecording();
      sendVoiceEnd();
    }
    // In input mode, keep recording, user must manually send
  },
  silenceThresholdMs: 800,
});

const statusText = computed(() => {
  if (voiceStore.mode === 'input') return '输入模式 - 说"发送"或点击按钮发送';
  return '正在聆听...';
});

function handleMicClick() {
  voiceStore.toggleSession();
  if (voiceStore.isRecording) {
    startRecording();
    sendVoiceStart(16000);
  } else {
    forceVadEnd();
    stopRecording();
    sendVoiceEnd();
  }
}

function handleMicDblClick() {
  voiceStore.toggleExpand();
}

function handleSend() {
  sendVoiceSend();
  voiceStore.switchToCommandMode();
}

function handleCancel() {
  voiceStore.clearInputBuffer();
  voiceStore.switchToCommandMode();
}
</script>

<style scoped>
.voice-bar {
  position: fixed;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.voice-bar-mini {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(99, 102, 241, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: all 0.2s;
}

.voice-bar-mini:hover {
  transform: scale(1.1);
}

.mic-icon {
  font-size: 18px;
}

.voice-bar-full {
  width: 360px;
  background: rgba(30, 30, 50, 0.92);
  backdrop-filter: blur(12px);
  border-radius: 16px;
  border: 1px solid rgba(99, 102, 241, 0.3);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.voice-bar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.voice-bar-title {
  color: #e0e0e0;
  font-size: 13px;
  font-weight: 600;
}

.voice-bar-content {
  padding: 12px 14px;
}

.voice-text {
  color: #e0e0e0;
  font-size: 14px;
  line-height: 1.5;
  min-height: 24px;
}

.cursor {
  color: #6366f1;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.voice-status {
  color: #a0a0a0;
  font-size: 11px;
  margin-top: 4px;
}

.voice-bar-actions {
  display: flex;
  gap: 8px;
  padding: 8px 14px 12px;
  justify-content: flex-end;
}

.voice-btn {
  padding: 4px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
  font-size: 12px;
  cursor: pointer;
}

.voice-btn.send {
  background: rgba(99, 102, 241, 0.6);
  border-color: rgba(99, 102, 241, 0.8);
}

.voice-btn.cancel {
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
}
</style>
```

- [ ] **Step 2: Mount in App.vue**

Add to `packages/web/src/App.vue`:

```vue
<script setup lang="ts">
import VoiceFloatingBar from './components/VoiceFloatingBar.vue';
</script>

<template>
  <router-view />
  <VoiceFloatingBar />
</template>
```

- [ ] **Step 3: Verify typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/VoiceFloatingBar.vue packages/web/src/App.vue
git commit -m "feat(web): add VoiceFloatingBar top-center component"
```

---

## Task 13: Action Map 自动生成脚本

**Files:**
- Create: `scripts/generate-action-map.ts`

- [ ] **Step 1: Create generator script**

```typescript
// scripts/generate-action-map.ts
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const WEB_SRC = join(ROOT, 'packages/web/src');
const OUTPUT = join(ROOT, 'packages/server/src/voice/actionMap.json');

interface ActionEntry {
  id: string;
  description: string;
  category: string;
  params: Record<string, { type: string; description?: string }>;
  available_when: string;
}

function scanRoutes(): ActionEntry[] {
  const routerPath = join(WEB_SRC, 'router/index.ts');
  if (!existsSync(routerPath)) return [];

  const content = readFileSync(routerPath, 'utf-8');
  const actions: ActionEntry[] = [];

  // Extract route definitions - handles multi-line format
  // Matches: { path: '/terminal', name: 'Terminal', ... }
  const routeRegex = /path:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'/g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const path = match[1];
    const name = match[2];
    actions.push({
      id: `navigate_${name.toLowerCase()}`,
      description: `导航到${name}页面 (${path})`,
      category: 'navigation',
      params: {},
      available_when: 'always',
    });
  }

  return actions;
}

function scanStores(): ActionEntry[] {
  const storesDir = join(WEB_SRC, 'stores');
  if (!existsSync(storesDir)) return [];

  const actions: ActionEntry[] = [];
  const files = readdirSync(storesDir).filter(f => f.endsWith('.ts'));

  for (const file of files) {
    const content = readFileSync(join(storesDir, file), 'utf-8');
    const storeName = file.replace('.ts', '');

    // Find exported functions (simple heuristic)
    const funcRegex = /function\s+(\w+)\s*\(/g;
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
      const funcName = match[1];
      if (funcName.startsWith('use') || funcName.startsWith('_')) continue;

      actions.push({
        id: `${storeName}_${funcName}`,
        description: `${storeName}: ${funcName}`,
        category: storeName,
        params: {},
        available_when: 'always',
      });
    }
  }

  return actions;
}

function generate() {
  const actions = [
    ...scanRoutes(),
    ...scanStores(),
    // Add well-known actions manually
    { id: 'terminal_scroll', description: '终端滚动', category: 'terminal', params: { direction: { type: 'enum', description: 'up/down/top/bottom' } }, available_when: "currentView == 'terminal'" },
    { id: 'terminal_clear', description: '清屏', category: 'terminal', params: {}, available_when: "currentView == 'terminal'" },
    { id: 'terminal_copy', description: '复制选中文字', category: 'terminal', params: {}, available_when: "currentView == 'terminal'" },
    { id: 'terminal_paste', description: '粘贴到终端', category: 'terminal', params: {}, available_when: "currentView == 'terminal'" },
    { id: 'terminal_new_session', description: '新建终端会话', category: 'terminal', params: {}, available_when: "currentView == 'terminal'" },
    { id: 'terminal_close_session', description: '关闭当前终端', category: 'terminal', params: {}, available_when: "currentView == 'terminal'" },
    { id: 'file_go_up', description: '文件管理器返回上级', category: 'file', params: {}, available_when: "currentView == 'files'" },
    { id: 'file_refresh', description: '刷新文件列表', category: 'file', params: {}, available_when: "currentView == 'files'" },
    { id: 'voice_stop', description: '停止语音', category: 'voice', params: {}, available_when: 'always' },
    { id: 'voice_minimize', description: '最小化悬浮条', category: 'voice', params: {}, available_when: 'always' },
  ];

  const actionMap = {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    actions,
  };

  writeFileSync(OUTPUT, JSON.stringify(actionMap, null, 2));
  console.log(`Generated action map with ${actions.length} actions → ${OUTPUT}`);
}

generate();
```

- [ ] **Step 2: Add script to package.json**

Add to root `package.json`:
```json
"scripts": {
  "gen:action-map": "tsx scripts/generate-action-map.ts"
}
```

- [ ] **Step 3: Run and verify**

Run: `pnpm gen:action-map`
Expected: Generates `packages/server/src/voice/actionMap.json`

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-action-map.ts package.json
git commit -m "feat: add action-map generator script"
```

---

## Task 14: Frontend WebSocket 语音消息处理

**Files:**
- Create: `packages/web/src/services/voiceWebSocket.ts`

- [ ] **Step 1: Implement voice WebSocket service**

This service connects to the existing terminal WebSocket and sends/receives voice messages.

```typescript
// packages/web/src/services/voiceWebSocket.ts
import { useVoiceStore } from '../stores/voice';
import { useAudioPlayer } from '../composables/useAudioPlayer';

let ws: WebSocket | null = null;
const audioPlayer = useAudioPlayer();

export function initVoiceWebSocket(terminalWs: WebSocket) {
  ws = terminalWs;

  // Listen for voice messages on the existing WebSocket
  const originalHandler = terminalWs.onmessage;
  terminalWs.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleVoiceMessage(msg);
    } catch { /* not JSON */ }
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
      // Execute UI action on frontend
      handleUIAction(msg.payload);
      if (msg.payload.feedback_tts) {
        // TTS will come in a separate voice:tts message
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
      audioPlayer.enqueue(msg.payload.audio);
      break;

    case 'voice:error':
      voiceStore.setError(msg.payload.message);
      setTimeout(() => voiceStore.setError(null), 5000);
      break;
  }
}

function handleUIAction(payload: any) {
  // Route UI actions to appropriate stores/router
  const { action_id } = payload;

  if (action_id.startsWith('navigate_')) {
    const view = action_id.replace('navigate_', '');
    // Use router to navigate
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
  ws?.send(JSON.stringify({
    type: 'voice:audio',
    payload: { chunk: btoa(String.fromCharCode(...chunk)), seq },
    timestamp: Date.now(),
  }));
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/services/voiceWebSocket.ts
git commit -m "feat(web): add voice WebSocket message handler"
```

---

## Task 15: 集成与端到端连接

**Files:**
- Modify: `packages/server/src/index.ts` (server startup initialization)
- Modify: `packages/web/src/components/VoiceFloatingBar.vue` (already wired in Task 12)
- Modify: `packages/server/.env.example`
- Modify: `packages/agent/.env.example`

- [ ] **Step 1: Server startup initialization order**

Add to `packages/server/src/index.ts` (after fastify setup, before server listen):

```typescript
import { VoiceAgentManager } from './voice/voiceAgent.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize voice system (after WebSocket setup)
let voiceAgentManager: VoiceAgentManager | null = null;
if (config.voice.enabled && config.voice.groqApiKey) {
  voiceAgentManager = new VoiceAgentManager({
    stt: {
      provider: 'groq',
      apiKey: config.voice.groqApiKey,
      model: config.voice.groqModel,
      language: config.voice.sttLanguage,
    },
    tts: {
      provider: 'edge-tts',
      voice: config.voice.ttsVoice,
      rate: config.voice.ttsRate,
    },
    llm: { timeout_ms: 10000, max_retries: 2 },
    vad: { command_silence_ms: 800, terminal_command_silence_ms: 1200 },
  });

  // Load action map if available
  try {
    const actionMapPath = join(__dirname, 'voice/actionMap.json');
    const actionMap = JSON.parse(readFileSync(actionMapPath, 'utf-8'));
    voiceAgentManager.setActionMap(actionMap);
    console.log(`[voice] Action map loaded: ${actionMap.actions?.length || 0} actions`);
  } catch {
    console.log('[voice] No action map found, LLM fallback will have limited context');
  }

  console.log('[voice] Voice system initialized');
} else {
  console.log('[voice] Voice system disabled (set VOICE_ENABLED=true and GROQ_API_KEY)');
}
```

- [ ] **Step 2: Add env vars**

`packages/server/.env.example`:
```
# Voice
VOICE_ENABLED=true
GROQ_API_KEY=your_groq_api_key
GROQ_STT_MODEL=whisper-large-v3-turbo
STT_LANGUAGE=zh
TTS_VOICE=zh-CN-XiaoxiaoNeural
TTS_RATE=+10%
```

`packages/agent/.env.example`:
```
# Voice LLM
CLAUDE_PATH=claude
VOICE_WORK_DIR=.
VOICE_LLM_TIMEOUT=10000
VOICE_MAX_RETRIES=2
```

- [ ] **Step 3: Full build verification**

```bash
pnpm build
cd packages/server && pnpm test
cd packages/web && pnpm typecheck
cd packages/agent && pnpm build
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: wire voice interaction end-to-end

- Frontend: VoiceFloatingBar + recorder + player + WebSocket
- Server: VoiceAgent + STT (Groq) + TTS (Edge-TTS) + dictionary + router
- Agent: VoiceLLM with persistent Claude Code session
- Config: env vars for server and agent
- Action map generator script"
```

---

## Execution Notes

### Prerequisites

1. **Groq API Key**: Sign up at https://console.groq.com, get free API key
2. **Edge-TTS CLI**: `pip install edge-tts`
3. **Claude CLI**: Must be installed on agent machine (already available via Coding Plan)

### Testing Strategy

- Server tests: Vitest with mocked fetch (STT) and mocked child_process (TTS)
- Agent tests: Mock `claude` CLI process
- Frontend: Manual testing (no unit test framework set up for Vue components in this project)

### Known Simplifications

- Audio encoding uses base64 (not optimal, but simple for MVP)
- Action Map generator uses regex heuristics (not full AST parsing)
- Terminal type detection is hardcoded initially (will be improved with ui:state-sync)
- TTS uses `edge-tts` CLI (requires Python + pip install)
