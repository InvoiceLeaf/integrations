import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, FilingStatusInput, FilingStatusResult } from '../types.js';
import { toErrorMessage } from './shared.js';

/**
 * List the filings produced by this installation (read-only history). AI-callable.
 * Requires the verified `filing` capability.
 */
export const filingStatus: IntegrationHandler<
  FilingStatusInput,
  FilingStatusResult,
  ElsterIntegrationConfig
> = async (_input, context): Promise<FilingStatusResult> => {
  try {
    if (!context.filing) {
      return { success: false, filings: [], error: 'Filing is not enabled for this integration.' };
    }
    const filings = await context.filing.list();
    return {
      success: true,
      filings,
      message: filings.length === 1 ? '1 filing.' : `${filings.length} filings.`,
    };
  } catch (error) {
    context.logger.error('Filing status lookup failed', { error: toErrorMessage(error) });
    return { success: false, filings: [], error: toErrorMessage(error) };
  }
};
