/**
 * Document Processed Handler
 *
 * Sends a Slack notification when a document has been processed (OCR/extraction complete).
 */

import type { IntegrationContext, IntegrationHandler, Company } from '@invoiceleaf/integration-sdk';
import type {
  DocumentEventInput,
  DocumentNotificationResult,
  SlackIntegrationConfig,
} from '../types.js';
import { getVendorName, getTotal, getCurrencyCode, getCompanyId } from '../types.js';
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
  const vendorName = getVendorName(document);
  const total = getTotal(document);
  const currencyCode = getCurrencyCode(document);
  const companyId = getCompanyId(document);

  if (!filterResult.shouldNotify) {
    logger.debug('Document filtered out', {
      documentId: document.id,
      vendorName,
      amount: total,
      reason: filterResult.reason,
    });
    return {
      success: true,
      skipped: true,
      reason: filterResult.reason,
      documentId: document.id,
      vendorName: vendorName || undefined,
      amount: total,
    };
  }

  // Fetch company for context (optional)
  let company: Company | null = null;
  if (companyId) {
    try {
      const companies = await data.listCompanies({ ids: [companyId] });
      company = companies.items[0] || null;
    } catch (error) {
      logger.warn('Failed to fetch company', {
        companyId,
        error: (error as Error).message,
      });
    }
  }

  // Build Slack message
  const blocks = buildDocumentProcessedBlocks(document, company, spaceId);
  const amount = formatCurrency(total, currencyCode);
  const fallbackText = `Invoice processed: ${vendorName || 'Unknown vendor'} - ${amount}`;

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
      vendorName,
      amount: total,
      currency: currencyCode,
    });

    return {
      success: true,
      documentId: document.id,
      vendorName: vendorName || undefined,
      amount: total,
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
