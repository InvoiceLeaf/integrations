/**
 * Notification Filters
 *
 * Logic for filtering which documents trigger notifications.
 */

import type { Document, SlackIntegrationConfig } from '../types.js';

/**
 * Filter options extracted from config.
 */
export interface FilterOptions {
  minimumAmount?: number;
  minimumAmountCurrency?: string;
  vendorFilter?: string[];
  categoryFilter?: string[];
}

/**
 * Result of filter evaluation.
 */
export interface FilterResult {
  shouldNotify: boolean;
  reason?: string;
}

/**
 * Determines if a document should trigger a notification based on filters.
 *
 * @param document - The document to evaluate
 * @param config - The integration configuration
 * @returns Whether to send notification and reason if filtered
 *
 * @example
 * ```typescript
 * const result = shouldNotify(document, {
 *   minimumAmount: 100,
 *   vendorFilter: ['Amazon', 'Google']
 * });
 *
 * if (!result.shouldNotify) {
 *   console.log(`Skipped: ${result.reason}`);
 * }
 * ```
 */
export function shouldNotify(
  document: Document,
  config: Partial<SlackIntegrationConfig>
): FilterResult {
  // Check minimum amount filter
  const minimumAmountResult = checkMinimumAmount(document, config);
  if (!minimumAmountResult.shouldNotify) {
    return minimumAmountResult;
  }

  // Check vendor filter
  const vendorResult = checkVendorFilter(document, config);
  if (!vendorResult.shouldNotify) {
    return vendorResult;
  }

  // Check category filter
  const categoryResult = checkCategoryFilter(document, config);
  if (!categoryResult.shouldNotify) {
    return categoryResult;
  }

  return { shouldNotify: true };
}

/**
 * Checks if document meets minimum amount threshold.
 */
function checkMinimumAmount(
  document: Document,
  config: Partial<SlackIntegrationConfig>
): FilterResult {
  const { minimumAmount, minimumAmountCurrency } = config;

  // No filter if minimum is 0 or not set
  if (!minimumAmount || minimumAmount <= 0) {
    return { shouldNotify: true };
  }

  const documentAmount = document.total ?? 0;
  const documentCurrency = document.currency?.toUpperCase() || 'EUR';
  const filterCurrency = minimumAmountCurrency?.toUpperCase() || 'EUR';

  // If currencies don't match, we can't compare accurately
  // In this case, we'll allow the notification (conservative approach)
  if (documentCurrency !== filterCurrency) {
    return { shouldNotify: true };
  }

  if (documentAmount < minimumAmount) {
    return {
      shouldNotify: false,
      reason: `amount_below_minimum:${documentAmount}<${minimumAmount}`,
    };
  }

  return { shouldNotify: true };
}

/**
 * Checks if document vendor matches the filter.
 */
function checkVendorFilter(
  document: Document,
  config: Partial<SlackIntegrationConfig>
): FilterResult {
  const { vendorFilter } = config;

  // No filter if empty or not set
  if (!vendorFilter || vendorFilter.length === 0) {
    return { shouldNotify: true };
  }

  const documentVendor = (document.vendorName || '').toLowerCase().trim();

  // If vendor is not set on document, skip filter (allow notification)
  if (!documentVendor) {
    return { shouldNotify: true };
  }

  // Check if any filter matches (case-insensitive, partial match)
  const matches = vendorFilter.some((filterVendor) => {
    const normalizedFilter = filterVendor.toLowerCase().trim();
    return documentVendor.includes(normalizedFilter) || normalizedFilter.includes(documentVendor);
  });

  if (!matches) {
    return {
      shouldNotify: false,
      reason: `vendor_not_in_filter:${document.vendorName}`,
    };
  }

  return { shouldNotify: true };
}

/**
 * Checks if document category matches the filter.
 */
function checkCategoryFilter(
  document: Document,
  config: Partial<SlackIntegrationConfig>
): FilterResult {
  const { categoryFilter } = config;

  // No filter if empty or not set
  if (!categoryFilter || categoryFilter.length === 0) {
    return { shouldNotify: true };
  }

  // If no category assigned, skip filter (allow notification)
  if (!document.categoryId && !document.categoryName) {
    return { shouldNotify: true };
  }

  // Check by category ID first, then by name
  const matches = categoryFilter.some((filterCategory) => {
    const normalizedFilter = filterCategory.toLowerCase().trim();

    // Match by ID
    if (document.categoryId?.toLowerCase() === normalizedFilter) {
      return true;
    }

    // Match by name (partial match)
    if (document.categoryName) {
      const normalizedName = document.categoryName.toLowerCase().trim();
      return normalizedName.includes(normalizedFilter) || normalizedFilter.includes(normalizedName);
    }

    return false;
  });

  if (!matches) {
    return {
      shouldNotify: false,
      reason: `category_not_in_filter:${document.categoryName || document.categoryId}`,
    };
  }

  return { shouldNotify: true };
}

/**
 * Checks if a specific notification type is enabled in config.
 *
 * @param notificationType - The type of notification
 * @param config - The integration configuration
 * @returns Whether the notification type is enabled
 */
export function isNotificationEnabled(
  notificationType: keyof Pick<
    SlackIntegrationConfig,
    | 'notifyOnDocumentCreated'
    | 'notifyOnDocumentProcessed'
    | 'notifyOnDocumentUpdated'
    | 'notifyOnExportCompleted'
    | 'enableDailySummary'
  >,
  config: Partial<SlackIntegrationConfig>
): boolean {
  const value = config[notificationType];

  // Default values for each type
  const defaults: Record<string, boolean> = {
    notifyOnDocumentCreated: false,
    notifyOnDocumentProcessed: true,
    notifyOnDocumentUpdated: false,
    notifyOnExportCompleted: true,
    enableDailySummary: false,
  };

  return value !== undefined ? value : defaults[notificationType] ?? false;
}
