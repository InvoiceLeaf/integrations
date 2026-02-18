import type { CrawledPdfAttachment } from '../types.js';

export function toAddressList(value?: string | string[]): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function buildAttachmentStateKey(prefix: string, attachment: CrawledPdfAttachment): string {
  return `${prefix}:att:${attachment.uid}:${attachment.fileName}:${attachment.checksum}`;
}
