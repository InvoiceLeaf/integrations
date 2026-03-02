import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { SevdeskIntegrationConfig, TestConnectionResult } from '../types.js';
import { SevdeskApiError, SevdeskClient } from '../sevdesk/client.js';
import { resolveSevdeskApiKey } from './auth.js';

export const testConnection: IntegrationHandler<
  unknown,
  TestConnectionResult,
  SevdeskIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<SevdeskIntegrationConfig>
): Promise<TestConnectionResult> => {
  try {
    const apiKey = await resolveSevdeskApiKey(context);
    const client = new SevdeskClient(apiKey, context.config.baseUrl);

    const [bookkeepingSystemVersion, contacts, invoices] = await Promise.all([
      client.getBookkeepingSystemVersion(),
      client.listContacts({ limit: 1, offset: 0 }),
      client.listInvoices({ limit: 1, offset: 0 }),
    ]);

    return {
      success: true,
      connected: true,
      message: 'sevDesk API key is valid.',
      bookkeepingSystemVersion,
      sampleContactId: contacts[0]?.id,
      discoveredContactPersonId: invoices[0]?.contactPerson?.id,
      discoveredAddressCountryId: invoices[0]?.addressCountry?.id,
    };
  } catch (error) {
    if (error instanceof SevdeskApiError) {
      context.logger.error('sevDesk connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        connected: false,
        error: `sevDesk API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('sevDesk connection test failed', { error: toErrorMessage(error) });
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
