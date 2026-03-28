import type { IntegrationHandler, HandlerResult, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { MessengerBotConfig } from '../types.js';

export const buildWeeklySummaryMessage: IntegrationHandler<ScheduleInput, HandlerResult, MessengerBotConfig> = async (input, context) => {
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
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
