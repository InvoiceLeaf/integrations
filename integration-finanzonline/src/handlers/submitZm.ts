import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { FinanzOnlineConfig, SubmitResult, SubmitZmInput } from '../types';
import { buildZmXml, getFonCredentials, parsePeriod, submitToFon, toErrorMessage } from './shared';

/**
 * Build the ZM (Zusammenfassende Meldung, art "U13") for a period and submit it to
 * FinanzOnline via the webservice, using the stored credentials. Defaults to a
 * non-binding TEST transmission; set `production: true` to file for real.
 */
export const submitZm: IntegrationHandler<
  SubmitZmInput,
  SubmitResult,
  FinanzOnlineConfig
> = async (input, context): Promise<SubmitResult> => {
  const production = input.production === true;
  try {
    const period = parsePeriod(input.period);
    const creds = await getFonCredentials(context);
    const xml = await buildZmXml(context, period);
    const result = await submitToFon(creds, 'U13', xml, production);
    if (!result.success) {
      context.logger.warn('ZM submission not accepted', { rc: result.rc, status: result.status });
    }
    return result;
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('ZM submission failed', { error: message });
    return {
      success: false,
      mode: production ? 'production' : 'test',
      message,
      error: message,
    };
  }
};
