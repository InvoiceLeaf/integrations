import type { IntegrationHandler, HandlerResult, UserActionInput } from '@invoiceleaf/integration-sdk';
import type { TelegramBotConfig } from '../types.js';

export const sendTestTelegramMessage: IntegrationHandler<UserActionInput, HandlerResult, TelegramBotConfig> = async (_input, context) => {
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
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
