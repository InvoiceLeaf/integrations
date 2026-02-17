/**
 * Reminder Triggered Handler
 *
 * Sends a Slack notification when a reminder is triggered.
 */

import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  ReminderNotificationResult,
  ReminderTriggeredInput,
  SlackIntegrationConfig,
} from '../types.js';
import { SlackClient } from '../slack/client.js';
import { buildReminderTriggeredBlocks, statusAttachment } from '../slack/blocks.js';
import { isNotificationEnabled } from '../utils/filters.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeReminderInput(input: ReminderTriggeredInput | Record<string, unknown>): ReminderTriggeredInput {
  const root = asRecord(input) ?? {};
  const nestedPayload = asRecord(root.payload);

  return {
    reminderId: toStringValue(root.reminderId) ?? toStringValue(nestedPayload?.reminderId),
    occurrenceId: toStringValue(root.occurrenceId) ?? toStringValue(nestedPayload?.occurrenceId),
    spaceId: toStringValue(root.spaceId) ?? toStringValue(nestedPayload?.spaceId),
    userId: toStringValue(root.userId) ?? toStringValue(nestedPayload?.userId),
    title: toStringValue(root.title) ?? toStringValue(nestedPayload?.title),
    scheduledFor:
      toNumberValue(root.scheduledFor) ?? toNumberValue(nestedPayload?.scheduledFor),
    triggeredAt:
      toNumberValue(root.triggeredAt) ?? toNumberValue(nestedPayload?.triggeredAt),
    messageText:
      toStringValue(root.messageText) ??
      toStringValue(nestedPayload?.messageText) ??
      toStringValue(root.title) ??
      toStringValue(nestedPayload?.title) ??
      'Reminder triggered.',
    metadata: asRecord(root.metadata) as ReminderTriggeredInput['metadata'],
    payload: nestedPayload ?? undefined,
  };
}

/**
 * Handles reminder.triggered events.
 *
 * Sends the reminder message text to Slack.
 */
export const handleReminderTriggered: IntegrationHandler<
  ReminderTriggeredInput | Record<string, unknown>,
  ReminderNotificationResult,
  SlackIntegrationConfig
> = async (
  input: ReminderTriggeredInput | Record<string, unknown>,
  ctx: IntegrationContext<SlackIntegrationConfig>
): Promise<ReminderNotificationResult> => {
  const { config, logger } = ctx;

  if (!isNotificationEnabled('notifyOnReminderTriggered', config)) {
    logger.debug('Reminder triggered notifications disabled');
    return {
      success: true,
      skipped: true,
      reason: 'notification_type_disabled',
    };
  }

  const normalized = normalizeReminderInput(input);
  const fallbackText = normalized.messageText || normalized.title || 'Reminder triggered.';
  const blocks = buildReminderTriggeredBlocks(normalized);

  try {
    const slack = new SlackClient(config.webhookUrl);
    await slack.sendMessage({
      text: fallbackText,
      blocks,
      attachments: [statusAttachment('info')],
      channel: config.channelOverride,
      username: config.username,
      icon_emoji: config.iconEmoji,
    });

    logger.info('Reminder triggered notification sent', {
      reminderId: normalized.reminderId,
      occurrenceId: normalized.occurrenceId,
    });

    return {
      success: true,
      reminderId: normalized.reminderId,
      occurrenceId: normalized.occurrenceId,
      messageText: fallbackText,
    };
  } catch (error) {
    logger.error('Failed to send reminder triggered Slack notification', {
      reminderId: normalized.reminderId,
      occurrenceId: normalized.occurrenceId,
      error: (error as Error).message,
    });

    return {
      success: false,
      error: `Failed to send Slack notification: ${(error as Error).message}`,
      reminderId: normalized.reminderId,
      occurrenceId: normalized.occurrenceId,
    };
  }
};
