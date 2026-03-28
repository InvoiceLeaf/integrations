import type { IntegrationHandler, HandlerResult, UserActionInput } from '@invoiceleaf/integration-sdk';
import type { MessengerBotConfig } from '../types.js';

export const sendTestMessengerMessage: IntegrationHandler<UserActionInput, HandlerResult, MessengerBotConfig> = async (_input, context) => {
  try {
    context.logger.info('Building Messenger test payload');
    return {
      success: true,
      transport: 'messenger',
      template: 'test',
      message: 'Messenger integration test message from InvoiceLeaf.',
    };
  } catch (error) {
    context.logger.error('Failed to build test message payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
