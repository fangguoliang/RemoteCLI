import * as pty from 'node-pty';
import { getShell } from './shell.js';

export interface PtySession {
  pty: pty.IPty;
  sessionId: string;
  cols: number;
  rows: number;
  onDataCallback: ((data: string) => void) | null;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();
  private sessionTimeouts = new Map<string, NodeJS.Timeout>();
  private sessionBuffers = new Map<string, string[]>();
  private TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  create(sessionId: string, cols: number = 80, rows: number = 24, onData: (data: string) => void): PtySession {
    const { shell, args } = getShell();
    const cwd = process.platform === 'win32'
      ? (process.env.USERPROFILE || process.cwd())
      : (process.env.HOME || process.cwd());

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
    };

    ptyProcess.onData((data) => {
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

  // Internal cleanup
  private cleanupSession(sessionId: string): void {
    // Clear timeout if exists
    const timeout = this.sessionTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionId);
    }

    // Clear buffer
    this.sessionBuffers.delete(sessionId);

    // Remove session
    this.sessions.delete(sessionId);
  }

  get(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId);
  }
}