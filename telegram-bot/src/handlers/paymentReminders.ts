import { defineHandler } from '@invoiceleaf/integration-sdk';

export const buildPaymentReminderMessage = defineHandler(async (input: unknown, context) => {
  context.logger.info('Building Telegram payload for payment reminders', { input });
  return {
    success: true,
    transport: 'telegram',
    template: 'payment_reminder',
    payload: input,
  };
});
