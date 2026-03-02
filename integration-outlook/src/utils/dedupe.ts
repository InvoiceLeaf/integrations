import type { OutlookAttachment } from '../types.js';

export function buildAttachmentStateKey(prefix: string, attachment: OutlookAttachment): string {
  return `${prefix}:att:${attachment.messageId}:${attachment.attachmentId}:${attachment.checksum}`;
}
