import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { FinanzOnlineConfig, FiledResult, SubmitZmInput } from '../types';
import { fileToFon } from './fileToFon';
import { toErrorMessage } from './shared';

/**
 * File the ZM (Zusammenfassende Meldung, art "U13") with FinanzOnline for real.
 *
 * This action is `internal: true` in the manifest, so it is NOT AI-callable; it is
 * reached only from the tax agent after a recorded approval, or from the confirmation
 * UI. It always files for real: the non-binding test transmission is `validate-zm`.
 */
export const submitZm: IntegrationHandler<
  SubmitZmInput,
  FiledResult,
  FinanzOnlineConfig
> = async (input, context): Promise<FiledResult> => {
  try {
    return await fileToFon(context, {
      art: 'U13',
      formType: 'zm',
      label: 'ZM',
      period: input.period,
      confirmToken: input.confirmToken,
      figuresHash: input.figuresHash,
    });
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('ZM filing failed', { error: message });
    return {
      success: false,
      period: input.period,
      mode: 'production',
      message,
      error: message,
    };
  }
};
