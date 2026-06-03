import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import { toErrorMessage } from '@invoiceleaf/integration-sdk';
import type {
  ElsterIntegrationConfig,
  FilingStatusEntry,
  FilingStatusInput,
  FilingStatusResult,
} from '../types.js';

/** State key prefix under which submitted filings are recorded in installation state. */
const FILING_STATE_PREFIX = 'elster:filing:';
/** Index key holding the list of recorded filing state keys. */
const FILING_INDEX_KEY = 'elster:filing:index';

/**
 * Read-only filing history / status for this installation. Returns JSON for the UI
 * and the AI ChatService (NOT internal, so AI-callable).
 *
 * v1 reads filing records from installation state (written by {@link submitUstva}).
 *
 * TODO(taxfiling): once the Layer 2 `TaxFiling` entity and a host-side filing
 *   history endpoint exist, read from there instead of installation state so the
 *   history survives even when state is pruned and matches the receipts UI.
 */
export const filingStatus: IntegrationHandler<
  FilingStatusInput,
  FilingStatusResult,
  ElsterIntegrationConfig
> = async (input, context): Promise<FilingStatusResult> => {
  try {
    const index = (await context.state.get<string[]>(FILING_INDEX_KEY)) ?? [];
    const filings: FilingStatusEntry[] = [];

    for (const key of index) {
      const entry = await context.state.get<FilingStatusEntry>(key);
      if (!entry) continue;
      if (input.period && entry.period !== input.period) continue;
      filings.push(entry);
    }

    return {
      success: true,
      filings,
      message: `${filings.length} filing record(s) found.`,
    };
  } catch (error) {
    context.logger.error('Reading filing status failed', { error: toErrorMessage(error) });
    return {
      success: false,
      filings: [],
      error: toErrorMessage(error),
    };
  }
};

/** State key for a single filing record. Shared with {@link submitUstva}. */
export function filingStateKey(formType: string, period: string): string {
  return `${FILING_STATE_PREFIX}${formType}:${period}`;
}

export { FILING_INDEX_KEY };
