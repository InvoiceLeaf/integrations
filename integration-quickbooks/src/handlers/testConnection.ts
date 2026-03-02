import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { QuickBooksIntegrationConfig, TestConnectionResult } from '../types.js';
import { QuickBooksApiError, QuickBooksClient } from '../quickbooks/client.js';

export const testConnection: IntegrationHandler<
  unknown,
  TestConnectionResult,
  QuickBooksIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<QuickBooksIntegrationConfig>
): Promise<TestConnectionResult> => {
  try {
    const connectionInfo = await context.credentials.getConnectionInfo('quickbooks');
    if (!connectionInfo.connected) {
      return {
        success: false,
        connected: false,
        error: 'QuickBooks is not connected. Complete OAuth authorization first.',
      };
    }

    const accessToken = await context.credentials.getAccessToken('quickbooks');
    const realmId =
      trimToUndefined(context.config.realmId) ?? trimToUndefined(connectionInfo.accountId);

    if (!realmId) {
      return {
        success: false,
        connected: false,
        error:
          'QuickBooks realmId is missing. Set config.realmId or reconnect so accountId is available.',
      };
    }

    const client = new QuickBooksClient(accessToken, realmId, context.config.apiBaseUrl);
    const company = await client.getCompanyInfo();

    return {
      success: true,
      connected: true,
      realmId,
      companyName: company.CompanyName ?? null,
      legalName: company.LegalName ?? null,
      message: 'QuickBooks connection is valid.',
    };
  } catch (error) {
    if (error instanceof QuickBooksApiError) {
      context.logger.error('QuickBooks connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        connected: false,
        error: `QuickBooks API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('QuickBooks connection test failed', { error: toErrorMessage(error) });
    return {
      success: false,
      connected: false,
      error: `Connection test failed: ${toErrorMessage(error)}`,
    };
  }
};

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function truncate(value: string): string {
  return value.length > 280 ? `${value.slice(0, 277)}...` : value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
