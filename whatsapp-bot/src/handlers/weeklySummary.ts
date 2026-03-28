import type { IntegrationHandler, HandlerResult, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { WhatsAppBotConfig } from '../types.js';

export const buildWeeklySummaryMessage: IntegrationHandler<ScheduleInput, HandlerResult, WhatsAppBotConfig> = async (input, context) => {
  try {
    context.logger.info('Building Whatsapp payload for weekly summary', { input });
    return {
      success: true,
      transport: 'whatsapp',
      template: 'weekly_summary',
      payload: input,
    };
  } catch (error) {
    context.logger.error('Failed to build weekly summary payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
