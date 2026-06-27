export type OverlayFileType = 'md' | 'txt' | 'json' | 'html' | 'pdf' | 'image';

const EDITABLE_TYPES = new Set(['md', 'txt', 'json']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);

export function getFileType(fileName: string): OverlayFileType | 'other' {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'md') return 'md';
  if (ext === 'txt') return 'txt';
  if (ext === 'json') return 'json';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}

export function isViewable(fileName: string): boolean {
  return getFileType(fileName) !== 'other';
}

export function isEditable(fileName: string): boolean {
  const type = getFileType(fileName);
  return type !== 'other' && EDITABLE_TYPES.has(type);
}

export const LARGE_FILE_THRESHOLD = 500 * 1024; // 500KB

export function isLargeFile(size: number | undefined): boolean {
  return (size ?? 0) > LARGE_FILE_THRESHOLD;
}
