import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildExportCompletedMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Telegram payload for export.completed', { input });
  return {
    success: true,
    transport: 'telegram',
    template: 'export_completed',
    payload: input,
  };
};
