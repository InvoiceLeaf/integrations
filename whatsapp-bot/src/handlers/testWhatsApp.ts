import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const sendTestWhatsAppMessage = async (
  _input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building WhatsApp test payload');
  return {
    success: true,
    transport: 'whatsapp',
    template: 'test',
    message: 'WhatsApp integration test message from InvoiceLeaf.',
  };
};
