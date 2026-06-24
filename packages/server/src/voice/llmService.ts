// packages/server/src/voice/llmService.ts
// 服务器端 LLM 直接调用服务 - 当 agent 不可用时作为后备
import https from 'https';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface LLMConfig {
  provider: 'openai' | 'baidu' | 'none';
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  // Baidu 专用
  baiduApiKey?: string;
  baiduSecretKey?: string;
}

interface ActionMapEntry {
  id: string;
  type: string;
  description: string;
  utterances?: string[];
  params?: Record<string, unknown>;
}

interface LLMActionMatch {
  action_id: string;
  params?: Record<string, unknown>;
  confidence: number;
}

// 内置 UI 导航操作清单（当 actionMap.json 加载失败时使用）
const BUILTIN_ACTIONS: ActionMapEntry[] = [
  { id: 'navigate_file_view', type: 'navigation', description: '打开/切换到文件管理器页面' },
  { id: 'navigate_terminal', type: 'navigation', description: '打开/切换到终端页面' },
  { id: 'navigate_settings', type: 'navigation', description: '打开/切换到设置页面' },
  { id: 'navigate_login', type: 'navigation', description: '打开登录页面' },
  { id: 'terminal_new_session', type: 'terminal', description: '新建终端会话/标签' },
  { id: 'terminal_close_session', type: 'terminal', description: '关闭当前终端会话/标签' },
  { id: 'terminal_scroll_up', type: 'terminal', description: '向上滚动终端' },
  { id: 'terminal_scroll_down', type: 'terminal', description: '向下滚动终端' },
  { id: 'terminal_clear', type: 'terminal', description: '清屏/清空终端' },
  { id: 'terminal_copy', type: 'terminal', description: '复制选中内容' },
  { id: 'terminal_paste', type: 'terminal', description: '粘贴内容' },
  { id: 'file_go_up', type: 'file', description: '返回上级目录' },
  { id: 'file_refresh', type: 'file', description: '刷新文件列表' },
  { id: 'voice_stop', type: 'voice', description: '停止录音/关闭语音' },
  { id: 'voice_minimize', type: 'voice', description: '最小化语音面板' },
];

export class LLMService {
  private config: LLMConfig;
  private actionMap: ActionMapEntry[] = [];
  private baiduAccessToken: string | null = null;
  private baiduTokenExpireTime = 0;

  constructor(config: LLMConfig) {
    this.config = config;
    this.loadActionMap();
  }

  private loadActionMap(): void {
    try {
      const actionMapPath = join(__dirname, 'actionMap.json');
      const data = JSON.parse(readFileSync(actionMapPath, 'utf-8'));
      // 转换 actionMap.json 格式到内部格式
      this.actionMap = (data.actions || []).map((a: any) => ({
        id: a.id.replace(':', '_'),  // navigate:terminal -> navigate_terminal
        type: a.type,
        description: a.description,
        utterances: a.utterances,
        params: a.params,
      }));
      console.log(`[LLMService] Loaded ${this.actionMap.length} actions from actionMap.json`);
    } catch (err) {
      console.log('[LLMService] Failed to load actionMap.json, using built-in actions');
      this.actionMap = BUILTIN_ACTIONS;
    }

    // 合并 commands.json 的导航动作（如果不在 actionMap 中）
    try {
      const commandsPath = join(__dirname, 'commands.json');
      const commandsData = JSON.parse(readFileSync(commandsPath, 'utf-8'));
      for (const cmd of commandsData.commands || []) {
        if (cmd.action_id.startsWith('navigate_')) {
          const existing = this.actionMap.find(a => a.id === cmd.action_id);
          if (!existing) {
            // 从 keywords 推断描述
            const desc = cmd.keywords.slice(0, 3).join('/');
            this.actionMap.push({
              id: cmd.action_id,
              type: 'navigation',
              description: desc,
              utterances: cmd.keywords,
              params: cmd.params,
            });
          }
        }
      }
    } catch {
      // commands.json is optional
    }

    console.log(`[LLMService] Total actions available: ${this.actionMap.length}`);
  }

  async interpretVoiceCommand(text: string): Promise<LLMActionMatch | null> {
    console.log(`[LLMService] interpretVoiceCommand called for: "${text}"`);
    console.log(`[LLMService] Provider: ${this.config.provider}, API URL: ${this.config.apiUrl || 'default'}`);

    if (this.config.provider === 'none') {
      console.log('[LLMService] LLM provider is "none", skipping LLM interpretation');
      return null;
    }

    // 构建 UI 操作清单的简洁描述
    const actionList = this.actionMap
      .filter(a => a.type === 'navigation' || a.type === 'voice' || a.type === 'terminal' || a.id.includes('session'))
      .map(a => `- ${a.id}: ${a.description}`)
      .join('\n');

    console.log(`[LLMService] Action list for LLM (${this.actionMap.filter(a => a.type === 'navigation' || a.type === 'voice').length} actions):`);
    console.log(actionList);

    const prompt = `你是一个语音命令解析器。根据用户的语音文本，从下面的 UI 操作清单中选择最匹配的一个。

## UI 操作清单
${actionList}

## 用户语音文本
"${text}"

## 输出要求
只输出一个 JSON 对象，不要输出其他内容：
{"action_id": "匹配的action_id", "confidence": 0.0到1.0的置信度}

如果用户的语音不是 UI 导航命令（比如是要执行的终端命令），返回：
{"action_id": null, "confidence": 0}

## 重要区分规则
- **navigate_terminal** = 切换到终端页面（用户说"切到终端"、"回终端页面"、"去终端"时选择）
- **session_create** = 创建新的终端会话（用户说"打开终端"、"新建终端"、"创建会话"、"打开在线终端"、"打开一个新的终端"时选择）
- **navigate_file_view** = 切换到文件管理页面（用户说"切到文件"、"打开文件管理"时选择）

当用户说"打开"、"新建"、"创建"终端相关词汇时，优先选择 session_create。
当用户说"切换"、"切到"、"回到"、"去"某个页面时，选择对应的 navigate_xxx。`;

    try {
      let response: string;

      if (this.config.provider === 'openai') {
        response = await this.callOpenAI(prompt);
      } else if (this.config.provider === 'baidu') {
        response = await this.callBaiduERNIE(prompt);
      } else {
        return null;
      }

      // 解析 LLM 响应
      const match = this.parseLLMResponse(response);
      if (match && match.action_id && match.confidence > 0.5) {
        console.log(`[LLMService] LLM matched: "${text}" -> ${match.action_id} (confidence: ${match.confidence})`);
        return match;
      }

      console.log(`[LLMService] LLM returned low confidence for: "${text}" -> ${JSON.stringify(match)}`);
      return null;
    } catch (err) {
      console.error('[LLMService] LLM interpretation failed:', err);
      return null;
    }
  }

  private parseLLMResponse(response: string): LLMActionMatch | null {
    try {
      // 尝试从响应中提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action_id: parsed.action_id || '',
        params: parsed.params,
        confidence: parsed.confidence || 0,
      };
    } catch {
      console.warn('[LLMService] Failed to parse LLM response:', response.substring(0, 200));
      return null;
    }
  }

  private callOpenAI(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const apiUrl = this.config.apiUrl || 'https://api.openai.com/v1/chat/completions';
      const urlObj = new URL(apiUrl);

      const body = JSON.stringify({
        model: this.config.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '你是语音命令解析器。只输出 JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 100,
      });

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.choices?.[0]?.message?.content) {
              resolve(json.choices[0].message.content);
            } else {
              reject(new Error('Invalid OpenAI response: ' + data.substring(0, 200)));
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private async callBaiduERNIE(prompt: string): Promise<string> {
    // 先获取 access token
    const token = await this.getBaiduAccessToken();

    return new Promise((resolve, reject) => {
      const model = this.config.model || 'ernie-speed-128k';
      const url = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${token}`;
      const urlObj = new URL(url);

      const body = JSON.stringify({
        messages: [
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_output_tokens: 100,
      });

      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.result) {
              resolve(json.result);
            } else {
              reject(new Error('Invalid Baidu response: ' + data.substring(0, 200)));
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private getBaiduAccessToken(): Promise<string> {
    // 如果 token 还有效（5分钟内过期），直接返回
    if (this.baiduAccessToken && Date.now() < this.baiduTokenExpireTime - 300000) {
      return Promise.resolve(this.baiduAccessToken);
    }

    return new Promise((resolve, reject) => {
      const apiKey = this.config.baiduApiKey || this.config.apiKey;
      const secretKey = this.config.baiduSecretKey;

      if (!apiKey || !secretKey) {
        reject(new Error('Baidu API key or secret key not configured'));
        return;
      }

      const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;
      const urlObj = new URL(url);

      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': 0,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.access_token) {
              this.baiduAccessToken = json.access_token;
              this.baiduTokenExpireTime = Date.now() + (json.expires_in * 1000);
              resolve(json.access_token);
            } else {
              reject(new Error('Failed to get Baidu access token: ' + data.substring(0, 200)));
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }
}
