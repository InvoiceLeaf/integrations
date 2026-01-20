/**
 * Slack Integration Types
 *
 * Type definitions for the Slack notifications integration.
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Integration configuration stored per installation.
 */
export interface SlackIntegrationConfig {
  /** Slack Incoming Webhook URL */
  webhookUrl: string;

  /** Override the default channel (optional) */
  channelOverride?: string;

  /** Custom bot username (optional) */
  username?: string;

  /** Custom bot icon emoji (optional) */
  iconEmoji?: string;

  // Notification toggles
  notifyOnDocumentCreated: boolean;
  notifyOnDocumentProcessed: boolean;
  notifyOnDocumentUpdated: boolean;
  notifyOnExportCompleted: boolean;
  enableDailySummary: boolean;

  // Filters
  /** Minimum invoice amount to trigger notification (0 = all) */
  minimumAmount: number;

  /** Currency for minimum amount filter */
  minimumAmountCurrency: string;

  /** Only notify for invoices from these vendors (empty = all) */
  vendorFilter: string[];

  /** Only notify for invoices in these categories (empty = all) */
  categoryFilter: string[];
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: SlackIntegrationConfig = {
  webhookUrl: '',
  notifyOnDocumentCreated: false,
  notifyOnDocumentProcessed: true,
  notifyOnDocumentUpdated: false,
  notifyOnExportCompleted: true,
  enableDailySummary: false,
  minimumAmount: 0,
  minimumAmountCurrency: 'EUR',
  vendorFilter: [],
  categoryFilter: [],
};

// ============================================================================
// Slack API Types (Block Kit)
// ============================================================================

/**
 * Slack message payload for incoming webhooks.
 */
export interface SlackMessage {
  /** Fallback text for notifications */
  text: string;

  /** Block Kit blocks for rich formatting */
  blocks?: SlackBlock[];

  /** Legacy attachments (optional) */
  attachments?: SlackAttachment[];

  /** Override channel */
  channel?: string;

  /** Override bot username */
  username?: string;

  /** Override bot icon (emoji) */
  icon_emoji?: string;

  /** Override bot icon (URL) */
  icon_url?: string;

  /** Whether to unfurl links */
  unfurl_links?: boolean;

  /** Whether to unfurl media */
  unfurl_media?: boolean;
}

/**
 * Union of all supported Block Kit block types.
 */
export type SlackBlock =
  | HeaderBlock
  | SectionBlock
  | ContextBlock
  | DividerBlock
  | ActionsBlock
  | ImageBlock;

/**
 * Header block - displays large, bold text.
 */
export interface HeaderBlock {
  type: 'header';
  block_id?: string;
  text: PlainTextElement;
}

/**
 * Section block - displays text with optional fields and accessory.
 */
export interface SectionBlock {
  type: 'section';
  block_id?: string;
  text?: TextElement;
  fields?: TextElement[];
  accessory?: ButtonElement | ImageElement;
}

/**
 * Context block - displays contextual information.
 */
export interface ContextBlock {
  type: 'context';
  block_id?: string;
  elements: (TextElement | ImageElement)[];
}

/**
 * Divider block - horizontal line separator.
 */
export interface DividerBlock {
  type: 'divider';
  block_id?: string;
}

/**
 * Actions block - interactive elements like buttons.
 */
export interface ActionsBlock {
  type: 'actions';
  block_id?: string;
  elements: (ButtonElement | SelectElement)[];
}

/**
 * Image block - displays an image.
 */
export interface ImageBlock {
  type: 'image';
  block_id?: string;
  image_url: string;
  alt_text: string;
  title?: PlainTextElement;
}

// ============================================================================
// Block Kit Elements
// ============================================================================

/**
 * Plain text element.
 */
export interface PlainTextElement {
  type: 'plain_text';
  text: string;
  emoji?: boolean;
}

/**
 * Markdown text element.
 */
export interface MrkdwnElement {
  type: 'mrkdwn';
  text: string;
  verbatim?: boolean;
}

/**
 * Text element (plain text or markdown).
 */
export type TextElement = PlainTextElement | MrkdwnElement;

/**
 * Button element for actions.
 */
export interface ButtonElement {
  type: 'button';
  text: PlainTextElement;
  action_id: string;
  url?: string;
  value?: string;
  style?: 'primary' | 'danger';
  confirm?: ConfirmDialog;
}

/**
 * Select menu element.
 */
export interface SelectElement {
  type: 'static_select';
  action_id: string;
  placeholder: PlainTextElement;
  options: SelectOption[];
  initial_option?: SelectOption;
}

/**
 * Select option.
 */
export interface SelectOption {
  text: PlainTextElement;
  value: string;
}

/**
 * Image element for context blocks.
 */
export interface ImageElement {
  type: 'image';
  image_url: string;
  alt_text: string;
}

/**
 * Confirmation dialog for destructive actions.
 */
export interface ConfirmDialog {
  title: PlainTextElement;
  text: TextElement;
  confirm: PlainTextElement;
  deny: PlainTextElement;
  style?: 'primary' | 'danger';
}

// ============================================================================
// Legacy Attachments (for colored sidebar)
// ============================================================================

/**
 * Slack attachment (legacy, but useful for colored sidebar).
 */
export interface SlackAttachment {
  color?: string;
  fallback?: string;
  author_name?: string;
  author_link?: string;
  author_icon?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: AttachmentField[];
  footer?: string;
  footer_icon?: string;
  ts?: number;
}

/**
 * Attachment field.
 */
export interface AttachmentField {
  title: string;
  value: string;
  short?: boolean;
}

// ============================================================================
// Event Input Types
// ============================================================================

/**
 * Input for document-related event handlers.
 */
export interface DocumentEventInput {
  documentId: string;
  spaceId: string;
  userId?: string;
  timestamp?: string;
}

/**
 * Input for export completed event handler.
 */
export interface ExportCompletedInput {
  exportId: string;
  spaceId: string;
  userId?: string;
  documentCount: number;
  format: string;
  timestamp?: string;
}

/**
 * Input for scheduled daily summary handler.
 */
export interface DailySummaryInput {
  spaceId: string;
  scheduledAt: string;
}

// ============================================================================
// Handler Result Types
// ============================================================================

/**
 * Base result for all handlers.
 */
export interface HandlerResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

/**
 * Result for document notification handlers.
 */
export interface DocumentNotificationResult extends HandlerResult {
  documentId?: string;
  vendorName?: string;
  amount?: number;
}

/**
 * Result for daily summary handler.
 */
export interface DailySummaryResult extends HandlerResult {
  stats?: DailySummaryStats;
}

/**
 * Daily summary statistics.
 */
export interface DailySummaryStats {
  processedCount: number;
  totalAmount: number;
  currency: string;
  pendingCount: number;
  topVendor: string | null;
  topVendorCount: number;
  categoryBreakdown: Record<string, number>;
}

// ============================================================================
// InvoiceLeaf Data Types (re-exported from SDK)
// ============================================================================

// Re-export types from SDK for convenience
export type {
  Document,
  Company,
  Export,
  Category,
  Tag,
  DocumentStatus,
} from '@invoiceleaf/integration-sdk';

// ============================================================================
// Document Helper Functions
// ============================================================================

import type { Document } from '@invoiceleaf/integration-sdk';

/**
 * Gets the vendor/supplier name from a document.
 */
export function getVendorName(doc: Document): string | undefined {
  return doc.supplier?.name;
}

/**
 * Gets the total amount from a document.
 */
export function getTotal(doc: Document): number | undefined {
  return doc.totalAmount;
}

/**
 * Gets the net amount from a document.
 */
export function getNetTotal(doc: Document): number | undefined {
  return doc.netAmount;
}

/**
 * Gets the VAT/tax amount from a document.
 */
export function getVatTotal(doc: Document): number | undefined {
  return doc.taxAmount;
}

/**
 * Gets the currency code from a document.
 */
export function getCurrencyCode(doc: Document): string | undefined {
  return doc.currency?.code;
}

/**
 * Gets the invoice number from a document.
 */
export function getInvoiceNumber(doc: Document): string | undefined {
  return doc.invoiceId;
}

/**
 * Gets the invoice date from a document.
 */
export function getInvoiceDate(doc: Document): string | undefined {
  return doc.invoiceDate;
}

/**
 * Gets the category name from a document.
 */
export function getCategoryName(doc: Document): string | undefined {
  return doc.category?.name;
}

/**
 * Gets the category ID from a document.
 */
export function getCategoryId(doc: Document): string | undefined {
  return doc.category?.id;
}

/**
 * Gets the company/supplier ID from a document.
 */
export function getCompanyId(doc: Document): string | undefined {
  return doc.supplier?.id;
}

/**
 * Gets the created timestamp as ISO string.
 */
export function getCreatedAt(doc: Document): string {
  return doc.created ? new Date(doc.created).toISOString() : new Date().toISOString();
}

/**
 * Gets the updated timestamp as ISO string.
 */
export function getUpdatedAt(doc: Document): string {
  return doc.lastUpdate ? new Date(doc.lastUpdate).toISOString() : getCreatedAt(doc);
}

/**
 * Gets the display status for a document.
 */
export function getDisplayStatus(doc: Document): string {
  if (doc.errorType && doc.errorType !== 0) return 'ERROR';
  if (doc.approved) return 'APPROVED';
  if (doc.processed) return 'PROCESSED';
  return doc.documentStatus || 'UPLOADED';
}

/**
 * Gets the space ID from a document.
 */
export function getSpaceId(doc: Document): string | undefined {
  return doc.space?.id;
}
