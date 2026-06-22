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
