import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { FinanzOnlineConfig, SubmitResult, SubmitU30Input } from '../types';
import { buildU30Xml, getFonCredentials, parsePeriod, submitToFon, toErrorMessage } from './shared';

/**
 * Build the U30 (USt-Voranmeldung) for a period and submit it to FinanzOnline via
 * the webservice, using the stored credentials. Defaults to a non-binding TEST
 * transmission; set `production: true` to file for real.
 */
export const submitU30: IntegrationHandler<
  SubmitU30Input,
  SubmitResult,
  FinanzOnlineConfig
> = async (input, context): Promise<SubmitResult> => {
  const production = input.production === true;
  try {
    const period = parsePeriod(input.period);
    const creds = await getFonCredentials(context);
    const xml = await buildU30Xml(context, period);
    const result = await submitToFon(creds, 'U30', xml, production);
    if (!result.success) {
      context.logger.warn('U30 submission not accepted', { rc: result.rc, status: result.status });
    }
    return result;
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('U30 submission failed', { error: message });
    return {
      success: false,
      mode: production ? 'production' : 'test',
      message,
      error: message,
    };
  }
};
