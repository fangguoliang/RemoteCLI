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
