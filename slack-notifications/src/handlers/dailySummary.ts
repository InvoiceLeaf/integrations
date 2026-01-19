/**
 * Daily Summary Handler
 *
 * Sends a daily summary of invoice activity to Slack.
 */

import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  DailySummaryInput,
  DailySummaryResult,
  DailySummaryStats,
  SlackIntegrationConfig,
  Document,
} from '../types.js';
import { SlackClient } from '../slack/client.js';
import { buildDailySummaryBlocks, statusAttachment } from '../slack/blocks.js';
import { isNotificationEnabled } from '../utils/filters.js';
import { formatCurrency } from '../utils/formatters.js';

/**
 * Handles daily summary scheduled trigger.
 *
 * Aggregates invoice activity from the previous day and sends a summary to Slack.
 */
export const handleDailySummary: IntegrationHandler<
  DailySummaryInput,
  DailySummaryResult,
  SlackIntegrationConfig
> = async (
  input: DailySummaryInput,
  ctx: IntegrationContext<SlackIntegrationConfig>
): Promise<DailySummaryResult> => {
  const { spaceId } = input;
  const { config, logger, data } = ctx;

  // Check if daily summary is enabled
  if (!isNotificationEnabled('enableDailySummary', config)) {
    logger.debug('Daily summary notifications disabled', { spaceId });
    return {
      success: true,
      skipped: true,
      reason: 'daily_summary_disabled',
    };
  }

  // Calculate yesterday's date range
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  logger.info('Generating daily summary', {
    spaceId,
    dateRange: {
      from: yesterday.toISOString(),
      to: today.toISOString(),
    },
  });

  // Fetch documents processed yesterday
  let documents: Document[];
  try {
    const result = await data.listDocuments({
      processedAfter: yesterday.toISOString(),
      processedBefore: today.toISOString(),
      limit: 1000,
    });
    documents = result.items as Document[];
  } catch (error) {
    logger.error('Failed to fetch documents for summary', {
      error: (error as Error).message,
    });
    return {
      success: false,
      error: `Failed to fetch documents: ${(error as Error).message}`,
    };
  }

  // Skip if no activity
  if (documents.length === 0) {
    logger.info('No documents processed yesterday, skipping summary', { spaceId });
    return {
      success: true,
      skipped: true,
      reason: 'no_activity',
    };
  }

  // Calculate statistics
  const stats = calculateStats(documents);

  logger.info('Daily summary stats calculated', {
    spaceId,
    processedCount: stats.processedCount,
    totalAmount: stats.totalAmount,
    topVendor: stats.topVendor,
  });

  // Build Slack message
  const blocks = buildDailySummaryBlocks(stats, spaceId);
  const fallbackText =
    `Daily Summary: ${stats.processedCount} invoice${stats.processedCount === 1 ? '' : 's'} processed, ` +
    `total ${formatCurrency(stats.totalAmount, stats.currency)}`;

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

    logger.info('Daily summary notification sent', {
      spaceId,
      stats,
    });

    return {
      success: true,
      stats,
    };
  } catch (error) {
    logger.error('Failed to send daily summary notification', {
      error: (error as Error).message,
    });

    return {
      success: false,
      error: `Failed to send Slack notification: ${(error as Error).message}`,
    };
  }
};

/**
 * Calculates summary statistics from documents.
 */
function calculateStats(documents: Document[]): DailySummaryStats {
  // Count by status
  const processedCount = documents.length;
  const pendingCount = documents.filter(
    (d) => d.status === 'PENDING_REVIEW'
  ).length;

  // Sum total amounts (group by currency, use the most common one)
  const currencyCounts: Record<string, { count: number; total: number }> = {};

  for (const doc of documents) {
    const currency = doc.currency || 'EUR';
    if (!currencyCounts[currency]) {
      currencyCounts[currency] = { count: 0, total: 0 };
    }
    currencyCounts[currency].count++;
    currencyCounts[currency].total += doc.total || 0;
  }

  // Find the most common currency
  let primaryCurrency = 'EUR';
  let maxCount = 0;
  for (const [currency, data] of Object.entries(currencyCounts)) {
    if (data.count > maxCount) {
      maxCount = data.count;
      primaryCurrency = currency;
    }
  }

  const totalAmount = currencyCounts[primaryCurrency]?.total || 0;

  // Find top vendor
  const vendorCounts: Record<string, number> = {};
  for (const doc of documents) {
    if (doc.vendorName) {
      vendorCounts[doc.vendorName] = (vendorCounts[doc.vendorName] || 0) + 1;
    }
  }

  let topVendor: string | null = null;
  let topVendorCount = 0;
  for (const [vendor, count] of Object.entries(vendorCounts)) {
    if (count > topVendorCount) {
      topVendorCount = count;
      topVendor = vendor;
    }
  }

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  for (const doc of documents) {
    const category = doc.categoryName || 'Uncategorized';
    categoryBreakdown[category] = (categoryBreakdown[category] || 0) + 1;
  }

  return {
    processedCount,
    totalAmount,
    currency: primaryCurrency,
    pendingCount,
    topVendor,
    topVendorCount,
    categoryBreakdown,
  };
}
