import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { GoogleDriveIntegrationConfig, HandlerResult } from '../types.js';
import { GoogleDriveApiError, GoogleDriveClient } from '../googleDrive/client.js';

export const testConnection: IntegrationHandler<
  unknown,
  HandlerResult,
  GoogleDriveIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<GoogleDriveIntegrationConfig>
): Promise<HandlerResult> => {
  try {
    const connection = await context.credentials.getConnectionInfo('google-drive');
    if (!connection.connected) {
      return {
        success: false,
        error: 'Google Drive is not connected. Complete OAuth authorization first.',
      };
    }

    const accessToken = await context.credentials.getAccessToken('google-drive');
    const client = new GoogleDriveClient(accessToken);
    const about = await client.getAbout();

    return {
      success: true,
      message: 'Google Drive connection is valid.',
      details: {
        displayName: about.displayName,
        emailAddress: about.emailAddress,
      },
    };
  } catch (error) {
    if (error instanceof GoogleDriveApiError) {
      context.logger.error('Google Drive connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        error: `Google Drive API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('Google Drive connection test failed', { error: toErrorMessage(error) });
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
