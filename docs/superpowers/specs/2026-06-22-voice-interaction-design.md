# RemoteCLI 语音交互系统设计文档

**日期**: 2026-06-22  
**版本**: 1.0.0  
**状态**: 待审批

---

## 1. 概述

为 remotecli 移动端 Web 终端增加语音交互能力，用户可以通过语音完成所有界面操作：终端命令输入、文件管理器导航、Claude 对话、UI 切换等。

### 1.1 核心原则

- **所见即所得**：说话的同时可以看到界面实时响应
- **智能翻译**：终端命令由 LLM 根据终端类型（PowerShell/Bash/Zsh）智能翻译
- **免费优先**：STT 使用 Groq Whisper API（免费额度大），TTS 使用 Edge-TTS（完全免费）
- **渐进增强**：命令词典快速响应 + LLM 兜底处理复杂/模糊指令

### 1.2 不在范围内

- 端到端语音对话模型（Qwen3-Omni 等）
- 本地部署 STT 模型（faster-whisper）
- 语音唤醒词（始终监听模式）
- 多语言混合输入处理（MVP 仅支持中文，STT language 固定为 "zh"；英文命令/代码由 LLM 在翻译阶段处理，不涉及 STT 语言切换）

---

## 2. 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| **STT** | Groq Whisper API | OpenAI 兼容接口，免费额度大，流式返回 |
| **TTS** | Edge-TTS (edge-tts) | 微软 TTS 引擎，完全免费，中文音质好 |
| **LLM 意图/命令** | 百炼 Coding Plan (Qwen) | 复用现有套餐，用于命令翻译和意图识别 |
| **音频传输** | WebSocket + PCM | 前端录音编码，server 转发 |
| **架构** | 服务端语音代理（Approach A） | 所有语音处理集中在 server 端 |

### 2.1 为什么不用百炼 STT/TTS

- 用户仅订阅了百炼 Coding Plan，该套餐不包含 STT/TTS 服务
- STT/TTS 需要百炼通用 API（按量计费），属于独立计费体系
- Groq Whisper + Edge-TTS 组合完全免费，满足需求

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        浏览器 (Vue 前端)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ 顶部悬浮条    │  │ 录音模块      │  │ 音频播放模块            │ │
│  │ • 状态指示    │  │ • MediaRecorder│  │ • 接收 TTS 音频        │ │
│  │ • 实时文字    │  │ • VAD 检测    │  │ • AudioContext 播放    │ │
│  │ • 控制按钮    │  │ • PCM 编码    │  │ • 播放队列管理          │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────▲────────────┘ │
│         │                 │                       │              │
│         └─────────────────┴─────── WebSocket ─────┘              │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│                   remotecli server (Fastify)                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              VoiceAgent 模块 (新增)                       │   │
│  │                                                          │   │
│  │  音频接收 → STTService (Groq Whisper API) → 文字         │   │
│  │     ↓                                                    │   │
│  │  CommandRouter:                                          │   │
│  │     • 命令词典匹配（UI 导航，快速路径）                    │   │
│  │     • LLM 翻译（终端命令 + 兜底）                         │   │
│  │     ↓                                                    │   │
│  │  ActionExecutor: 执行动作（终端/文件管理器/Claude/UI）     │   │
│  │     ↓                                                    │   │
│  │  TTSService (Edge-TTS) → 音频 → 回传浏览器播放           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 核心组件

| 组件 | 位置 | 职责 |
|------|------|------|
| **VoiceFloatingBar** | 前端 | 顶部悬浮条 UI、显示实时文字、控制录音 |
| **AudioRecorder** | 前端 | 麦克风录音、VAD、PCM 编码、WebSocket 发送 |
| **AudioPlayer** | 前端 | 接收 TTS 音频、解码播放、队列管理 |
| **VoiceAgent** | server | 语音代理主模块，协调 STT/命令路由/TTS |
| **STTService** | server | 调用 Groq Whisper API，流式返回文字 |
| **CommandRouter** | server | 词典匹配 + LLM 翻译/意图识别 |
| **ActionExecutor** | server | 执行动作：注入终端、操作文件管理器、Claude 对话、UI 导航 |
| **TTSService** | server | 调用 Edge-TTS，生成反馈语音 |
| **ActionMapGenerator** | server/构建 | 扫描 Vue 源码生成 UI 动作地图 |

---

## 4. 悬浮窗 UI 设计

### 4.0 语音模式启停

语音模式有三层控制：

| 层级 | 控制方式 | 说明 |
|------|---------|------|
| **全局开关** | Settings 页面 + server 配置 | 完全禁用语音功能，不加载 VoiceAgent 模块，不注册 WebSocket 路由 |
| **语音会话** | 单击 🎤 图标 | 启停语音会话（默认停止）。单击启动录音，再单击停止录音 |
| **最小化/最大化** | 双击 🎤 图标 | 切换悬浮条展开/折叠 |
| **快捷键** | `Ctrl+Shift+V` | 快速切换悬浮条显示/隐藏 |

**状态流转：**

```
全局禁用（Settings关闭）
  → 悬浮条不渲染，VoiceAgent 不初始化

全局启用（Settings开启）
  → 悬浮条默认最小化显示 🎤（语音会话默认停止）
  → 单击 🎤 → 启动语音会话（🎤 变 🔴，开始录音）
  → 再单击 🔴 → 停止语音会话（🔴 变 🎤，结束录音）
  → 双击 🎤/🔴 → 展开/折叠悬浮条
```

**持久化：**
- 全局开关：存储在 server 配置文件（`voice.enabled`），影响所有客户端
- 悬浮条展开/折叠状态：存储在浏览器 `localStorage`（`voice.barExpanded`）
- 语音会话状态：不持久化，页面刷新后默认停止
- VAD 参数：存储在浏览器 `localStorage`，用户可在 Settings 微调

### 4.1 方案：顶部居中悬浮条（方案 B）

固定在页面顶部居中，类似搜索栏。

**最小化状态：**
```
┌──────────────────────────────────────────────────────┐
│ 🎤                                  [最小化]          │
└──────────────────────────────────────────────────────┘
```
- 单击 🎤：启动语音会话（进入命令模式，开始录音）
- 双击 🎤：展开悬浮条（最大化）

**命令模式（录音中）：**
```
┌──────────────────────────────────────────────────────┐
│ 🔴  正在聆听...                    [最小化]           │
└──────────────────────────────────────────────────────┘
```
- 单击 🔴：停止语音会话（结束录音，回到默认停用状态）
- 双击 🔴：展开悬浮条（最大化）

**最大化状态（展开面板）：**
```
┌──────────────────────────────────────────────────────┐
│ 📝  帮我写一个脚本，统计当前目录下    [取消] [发送📤]   │
│      所有文件的大小...▌                               │
└──────────────────────────────────────────────────────┘
```
- 单击 [×] 或双击标题区：最小化悬浮条

### 4.2 交互状态

| 状态 | 显示 | 行为 |
|------|------|------|
| 禁用 | 不可见 | 全局开关关闭，功能不加载 |
| 停用（默认） | 🎤 最小化 | 单击启动语音会话，双击展开 |
| 录音中 | 🔴 最小化 | 单击停止语音会话，双击展开 |
| 展开 | 完整悬浮条 | 显示实时文字/控制按钮，双击标题区折叠 |
| 错误 | ⚠️ | 5 秒后自动恢复 |

---

## 5. 语音命令系统

### 5.1 三层处理架构

```
用户说话 → STT 转文字
              │
              ▼
         CommandRouter
              │
    ┌─────────┼──────────┐
    ▼         ▼          ▼
 UI 命令    终端命令    Claude 输入
 (词典匹配)  (LLM 翻译)  (直接转发)
    │         │          │
    ▼         ▼          ▼
 执行UI    注入终端     发送给
 动作      执行命令     Claude
```

### 5.2 第一层：命令词典（UI 导航）

预定义常用 UI 命令，关键词匹配，零延迟：

| 命令类别 | 语音关键词示例 | 执行动作 |
|---------|--------------|---------|
| 界面导航 | "打开文件管理器"、"切换到终端" | UI 路由切换 |
| 标签页 | "新建会话"、"关闭标签"、"切换标签" | Tab CRUD |
| 终端操作 | "向上滚动"、"清屏"、"复制"、"粘贴" | 终端控制 |
| 语音控制 | "停止录音"、"最小化" | 悬浮窗控制 |

词典以 JSON 配置存储在 server 端，支持热更新。

### 5.3 第二层：LLM 终端命令翻译（核心）

**所有终端相关的语音输入都经过 LLM 翻译**，LLM 根据当前终端类型生成正确的命令：

```
用户说: "查看哪个进程占用了 8080 端口"

LLM 上下文:
{
  "terminal_type": "powershell",  // 或 "bash" / "zsh"
  "os": "windows",
  "cwd": "C:\\Users\\Admin"
}

LLM 返回 (PowerShell):
{
  "type": "terminal_command",
  "command": "Get-NetTCPConnection -LocalPort 8080 | Select-Object OwningProcess",
  "dangerous": false
}

同样的输入在 bash 终端:
{
  "type": "terminal_command",
  "command": "lsof -i :8080",
  "dangerous": false
}
```

**LLM Prompt：**

```
你是 remotecli 的语音命令翻译器。

## 当前环境
- 终端类型: {terminal_type}   // powershell | bash | zsh | sh
- 操作系统: {os}              // windows | linux | macos
- 当前目录: {cwd}

## 任务
将用户的自然语言指令翻译为正确的终端命令。

## 输出格式 (JSON)
{
  "type": "terminal_command" | "terminal_input" | "claude_prompt" | "ui_action" | "clarification",
  "command": "具体命令",
  "explanation": "命令说明",
  "dangerous": false,
  "needs_confirm": false
}

## 规则
1. 根据终端类型生成对应语法正确的命令
2. 危险操作标记 dangerous: true
3. 意图不明确时返回 type: "clarification"
4. 用户想和 Claude 对话时返回 type: "claude_prompt"
```

### 5.4 安全机制

LLM 标记 `dangerous: true` 的命令，前端弹窗确认：

```
┌─────────────────────────────────────┐
│  ⚠️ 危险操作确认                      │
│                                     │
│  语音输入: "删除所有临时文件"          │
│  翻译命令: Remove-Item *.tmp -Force  │
│  说明: 删除当前目录下所有 .tmp 文件    │
│                                     │
│  [取消]  [确认执行]                   │
└─────────────────────────────────────┘
```

---

## 6. UI 动作地图（Action Map）

### 6.1 设计思路

类似 LLM 的 function calling，把整个 UI 的能力描述成结构化的 action schema，LLM 根据用户语音 + 当前 UI 状态选择正确的 action。

### 6.2 Action Map 结构

```json
{
  "version": "1.0.0",
  "generated_at": "2026-06-22T10:00:00Z",
  "current_state": {
    "current_view": "terminal",
    "active_tab_id": "tab-1",
    "terminal_type": "powershell",
    "cwd": "C:\\Users\\Admin",
    "sidebar_open": false
  },
  "actions": [
    {
      "id": "navigate_file_view",
      "description": "打开文件管理器面板",
      "category": "navigation",
      "params": { "path": { "type": "string", "description": "可选，指定目录路径" } },
      "available_when": "always"
    },
    {
      "id": "terminal_new_session",
      "description": "新建终端会话",
      "category": "terminal",
      "params": {},
      "available_when": "current_view == 'terminal'"
    },
    {
      "id": "terminal_scroll",
      "description": "终端内容滚动",
      "category": "terminal",
      "params": { "direction": { "type": "enum", "values": ["up","down","top","bottom"] } },
      "available_when": "current_view == 'terminal'"
    }
  ]
}
```

### 6.3 自动生成

每次构建/初始化时全自动扫描 Vue 源码生成：

| 扫描源 | 提取内容 | 输出 |
|-------|---------|------|
| `router/index.ts` | 所有路由路径和名称 | navigation actions |
| `stores/*.ts` | 所有 action 方法 | UI 动作条目 |
| `components/*.vue` | 暴露的操作按钮 | 带描述的动作条目 |

生成脚本：`pnpm gen:action-map`（构建时自动执行）

### 6.4 运行时

- Server 启动时加载 `action-map.json` 并缓存在内存中
- 前端通过 WebSocket 实时同步 UI 状态（`ui:state-sync`）
- **Action Map 不随每次请求传输**：Server 启动时一次性加载到内存，LLM 调用时由 Server 从内存中拼装 prompt，不需要每次从前端传递
- **Action Map 版本管理**：文件包含 `version` 和 `generated_at` 字段，Server 启动时检查文件修改时间，如已过期则自动重新生成。开发模式下可通过 `pnpm gen:action-map` 手动触发

---

## 7. 三种交互模式

### 7.1 模式定义

| 模式 | 触发方式 | VAD 行为 | 发送方式 |
|------|---------|---------|---------|
| **命令模式** | 默认模式 | 停顿 800ms 自动提交 LLM | 自动执行 |
| **终端命令模式** | LLM 判定为终端命令 | 停顿 1200ms 自动提交 | 自动注入终端 |
| **输入模式** | 说"输入" / 点击输入按钮 | 不自动发送 | 说"发送"/"输入完毕" / 点击按钮 / 回车 |

### 7.2 模式流转

```
用户点击 🎤 开始录音
         │
         ▼
   ┌─── 命令模式（默认）───┐
   │  停顿 800ms → 提交 LLM │
   │  LLM 判定:             │
   │   ├─ UI动作 → 执行     │
   │   ├─ 终端命令 → 自动注入│
   │   └─ 需要输入 → 进入输入模式
   └───────────────────────┘
              │
              ▼
   ┌─── 输入模式 ──────────┐
   │  语音累加到缓冲区       │
   │  不自动发送             │
   │  触发发送:              │
   │  • "发送"/"输入完毕"    │
   │  • 点击 [发送] 按钮     │
   │  • 回车键              │
   └───────────────────────┘
              │
              ▼ 发送后 → 回到命令模式
```

### 7.3 VAD 配置

```typescript
const VAD_DEFAULTS = {
  command_silence_ms: 800,          // 命令模式：行业推荐默认值
  terminal_command_silence_ms: 1200, // 终端命令：保守值，防止截断
  // input 模式不设超时，固定手动触发
};
```

这些值可在 Settings 页面由用户调整。

---

## 8. 音频管道与 WebSocket 协议

### 8.1 录音参数

- 采样率：16000 Hz（Whisper 标准）
- 位深：16-bit PCM
- 声道：单声道
- 分帧：每 100ms 发送一帧（流式传输）

### 8.2 VAD（前端负责）

**VAD 完全在前端执行**，前端根据当前交互模式使用对应的静音超时阈值，检测到语音结束后主动通知 Server。

```
录音开始 → 前端检测音频能量
  → 能量 > 阈值 → 发送音频帧 + 发送 voice:vad-state { speaking: true }
  → 能量 < 阈值 持续 N ms → 前端根据当前模式判断:
      • 命令模式 (800ms) → 发送 voice:vad-state { speaking: false, reason: "silence" }
      • 终端命令模式 (1200ms) → 同上
      • 输入模式 → 不发送 silence，仅累积文字
  → 用户手动停止 → 发送 voice:vad-state { speaking: false, reason: "manual" }
```

**关键：静音超时由前端控制**，因为前端持有音频流且能实时检测能量。Server 仅接收 VAD 状态信号，不自行判断静音。前端根据 Server 下发的当前模式（`voice:mode` 消息）选择对应的超时阈值。

### 8.3 WebSocket 消息协议

**上行（浏览器 → Server）：**

```typescript
{ type: "voice:start", payload: { sampleRate: 16000 } }
{ type: "voice:audio", payload: { chunk: ArrayBuffer, seq: number } }
{ type: "voice:vad-state", payload: { speaking: boolean, reason?: "silence" | "manual" } }  // VAD 状态信号
{ type: "voice:end", payload: {} }
{ type: "voice:send", payload: {} }         // 输入模式手动发送
{ type: "voice:cancel", payload: {} }       // 输入模式取消
```

**下行（Server → 浏览器）：**

```typescript
{ type: "voice:interim", payload: { text: "打开文件" } }
{ type: "voice:final", payload: { text: "打开文件管理器" } }
{ type: "voice:action", payload: { action_id: "navigate_file_view", feedback_tts: "已打开文件管理器" } }
{ type: "voice:mode", payload: { mode: "input", message: "好的，请继续输入" } }
{ type: "voice:tts", payload: { audio: ArrayBuffer, format: "mp3" } }
{ type: "voice:error", payload: { code: "stt_failed", message: "..." } }
```

---

## 9. TTS 反馈策略

### 9.1 播报规则

| 场景 | TTS 反馈 | 示例 |
|------|---------|------|
| UI 导航动作 | ✅ 播报 | "已打开文件管理器" |
| 终端命令执行 | ❌ 沉默 | 命令直接注入终端，`explanation` 字段仅显示在悬浮条文字区，不播报 |
| 终端命令出错 | ✅ 播报 | "命令执行失败：找不到路径" |
| Claude 对话转发 | ❌ 沉默 | 直接发送 |
| 模式切换 | ✅ 播报 | "好的，请继续输入" |
| 错误/异常 | ✅ 播报 | "语音服务暂时不可用" |
| 危险操作确认 | ✅ 播报 | "检测到危险操作，请在界面上确认" |

**原则：操作成功且用户能看到结果 → 不播报；操作结果不明显或出错 → 播报。**

### 9.2 Edge-TTS 配置

```typescript
const TTS_CONFIG = {
  voice: "zh-CN-XiaoxiaoNeural",
  rate: "+10%",
  maxLength: 30,  // 反馈文字上限，超过截断
};
```

---

## 10. 集成点

### 10.1 ActionExecutor 对接

```
ActionExecutor
  ├── TerminalManager
  │     ├── injectInput(text)
  │     ├── executeCommand(cmd)
  │     ├── scroll(direction)
  │     ├── clear()
  │     └── getCurrentShell() → "powershell" | "bash" | "zsh"
  │
  │  OS 信息来源：Agent 注册时上报 platform 字段（process.platform），
  │  Server 在 tunnel 连接建立时已存储 agent 的 os 元数据。
  │  LLM 上下文的 os 字段从 agent 元数据获取，无需前端额外传递。
  │
  ├── FileManager
  │     ├── navigate(path)
  │     ├── goUp()
  │     ├── refresh()
  │     └── openFile(name)
  │
  ├── ClaudeSession
  │     ├── sendPrompt(text)
  │     └── isStreaming()
  │
  ├── TabManager
  │     ├── create()
  │     ├── close(id)
  │     ├── switch(id|index)
  │     └── list()
  │
  └── Router (前端)
        ├── navigate(view)
        └── getCurrentView()
```

### 10.2 前端状态同步

```typescript
// 前端 → Server (WebSocket)
{ type: "ui:state-sync", payload: {
  currentView: "terminal",
  activeTabId: "tab-1",
  terminalType: "powershell",
  cwd: "C:\\Users\\Admin",
  claudeIsStreaming: false,
  tabCount: 3
}}
```

同步时机：视图切换、标签页变化、CWD 变化、Claude 回复状态变化。

---

## 11. 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| Groq API 超时/不可用 | TTS 播报 "语音服务暂时不可用" + 悬浮条显示错误 |
| Groq 频率限制 | 降级到浏览器 Web Speech API（如可用） |
| 完整降级链 | Groq 不可用 → Web Speech API → 纯文字模式（悬浮条仅作为文字输入框，无 STT）。降级切换时通过悬浮条文字通知用户 |
| Edge-TTS 失败 | 静默失败，仅悬浮条文字反馈 |
| 麦克风权限拒绝 | 悬浮条文字提示 "请授权麦克风" |
| LLM 返回无法解析 | 悬浮条显示 "无法理解，请换个说法" |
| LLM 返回畸形 JSON | 重试一次（附加 "请严格输出 JSON" 提示），仍失败则回退为终端原始输入 |
| LLM API 超时 | 悬浮条显示 "思考中..." 超时后回退为终端原始输入 |
| WebSocket 断开 | 自动重连，悬浮条显示 "连接中..." |
| 网络不稳定 | 音频本地缓存，恢复后重传 |

---

## 12. 配置项

```yaml
voice:
  enabled: true
  stt:
    provider: "groq"
    api_key: "${GROQ_API_KEY}"
    model: "whisper-large-v3-turbo"
    language: "zh"
  tts:
    provider: "edge-tts"
    voice: "zh-CN-XiaoxiaoNeural"
    rate: "+10%"
  llm:
    provider: "bailian"
    api_key: "${BAILIAN_API_KEY}"  # Coding Plan key
    model: "qwen3-coder-plus"
  vad:
    command_silence_ms: 800
    terminal_command_silence_ms: 1200
  ui:
    position: "top-center"
    auto_hide_ms: 5000
```

---

## 13. MVP 范围

### 第一阶段（完整 MVP）

- ✅ 顶部悬浮条 UI（最小化/命令模式/输入模式）
- ✅ 前端录音 + WebSocket 传输 + VAD
- ✅ Groq Whisper STT（流式）
- ✅ 命令词典（UI 导航）
- ✅ LLM 终端命令翻译（感知终端类型）
- ✅ LLM 意图兜底（使用 Action Map）
- ✅ Action Map 自动生成
- ✅ ActionExecutor 集成（终端/文件管理器/Claude/UI）
- ✅ Edge-TTS 语音反馈
- ✅ 危险操作确认
- ✅ 前端状态同步
- ✅ 错误处理 + 降级

### 后续迭代

- ❌ 流式 STT 中间结果实时显示优化
- ❌ 多语言支持（英语、日语等）
- ❌ 语音快捷键（跳过 LLM 直接映射）
- ❌ 对话上下文（连续语音对话记忆）
