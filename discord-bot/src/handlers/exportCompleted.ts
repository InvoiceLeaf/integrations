import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildExportCompletedMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Discord payload for export.completed', { input });
  return {
    success: true,
    transport: 'discord',
    template: 'export_completed',
    payload: input,
  };
};
