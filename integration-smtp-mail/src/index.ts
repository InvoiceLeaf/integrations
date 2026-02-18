/**
 * SMTP Mail integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export { sendEmail, testConnection, crawlPdfAttachments } from './handlers/index.js';

export type {
  SmtpMailConfig,
  SendEmailInput,
  SendEmailAttachmentInput,
  HandlerResult,
  CrawlResult,
} from './types.js';
