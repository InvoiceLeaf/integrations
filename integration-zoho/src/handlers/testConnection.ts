import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { TestConnectionResult, ZohoIntegrationConfig } from '../types.js';
import { ZohoBooksApiError, ZohoBooksClient } from '../zoho/client.js';

export const testConnection: IntegrationHandler<
  unknown,
  TestConnectionResult,
  ZohoIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<ZohoIntegrationConfig>
): Promise<TestConnectionResult> => {
  try {
    const connectionInfo = await context.credentials.getConnectionInfo('zoho-books');
    if (!connectionInfo.connected) {
      return {
        success: false,
        connected: false,
        error: 'Zoho Books is not connected. Complete OAuth authorization first.',
      };
    }

    const accessToken = await context.credentials.getAccessToken('zoho-books');
    const client = new ZohoBooksClient(accessToken, context.config.apiBaseUrl);
    const organizations = await client.listOrganizations();
    if (organizations.length === 0) {
      return {
        success: false,
        connected: false,
        error: 'No Zoho organizations returned for this account.',
      };
    }

    const selected = selectOrganization(organizations, context.config.organizationId);

    return {
      success: true,
      connected: true,
      organizationId: selected.organization_id,
      organizationName: selected.name ?? null,
      availableOrganizations: organizations.map((item) => ({
        organizationId: item.organization_id,
        organizationName: item.name,
      })),
      message: 'Zoho Books connection is valid.',
    };
  } catch (error) {
    if (error instanceof ZohoBooksApiError) {
      context.logger.error('Zoho connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        connected: false,
        error: `Zoho API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('Zoho connection test failed', { error: toErrorMessage(error) });
    return {
      success: false,
      connected: false,
      error: `Connection test failed: ${toErrorMessage(error)}`,
    };
  }
};

function selectOrganization(
  organizations: Array<{ organization_id: string; name: string }>,
  configuredId?: string
): { organization_id: string; name: string } {
  const preferred = trimToUndefined(configuredId);
  if (preferred) {
    const match = organizations.find((item) => item.organization_id === preferred);
    if (match) {
      return match;
    }
    throw new Error(`Configured Zoho organizationId "${preferred}" is not accessible.`);
  }
  return organizations[0];
}

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
