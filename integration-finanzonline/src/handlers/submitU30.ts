import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { FinanzOnlineConfig, FiledResult, SubmitU30Input } from '../types';
import { fileToFon } from './fileToFon';
import { toErrorMessage } from './shared';

/**
 * File the U30 (USt-Voranmeldung) with FinanzOnline for real.
 *
 * This action is `internal: true` in the manifest, so it is NOT AI-callable; it is
 * reached only from the tax agent after a recorded approval, or from the confirmation
 * UI. It always files for real: the non-binding test transmission is `validate-u30`.
 */
export const submitU30: IntegrationHandler<
  SubmitU30Input,
  FiledResult,
  FinanzOnlineConfig
> = async (input, context): Promise<FiledResult> => {
  try {
    return await fileToFon(context, {
      art: 'U30',
      formType: 'u30',
      label: 'U30',
      period: input.period,
      confirmToken: input.confirmToken,
      figuresHash: input.figuresHash,
    });
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('U30 filing failed', { error: message });
    return {
      success: false,
      period: input.period,
      mode: 'production',
      message,
      error: message,
    };
  }
};
