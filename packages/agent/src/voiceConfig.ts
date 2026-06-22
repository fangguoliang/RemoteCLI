import 'dotenv/config';

export interface VoiceConfig {
  claudeCodePath: string;
  claudeCodeArgs: string[];
  timeoutMs: number;
  maxRestarts: number;
  workingDirectory: string;
}

export const voiceConfig: VoiceConfig = {
  // Path to claude CLI (default: 'claude' from PATH)
  claudeCodePath: process.env.CLAUDE_CODE_PATH || 'claude',

  // Arguments to pass to claude CLI for stream-json mode
  claudeCodeArgs: [
    '--output-format', 'stream-json',
    '--allowedTools', 'Bash,Edit,Glob,Grep,Read,Write',
  ],

  // Timeout for LLM responses (milliseconds)
  timeoutMs: parseInt(process.env.VOICE_LLM_TIMEOUT_MS || '10000', 10),

  // Maximum restart attempts before giving up
  maxRestarts: 3,

  // Working directory for Claude Code sessions
  workingDirectory: process.env.VOICE_WORKING_DIR || process.cwd(),
};
