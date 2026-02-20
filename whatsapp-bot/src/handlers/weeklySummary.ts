import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

export const buildWeeklySummaryMessage = async (
  input: unknown,
  context: IntegrationContext
) => {
  context.logger.info('Building WhatsApp payload for weekly summary', { input });
  return {
    success: true,
    transport: 'whatsapp',
    template: 'weekly_summary',
    payload: input,
  };
};
