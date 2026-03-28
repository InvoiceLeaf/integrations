import type { IntegrationHandler, HandlerResult, UserActionInput } from '@invoiceleaf/integration-sdk';
import type { DiscordBotConfig } from '../types.js';

export const sendTestDiscordMessage: IntegrationHandler<UserActionInput, HandlerResult, DiscordBotConfig> = async (input, context) => {
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
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
