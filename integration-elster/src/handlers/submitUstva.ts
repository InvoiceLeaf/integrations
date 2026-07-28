import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, SubmitUstvaInput, SubmitUstvaResult } from '../types.js';
import { buildUstva, toErrorMessage } from './shared.js';

/** Stable handle for the customer's ELSTER certificate (the externalAuth provider). */
const CERT_HANDLE = 'elster-cert';

/**
 * Sign and file a USt-VA with the Finanzamt via the host's native ERiC service.
 *
 * This action is `internal: true` in the manifest, so it is NOT AI-callable; it is
 * reached only from the tax agent after a recorded approval, or from the confirmation
 * UI. It always files for real and always requires an approval token: the non-binding
 * ERiC dry run is `validate-ustva`.
 *
 * The certificate bytes and PIN never enter this isolate: the plugin passes only the
 * stable cert handle; the host loads the certificate and performs the signing.
 */
export const submitUstva: IntegrationHandler<
  SubmitUstvaInput,
  SubmitUstvaResult,
  ElsterIntegrationConfig
> = async (input, context): Promise<SubmitUstvaResult> => {
  const mode = 'production';
  try {
    if (!context.filing) {
      return {
        success: false,
        period: input.period,
        mode,
        error: 'Filing is not enabled for this integration.',
      };
    }

    if (!input.confirmToken) {
      return {
        success: false,
        period: input.period,
        mode,
        error: 'Filing requires an approval. Approve the figures before filing.',
      };
    }

    const { period, xml } = await buildUstva(context, input.period);
    const result = await context.filing.submit({
      xml,
      formType: 'ustva',
      period: period.canonical,
      certHandle: CERT_HANDLE,
      testMode: false,
      confirmToken: input.confirmToken,
      figuresHash: input.figuresHash,
    });

    return {
      success: true,
      period: period.canonical,
      mode,
      state: result.transferTicket ? 'ACCEPTED' : 'SUBMITTED',
      transferTicket: result.transferTicket,
      receiptFileSource: result.receiptFileSource,
      message: `USt-VA for ${period.canonical} was filed.${
        result.transferTicket ? ` Transfer ticket: ${result.transferTicket}.` : ''
      }`,
    };
  } catch (error) {
    context.logger.error('USt-VA filing failed', { mode, error: toErrorMessage(error) });
    return {
      success: false,
      period: input.period,
      mode,
      error: toErrorMessage(error),
    };
  }
};
