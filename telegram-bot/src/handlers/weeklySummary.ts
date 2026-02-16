import { defineHandler } from '@invoiceleaf/integration-sdk';

export const buildWeeklySummaryMessage = defineHandler(async (input: unknown, context) => {
  context.logger.info('Building Telegram payload for weekly summary', { input });
  return {
    success: true,
    transport: 'telegram',
    template: 'weekly_summary',
    payload: input,
  };
});
