import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileManager } from '../file.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FileManager', () => {
  let fm: FileManager;
  let tmpDir: string;

  beforeEach(async () => {
    fm = new FileManager();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('validateFileName', () => {
    it('accepts valid filenames', () => {
      expect(() => (fm as any).validateFileName('notes.txt')).not.toThrow();
      expect(() => (fm as any).validateFileName('config.json')).not.toThrow();
      expect(() => (fm as any).validateFileName('readme.md')).not.toThrow();
      expect(() => (fm as any).validateFileName('中文文件.txt')).not.toThrow();
    });

    it('rejects empty filenames', () => {
      expect(() => (fm as any).validateFileName('')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('   ')).toThrow('INVALID_FILENAME');
    });

    it('rejects illegal characters', () => {
      expect(() => (fm as any).validateFileName('file<name.txt')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('file:name.txt')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('file/name.txt')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('file\\name.txt')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('file|name.txt')).toThrow('INVALID_FILENAME');
    });

    it('rejects path traversal', () => {
      expect(() => (fm as any).validateFileName('../etc/passwd')).toThrow('INVALID_FILENAME');
      expect(() => (fm as any).validateFileName('..')).toThrow('INVALID_FILENAME');
    });

    it('rejects dots-only names', () => {
      expect(() => (fm as any).validateFileName('...')).toThrow('INVALID_FILENAME');
    });
  });

  describe('createFile', () => {
    it('creates a new empty file', async () => {
      const result = await fm.createFile(tmpDir, 'newfile.txt');
      expect(result.path).toContain('newfile.txt');
      const content = await fs.readFile(result.path, 'utf-8');
      expect(content).toBe('');
    });

    it('throws FILE_ALREADY_EXISTS if file exists', async () => {
      await fs.writeFile(path.join(tmpDir, 'exists.txt'), 'content');
      await expect(fm.createFile(tmpDir, 'exists.txt')).rejects.toThrow('FILE_ALREADY_EXISTS');
    });

    it('throws INVALID_FILENAME for bad names', async () => {
      await expect(fm.createFile(tmpDir, '../bad.txt')).rejects.toThrow('INVALID_FILENAME');
    });
  });

  describe('renameFile', () => {
    it('renames a file', async () => {
      const filePath = path.join(tmpDir, 'old.txt');
      await fs.writeFile(filePath, 'content');
      await fm.renameFile(filePath, 'new.txt');
      const newPath = path.join(tmpDir, 'new.txt');
      const content = await fs.readFile(newPath, 'utf-8');
      expect(content).toBe('content');
    });

    it('throws for invalid new name', async () => {
      const filePath = path.join(tmpDir, 'file.txt');
      await fs.writeFile(filePath, 'content');
      await expect(fm.renameFile(filePath, '../bad.txt')).rejects.toThrow('INVALID_FILENAME');
    });
  });

  describe('deleteFile', () => {
    it('deletes a file', async () => {
      const filePath = path.join(tmpDir, 'todelete.txt');
      await fs.writeFile(filePath, 'content');
      await fm.deleteFile(filePath, false);
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('deletes a directory recursively', async () => {
      const subDir = path.join(tmpDir, 'subdir');
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(subDir, 'file.txt'), 'content');
      await fm.deleteFile(subDir, true);
      await expect(fs.access(subDir)).rejects.toThrow();
    });
  });
});