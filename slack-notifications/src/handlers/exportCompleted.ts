/**
 * Export Completed Handler
 *
 * Sends a Slack notification when an export is ready for download.
 */

import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
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

  // Fetch export details (the input may have basic info, but we want full details)
  let exportData;
  try {
    // Try to get export from context data API
    // Note: This assumes the SDK provides getExport or similar method
    exportData = {
      id: exportId,
      spaceId,
      format: format || 'unknown',
      status: 'COMPLETED' as const,
      documentCount: documentCount || 0,
      downloadUrl: undefined as string | undefined, // Will be populated if available
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    // If data API has createExport return with downloadUrl, try to fetch it
    // This is a simplified version - in reality you might call a specific endpoint
  } catch (error) {
    logger.warn('Could not fetch export details, using input data', {
      exportId,
      error: (error as Error).message,
    });
  }

  // Build Slack message
  const blocks = buildExportCompletedBlocks(exportData, spaceId);
  const fallbackText = `Export ready: ${exportData.documentCount} documents in ${exportData.format.toUpperCase()} format`;

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
