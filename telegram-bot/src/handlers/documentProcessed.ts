import { defineHandler } from '@invoiceleaf/integration-sdk';

export const buildDocumentProcessedMessage = defineHandler(async (input: unknown, context) => {
  context.logger.info('Building Telegram payload for document.processed', { input });
  return {
    success: true,
    transport: 'telegram',
    template: 'document_processed',
    payload: input,
  };
});
