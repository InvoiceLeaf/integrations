import type { IntegrationHandler, UserActionInput } from '@invoiceleaf/integration-sdk';
import { DatevApiError } from '../datev/client.js';
import type { DatevIntegrationConfig, TestConnectionResult } from '../types.js';
import { buildRuntime, toErrorMessage } from './actions.js';

function truncate(value: string | undefined, maxLength = 280): string {
  if (!value) return '';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

export const testConnection: IntegrationHandler<UserActionInput, TestConnectionResult, DatevIntegrationConfig> = async (
  _input,
  context
): Promise<TestConnectionResult> => {
  try {
    const runtime = await buildRuntime(context);
    const clients = await runtime.client.listClients();

    return {
      success: true,
      connected: true,
      message: `DATEV connection is valid (${clients.length} accessible client(s)).`,
      authProvider: runtime.authProvider as TestConnectionResult['authProvider'],
      environment: runtime.environment,
      apiBaseUrl: runtime.apiBaseUrl,
      xDatevClientId: runtime.xDatevClientId,
      clientCount: clients.length,
      sampleClients: clients.slice(0, 10),
    };
  } catch (error) {
    if (error instanceof DatevApiError) {
      context.logger.error('DATEV connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        connected: false,
        error: `DATEV API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }
    context.logger.error('DATEV connection test failed', { error: toErrorMessage(error) });
    return {
      success: false,
      connected: false,
      error: `Connection test failed: ${toErrorMessage(error)}`,
    };
  }
};
