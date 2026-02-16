import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const sendTestTelegramMessage = async (
  _input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Telegram test payload');
  return {
    success: true,
    transport: 'telegram',
    template: 'test',
    message: 'Telegram integration test message from InvoiceLeaf.',
  };
};
