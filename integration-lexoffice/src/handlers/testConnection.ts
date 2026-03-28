import type { IntegrationContext, IntegrationHandler, UserActionInput } from '@invoiceleaf/integration-sdk';
import { toErrorMessage, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { LexofficeIntegrationConfig, TestConnectionResult } from '../types.js';
import { LexofficeApiError, LexofficeClient } from '../lexoffice/client.js';

export const testConnection: IntegrationHandler<
  UserActionInput,
  TestConnectionResult,
  LexofficeIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<LexofficeIntegrationConfig>
): Promise<TestConnectionResult> => {
  try {
    const connectionInfo = await context.credentials.getConnectionInfo('lexoffice');
    if (!connectionInfo.connected && !trimToUndefined(context.config.apiKey)) {
      return {
        success: false,
        connected: false,
        error: 'lexoffice is not connected. Add an API key in external auth or config.apiKey.',
      };
    }

    const apiKey = await resolveApiKey(context);
    const client = new LexofficeClient(apiKey, context.config.apiBaseUrl);
    const contacts = await client.listContacts(1);

    return {
      success: true,
      connected: true,
      sampleContactId: trimToUndefined(contacts[0]?.id),
      message: 'lexoffice connection is valid.',
    };
  } catch (error) {
    if (error instanceof LexofficeApiError) {
      context.logger.error('lexoffice connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        connected: false,
        error: `lexoffice API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('lexoffice connection test failed', { error: toErrorMessage(error) });
    return {
      success: false,
      connected: false,
      error: `Connection test failed: ${toErrorMessage(error)}`,
    };
  }
};

async function resolveApiKey(
  context: IntegrationContext<LexofficeIntegrationConfig>
): Promise<string> {
  try {
    const key = trimToUndefined(await context.credentials.getApiKey('lexoffice'));
    if (key) {
      return key;
    }
  } catch (error) {
    context.logger.warn('Failed to resolve lexoffice API key from credentials, falling back to config.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const fallback = trimToUndefined(context.config.apiKey);
  if (fallback) {
    return fallback;
  }

  throw new Error('Missing lexoffice API key.');
}

function truncate(value: string): string {
  return value.length > 280 ? `${value.slice(0, 277)}...` : value;
}
