import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, SubmitUstvaInput, SubmitUstvaResult } from '../types.js';
import { buildUstva, toErrorMessage } from './shared.js';

/** Stable handle for the customer's ELSTER certificate (the externalAuth provider). */
const CERT_HANDLE = 'elster-cert';

/**
 * Sign and submit a USt-VA filing to the Finanzamt via the host's native ERiC
 * service.
 *
 * This action is `internal: true` in the manifest — NOT AI-callable; only the UI
 * reaches it. A real, irreversible send happens only when `production` is explicitly
 * true (the UI sets it after an explicit confirmation); otherwise a non-binding test
 * transmission is sent.
 *
 * The certificate bytes and PIN never enter this isolate: the plugin passes only the
 * stable cert handle; the host loads the certificate and performs the signing.
 */
export const submitUstva: IntegrationHandler<
  SubmitUstvaInput,
  SubmitUstvaResult,
  ElsterIntegrationConfig
> = async (input, context): Promise<SubmitUstvaResult> => {
  const production = input.production === true;
  const mode = production ? 'production' : 'test';
  try {
    if (!context.filing) {
      return {
        success: false,
        period: input.period,
        mode,
        error: 'Filing is not enabled for this integration.',
      };
    }

    const { period, xml } = await buildUstva(context, input.period);
    const result = await context.filing.submit({
      xml,
      formType: 'ustva',
      period: period.canonical,
      certHandle: CERT_HANDLE,
      testMode: !production,
    });

    return {
      success: true,
      period: period.canonical,
      mode,
      state: result.transferTicket ? 'ACCEPTED' : 'SUBMITTED',
      transferTicket: result.transferTicket,
      receiptFileSource: result.receiptFileSource,
      message: `USt-VA for ${period.canonical} submitted (${mode}).${
        result.transferTicket ? ` Transfer ticket: ${result.transferTicket}.` : ''
      }`,
    };
  } catch (error) {
    context.logger.error('USt-VA submission failed', { mode, error: toErrorMessage(error) });
    return {
      success: false,
      period: input.period,
      mode,
      error: toErrorMessage(error),
    };
  }
};
