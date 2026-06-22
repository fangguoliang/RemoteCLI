import { spawn, ChildProcess } from 'child_process';
import { voiceConfig } from './voiceConfig.js';
import { EventEmitter } from 'events';

export interface VoiceInterpretPayload {
  sessionId: string;
  text: string;
}

export interface VoiceActionResult {
  sessionId: string;
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

interface StreamJsonEvent {
  type: string;
  payload?: unknown;
}

export class VoiceLLM extends EventEmitter {
  private claudeProcess: ChildProcess | null = null;
  private currentSessionId: string | null = null;
  private responseTimeout: NodeJS.Timeout | null = null;
  private restartCount = 0;
  private isReady = false;
  private buffer = '';
  private pendingResolve: ((value: unknown) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;

  constructor() {
    super();
    this.startClaudeProcess();
  }

  private startClaudeProcess(): void {
    console.log('[VoiceLLM] Starting Claude Code process...');

    try {
      this.claudeProcess = spawn(voiceConfig.claudeCodePath, voiceConfig.claudeCodeArgs, {
        cwd: voiceConfig.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.claudeProcess.stdout?.on('data', (chunk: Buffer) => {
        this.handleOutput(chunk.toString());
      });

      this.claudeProcess.stderr?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString();
        console.error('[VoiceLLM] stderr:', msg);
      });

      this.claudeProcess.on('exit', (code: number | null, signal: string | null) => {
        console.log(`[VoiceLLM] Process exited with code ${code}, signal ${signal}`);
        this.isReady = false;

        if (this.pendingReject) {
          const err = new Error(`Claude Code process exited unexpectedly (code: ${code})`);
          this.pendingReject(err);
          this.pendingReject = null;
          this.pendingResolve = null;
        }

        // Auto-restart on crash (if within limits)
        if (this.restartCount < voiceConfig.maxRestarts) {
          console.log(`[VoiceLLM] Restarting... attempt ${this.restartCount + 1}/${voiceConfig.maxRestarts}`);
          this.restartCount++;
          setTimeout(() => this.startClaudeProcess(), 1000);
        } else {
          console.error('[VoiceLLM] Max restart attempts reached. Voice features disabled.');
          this.emit('error', new Error('Max restart attempts reached'));
        }
      });

      this.claudeProcess.on('error', (err: Error) => {
        console.error('[VoiceLLM] Failed to start process:', err.message);
        this.isReady = false;

        if (this.pendingReject) {
          this.pendingReject(err);
          this.pendingReject = null;
          this.pendingResolve = null;
        }
      });

      // Wait for process to be ready
      this.isReady = true;
      console.log('[VoiceLLM] Claude Code process started successfully');
    } catch (err) {
      console.error('[VoiceLLM] Failed to spawn Claude Code:', err);
      throw err;
    }
  }

  private handleOutput(data: string): void {
    this.buffer += data;

    // Process complete JSON lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line) as StreamJsonEvent;
        this.processEvent(event);
      } catch (err) {
        console.warn('[VoiceLLM] Failed to parse stream-json:', line.substring(0, 100));
      }
    }
  }

  private processEvent(event: StreamJsonEvent): void {
    // Handle different stream-json event types
    switch (event.type) {
      case 'result':
        // Final result from Claude Code
        if (this.pendingResolve) {
          clearTimeout(this.responseTimeout!);
          this.responseTimeout = null;
          this.pendingResolve(event.payload);
          this.pendingResolve = null;
          this.pendingReject = null;
          this.currentSessionId = null;
        }
        break;

      case 'assistant':
        // Assistant message - could contain actions
        if (this.pendingResolve) {
          // Resolve with assistant message for further processing
          clearTimeout(this.responseTimeout!);
          this.responseTimeout = null;
          this.pendingResolve({
            type: 'assistant',
            content: event.payload,
          });
          this.pendingResolve = null;
          this.pendingReject = null;
          this.currentSessionId = null;
        }
        break;

      case 'error':
        // Error from Claude Code
        if (this.pendingReject) {
          clearTimeout(this.responseTimeout!);
          this.responseTimeout = null;
          this.pendingReject(new Error(typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload)));
          this.pendingReject = null;
          this.pendingResolve = null;
          this.currentSessionId = null;
        }
        break;

      default:
        // Ignore other event types (user, system, etc.)
        break;
    }
  }

  async interpret(payload: VoiceInterpretPayload): Promise<VoiceActionResult> {
    if (!this.isReady || !this.claudeProcess) {
      return {
        sessionId: payload.sessionId,
        action: '',
        success: false,
        error: 'VoiceLLM not ready',
      };
    }

    if (this.currentSessionId) {
      return {
        sessionId: payload.sessionId,
        action: '',
        success: false,
        error: 'Another request is being processed',
      };
    }

    this.currentSessionId = payload.sessionId;

    return new Promise<VoiceActionResult>((resolve, reject) => {
      this.pendingResolve = (value: unknown) => {
        // Parse the LLM response to extract action
        const action = this.extractAction(value);
        resolve({
          sessionId: payload.sessionId,
          action: action.command || '',
          success: true,
          result: action,
        });
      };

      this.pendingReject = (err: Error) => {
        reject(err);
      };

      // Send the prompt to Claude Code via stdin
      const prompt = `Interpret this voice command and return a JSON object with the action to take.
Voice command: "${payload.text}"

Return ONLY a JSON object in this format:
{
  "command": "the PowerShell command to execute",
  "description": "what this command does"
}

If the command is unsafe or unclear, return:
{
  "command": "",
  "description": "Could not interpret command safely"
}`;

      this.claudeProcess!.stdin!.write(prompt + '\n');

      // Set timeout
      this.responseTimeout = setTimeout(() => {
        if (this.pendingReject) {
          this.pendingReject(new Error('Voice interpretation timed out'));
          this.pendingReject = null;
          this.pendingResolve = null;
          this.currentSessionId = null;
        }
      }, voiceConfig.timeoutMs);
    });
  }

  private extractAction(value: unknown): { command: string; description: string } {
    if (typeof value !== 'object' || value === null) {
      return { command: '', description: '' };
    }

    const payload = value as Record<string, unknown>;

    // Check if it's an assistant message wrapper
    if (payload.type === 'assistant' && payload.content) {
      const content = payload.content as Record<string, unknown>;
      if (content.content) {
        // Try to parse the content as JSON
        try {
          const parsed = JSON.parse(content.content as string);
          return {
            command: parsed.command || '',
            description: parsed.description || '',
          };
        } catch {
          // Content is not JSON, use as-is
          return {
            command: content.content as string,
            description: '',
          };
        }
      }
    }

    // Direct result
    return {
      command: (payload.command as string) || '',
      description: (payload.description as string) || '',
    };
  }

  destroy(): void {
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout);
    }

    if (this.claudeProcess) {
      console.log('[VoiceLLM] Destroying Claude Code process');
      this.claudeProcess.kill();
      this.claudeProcess = null;
    }

    this.isReady = false;
    this.removeAllListeners();
  }

  get ready(): boolean {
    return this.isReady;
  }
}
