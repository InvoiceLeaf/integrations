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
// InvoiceLeaf Data Types (from Context API)
// ============================================================================

/**
 * Document from InvoiceLeaf API.
 */
export interface Document {
  id: string;
  spaceId: string;
  documentNumber?: string;
  documentDate?: string;
  dueDate?: string;
  vendorName?: string;
  vendorVatId?: string;
  total?: number;
  netTotal?: number;
  vatTotal?: number;
  currency?: string;
  status: DocumentStatus;
  categoryId?: string;
  categoryName?: string;
  companyId?: string;
  tags?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
}

/**
 * Document status.
 */
export type DocumentStatus =
  | 'UPLOADED'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'EXPORTED'
  | 'ERROR';

/**
 * Company from InvoiceLeaf API.
 */
export interface Company {
  id: string;
  name: string;
  vatId?: string;
  address?: string;
  city?: string;
  country?: string;
}

/**
 * Export from InvoiceLeaf API.
 */
export interface Export {
  id: string;
  spaceId: string;
  format: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  documentCount: number;
  downloadUrl?: string;
  createdAt: string;
  completedAt?: string;
}
