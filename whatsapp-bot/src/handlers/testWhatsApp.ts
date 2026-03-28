import type { IntegrationHandler, HandlerResult, UserActionInput } from '@invoiceleaf/integration-sdk';
import type { WhatsAppBotConfig } from '../types.js';

export const sendTestWhatsAppMessage: IntegrationHandler<UserActionInput, HandlerResult, WhatsAppBotConfig> = async (_input, context) => {
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
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
