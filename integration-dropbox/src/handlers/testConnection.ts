import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { DropboxIntegrationConfig, HandlerResult } from '../types.js';
import { DropboxApiError, DropboxClient } from '../dropbox/client.js';

export const testConnection: IntegrationHandler<unknown, HandlerResult, DropboxIntegrationConfig> = async (
  _input,
  context: IntegrationContext<DropboxIntegrationConfig>
): Promise<HandlerResult> => {
  try {
    const connection = await context.credentials.getConnectionInfo('dropbox');
    if (!connection.connected) {
      return {
        success: false,
        error: 'Dropbox is not connected. Complete OAuth authorization first.',
      };
    }

    const accessToken = await context.credentials.getAccessToken('dropbox');
    const client = new DropboxClient(accessToken);
    const account = await client.getCurrentAccount();

    return {
      success: true,
      message: 'Dropbox connection is valid.',
      details: {
        accountId: account.accountId,
        email: account.email,
        displayName: account.displayName,
      },
    };
  } catch (error) {
    if (error instanceof DropboxApiError) {
      context.logger.error('Dropbox connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        error: `Dropbox API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('Dropbox connection test failed', { error: toErrorMessage(error) });
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
