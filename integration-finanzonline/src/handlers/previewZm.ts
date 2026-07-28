import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { FinanzOnlineConfig, PreviewZmInput, PreviewZmResult } from '../types';
import { computeZmEntries } from '../mapping/index';
import { listDocumentsInWindow, parsePeriod, toErrorMessage } from './shared';

/**
 * Read-only preview of the ZM lines for a period. Returns JSON for the UI, the AI
 * ChatService and the tax agent (this action is NOT internal, so it is AI-callable).
 * Surfaces the `review` buckets so supplies without a usable customer UID are visible
 * before anything is filed.
 */
export const previewZm: IntegrationHandler<
  PreviewZmInput,
  PreviewZmResult,
  FinanzOnlineConfig
> = async (input, context): Promise<PreviewZmResult> => {
  try {
    const period = parsePeriod(input.period);
    const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
    const { entries, documentCount, review } = computeZmEntries(documents);

    // One "Kennzahl" per reported line, so the agent can hash and diff the figures the
    // same way it does for the U30.
    const kennzahlen: Record<string, number> = {};
    let total = 0;
    for (const entry of entries) {
      kennzahlen[`${entry.uidMs}|${entry.klag}`] = entry.sumBgl;
      total += entry.sumBgl;
    }

    const base =
      entries.length > 0
        ? `ZM for ${period.canonical}: ${entries.length} line(s), ${total.toFixed(2)} total intra-EU turnover.`
        : `No intra-EU B2B supplies found for ${period.canonical}; nothing to report.`;
    const reviewNote =
      review.length > 0 ? ` ${review.length} item group(s) need review before filing.` : '';

    return {
      success: true,
      period: period.canonical,
      kennzahlen,
      payable: total,
      documentCount,
      entries,
      review,
      message: base + reviewNote,
    };
  } catch (error) {
    context.logger.error('ZM preview failed', { error: toErrorMessage(error) });
    return {
      success: false,
      period: input.period,
      kennzahlen: {},
      payable: 0,
      documentCount: 0,
      error: toErrorMessage(error),
    };
  }
};
