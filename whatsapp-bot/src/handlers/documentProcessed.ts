import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildDocumentProcessedMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building WhatsApp payload for document.processed', { input });
  return {
    success: true,
    transport: 'whatsapp',
    template: 'document_processed',
    payload: input,
  };
};
