import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildExportCompletedMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Messenger payload for export.completed', { input });
  return {
    success: true,
    transport: 'messenger',
    template: 'export_completed',
    payload: input,
  };
};
