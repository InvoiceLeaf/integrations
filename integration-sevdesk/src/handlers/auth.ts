import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import { trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { SevdeskIntegrationConfig } from '../types.js';

const SYSTEM = 'sevdesk';

export async function resolveSevdeskApiKey(
  context: IntegrationContext<SevdeskIntegrationConfig>
): Promise<string> {
  const apiKey = await context.credentials.getApiKey(SYSTEM);
  const trimmed = trimToUndefined(apiKey);
  if (trimmed) {
    return trimmed;
  }

  throw new Error(
    'sevDesk API key is missing. Connect sevDesk in the Connections tab.'
  );
}

