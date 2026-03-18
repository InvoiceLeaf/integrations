import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildDocumentProcessedMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  try {
    if (!input || typeof input !== 'object') {
      context.logger.warn('Invalid input for document.processed', { input });
      return { success: false, error: 'Invalid input: expected an object' };
    }

    context.logger.info('Building Messenger payload for document.processed', { input });
    return {
      success: true,
      transport: 'messenger',
      template: 'document_processed',
      payload: input,
    };
  } catch (error) {
    context.logger.error('Failed to build document.processed payload', {
      error: (error as Error).message,
    });
    return { success: false, error: `Handler error: ${(error as Error).message}` };
  }
};
