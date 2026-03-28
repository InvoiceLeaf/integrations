import type { IntegrationHandler, HandlerResult, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { WhatsAppBotConfig } from '../types.js';

export const buildPaymentReminderMessage: IntegrationHandler<ScheduleInput, HandlerResult, WhatsAppBotConfig> = async (input, context) => {
  try {
    context.logger.info('Building Whatsapp payload for payment reminders', { input });
    return {
      success: true,
      transport: 'whatsapp',
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
