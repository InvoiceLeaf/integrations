/**
 * Document Created Handler
 *
 * Sends a Slack notification when a new document is uploaded.
 */

import type { IntegrationContext, IntegrationHandler, Company } from '@invoiceleaf/integration-sdk';
import type {
  DocumentEventInput,
  DocumentNotificationResult,
  SlackIntegrationConfig,
} from '../types.js';
import { getVendorName, getCompanyId } from '../types.js';
import { SlackClient } from '../slack/client.js';
import { buildDocumentCreatedBlocks, statusAttachment } from '../slack/blocks.js';
import { shouldNotify, isNotificationEnabled } from '../utils/filters.js';

/**
 * Handles document.created events.
 *
 * Sends a notification to Slack when a new document is uploaded to InvoiceLeaf.
 */
export const handleDocumentCreated: IntegrationHandler<
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
  if (!isNotificationEnabled('notifyOnDocumentCreated', config)) {
    logger.debug('Document created notifications disabled', { documentId });
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

  // Apply filters (if document has been partially processed)
  const filterResult = shouldNotify(document, config);
  if (!filterResult.shouldNotify) {
    logger.debug('Document filtered out', {
      documentId: document.id,
      reason: filterResult.reason,
    });
    return {
      success: true,
      skipped: true,
      reason: filterResult.reason,
    };
  }

  const vendorName = getVendorName(document);
  const companyId = getCompanyId(document);

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
  const blocks = buildDocumentCreatedBlocks(document, company, spaceId);
  const fallbackText = `New invoice uploaded${vendorName ? ` from ${vendorName}` : ''}`;

  // Send to Slack
  try {
    const slack = new SlackClient(config.webhookUrl);
    await slack.sendMessage({
      text: fallbackText,
      blocks,
      attachments: [statusAttachment('info')],
      channel: config.channelOverride,
      username: config.username,
      icon_emoji: config.iconEmoji,
    });

    logger.info('Document created notification sent', {
      documentId: document.id,
      vendorName,
    });

    return {
      success: true,
      documentId: document.id,
      vendorName: vendorName || undefined,
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
