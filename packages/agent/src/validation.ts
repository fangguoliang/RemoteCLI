// packages/agent/src/validation.ts
import * as path from 'path';
import * as fs from 'fs';
import { PtyManager } from './pty.js';
import type { FileValidatePayload, FileValidatedPayload } from '@remotecli/shared';

export function validateFilePath(
  payload: FileValidatePayload,
  sessionId: string,
  ptyManager: PtyManager
): FileValidatedPayload {
  const { path: inputPath } = payload;

  // Get working directory from PtyManager
  const cwd = ptyManager.getWorkingDirectory(sessionId);
  console.log(`[validation] validateFilePath: inputPath=${inputPath}, sessionId=${sessionId}, cwd=${cwd}`);

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
    console.log(`[validation] Resolved relative path: ${inputPath} -> ${resolvedPath}`);
  }

  // Check existence
  let exists = false;
  try {
    exists = fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile();
  } catch {
    exists = false;
  }

  console.log(`[validation] Final result: resolvedPath=${resolvedPath}, exists=${exists}`);

  return {
    originalPath: inputPath,
    resolvedPath,
    exists,
    error: exists ? undefined : 'File not found',
  };
}