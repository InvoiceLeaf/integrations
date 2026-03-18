import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const sendTestWhatsAppMessage = async (
  _input: unknown,
  context: IntegrationContext
) => {
  try {
    context.logger.info('Building WhatsApp test payload');
    return {
      success: true,
      transport: 'whatsapp',
      template: 'test',
      message: 'WhatsApp integration test message from InvoiceLeaf.',
    };
  } catch (error) {
    context.logger.error('Failed to build test message payload', {
      error: (error as Error).message,
    });
    return { success: false, error: `Handler error: ${(error as Error).message}` };
  }
};
