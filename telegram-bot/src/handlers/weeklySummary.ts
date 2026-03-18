import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildWeeklySummaryMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  try {
    context.logger.info('Building Telegram payload for weekly summary', { input });
    return {
      success: true,
      transport: 'telegram',
      template: 'weekly_summary',
      payload: input,
    };
  } catch (error) {
    context.logger.error('Failed to build weekly summary payload', {
      error: (error as Error).message,
    });
    return { success: false, error: `Handler error: ${(error as Error).message}` };
  }
};
