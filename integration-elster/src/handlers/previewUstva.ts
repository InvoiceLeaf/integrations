import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, PreviewUstvaInput, PreviewUstvaResult } from '../types.js';
import { computeUstvaKennzahlen, listDocumentsInWindow, parsePeriod, toErrorMessage } from './shared.js';

/**
 * Read-only preview of the USt-VA Kennzahlen for a period. Returns JSON for the UI
 * and the AI ChatService (this action is NOT internal, so it is AI-callable).
 */
export const previewUstva: IntegrationHandler<
  PreviewUstvaInput,
  PreviewUstvaResult,
  ElsterIntegrationConfig
> = async (input, context): Promise<PreviewUstvaResult> => {
  try {
    const period = parsePeriod(input.period);
    const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
    const { kennzahlen, payable, documentCount, review } = computeUstvaKennzahlen(documents);

    const base =
      payable >= 0
        ? `Estimated USt-VA payable for ${period.canonical}: ${payable.toFixed(2)}.`
        : `Estimated USt-VA refund for ${period.canonical}: ${Math.abs(payable).toFixed(2)}.`;
    const reviewNote = review.length > 0 ? ` ${review.length} item group(s) need review before filing.` : '';

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
    context.logger.error('USt-VA preview failed', { error: toErrorMessage(error) });
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
