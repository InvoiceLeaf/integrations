/**
 * Formatting Utilities
 *
 * Helper functions for formatting currency, dates, and other values.
 */

/**
 * Formats a number as currency.
 *
 * @param amount - The amount to format
 * @param currency - The currency code (e.g., 'EUR', 'USD')
 * @returns Formatted currency string
 *
 * @example
 * formatCurrency(1234.56, 'EUR') // '€1,234.56'
 * formatCurrency(1234.56, 'USD') // '$1,234.56'
 */
export function formatCurrency(amount: number | undefined | null, currency?: string | null): string {
  if (amount === undefined || amount === null) {
    return 'N/A';
  }

  const currencyCode = currency || 'EUR';

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if currency code is invalid
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

/**
 * Formats a date value for display.
 *
 * Accepts either an ISO date string or epoch milliseconds.
 *
 * @param dateValue - ISO date string or epoch milliseconds
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string
 *
 * @example
 * formatDate('2024-01-15')     // 'Jan 15, 2024'
 * formatDate(1705276800000)    // 'Jan 15, 2024'
 */
export function formatDate(
  dateValue: string | number | undefined | null,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
): string {
  if (dateValue === undefined || dateValue === null) {
    return 'N/A';
  }

  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) {
      return 'N/A';
    }
    return new Intl.DateTimeFormat('en-US', options).format(date);
  } catch {
    return 'N/A';
  }
}

/**
 * Formats a date as relative time (e.g., "2 hours ago").
 *
 * Accepts either an ISO date string or epoch milliseconds.
 *
 * @param dateValue - ISO date string or epoch milliseconds
 * @returns Relative time string
 *
 * @example
 * formatRelativeTime('2024-01-15T10:00:00Z') // '2 hours ago'
 * formatRelativeTime(1705312800000)           // '2 hours ago'
 */
export function formatRelativeTime(dateValue: string | number | undefined | null): string {
  if (dateValue === undefined || dateValue === null) {
    return 'N/A';
  }

  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) {
      return 'N/A';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return 'just now';
    }
    if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    }
    if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    }
    if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    }

    // Fall back to formatted date for older items
    return formatDate(dateValue);
  } catch {
    return 'N/A';
  }
}

/**
 * Formats a number with thousands separators.
 *
 * @param value - The number to format
 * @returns Formatted number string
 *
 * @example
 * formatNumber(1234567) // '1,234,567'
 */
export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null) {
    return 'N/A';
  }

  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Truncates text to a maximum length with ellipsis.
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text
 */
export function truncate(text: string | undefined | null, maxLength: number): string {
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Converts a date value (ISO string or epoch milliseconds) to epoch seconds.
 *
 * InvoiceLeaf backend uses epoch milliseconds for timestamps, while Slack's
 * date formatting and attachment `ts` field expect epoch seconds.
 *
 * @param dateValue - ISO date string or epoch milliseconds
 * @returns Epoch seconds, or null if the input is invalid
 *
 * @example
 * toEpochSeconds(1705276800000)             // 1705276800
 * toEpochSeconds('2024-01-15T00:00:00Z')    // 1705276800
 */
export function toEpochSeconds(dateValue: string | number | undefined | null): number | null {
  if (dateValue === undefined || dateValue === null) {
    return null;
  }

  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) {
      return null;
    }
    return Math.floor(date.getTime() / 1000);
  } catch {
    return null;
  }
}

/**
 * Formats a date using Slack's native date formatting.
 *
 * Uses Slack's `<!date^EPOCH^FORMAT|FALLBACK>` syntax, which renders dates
 * in each user's local timezone. This is preferred over server-side formatting.
 *
 * @param dateValue - ISO date string or epoch milliseconds
 * @param tokenString - Slack date token string (default: '{date_short_pretty} at {time}')
 * @param fallbackText - Text shown if Slack cannot render the date
 * @returns Slack date mrkdwn string, or fallback text if input is invalid
 *
 * @see https://api.slack.com/reference/surfaces/formatting#date-formatting
 *
 * @example
 * formatSlackDate(1705276800000)
 * // '<!date^1705276800^{date_short_pretty} at {time}|Jan 15, 2024>'
 */
export function formatSlackDate(
  dateValue: string | number | undefined | null,
  tokenString = '{date_short_pretty} at {time}',
  fallbackText?: string
): string {
  const epochSeconds = toEpochSeconds(dateValue);
  if (epochSeconds === null) {
    return fallbackText || 'N/A';
  }

  const fallback = fallbackText || formatDate(dateValue);
  return `<!date^${epochSeconds}^${tokenString}|${fallback}>`;
}

/**
 * Escapes special characters for Slack mrkdwn format.
 *
 * @param text - Text to escape
 * @returns Escaped text safe for mrkdwn
 */
export function escapeSlackMrkdwn(text: string | undefined | null): string {
  if (!text) {
    return '';
  }

  // Escape special mrkdwn characters: & < > * _ ~ `
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
