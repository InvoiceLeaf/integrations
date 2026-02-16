import { defineHandler } from '@invoiceleaf/integration-sdk';

export const sendTestTelegramMessage = defineHandler(async (_input: unknown, context) => {
  context.logger.info('Building Telegram test payload');
  return {
    success: true,
    transport: 'telegram',
    template: 'test',
    message: 'Telegram integration test message from InvoiceLeaf.',
  };
});
