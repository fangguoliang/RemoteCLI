// packages/server/src/__tests__/actionExecutor.test.ts
import { describe, it, expect } from 'vitest';
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
