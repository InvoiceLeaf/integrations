/**
 * Gmail integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export { crawlPdfAttachments, testConnection } from './handlers/index.js';

export type { GmailConfig, HandlerResult, CrawlResult, GmailAttachment } from './types.js';
