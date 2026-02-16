import { defineHandler } from '@invoiceleaf/integration-sdk';

export const buildExportCompletedMessage = defineHandler(async (input: unknown, context) => {
  context.logger.info('Building Telegram payload for export.completed', { input });
  return {
    success: true,
    transport: 'telegram',
    template: 'export_completed',
    payload: input,
  };
});
