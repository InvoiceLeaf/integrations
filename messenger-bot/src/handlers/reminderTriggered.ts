import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { MessengerBotConfig } from '../types.js';

type ReminderTriggeredInput = {
  reminderId?: string;
  occurrenceId?: string;
  spaceId?: string;
  userId?: string;
  title?: string;
  scheduledFor?: number;
  triggeredAt?: number;
  messageText?: string;
  metadata?: {
    scheduleType?: 'one_time' | 'rrule' | string;
    aiMode?: 'off' | 'light_rewrite' | 'tool_enabled' | string;
  };
  payload?: unknown;
};

type ReminderTriggeredOutput = {
  success: true;
  transport: 'messenger';
  template: 'reminder_triggered';
  messageText: string;
  payload: ReminderTriggeredInput | Record<string, unknown>;
} | {
  success: false;
  error: string;
};

function extractMessageText(
  input: ReminderTriggeredInput | Record<string, unknown>
): string {
  const root = input as Record<string, unknown>;

  if (typeof root.messageText === 'string' && root.messageText.trim()) {
    return root.messageText.trim();
  }

  const nestedPayload = root.payload;
  if (
    nestedPayload &&
    typeof nestedPayload === 'object' &&
    typeof (nestedPayload as { messageText?: unknown }).messageText ===
      'string' &&
    (nestedPayload as { messageText: string }).messageText.trim()
  ) {
    return (nestedPayload as { messageText: string }).messageText.trim();
  }

  if (typeof root.title === 'string' && root.title.trim()) {
    return root.title.trim();
  }

  return 'Reminder triggered.';
}

export const buildReminderTriggeredMessage: IntegrationHandler<ReminderTriggeredInput | Record<string, unknown>, ReminderTriggeredOutput, MessengerBotConfig> = async (input, context) => {
  try {
    context.logger.info('Building Messenger payload for reminder.triggered', {
      input,
    });

    return {
      success: true,
      transport: 'messenger',
      template: 'reminder_triggered',
      messageText: extractMessageText(input),
      payload: input,
    };
  } catch (error) {
    context.logger.error('Failed to build reminder.triggered payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
