import type { IntegrationHandler, HandlerResult, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { TelegramBotConfig } from '../types.js';

export const buildWeeklySummaryMessage: IntegrationHandler<ScheduleInput, HandlerResult, TelegramBotConfig> = async (input, context) => {
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
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
