import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import { trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { GetMyInvoicesIntegrationConfig } from '../types.js';

const SYSTEM = 'getmyinvoices';

export async function resolveGetMyInvoicesApiKey(
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>
): Promise<string> {
  const apiKey = await context.credentials.getApiKey(SYSTEM);
  const trimmed = trimToUndefined(apiKey);
  if (trimmed) {
    return trimmed;
  }

  throw new Error(
    'GetMyInvoices API key is missing. Connect GetMyInvoices in the Connections tab.'
  );
}
