import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildPaymentReminderMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Discord payload for payment reminders', { input });
  return {
    success: true,
    transport: 'discord',
    template: 'payment_reminder',
    payload: input,
  };
};
