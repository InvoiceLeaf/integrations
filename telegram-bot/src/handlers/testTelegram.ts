import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const sendTestTelegramMessage = async (
  _input: unknown,
  context: IntegrationContext
) => {
  try {
    context.logger.info('Building Telegram test payload');
    return {
      success: true,
      transport: 'telegram',
      template: 'test',
      message: 'Telegram integration test message from InvoiceLeaf.',
    };
  } catch (error) {
    context.logger.error('Failed to build test message payload', {
      error: (error as Error).message,
    });
    return { success: false, error: `Handler error: ${(error as Error).message}` };
  }
};
