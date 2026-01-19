/**
 * Document Processed Handler
 *
 * Sends a Slack notification when a document has been processed (OCR/extraction complete).
 */

import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  DocumentEventInput,
  DocumentNotificationResult,
  SlackIntegrationConfig,
  Company,
} from '../types.js';
import { SlackClient } from '../slack/client.js';
import { buildDocumentProcessedBlocks, statusAttachment } from '../slack/blocks.js';
import { shouldNotify, isNotificationEnabled } from '../utils/filters.js';
import { formatCurrency } from '../utils/formatters.js';

/**
 * Handles document.processed events.
 *
 * Sends a notification to Slack when invoice processing is complete,
 * including extracted details like vendor, amount, and invoice number.
 */
export const handleDocumentProcessed: IntegrationHandler<
  DocumentEventInput,
  DocumentNotificationResult,
  SlackIntegrationConfig
> = async (
  input: DocumentEventInput,
  ctx: IntegrationContext<SlackIntegrationConfig>
): Promise<DocumentNotificationResult> => {
  const { documentId, spaceId } = input;
  const { config, logger, data } = ctx;

  // Check if this notification type is enabled
  if (!isNotificationEnabled('notifyOnDocumentProcessed', config)) {
    logger.debug('Document processed notifications disabled', { documentId });
    return {
      success: true,
      skipped: true,
      reason: 'notification_type_disabled',
    };
  }

  // Fetch document details
  let document;
  try {
    document = await data.getDocument(documentId);
  } catch (error) {
    logger.error('Failed to fetch document', { documentId, error });
    return {
      success: false,
      error: `Failed to fetch document: ${(error as Error).message}`,
    };
  }

  // Apply filters
  const filterResult = shouldNotify(document, config);
  if (!filterResult.shouldNotify) {
    logger.debug('Document filtered out', {
      documentId: document.id,
      vendorName: document.vendorName,
      amount: document.total,
      reason: filterResult.reason,
    });
    return {
      success: true,
      skipped: true,
      reason: filterResult.reason,
      documentId: document.id,
      vendorName: document.vendorName || undefined,
      amount: document.total,
    };
  }

  // Fetch company for context (optional)
  let company: Company | null = null;
  if (document.companyId) {
    try {
      const companies = await data.listCompanies({ ids: [document.companyId] });
      company = companies.items[0] || null;
    } catch (error) {
      logger.warn('Failed to fetch company', {
        companyId: document.companyId,
        error: (error as Error).message,
      });
    }
  }

  // Build Slack message
  const blocks = buildDocumentProcessedBlocks(document, company, spaceId);
  const amount = formatCurrency(document.total, document.currency);
  const fallbackText = `Invoice processed: ${document.vendorName || 'Unknown vendor'} - ${amount}`;

  // Send to Slack
  try {
    const slack = new SlackClient(config.webhookUrl);
    await slack.sendMessage({
      text: fallbackText,
      blocks,
      attachments: [statusAttachment('success')],
      channel: config.channelOverride,
      username: config.username,
      icon_emoji: config.iconEmoji,
    });

    logger.info('Document processed notification sent', {
      documentId: document.id,
      vendorName: document.vendorName,
      amount: document.total,
      currency: document.currency,
    });

    return {
      success: true,
      documentId: document.id,
      vendorName: document.vendorName || undefined,
      amount: document.total,
    };
  } catch (error) {
    logger.error('Failed to send Slack notification', {
      documentId: document.id,
      error: (error as Error).message,
    });

    return {
      success: false,
      error: `Failed to send Slack notification: ${(error as Error).message}`,
      documentId: document.id,
    };
  }
};
