import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import { trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { BraintreeIntegrationConfig } from '../types.js';
import { BraintreeClient } from './client.js';

export const SYSTEM = 'braintree';

/**
 * Validate the non-secret connection settings and combine them with the
 * stored Private Key credential into a ready-to-use API client.
 */
export async function createBraintreeClient(
  context: IntegrationContext<BraintreeIntegrationConfig>
): Promise<BraintreeClient> {
  const merchantId = trimToUndefined(context.config.merchantId);
  if (!merchantId) {
    throw new Error('Braintree merchant ID is not configured. Enter it in the integration settings.');
  }
  const publicKey = trimToUndefined(context.config.publicKey);
  if (!publicKey) {
    throw new Error('Braintree public key is not configured. Enter it in the integration settings.');
  }
  const privateKey = await context.credentials.getApiKey(SYSTEM);
  return new BraintreeClient(publicKey, privateKey, context.config.environment);
}
