import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const sendTestDiscordMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  try {
    context.logger.info('Building Discord test message payload', { input });
    return {
      success: true,
      transport: 'discord',
      template: 'test',
      payload: {
        message: 'This is a test notification from InvoiceLeaf Discord Bot integration.',
      },
    };
  } catch (error) {
    context.logger.error('Failed to build test message payload', {
      error: (error as Error).message,
    });
    return { success: false, error: `Handler error: ${(error as Error).message}` };
  }
};
