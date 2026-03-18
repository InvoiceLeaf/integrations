import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildExportCompletedMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  try {
    if (!input || typeof input !== 'object') {
      context.logger.warn('Invalid input for export.completed', { input });
      return { success: false, error: 'Invalid input: expected an object' };
    }

    context.logger.info('Building Discord payload for export.completed', { input });
    return {
      success: true,
      transport: 'discord',
      template: 'export_completed',
      payload: input,
    };
  } catch (error) {
    context.logger.error('Failed to build export.completed payload', {
      error: (error as Error).message,
    });
    return { success: false, error: `Handler error: ${(error as Error).message}` };
  }
};
