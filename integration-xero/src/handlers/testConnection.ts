import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { TestConnectionResult, XeroIntegrationConfig } from '../types.js';
import {
  listXeroConnections,
  selectXeroTenant,
  XeroAccountingClient,
  XeroApiError,
} from '../xero/client.js';

export const testConnection: IntegrationHandler<
  unknown,
  TestConnectionResult,
  XeroIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<XeroIntegrationConfig>
): Promise<TestConnectionResult> => {
  try {
    const connectionInfo = await context.credentials.getConnectionInfo('xero');
    if (!connectionInfo.connected) {
      return {
        success: false,
        connected: false,
        error: 'Xero is not connected. Complete OAuth authorization first.',
      };
    }

    const accessToken = await context.credentials.getAccessToken('xero');
    const connections = await listXeroConnections(accessToken);
    if (connections.length === 0) {
      return {
        success: false,
        connected: false,
        error:
          'Xero token is valid but no tenant connections were returned. Reconnect your Xero account.',
      };
    }

    const preferredTenantId = context.config.xeroTenantId || connectionInfo.accountId;
    const tenant = selectXeroTenant(connections, preferredTenantId);
    const client = new XeroAccountingClient(accessToken, tenant.tenantId);
    const organisationName = await client.getOrganisationName();

    return {
      success: true,
      connected: true,
      message: 'Xero connection is valid.',
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      organisationName,
      availableTenants: connections.map((item) => ({
        tenantId: item.tenantId,
        tenantName: item.tenantName,
      })),
    };
  } catch (error) {
    if (error instanceof XeroApiError) {
      context.logger.error('Xero connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        connected: false,
        error: `Xero API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('Xero connection test failed', { error: toErrorMessage(error) });
    return {
      success: false,
      connected: false,
      error: `Connection test failed: ${toErrorMessage(error)}`,
    };
  }
};

function truncate(value: string): string {
  return value.length > 280 ? `${value.slice(0, 277)}...` : value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

