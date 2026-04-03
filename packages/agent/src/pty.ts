import * as pty from 'node-pty';
import { getShell } from './shell.js';

export interface PtySession {
  pty: pty.IPty;
  sessionId: string;
  cols: number;
  rows: number;
  onDataCallback: ((data: string) => void) | null;
  workingDirectory: string;  // Track current working directory
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();
  private sessionTimeouts = new Map<string, NodeJS.Timeout>();
  private sessionBuffers = new Map<string, string[]>();
  private promptBuffers = new Map<string, string>();  // Buffer for prompt parsing
  private TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  create(sessionId: string, cols: number = 80, rows: number = 24, onData: (data: string) => void): PtySession {
    const { shell, args } = getShell();
    const cwd = process.platform === 'win32'
      ? (process.env.USERPROFILE || process.cwd())
      : (process.env.HOME || process.cwd());

    console.log(`[PtyManager] Creating PTY: shell=${shell}, args=${JSON.stringify(args)}, cwd=${cwd}`);

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as { [key: string]: string },
    });

    const session: PtySession = {
      pty: ptyProcess,
      sessionId,
      cols,
      rows,
      onDataCallback: onData,
      workingDirectory: cwd,  // Initialize with spawn cwd
    };

    ptyProcess.onData((data) => {
      // Update working directory from PowerShell prompt
      // Buffer data to handle prompts that span multiple callbacks
      let promptBuffer = this.promptBuffers.get(sessionId) || '';
      promptBuffer += data;

      // Try to match prompt in the buffer
      const newDir = this.parsePromptForDirectory(promptBuffer);
      if (newDir) {
        session.workingDirectory = newDir;
        // Clear buffer after successful match (keep last 500 chars for partial matches)
        this.promptBuffers.set(sessionId, promptBuffer.slice(-500));
      } else {
        // Keep buffer for next callback (but limit size)
        this.promptBuffers.set(sessionId, promptBuffer.slice(-1000));
      }

      if (session.onDataCallback) {
        session.onDataCallback(data);
      } else {
        // Buffer output if no callback (paused session)
        const buffer = this.sessionBuffers.get(sessionId);
        if (buffer) {
          buffer.push(data);
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`Session ${sessionId} exited with code ${exitCode}`);
      this.cleanupSession(sessionId);
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pty.write(data);
    return true;
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    return true;
  }

  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pty.kill();
    this.cleanupSession(sessionId);
    return true;
  }

  // Pause a session (browser disconnected but PTY keeps running)
  pause(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    console.log(`Pausing session ${sessionId}`);
    session.onDataCallback = null;

    // Start buffering output
    this.sessionBuffers.set(sessionId, []);

    // Set timeout to close session if not resumed
    const timeout = setTimeout(() => {
      console.log(`Session ${sessionId} timed out after 30 minutes, closing`);
      this.close(sessionId);
    }, this.TIMEOUT_MS);
    this.sessionTimeouts.set(sessionId, timeout);

    return true;
  }

  // Resume a paused session
  resume(sessionId: string, onData: (data: string) => void): { success: boolean; bufferedOutput?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false };

    console.log(`Resuming session ${sessionId}`);

    // Clear timeout
    const timeout = this.sessionTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionId);
    }

    // Get buffered output
    let bufferedOutput = '';
    const buffer = this.sessionBuffers.get(sessionId);
    if (buffer && buffer.length > 0) {
      bufferedOutput = buffer.join('');
    }
    this.sessionBuffers.delete(sessionId);

    // Restore callback
    session.onDataCallback = onData;

    // Send buffered output immediately
    if (bufferedOutput) {
      onData(bufferedOutput);
    }

    return { success: true, bufferedOutput };
  }

  // Check if a session exists
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  // Get the current working directory of a session
  getWorkingDirectory(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    return session?.workingDirectory ?? null;
  }

  // Internal cleanup
  private cleanupSession(sessionId: string): void {
    // Clear timeout if exists
    const timeout = this.sessionTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionId);
    }

    // Clear buffers
    this.sessionBuffers.delete(sessionId);
    this.promptBuffers.delete(sessionId);

    // Remove session
    this.sessions.delete(sessionId);
  }

  get(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId);
  }

  // Parse PowerShell prompt to extract current working directory
  private parsePromptForDirectory(data: string): string | null {
    // Strip ANSI escape codes first (PowerShell prompts often have colors)
    const cleanData = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    // PowerShell prompt format: "PS D:\project> " or "PS C:\Users\admin> "
    // Also handle paths with spaces: "PS D:\my project\folder> "
    const promptMatch = cleanData.match(/PS\s+([A-Za-z]:[^\r\n>]+)>/);
    if (promptMatch) {
      const dir = promptMatch[1].trim();
      console.log(`[PtyManager] Parsed working directory from prompt: ${dir}`);
      return dir;
    }

    // Debug: log when we receive data but can't parse prompt
    if (cleanData.includes('PS ') && cleanData.includes('>')) {
      console.log(`[PtyManager] Prompt detected but not matched, data snippet: ${cleanData.substring(0, 100)}`);
    }

    return null;
  }
}