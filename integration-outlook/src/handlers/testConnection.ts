import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { HandlerResult, OutlookConfig } from '../types.js';
import { OutlookApiError, OutlookClient } from '../outlook/client.js';

export const testConnection: IntegrationHandler<unknown, HandlerResult, OutlookConfig> = async (
  _input,
  context: IntegrationContext<OutlookConfig>
): Promise<HandlerResult> => {
  try {
    const connectionInfo = await context.credentials.getConnectionInfo('outlook');
    if (!connectionInfo.connected) {
      return {
        success: false,
        error: 'Outlook is not connected. Complete OAuth authorization first.',
      };
    }

    const accessToken = await context.credentials.getAccessToken('outlook');
    const client = new OutlookClient(accessToken);
    const profile = await client.getProfile();

    return {
      success: true,
      message: 'Outlook connection is valid.',
      details: {
        accountId: profile.id,
        email: profile.mail,
        displayName: profile.displayName,
      },
    };
  } catch (error) {
    if (error instanceof OutlookApiError) {
      context.logger.error('Outlook connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        error: `Outlook API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('Outlook connection test failed', {
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
