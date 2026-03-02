import type { GmailAttachment } from '../types.js';

export function buildAttachmentStateKey(prefix: string, attachment: GmailAttachment): string {
  return `${prefix}:att:${attachment.messageId}:${attachment.attachmentId}:${attachment.checksum}`;
}
