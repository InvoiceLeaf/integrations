import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildWeeklySummaryMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  try {
    context.logger.info('Building Messenger payload for weekly summary', { input });
    return {
      success: true,
      transport: 'messenger',
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
