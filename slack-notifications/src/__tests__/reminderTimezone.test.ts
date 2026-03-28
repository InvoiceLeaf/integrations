/**
 * Reminder Timezone Regression Tests
 *
 * Validates that reminder-triggered notifications produce timezone-consistent
 * output. Covers the formatSlackDate, formatDate, and buildReminderTriggeredBlocks
 * functions to ensure epoch-millisecond timestamps render correctly.
 *
 * Issue: BillKoala-2ra - UTC/local mismatch prevention in chat tool outputs.
 */
import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatSlackDate,
  toEpochSeconds,
  formatRelativeTime,
} from '../utils/formatters.js';
import { buildReminderTriggeredBlocks } from '../slack/blocks.js';
import type { ReminderTriggeredInput, SectionBlock, SlackBlock } from '../types.js';

// ============================================================================
// formatSlackDate: epoch-ms to Slack date token
// ============================================================================

describe('formatSlackDate timezone consistency', () => {
  it('converts epoch milliseconds to epoch seconds for Slack', () => {
    // 2026-01-15T09:00:00Z in epoch ms
    const epochMs = Date.UTC(2026, 0, 15, 9, 0, 0);
    const epochSec = toEpochSeconds(epochMs);

    expect(epochSec).toBe(Math.floor(epochMs / 1000));
  });

  it('produces Slack date token with correct epoch seconds', () => {
    const epochMs = Date.UTC(2026, 0, 15, 9, 0, 0);
    const result = formatSlackDate(epochMs);

    // Should contain <!date^EPOCH_SECONDS^...
    expect(result).toMatch(/^<!date\^\d+\^/);

    // Extract epoch seconds from the token
    const match = result.match(/<!date\^(\d+)\^/);
    expect(match).not.toBeNull();
    const extractedEpoch = Number(match![1]);
    expect(extractedEpoch).toBe(Math.floor(epochMs / 1000));
  });

  it('handles epoch ms from different timezone-originated timestamps', () => {
    // 2026-06-15T14:00:00+02:00 (Berlin CEST) = 2026-06-15T12:00:00Z
    const berlinEpochMs = Date.UTC(2026, 5, 15, 12, 0, 0);

    // 2026-06-15T09:00:00-04:00 (New York EDT) = 2026-06-15T13:00:00Z
    const nyEpochMs = Date.UTC(2026, 5, 15, 13, 0, 0);

    const berlinResult = formatSlackDate(berlinEpochMs);
    const nyResult = formatSlackDate(nyEpochMs);

    // Both should produce valid Slack date tokens
    expect(berlinResult).toMatch(/^<!date\^\d+\^/);
    expect(nyResult).toMatch(/^<!date\^\d+\^/);

    // And they should have different epoch seconds since they represent different UTC instants
    const berlinMatch = berlinResult.match(/<!date\^(\d+)\^/)!;
    const nyMatch = nyResult.match(/<!date\^(\d+)\^/)!;
    expect(Number(berlinMatch[1])).not.toBe(Number(nyMatch[1]));
  });

  it('returns fallback text for undefined/null input', () => {
    expect(formatSlackDate(undefined)).toBe('N/A');
    expect(formatSlackDate(null)).toBe('N/A');
  });

  it('returns custom fallback for invalid input', () => {
    expect(formatSlackDate('invalid-date', undefined, 'Unknown')).toBe('Unknown');
  });
});

// ============================================================================
// formatDate: epoch-ms rendering
// ============================================================================

describe('formatDate with epoch milliseconds', () => {
  it('formats epoch ms to human-readable date', () => {
    const epochMs = Date.UTC(2026, 2, 15, 9, 0, 0); // March 15, 2026 09:00 UTC
    const result = formatDate(epochMs);

    expect(result).toContain('2026');
    expect(result).toContain('Mar');
    expect(result).toContain('15');
  });

  it('formats epoch ms with time options', () => {
    const epochMs = Date.UTC(2026, 2, 15, 14, 30, 0); // March 15, 2026 14:30 UTC
    const result = formatDate(epochMs, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    expect(result).toContain('2026');
    expect(result).not.toBe('N/A');
  });

  it('returns N/A for undefined', () => {
    expect(formatDate(undefined)).toBe('N/A');
    expect(formatDate(null)).toBe('N/A');
  });
});

// ============================================================================
// toEpochSeconds: ms to seconds conversion
// ============================================================================

describe('toEpochSeconds precision', () => {
  it('correctly divides by 1000 and floors', () => {
    expect(toEpochSeconds(1705276800000)).toBe(1705276800);
    expect(toEpochSeconds(1705276800500)).toBe(1705276800);
    expect(toEpochSeconds(1705276800999)).toBe(1705276800);
  });

  it('handles ISO string input', () => {
    const result = toEpochSeconds('2026-01-15T00:00:00Z');
    expect(result).toBeTypeOf('number');
    expect(result).toBeGreaterThan(0);
  });

  it('returns null for invalid input', () => {
    expect(toEpochSeconds(undefined)).toBeNull();
    expect(toEpochSeconds(null)).toBeNull();
    expect(toEpochSeconds('not-a-date')).toBeNull();
  });
});

// ============================================================================
// buildReminderTriggeredBlocks: timezone in block output
// ============================================================================

describe('buildReminderTriggeredBlocks timezone handling', () => {
  it('includes scheduledFor as Slack date token when present', () => {
    const input: ReminderTriggeredInput = {
      reminderId: 'rem-123',
      title: 'Monthly tax reminder',
      scheduledFor: Date.UTC(2026, 5, 15, 12, 0, 0),
      messageText: 'Time to file your taxes',
    };

    const blocks = buildReminderTriggeredBlocks(input);
    const blockTexts = JSON.stringify(blocks);

    // Should contain a Slack date token for the scheduled time
    expect(blockTexts).toContain('<!date^');
    // The date token should use the correct epoch seconds
    const expectedEpochSec = Math.floor(input.scheduledFor! / 1000);
    expect(blockTexts).toContain(`<!date^${expectedEpochSec}^`);
  });

  it('renders blocks without scheduledFor when not provided', () => {
    const input: ReminderTriggeredInput = {
      reminderId: 'rem-456',
      title: 'Simple reminder',
      messageText: 'Check something',
    };

    const blocks = buildReminderTriggeredBlocks(input);
    const blockTexts = JSON.stringify(blocks);

    // Should not contain a Slack date token
    expect(blockTexts).not.toContain('<!date^');
    // Should still contain the message
    expect(blockTexts).toContain('Check something');
  });

  it('includes reminder ID in context block', () => {
    const input: ReminderTriggeredInput = {
      reminderId: 'abc-def-123',
      occurrenceId: 'occ-789',
      title: 'Test',
      messageText: 'Test message',
    };

    const blocks = buildReminderTriggeredBlocks(input);
    const blockTexts = JSON.stringify(blocks);

    expect(blockTexts).toContain('abc-def-123');
    expect(blockTexts).toContain('occ-789');
  });

  it('uses title as fallback when messageText is empty', () => {
    const input: ReminderTriggeredInput = {
      title: 'Important reminder title',
    };

    const blocks = buildReminderTriggeredBlocks(input);
    const blockTexts = JSON.stringify(blocks);

    expect(blockTexts).toContain('Important reminder title');
  });

  it('uses default message when both title and messageText are absent', () => {
    const input: ReminderTriggeredInput = {};

    const blocks = buildReminderTriggeredBlocks(input);
    const blockTexts = JSON.stringify(blocks);

    expect(blockTexts).toContain('Reminder triggered');
  });

  it('scheduledFor at different UTC instants produces different Slack tokens', () => {
    // 09:00 Berlin (12:00 UTC in winter, CET) vs 09:00 Tokyo (00:00 UTC, JST)
    const berlinEpoch = Date.UTC(2026, 0, 15, 8, 0, 0); // 09:00 CET = 08:00 UTC
    const tokyoEpoch = Date.UTC(2026, 0, 15, 0, 0, 0);  // 09:00 JST = 00:00 UTC

    const berlinBlocks = buildReminderTriggeredBlocks({
      scheduledFor: berlinEpoch,
      messageText: 'Berlin',
    });
    const tokyoBlocks = buildReminderTriggeredBlocks({
      scheduledFor: tokyoEpoch,
      messageText: 'Tokyo',
    });

    const berlinJson = JSON.stringify(berlinBlocks);
    const tokyoJson = JSON.stringify(tokyoBlocks);

    const berlinMatch = berlinJson.match(/<!date\^(\d+)\^/)!;
    const tokyoMatch = tokyoJson.match(/<!date\^(\d+)\^/)!;

    expect(berlinMatch).not.toBeNull();
    expect(tokyoMatch).not.toBeNull();
    expect(Number(berlinMatch[1])).not.toBe(Number(tokyoMatch[1]));
  });
});

// ============================================================================
// Epoch millisecond round-trip consistency
// ============================================================================

describe('epoch millisecond consistency', () => {
  it('epoch ms stored as UTC always renders the same Slack token', () => {
    // Simulate a reminder stored at 09:00 Europe/Berlin
    // Backend stores as UTC epoch ms
    const localHour = 9;
    const berlinOffsetHours = 1; // CET in January
    const utcHour = localHour - berlinOffsetHours;
    const epochMs = Date.UTC(2026, 0, 15, utcHour, 0, 0);

    // Whether displayed in Berlin or UTC, the Slack token epoch should be identical
    const slackToken1 = formatSlackDate(epochMs);
    const slackToken2 = formatSlackDate(epochMs);

    expect(slackToken1).toBe(slackToken2);
  });

  it('same epoch renders same date across multiple formatDate calls', () => {
    const epochMs = Date.UTC(2026, 5, 15, 14, 0, 0);

    const result1 = formatDate(epochMs, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const result2 = formatDate(epochMs, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    expect(result1).toBe(result2);
    expect(result1).not.toBe('N/A');
  });
});
