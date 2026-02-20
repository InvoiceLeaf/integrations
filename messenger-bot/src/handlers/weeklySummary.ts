import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildWeeklySummaryMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Messenger payload for weekly summary', { input });
  return {
    success: true,
    transport: 'messenger',
    template: 'weekly_summary',
    payload: input,
  };
};
