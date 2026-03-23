import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { FileEntry } from '@remotecli/shared';

export class FileManager {
  private chunkSize = 1024 * 1024; // 1MB

  // 展开路径（处理 ~ 等）
  private expandPath(dirPath: string): string {
    if (dirPath === '~' || dirPath.startsWith('~/')) {
      const home = os.homedir();
      if (dirPath === '~') {
        return home;
      }
      return path.join(home, dirPath.slice(2));
    }
    // Handle Windows drive letters (e.g., "D:" -> "D:\\")
    if (/^[A-Za-z]:$/.test(dirPath)) {
      return dirPath + '\\';
    }
    return dirPath;
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
      const stat = await fs.stat(filePath);

      if (stat.isDirectory()) {
        throw new Error('IS_DIRECTORY');
      }

      const totalSize = stat.size;
      const totalChunks = Math.ceil(totalSize / this.chunkSize);

      const handle = await fs.open(filePath, 'r');

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

    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // 合并所有块并写入文件
      const handle = await fs.open(filePath, 'w');

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
}