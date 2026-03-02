import type { DrivePdfFile } from '../types.js';

export function buildFileStateKey(prefix: string, file: DrivePdfFile): string {
  return `${prefix}:file:${file.id}:${file.modifiedTime ?? 'no-modified'}:${file.md5Checksum ?? 'no-hash'}`;
}
