import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

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
  transport: 'discord';
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

export const buildReminderTriggeredMessage = async (
  input: ReminderTriggeredInput | Record<string, unknown>,
  context: IntegrationContext
): Promise<ReminderTriggeredOutput> => {
  try {
    context.logger.info('Building Discord payload for reminder.triggered', {
      input,
    });

    return {
      success: true,
      transport: 'discord',
      template: 'reminder_triggered',
      messageText: extractMessageText(input),
      payload: input,
    };
  } catch (error) {
    context.logger.error('Failed to build reminder.triggered payload', {
      error: (error as Error).message,
    });
    return { success: false, error: `Handler error: ${(error as Error).message}` };
  }
};
