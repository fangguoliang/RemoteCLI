import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { FileEntry } from '@remotecli/shared';

export class FileManager {
  private chunkSize = 1024 * 1024; // 1MB

  // 展开路径（处理 ~ 等）并规范化路径分隔符
  private expandPath(dirPath: string): string {
    let result = dirPath;

    // 处理 ~ 路径
    if (result === '~' || result.startsWith('~/') || result.startsWith('~\\')) {
      const home = os.homedir();
      if (result === '~') {
        return home;
      }
      return path.join(home, result.slice(2));
    }

    // 在 Unix 系统上，规范化路径分隔符（将 Windows 反斜杠转换为正斜杠）
    if (process.platform !== 'win32') {
      // 将反斜杠替换为正斜杠
      result = result.replace(/\\/g, '/');
    } else {
      // 在 Windows 上，将正斜杠替换为反斜杠
      result = result.replace(/\//g, '\\');
      // Handle Windows drive letters (e.g., "D:" -> "D:\\")
      if (/^[A-Za-z]:$/.test(result)) {
        return result + '\\';
      }
    }

    return result;
  }

  async browse(dirPath: string): Promise<{ path: string; entries: FileEntry[] }> {
    try {
      const expandedPath = this.expandPath(dirPath);
      const entries = await fs.readdir(expandedPath, { withFileTypes: true });
      const result: FileEntry[] = [];

      for (const entry of entries) {
        const fileEntry: FileEntry = {
          name: entry.name,
          isDirectory: entry.isDirectory(),
        };

        if (!entry.isDirectory()) {
          try {
            const stat = await fs.stat(path.join(expandedPath, entry.name));
            fileEntry.size = stat.size;
            fileEntry.modifiedAt = stat.mtimeMs;
          } catch {
            // 忽略无法访问的文件
          }
        } else {
          try {
            const stat = await fs.stat(path.join(expandedPath, entry.name));
            fileEntry.modifiedAt = stat.mtimeMs;
          } catch {
            // 忽略无法访问的目录
          }
        }

        result.push(fileEntry);
      }

      // 目录在前，然后按名称排序
      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return { path: expandedPath, entries: result };
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'ENOENT') {
        throw new Error('DIR_NOT_FOUND');
      }
      if (error.code === 'EACCES') {
        throw new Error('PERMISSION_DENIED');
      }
      throw err;
    }
  }

  async readFileChunked(
    filePath: string,
    onChunk: (data: { chunkIndex: number; totalChunks: number; totalSize: number; content: string }) => void
  ): Promise<void> {
    try {
      const expandedPath = this.expandPath(filePath);
      const stat = await fs.stat(expandedPath);

      if (stat.isDirectory()) {
        throw new Error('IS_DIRECTORY');
      }

      const totalSize = stat.size;
      const totalChunks = Math.ceil(totalSize / this.chunkSize);

      const handle = await fs.open(expandedPath, 'r');

      try {
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const start = chunkIndex * this.chunkSize;
          const length = Math.min(this.chunkSize, totalSize - start);
          const buffer = Buffer.alloc(length);

          await handle.read(buffer, 0, length, start);
          const content = buffer.toString('base64');

          onChunk({ chunkIndex, totalChunks, totalSize, content });
        }
      } finally {
        await handle.close();
      }
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'ENOENT') {
        throw new Error('FILE_NOT_FOUND');
      }
      if (error.code === 'EACCES') {
        throw new Error('PERMISSION_DENIED');
      }
      throw err;
    }
  }

  private uploadBuffers = new Map<string, { chunks: Map<number, string>; totalChunks: number; totalSize: number }>();

  startUpload(sessionId: string, totalChunks: number, totalSize: number): void {
    this.uploadBuffers.set(sessionId, {
      chunks: new Map(),
      totalChunks,
      totalSize,
    });
  }

  writeChunk(
    sessionId: string,
    chunkIndex: number,
    content: string
  ): { done: boolean; percent: number } {
    const upload = this.uploadBuffers.get(sessionId);
    if (!upload) {
      throw new Error('UPLOAD_NOT_FOUND');
    }

    upload.chunks.set(chunkIndex, content);
    const percent = Math.round((upload.chunks.size / upload.totalChunks) * 100);

    return {
      done: upload.chunks.size === upload.totalChunks,
      percent,
    };
  }

  async completeUpload(sessionId: string, filePath: string): Promise<void> {
    const upload = this.uploadBuffers.get(sessionId);
    if (!upload) {
      throw new Error('UPLOAD_NOT_FOUND');
    }

    const expandedPath = this.expandPath(filePath);

    try {
      // 确保目录存在
      const dir = path.dirname(expandedPath);
      await fs.mkdir(dir, { recursive: true });

      // 合并所有块并写入文件
      const handle = await fs.open(expandedPath, 'w');

      try {
        for (let i = 0; i < upload.totalChunks; i++) {
          const content = upload.chunks.get(i);
          if (!content) {
            throw new Error(`Missing chunk ${i}`);
          }
          const buffer = Buffer.from(content, 'base64');
          await handle.write(buffer, 0, buffer.length, i * this.chunkSize);
        }
      } finally {
        await handle.close();
      }
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'EACCES') {
        throw new Error('PERMISSION_DENIED');
      }
      if (error.code === 'ENOSPC') {
        throw new Error('DISK_FULL');
      }
      throw err;
    } finally {
      this.uploadBuffers.delete(sessionId);
    }
  }

  cancelUpload(sessionId: string): void {
    this.uploadBuffers.delete(sessionId);
  }

  // Validate filename safety
  private validateFileName(fileName: string): void {
    if (!fileName || !fileName.trim()) {
      throw new Error('INVALID_FILENAME: empty');
    }
    if (/[<>:"/\\|?*\x00-\x1f]/.test(fileName)) {
      throw new Error('INVALID_FILENAME: illegal characters');
    }
    if (/^[\s.]+$/.test(fileName)) {
      throw new Error('INVALID_FILENAME: dots or spaces only');
    }
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      throw new Error('INVALID_FILENAME: path traversal');
    }
  }

  // Create a new empty file
  async createFile(dirPath: string, fileName: string): Promise<{ path: string }> {
    this.validateFileName(fileName);
    const expandedDir = this.expandPath(dirPath);
    const filePath = path.join(expandedDir, fileName);

    // Security: resolved path must be within target directory
    const resolvedDir = path.resolve(expandedDir);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
      throw new Error('PATH_TRAVERSAL');
    }

    // Check if file already exists
    try {
      await fs.access(filePath);
      throw new Error('FILE_ALREADY_EXISTS');
    } catch (err: any) {
      if (err.message === 'FILE_ALREADY_EXISTS' || err.code === 'FILE_ALREADY_EXISTS') throw err;
      // ENOENT = file doesn't exist, proceed
    }

    await fs.writeFile(filePath, '', 'utf-8');
    return { path: filePath };
  }

  // Rename a file
  async renameFile(oldPath: string, newName: string): Promise<void> {
    this.validateFileName(newName);
    const expandedOld = this.expandPath(oldPath);
    const dir = path.dirname(expandedOld);
    const newPath = path.join(dir, newName);

    const resolvedDir = path.resolve(dir);
    const resolvedNew = path.resolve(newPath);
    if (!resolvedNew.startsWith(resolvedDir + path.sep)) {
      throw new Error('PATH_TRAVERSAL');
    }

    await fs.rename(expandedOld, newPath);
  }

  // Delete a file or directory
  async deleteFile(filePath: string, isDirectory: boolean): Promise<void> {
    const expandedPath = this.expandPath(filePath);
    if (isDirectory) {
      await fs.rm(expandedPath, { recursive: true });
    } else {
      await fs.unlink(expandedPath);
    }
  }
}