import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const sendTestMessengerMessage = async (
  _input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Messenger test payload');
  return {
    success: true,
    transport: 'messenger',
    template: 'test',
    message: 'Messenger integration test message from InvoiceLeaf.',
  };
};
