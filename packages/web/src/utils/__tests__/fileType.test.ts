import { describe, it, expect } from 'vitest';
import { getFileType, isViewable, isEditable, isLargeFile, LARGE_FILE_THRESHOLD } from '../fileType';

describe('getFileType', () => {
  it('identifies markdown files', () => {
    expect(getFileType('readme.md')).toBe('md');
    expect(getFileType('README.MD')).toBe('md');
  });

  it('identifies text files', () => {
    expect(getFileType('notes.txt')).toBe('txt');
  });

  it('identifies JSON files', () => {
    expect(getFileType('config.json')).toBe('json');
  });

  it('identifies HTML files', () => {
    expect(getFileType('page.html')).toBe('html');
    expect(getFileType('page.htm')).toBe('html');
  });

  it('identifies PDF files', () => {
    expect(getFileType('doc.pdf')).toBe('pdf');
  });

  it('identifies image files', () => {
    expect(getFileType('photo.jpg')).toBe('image');
    expect(getFileType('photo.jpeg')).toBe('image');
    expect(getFileType('icon.png')).toBe('image');
    expect(getFileType('anim.gif')).toBe('image');
    expect(getFileType('photo.webp')).toBe('image');
  });

  it('returns other for unknown extensions', () => {
    expect(getFileType('file.zip')).toBe('other');
    expect(getFileType('file.exe')).toBe('other');
    expect(getFileType('file.docx')).toBe('other');
  });

  it('returns other for files without extension', () => {
    expect(getFileType('Makefile')).toBe('other');
    expect(getFileType('README')).toBe('other');
  });
});

describe('isViewable', () => {
  it('returns true for viewable types', () => {
    expect(isViewable('file.md')).toBe(true);
    expect(isViewable('file.txt')).toBe(true);
    expect(isViewable('file.json')).toBe(true);
    expect(isViewable('file.html')).toBe(true);
    expect(isViewable('file.pdf')).toBe(true);
    expect(isViewable('file.jpg')).toBe(true);
  });

  it('returns false for non-viewable types', () => {
    expect(isViewable('file.zip')).toBe(false);
    expect(isViewable('file.exe')).toBe(false);
  });
});

describe('isEditable', () => {
  it('returns true for editable types', () => {
    expect(isEditable('file.md')).toBe(true);
    expect(isEditable('file.txt')).toBe(true);
    expect(isEditable('file.json')).toBe(true);
  });

  it('returns false for non-editable types', () => {
    expect(isEditable('file.html')).toBe(false);
    expect(isEditable('file.pdf')).toBe(false);
    expect(isEditable('file.jpg')).toBe(false);
    expect(isEditable('file.zip')).toBe(false);
  });
});

describe('isLargeFile', () => {
  it('returns false for small files', () => {
    expect(isLargeFile(1024)).toBe(false);
    expect(isLargeFile(LARGE_FILE_THRESHOLD)).toBe(false);
  });

  it('returns true for files over threshold', () => {
    expect(isLargeFile(LARGE_FILE_THRESHOLD + 1)).toBe(true);
    expect(isLargeFile(1024 * 1024)).toBe(true);
  });

  it('returns false for undefined size', () => {
    expect(isLargeFile(undefined)).toBe(false);
  });
});
