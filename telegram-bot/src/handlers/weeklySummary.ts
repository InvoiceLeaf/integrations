import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildWeeklySummaryMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building Telegram payload for weekly summary', { input });
  return {
    success: true,
    transport: 'telegram',
    template: 'weekly_summary',
    payload: input,
  };
};
