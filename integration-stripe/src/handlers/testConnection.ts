import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import { toErrorMessage, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { StripeIntegrationConfig, TestConnectionResult } from '../types.js';
import { StripeClient } from '../stripe/client.js';

const SYSTEM = 'stripe';

export const testConnection: IntegrationHandler<
  Record<string, unknown>,
  TestConnectionResult,
  StripeIntegrationConfig
> = async (_input, context: IntegrationContext<StripeIntegrationConfig>): Promise<TestConnectionResult> => {
  let invoicesReadable = false;
  let chargesReadable = false;
  const errors: string[] = [];

  try {
    const apiKey = await context.credentials.getApiKey(SYSTEM);
    const client = new StripeClient(apiKey, trimToUndefined(context.config.apiBaseUrl));

    try {
      await client.listInvoices({ limit: 1 });
      invoicesReadable = true;
    } catch (error) {
      errors.push(`Invoices: ${toErrorMessage(error)}`);
    }

    try {
      await client.listCharges({ limit: 1 });
      chargesReadable = true;
    } catch (error) {
      errors.push(`Charges: ${toErrorMessage(error)}`);
    }
  } catch (error) {
    return {
      success: false,
      invoicesReadable,
      chargesReadable,
      error: `Stripe API key is not available: ${toErrorMessage(error)}`,
    };
  }

  const success = invoicesReadable && chargesReadable;
  return {
    success,
    invoicesReadable,
    chargesReadable,
    message: success
      ? 'Stripe connection verified: invoices and charges are readable.'
      : undefined,
    error: success ? undefined : errors.join(' | '),
  };
};
