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
 * Formats a date string for display.
 *
 * @param dateString - ISO date string
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string
 *
 * @example
 * formatDate('2024-01-15') // 'Jan 15, 2024'
 */
export function formatDate(
  dateString: string | undefined | null,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
): string {
  if (!dateString) {
    return 'N/A';
  }

  try {
    const date = new Date(dateString);
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
 * @param dateString - ISO date string
 * @returns Relative time string
 *
 * @example
 * formatRelativeTime('2024-01-15T10:00:00Z') // '2 hours ago'
 */
export function formatRelativeTime(dateString: string | undefined | null): string {
  if (!dateString) {
    return 'N/A';
  }

  try {
    const date = new Date(dateString);
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
    return formatDate(dateString);
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
