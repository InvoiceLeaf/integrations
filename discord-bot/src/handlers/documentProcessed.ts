import type { IntegrationHandler, HandlerResult, DocumentProcessedInput } from '@invoiceleaf/integration-sdk';
import type { DiscordBotConfig } from '../types.js';

export const buildDocumentProcessedMessage: IntegrationHandler<DocumentProcessedInput, HandlerResult, DiscordBotConfig> = async (input, context) => {
  try {
    if (!input || typeof input !== 'object') {
      context.logger.warn('Invalid input for document.processed', { input });
      return { success: false, error: 'Invalid input: expected an object' };
    }

    context.logger.info('Building Discord payload for document.processed', { input });
    return {
      success: true,
      transport: 'discord',
      template: 'document_processed',
      payload: input,
    };
  } catch (error) {
    context.logger.error('Failed to build document.processed payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
