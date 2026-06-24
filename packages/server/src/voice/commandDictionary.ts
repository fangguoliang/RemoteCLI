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
    try {
      const data = JSON.parse(readFileSync(configPath, 'utf-8'));
      this.commands = data.commands || [];
    } catch {
      // commands.json is optional - use empty commands if not found
      this.commands = [];
    }
  }

  match(text: string): DictionaryMatch | null {
    const normalized = text.trim();

    // Dynamic command parsing first
    const dynamicMatch = this.parseDynamicCommands(normalized);
    if (dynamicMatch) {
      return dynamicMatch;
    }

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

  private parseDynamicCommands(text: string): DictionaryMatch | null {
    // 导航命令的动态解析（优先级最高，先于其他动态命令）
    const navMatch = this.parseNavigationCommands(text);
    if (navMatch) return navMatch;

    // 切换到X盘 / 去X盘 / 打开X盘 / 切换到X的地盘/低盘（语音识别误差）
    const driveMatch = text.match(/(?:切换|去|打开|进入)(?:到)?([A-Za-z])(?:的)?地盘?/) ||
                       text.match(/(?:切换|去|打开|进入)(?:到)?([A-Za-z])盘/) ||
                       text.match(/(?:切换|去|打开|进入)(?:到)?(低|地|底)(?:的)?盘/) ||  // 低盘、地盘、底盘
                       text.match(/([A-Za-z])盘发送/) ||  // X盘发送
                       text.match(/(低|地|底)盘发送/);    // 低盘发送、地盘发送、底盘发送
    if (driveMatch) {
      let drive = driveMatch[1].toUpperCase();
      // 处理中文误识别
      if (drive === '低' || drive === '地' || drive === '底') {
        drive = 'D';  // 默认映射到 D 盘
      }
      console.log(`[CommandDictionary] Drive command matched: ${drive}: (from "${text}")`);
      return {
        action_id: 'terminal_command',
        params: { command: `${drive}:` }
      };
    }

    // 切换到X目录 / 去X目录 / cd X（但不包含"盘"字）
    const dirMatch = text.match(/(?:切换|去|进入|cd)(?:到)?\s*([^，。！？\s]+?)(?:目录|文件夹)?$/);
    if (dirMatch && !text.includes('盘') && !text.includes('低') && !text.includes('地') && !text.includes('底')) {
      const dir = dirMatch[1].trim();
      if (dir && !dir.match(/^(发送|执行|运行|确认)$/) && !dir.match(/^(终端|文件|设置)/)) {
        console.log(`[CommandDictionary] Directory command matched: cd "${dir}" (from "${text}")`);
        return {
          action_id: 'terminal_command',
          params: { command: `cd "${dir}"` }
        };
      }
    }

    // 发送 / 执行 / 运行（但只有在没有其他命令时才匹配）
    if (/(?:发送|执行|运行|确认)/.test(text)) {
      // 检查是否包含其他命令关键词，如果有则不匹配"发送"
      if (!text.match(/(?:切换|去|打开|进入|cd)/)) {
        // 尝试提取"执行/运行"后面的命令
        const cmdMatch = text.match(/(?:执行|运行)\s*([^，。！？\s]+)/);
        if (cmdMatch && cmdMatch[1]) {
          const cmd = cmdMatch[1].trim();
          // 排除无意义的词
          if (cmd && !cmd.match(/^(命令|一下|这个|那个|它)$/)) {
            console.log(`[CommandDictionary] Execute command matched: "${cmd}" (from "${text}")`);
            return {
              action_id: 'terminal_command',
              params: { command: cmd }
            };
          }
        }
        // 没有提取到命令，才匹配为回车
        console.log(`[CommandDictionary] Enter command matched (from "${text}")`);
        return {
          action_id: 'terminal_enter',
          params: {}
        };
      }
    }

    return null;
  }

  private parseNavigationCommands(text: string): DictionaryMatch | null {
    // 终端相关导航
    // 匹配模式：(帮我)?(切换|切|回|去)(到|回)?终端(页面)?(发送)?
    if (/(?:帮我|请)?\s*(?:切换|切|回|去)(?:到|回)?\s*终端/.test(text)) {
      console.log(`[CommandDictionary] Navigation: terminal (from "${text}")`);
      return { action_id: 'navigate_terminal', params: {} };
    }
    // 单独的"终端"（如果包含"打开"、"去"等动作词）
    if (/(?:打开|进入|显示).{0,2}终端/.test(text)) {
      console.log(`[CommandDictionary] Navigation: terminal (from "${text}")`);
      return { action_id: 'navigate_terminal', params: {} };
    }

    // 文件管理器相关导航
    if (/(?:帮我|请)?\s*(?:切换|切|去|打开)(?:到)?\s*(?:文件|文件管理)/.test(text)) {
      console.log(`[CommandDictionary] Navigation: file_view (from "${text}")`);
      return { action_id: 'navigate_file_view', params: {} };
    }

    // 设置相关导航
    if (/(?:帮我|请)?\s*(?:切换|切|去|打开)(?:到)?\s*设置/.test(text)) {
      console.log(`[CommandDictionary] Navigation: settings (from "${text}")`);
      return { action_id: 'navigate_settings', params: {} };
    }

    return null;
  }
}
