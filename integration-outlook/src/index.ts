/**
 * Outlook integration handler exports.
 * Manifest is defined in manifest.json at package root.
 */
export { crawlPdfAttachments, testConnection } from './handlers/index.js';

export type { OutlookConfig, HandlerResult, CrawlResult, OutlookAttachment } from './types.js';
