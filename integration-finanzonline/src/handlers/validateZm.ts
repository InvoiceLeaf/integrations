import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { FinanzOnlineConfig, ValidateInput, ValidateResult } from '../types';
import { buildZmXml, getFonCredentials, parsePeriod, submitToFon, toErrorMessage } from './shared';

/**
 * Validate the ZM for a period by sending a non-binding TEST transmission
 * (uebermittlung "T") to FinanzOnline. Nothing is filed.
 *
 * Read-only in effect and AI-callable. Shares the `{ success, ok, errors }` contract with
 * the other validate actions so the tax agent handles every jurisdiction the same way.
 */
export const validateZm: IntegrationHandler<
  ValidateInput,
  ValidateResult,
  FinanzOnlineConfig
> = async (input, context): Promise<ValidateResult> => {
  try {
    const period = parsePeriod(input.period);
    const creds = await getFonCredentials(context);
    const xml = await buildZmXml(context, period);
    const result = await submitToFon(creds, 'U13', xml, false);
    const errors = (result.errors ?? []).map((e) => `${e.code}: ${e.text}`);

    return {
      success: true,
      period: period.canonical,
      ok: result.success,
      errors,
      message: result.success
        ? `ZM for ${period.canonical} was accepted by the FinanzOnline test path.`
        : `ZM for ${period.canonical} has ${errors.length} issue(s).`,
    };
  } catch (error) {
    context.logger.error('ZM validation failed', { error: toErrorMessage(error) });
    return {
      success: false,
      period: input.period,
      ok: false,
      errors: [],
      error: toErrorMessage(error),
    };
  }
};
