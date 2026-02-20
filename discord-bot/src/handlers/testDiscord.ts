import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const sendTestDiscordMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Discord test message payload', { input });
  return {
    success: true,
    transport: 'discord',
    template: 'test',
    payload: {
      message: 'This is a test notification from InvoiceLeaf Discord Bot integration.',
    },
  };
};
