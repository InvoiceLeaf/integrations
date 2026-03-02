export interface GmailConfig {
  query?: string;
  includeSpamTrash?: boolean;
  maxMessagesPerRun?: number;
  maxAttachmentsPerMessage?: number;
  stateKeyPrefix?: string;
  dedupeTtlSeconds?: number;
  importSource?: string;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface GmailAttachment {
  messageId: string;
  attachmentId: string;
  fileName: string;
  contentType: string;
  contentBase64: string;
  checksum: string;
  subject?: string;
  from?: string;
  date?: string;
}

export interface CrawlResult extends HandlerResult {
  scannedMessages: number;
  scannedAttachments: number;
  imported: number;
  duplicates: number;
  skipped: number;
  failed: number;
}
