import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildExportCompletedMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building WhatsApp payload for export.completed', { input });
  return {
    success: true,
    transport: 'whatsapp',
    template: 'export_completed',
    payload: input,
  };
};
