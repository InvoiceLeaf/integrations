export interface SmtpMailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure?: boolean;
  smtpUsername: string;
  smtpPassword: string;
  fromAddress: string;

  imapHost: string;
  imapPort: number;
  imapSecure?: boolean;
  imapUsername: string;
  imapPassword: string;
  imapFolder?: string;
  processedFolder?: string;

  searchFilter?: string;
  maxMessagesPerRun?: number;
  maxAttachmentsPerMessage?: number;

  stateKeyPrefix?: string;
  dedupeTtlSeconds?: number;
  importSource?: string;
}

export interface SendEmailAttachmentInput {
  fileName: string;
  contentType?: string;
  contentBase64: string;
}

export interface SendEmailInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: SendEmailAttachmentInput[];
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface CrawledPdfAttachment {
  uid: number;
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
