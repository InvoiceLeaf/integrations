/**
 * Test Connection Handler
 *
 * Sends a test message to verify the Slack webhook is configured correctly.
 */

import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { HandlerResult, SlackIntegrationConfig } from '../types.js';
import { SlackClient, SlackApiError, SlackWebhookValidationError } from '../slack/client.js';
import { buildTestConnectionBlocks, statusAttachment } from '../slack/blocks.js';

/**
 * Input for test connection action.
 */
interface TestConnectionInput {
  spaceId: string;
}

/**
 * Result for test connection action.
 */
interface TestConnectionResult extends HandlerResult {
  message?: string;
}

/**
 * Handles the "Send Test Message" action.
 *
 * Sends a test message to verify the Slack webhook is working correctly.
 * This is a user-triggered action, not an event handler.
 */
export const sendTestMessage: IntegrationHandler<
  TestConnectionInput,
  TestConnectionResult,
  SlackIntegrationConfig
> = async (
  input: TestConnectionInput,
  ctx: IntegrationContext<SlackIntegrationConfig>
): Promise<TestConnectionResult> => {
  const { spaceId } = input;
  const { config, logger, userId } = ctx;

  logger.info('Sending test message to Slack', { spaceId, userId });

  // Validate webhook URL is configured
  if (!config.webhookUrl) {
    logger.error('Webhook URL not configured');
    return {
      success: false,
      error: 'Slack webhook URL is not configured. Please add your webhook URL in the integration settings.',
    };
  }

  // Build test message
  const blocks = buildTestConnectionBlocks(spaceId, userId);
  const fallbackText = 'InvoiceLeaf Slack integration connected successfully!';

  // Send to Slack
  try {
    const slack = new SlackClient(config.webhookUrl);
    await slack.sendMessage({
      text: fallbackText,
      blocks,
      attachments: [statusAttachment('success')],
      channel: config.channelOverride,
      username: config.username,
      icon_emoji: config.iconEmoji,
    });

    logger.info('Test message sent successfully', { spaceId });

    return {
      success: true,
      message: 'Test message sent successfully! Check your Slack channel.',
    };
  } catch (error) {
    if (error instanceof SlackWebhookValidationError) {
      logger.error('Invalid webhook URL', { error: error.message });
      return {
        success: false,
        error: `Invalid webhook URL: ${error.message}`,
      };
    }

    if (error instanceof SlackApiError) {
      logger.error('Slack API error', {
        statusCode: error.statusCode,
        responseBody: error.responseBody,
      });

      // Provide user-friendly error messages
      let userMessage = 'Failed to send message to Slack.';
      if (error.statusCode === 404) {
        userMessage = 'Webhook URL not found. Please verify your Slack webhook URL is correct.';
      } else if (error.statusCode === 403) {
        userMessage = 'Access denied. The webhook may have been revoked. Please create a new webhook.';
      } else if (error.responseBody === 'channel_not_found') {
        userMessage = 'Channel not found. Please verify the channel exists and the webhook has access.';
      } else if (error.responseBody === 'invalid_payload') {
        userMessage = 'Invalid message format. Please contact support.';
      }

      return {
        success: false,
        error: userMessage,
      };
    }

    logger.error('Unexpected error sending test message', {
      error: (error as Error).message,
    });

    return {
      success: false,
      error: `Failed to send test message: ${(error as Error).message}`,
    };
  }
};
