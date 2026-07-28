import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import { trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { PaypalIntegrationConfig } from '../types.js';
import { PaypalClient } from '../paypal/client.js';

export const SYSTEM = 'paypal';

/**
 * Build a PayPal client from the installation: the Client Secret is stored as
 * the "paypal" api_key credential, while the Client ID and environment are
 * non-secret configuration values.
 */
export async function createPaypalClient(
  context: IntegrationContext<PaypalIntegrationConfig>
): Promise<PaypalClient> {
  const clientId = trimToUndefined(context.config.clientId);
  if (!clientId) {
    throw new Error('PayPal Client ID is not configured. Set it in the integration settings.');
  }
  const clientSecret = await context.credentials.getApiKey(SYSTEM);
  return new PaypalClient({
    clientId,
    clientSecret,
    environment: context.config.environment,
    tokenCache: context.state,
  });
}
