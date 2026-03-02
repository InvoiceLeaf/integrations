import type { DropboxPdfFile } from '../types.js';

export function buildFileStateKey(prefix: string, file: DropboxPdfFile): string {
  return `${prefix}:file:${file.id}:${file.rev ?? 'no-rev'}:${file.contentHash ?? 'no-hash'}`;
}
