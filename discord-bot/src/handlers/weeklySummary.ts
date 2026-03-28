import type { IntegrationHandler, HandlerResult, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { DiscordBotConfig } from '../types.js';

export const buildWeeklySummaryMessage: IntegrationHandler<ScheduleInput, HandlerResult, DiscordBotConfig> = async (input, context) => {
  try {
    context.logger.info('Building Discord payload for weekly summary', { input });
    return {
      success: true,
      transport: 'discord',
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
