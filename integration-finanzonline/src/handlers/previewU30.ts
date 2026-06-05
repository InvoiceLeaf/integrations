import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { FinanzOnlineConfig, PreviewU30Input, PreviewU30Result } from '../types';
import { computeU30 } from '../mapping/index';
import { listDocumentsInWindow, parsePeriod, toErrorMessage } from './shared';

/**
 * Read-only preview of the U30 Kennzahlen for a period. Returns JSON for the UI and
 * the AI ChatService (this action is NOT internal, so it is AI-callable). Surfaces
 * the `review` buckets so unmapped documents are visible before any file is filed.
 */
export const previewU30: IntegrationHandler<
  PreviewU30Input,
  PreviewU30Result,
  FinanzOnlineConfig
> = async (input, context): Promise<PreviewU30Result> => {
  try {
    const period = parsePeriod(input.period);
    const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
    const { kennzahlen, payable, documentCount, review } = computeU30(documents);

    const base =
      payable >= 0
        ? `Estimated U30 payable (Zahllast) for ${period.canonical}: ${payable.toFixed(2)}.`
        : `Estimated U30 credit (Gutschrift) for ${period.canonical}: ${Math.abs(payable).toFixed(2)}.`;
    const reviewNote =
      review.length > 0 ? ` ${review.length} item group(s) need review before filing.` : '';

    return {
      success: true,
      period: period.canonical,
      kennzahlen,
      payable,
      documentCount,
      review,
      message: base + reviewNote,
    };
  } catch (error) {
    context.logger.error('U30 preview failed', { error: toErrorMessage(error) });
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
