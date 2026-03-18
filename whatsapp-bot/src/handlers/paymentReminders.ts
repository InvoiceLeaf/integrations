import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildPaymentReminderMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
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
      error: (error as Error).message,
    });
    return { success: false, error: `Handler error: ${(error as Error).message}` };
  }
};
