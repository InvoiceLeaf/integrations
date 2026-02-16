import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildPaymentReminderMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Telegram payload for payment reminders', { input });
  return {
    success: true,
    transport: 'telegram',
    template: 'payment_reminder',
    payload: input,
  };
};
