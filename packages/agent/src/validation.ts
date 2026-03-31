// packages/agent/src/validation.ts
import * as path from 'path';
import * as fs from 'fs';
import { PtyManager } from './pty.js';
import type { FileValidatePayload, FileValidatedPayload } from '@remotecli/shared';

export function validateFilePath(
  payload: FileValidatePayload,
  ptyManager: PtyManager
): FileValidatedPayload {
  const { path: inputPath, sessionId } = payload;

  // Get working directory from PtyManager
  const cwd = ptyManager.getWorkingDirectory(sessionId);
  if (!cwd) {
    return {
      originalPath: inputPath,
      resolvedPath: inputPath,
      exists: false,
      error: 'Session not found or no working directory',
    };
  }

  // Resolve relative paths
  let resolvedPath = inputPath;
  if (!inputPath.match(/^[A-Za-z]:/)) {
    // Relative path - resolve against cwd
    resolvedPath = path.resolve(cwd, inputPath);
  }

  // Check existence
  let exists = false;
  try {
    exists = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile();
  } catch {
    exists = false;
  }

  return {
    originalPath: inputPath,
    resolvedPath,
    exists,
    error: exists ? undefined : 'File not found',
  };
}