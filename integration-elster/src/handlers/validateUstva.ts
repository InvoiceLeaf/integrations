import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, ValidateUstvaInput, ValidateUstvaResult } from '../types.js';
import { buildUstva, toErrorMessage } from './shared.js';

/**
 * Validate a USt-VA filing against ERiC without submitting it (test path). Read-only
 * and AI-callable. Requires the verified `filing` capability, so the host grants
 * `context.filing` only to verified integrations.
 */
export const validateUstva: IntegrationHandler<
  ValidateUstvaInput,
  ValidateUstvaResult,
  ElsterIntegrationConfig
> = async (input, context): Promise<ValidateUstvaResult> => {
  try {
    if (!context.filing) {
      return {
        success: false,
        period: input.period,
        ok: false,
        errors: [],
        error: 'Filing is not enabled for this integration.',
      };
    }

    const { period, xml } = await buildUstva(context, input.period);
    const result = await context.filing.validate({
      xml,
      formType: 'ustva',
      period: period.canonical,
      testMode: true,
    });
    const errors = result.errors ?? [];

    return {
      success: true,
      period: period.canonical,
      ok: result.ok,
      errors,
      message: result.ok
        ? `USt-VA for ${period.canonical} is valid.`
        : `USt-VA for ${period.canonical} has ${errors.length} validation issue(s).`,
    };
  } catch (error) {
    context.logger.error('USt-VA validation failed', { error: toErrorMessage(error) });
    return {
      success: false,
      period: input.period,
      ok: false,
      errors: [],
      error: toErrorMessage(error),
    };
  }
};
