/**
 * Slack Block Kit Builders
 *
 * Helper functions for building Slack Block Kit messages.
 */

import type {
  SlackBlock,
  HeaderBlock,
  SectionBlock,
  ContextBlock,
  DividerBlock,
  ActionsBlock,
  ButtonElement,
  TextElement,
  PlainTextElement,
  MrkdwnElement,
  Document,
  Company,
  Export,
  DailySummaryStats,
  SlackAttachment,
} from '../types.js';
import { formatCurrency, formatDate, formatRelativeTime } from '../utils/formatters.js';

// ============================================================================
// Base URL for InvoiceLeaf app links
// ============================================================================

const APP_BASE_URL = 'https://app.invoiceleaf.com';

// ============================================================================
// Element Builders
// ============================================================================

/**
 * Creates a plain text element.
 */
export function plainText(text: string, emoji = true): PlainTextElement {
  return { type: 'plain_text', text, emoji };
}

/**
 * Creates a markdown text element.
 */
export function mrkdwn(text: string): MrkdwnElement {
  return { type: 'mrkdwn', text };
}

/**
 * Creates a button element.
 */
export function button(
  text: string,
  actionId: string,
  options: { url?: string; value?: string; style?: 'primary' | 'danger' } = {}
): ButtonElement {
  return {
    type: 'button',
    text: plainText(text),
    action_id: actionId,
    ...options,
  };
}

// ============================================================================
// Block Builders
// ============================================================================

/**
 * Creates a header block.
 */
export function header(text: string): HeaderBlock {
  return {
    type: 'header',
    text: plainText(text),
  };
}

/**
 * Creates a section block with fields.
 */
export function sectionWithFields(fields: TextElement[]): SectionBlock {
  return {
    type: 'section',
    fields,
  };
}

/**
 * Creates a section block with text.
 */
export function section(text: string | TextElement): SectionBlock {
  return {
    type: 'section',
    text: typeof text === 'string' ? mrkdwn(text) : text,
  };
}

/**
 * Creates a context block.
 */
export function context(...elements: TextElement[]): ContextBlock {
  return {
    type: 'context',
    elements,
  };
}

/**
 * Creates a divider block.
 */
export function divider(): DividerBlock {
  return { type: 'divider' };
}

/**
 * Creates an actions block.
 */
export function actions(...elements: ButtonElement[]): ActionsBlock {
  return {
    type: 'actions',
    elements,
  };
}

// ============================================================================
// Document Notification Blocks
// ============================================================================

/**
 * Builds blocks for document created notification.
 */
export function buildDocumentCreatedBlocks(
  document: Document,
  company: Company | null,
  spaceId: string
): SlackBlock[] {
  const invoiceUrl = `${APP_BASE_URL}/spaces/${spaceId}/documents/${document.id}`;

  const blocks: SlackBlock[] = [
    header('New Invoice Uploaded'),
    sectionWithFields([
      mrkdwn(`*Vendor*\n${document.vendorName || 'Processing...'}`),
      mrkdwn(`*Status*\n${formatStatus(document.status)}`),
    ]),
  ];

  if (company) {
    blocks.push(context(mrkdwn(`Assigned to: *${company.name}*`)));
  }

  blocks.push(
    context(mrkdwn(`Uploaded ${formatRelativeTime(document.createdAt)}`)),
    actions(button('View Document', 'view_document', { url: invoiceUrl }))
  );

  return blocks;
}

/**
 * Builds blocks for document processed notification.
 */
export function buildDocumentProcessedBlocks(
  document: Document,
  company: Company | null,
  spaceId: string
): SlackBlock[] {
  const invoiceUrl = `${APP_BASE_URL}/spaces/${spaceId}/documents/${document.id}`;

  const blocks: SlackBlock[] = [
    header('Invoice Processed'),
    sectionWithFields([
      mrkdwn(`*Vendor*\n${document.vendorName || 'Unknown'}`),
      mrkdwn(`*Amount*\n${formatCurrency(document.total, document.currency)}`),
      mrkdwn(`*Invoice #*\n${document.documentNumber || 'N/A'}`),
      mrkdwn(`*Date*\n${formatDate(document.documentDate)}`),
    ]),
  ];

  // Add net/VAT breakdown if available
  if (document.netTotal !== undefined && document.vatTotal !== undefined) {
    blocks.push(
      context(
        mrkdwn(
          `Net: ${formatCurrency(document.netTotal, document.currency)} | ` +
            `VAT: ${formatCurrency(document.vatTotal, document.currency)}`
        )
      )
    );
  }

  // Add company context if available
  if (company) {
    blocks.push(context(mrkdwn(`Assigned to: *${company.name}*`)));
  }

  // Add category if set
  if (document.categoryName) {
    blocks.push(context(mrkdwn(`Category: ${document.categoryName}`)));
  }

  // Add due date warning if approaching
  if (document.dueDate) {
    const daysUntilDue = getDaysUntilDue(document.dueDate);
    if (daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue >= 0) {
      blocks.push(
        context(
          mrkdwn(
            daysUntilDue === 0
              ? ':warning: *Due today!*'
              : `:warning: Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`
          )
        )
      );
    }
  }

  blocks.push(actions(button('View Invoice', 'view_invoice', { url: invoiceUrl })));

  return blocks;
}

/**
 * Builds blocks for document updated notification.
 */
export function buildDocumentUpdatedBlocks(
  document: Document,
  company: Company | null,
  spaceId: string
): SlackBlock[] {
  const invoiceUrl = `${APP_BASE_URL}/spaces/${spaceId}/documents/${document.id}`;

  const blocks: SlackBlock[] = [
    header('Invoice Updated'),
    sectionWithFields([
      mrkdwn(`*Vendor*\n${document.vendorName || 'Unknown'}`),
      mrkdwn(`*Amount*\n${formatCurrency(document.total, document.currency)}`),
      mrkdwn(`*Invoice #*\n${document.documentNumber || 'N/A'}`),
      mrkdwn(`*Status*\n${formatStatus(document.status)}`),
    ]),
  ];

  if (company) {
    blocks.push(context(mrkdwn(`Assigned to: *${company.name}*`)));
  }

  blocks.push(
    context(mrkdwn(`Updated ${formatRelativeTime(document.updatedAt)}`)),
    actions(button('View Invoice', 'view_invoice', { url: invoiceUrl }))
  );

  return blocks;
}

// ============================================================================
// Export Notification Blocks
// ============================================================================

/**
 * Builds blocks for export completed notification.
 */
export function buildExportCompletedBlocks(exportData: Export, spaceId: string): SlackBlock[] {
  const dashboardUrl = `${APP_BASE_URL}/spaces/${spaceId}/exports`;
  const downloadUrl = exportData.downloadUrl;

  const blocks: SlackBlock[] = [
    header('Export Ready'),
    sectionWithFields([
      mrkdwn(`*Format*\n${exportData.format.toUpperCase()}`),
      mrkdwn(`*Documents*\n${exportData.documentCount}`),
    ]),
    context(mrkdwn(`Completed ${formatRelativeTime(exportData.completedAt || exportData.createdAt)}`)),
  ];

  const actionButtons: ButtonElement[] = [];

  if (downloadUrl) {
    actionButtons.push(button('Download Export', 'download_export', { url: downloadUrl, style: 'primary' }));
  }

  actionButtons.push(button('View All Exports', 'view_exports', { url: dashboardUrl }));

  blocks.push(actions(...actionButtons));

  return blocks;
}

// ============================================================================
// Daily Summary Blocks
// ============================================================================

/**
 * Builds blocks for daily summary notification.
 */
export function buildDailySummaryBlocks(stats: DailySummaryStats, spaceId: string): SlackBlock[] {
  const dashboardUrl = `${APP_BASE_URL}/spaces/${spaceId}/dashboard`;
  const documentsUrl = `${APP_BASE_URL}/spaces/${spaceId}/documents`;

  const blocks: SlackBlock[] = [
    header('Daily Invoice Summary'),
    sectionWithFields([
      mrkdwn(`*Processed*\n${stats.processedCount} invoice${stats.processedCount === 1 ? '' : 's'}`),
      mrkdwn(`*Total Amount*\n${formatCurrency(stats.totalAmount, stats.currency)}`),
      mrkdwn(`*Pending Review*\n${stats.pendingCount}`),
      mrkdwn(`*Top Vendor*\n${stats.topVendor ? `${stats.topVendor} (${stats.topVendorCount})` : 'N/A'}`),
    ]),
  ];

  // Add category breakdown if available
  const categoryEntries = Object.entries(stats.categoryBreakdown);
  if (categoryEntries.length > 0) {
    const categoryText = categoryEntries
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => `${name}: ${count}`)
      .join(' | ');

    blocks.push(divider(), context(mrkdwn(`*By Category:* ${categoryText}`)));
  }

  blocks.push(
    divider(),
    actions(
      button('Open Dashboard', 'open_dashboard', { url: dashboardUrl, style: 'primary' }),
      button('View Documents', 'view_documents', { url: documentsUrl })
    )
  );

  return blocks;
}

// ============================================================================
// Test Message Blocks
// ============================================================================

/**
 * Builds blocks for test connection message.
 */
export function buildTestConnectionBlocks(spaceId: string, userId: string): SlackBlock[] {
  return [
    header('InvoiceLeaf Connected'),
    section(
      'Your InvoiceLeaf workspace is now connected to Slack. ' +
        "You'll receive notifications based on your configuration."
    ),
    divider(),
    context(
      mrkdwn(`Workspace: \`${spaceId}\``),
      mrkdwn(`Configured by: \`${userId}\``),
      mrkdwn(`Time: ${formatDate(new Date().toISOString())}`)
    ),
  ];
}

// ============================================================================
// Attachment Builders (for colored sidebar)
// ============================================================================

/**
 * Creates an attachment with status-based color.
 */
export function statusAttachment(status: 'success' | 'warning' | 'error' | 'info'): SlackAttachment {
  const colors: Record<string, string> = {
    success: '#36a64f',
    warning: '#f2c744',
    error: '#dc3545',
    info: '#0066cc',
  };

  return {
    color: colors[status],
    fallback: '',
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Formats document status for display.
 */
function formatStatus(status: string): string {
  const statusEmojis: Record<string, string> = {
    UPLOADED: ':inbox_tray: Uploaded',
    PROCESSING: ':hourglass_flowing_sand: Processing',
    PROCESSED: ':white_check_mark: Processed',
    PENDING_REVIEW: ':eyes: Pending Review',
    APPROVED: ':heavy_check_mark: Approved',
    EXPORTED: ':outbox_tray: Exported',
    ERROR: ':x: Error',
  };

  return statusEmojis[status] || status;
}

/**
 * Calculates days until due date.
 */
function getDaysUntilDue(dueDate: string): number | null {
  if (!dueDate) return null;

  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}
