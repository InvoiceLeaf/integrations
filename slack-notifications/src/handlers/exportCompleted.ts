/**
 * Export Completed Handler
 *
 * Sends a Slack notification when an export is ready for download.
 */

import type { IntegrationContext, IntegrationHandler, Export } from '@invoiceleaf/integration-sdk';
import type {
  ExportCompletedInput,
  HandlerResult,
  SlackIntegrationConfig,
} from '../types.js';
import { SlackClient } from '../slack/client.js';
import { buildExportCompletedBlocks, statusAttachment } from '../slack/blocks.js';
import { isNotificationEnabled } from '../utils/filters.js';

/**
 * Result for export completed handler.
 */
interface ExportCompletedResult extends HandlerResult {
  exportId?: string;
  format?: string;
  documentCount?: number;
}

/**
 * Handles export.completed events.
 *
 * Sends a notification to Slack when an export is ready for download.
 */
export const handleExportCompleted: IntegrationHandler<
  ExportCompletedInput,
  ExportCompletedResult,
  SlackIntegrationConfig
> = async (
  input: ExportCompletedInput,
  ctx: IntegrationContext<SlackIntegrationConfig>
): Promise<ExportCompletedResult> => {
  const { exportId, spaceId, documentCount, format } = input;
  const { config, logger, data } = ctx;

  // Check if this notification type is enabled
  if (!isNotificationEnabled('notifyOnExportCompleted', config)) {
    logger.debug('Export completed notifications disabled', { exportId });
    return {
      success: true,
      skipped: true,
      reason: 'notification_type_disabled',
    };
  }

  // Try to fetch export details from the API, fall back to input data
  let exportData: Export;
  try {
    exportData = await data.getExport(exportId);
  } catch (error) {
    logger.warn('Could not fetch export details, using input data', {
      exportId,
      error: (error as Error).message,
    });
    // Create a minimal export object from input
    exportData = {
      id: exportId,
      spaceId,
      format: format || 'unknown',
      status: 'COMPLETED',
      documentCount: documentCount || 0,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  // Build Slack message
  const blocks = buildExportCompletedBlocks(exportData, spaceId);
  const fallbackText = `Export ready: ${exportData.documentCount || 0} documents in ${exportData.format.toUpperCase()} format`;

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

    logger.info('Export completed notification sent', {
      exportId: exportData.id,
      format: exportData.format,
      documentCount: exportData.documentCount,
    });

    return {
      success: true,
      exportId: exportData.id,
      format: exportData.format,
      documentCount: exportData.documentCount,
    };
  } catch (error) {
    logger.error('Failed to send Slack notification', {
      exportId,
      error: (error as Error).message,
    });

    return {
      success: false,
      error: `Failed to send Slack notification: ${(error as Error).message}`,
      exportId,
    };
  }
};
