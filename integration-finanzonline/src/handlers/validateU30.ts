import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { FinanzOnlineConfig, ValidateInput, ValidateResult } from '../types';
import { buildU30Xml, getFonCredentials, parsePeriod, submitToFon, toErrorMessage } from './shared';

/**
 * Validate the U30 for a period by sending a non-binding TEST transmission
 * (uebermittlung "T") to FinanzOnline. Nothing is filed.
 *
 * Read-only in effect and AI-callable. The tax agent uses this as its validation step,
 * so the contract matches the German `validate-ustva`: `{ success, ok, errors }`.
 */
export const validateU30: IntegrationHandler<
  ValidateInput,
  ValidateResult,
  FinanzOnlineConfig
> = async (input, context): Promise<ValidateResult> => {
  try {
    const period = parsePeriod(input.period);
    const creds = await getFonCredentials(context);
    const xml = await buildU30Xml(context, period);
    const result = await submitToFon(creds, 'U30', xml, false);
    const errors = (result.errors ?? []).map((e) => `${e.code}: ${e.text}`);

    return {
      success: true,
      period: period.canonical,
      ok: result.success,
      errors,
      message: result.success
        ? `U30 for ${period.canonical} was accepted by the FinanzOnline test path.`
        : `U30 for ${period.canonical} has ${errors.length} issue(s).`,
    };
  } catch (error) {
    context.logger.error('U30 validation failed', { error: toErrorMessage(error) });
    return {
      success: false,
      period: input.period,
      ok: false,
      errors: [],
      error: toErrorMessage(error),
    };
  }
};
