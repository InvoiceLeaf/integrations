import type { IntegrationHandler, HandlerResult, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { MessengerBotConfig } from '../types.js';

export const buildPaymentReminderMessage: IntegrationHandler<ScheduleInput, HandlerResult, MessengerBotConfig> = async (input, context) => {
  try {
    context.logger.info('Building Messenger payload for payment reminders', { input });
    return {
      success: true,
      transport: 'messenger',
      template: 'payment_reminder',
      payload: input,
    };
  } catch (error) {
    context.logger.error('Failed to build payment reminder payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
