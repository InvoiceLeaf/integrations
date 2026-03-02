import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { GmailConfig, HandlerResult } from '../types.js';
import { GmailApiError, GmailClient } from '../gmail/client.js';

export const testConnection: IntegrationHandler<unknown, HandlerResult, GmailConfig> = async (
  _input,
  context: IntegrationContext<GmailConfig>
): Promise<HandlerResult> => {
  try {
    const connectionInfo = await context.credentials.getConnectionInfo('gmail');
    if (!connectionInfo.connected) {
      return {
        success: false,
        error: 'Gmail is not connected. Complete OAuth authorization first.',
      };
    }

    const accessToken = await context.credentials.getAccessToken('gmail');
    const client = new GmailClient(accessToken);
    const profile = await client.getProfile();

    return {
      success: true,
      message: 'Gmail connection is valid.',
      details: {
        emailAddress: profile.emailAddress,
        messagesTotal: profile.messagesTotal,
      },
    };
  } catch (error) {
    if (error instanceof GmailApiError) {
      context.logger.error('Gmail connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        error: `Gmail API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('Gmail connection test failed', {
      error: toErrorMessage(error),
    });

    return {
      success: false,
      error: `Connection test failed: ${toErrorMessage(error)}`,
    };
  }
};

function truncate(value: string): string {
  return value.length > 280 ? `${value.slice(0, 277)}...` : value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
