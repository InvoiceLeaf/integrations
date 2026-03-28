import type { IntegrationHandler, HandlerResult, ExportCompletedInput } from '@invoiceleaf/integration-sdk';
import type { MessengerBotConfig } from '../types.js';

export const buildExportCompletedMessage: IntegrationHandler<ExportCompletedInput, HandlerResult, MessengerBotConfig> = async (input, context) => {
  try {
    if (!input || typeof input !== 'object') {
      context.logger.warn('Invalid input for export.completed', { input });
      return { success: false, error: 'Invalid input: expected an object' };
    }

    context.logger.info('Building Messenger payload for export.completed', { input });
    return {
      success: true,
      transport: 'messenger',
      template: 'export_completed',
      payload: input,
    };
  } catch (error) {
    context.logger.error('Failed to build export.completed payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
