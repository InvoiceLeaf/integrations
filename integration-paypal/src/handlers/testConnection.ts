import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import { toErrorMessage } from '@invoiceleaf/integration-sdk';
import type { PaypalIntegrationConfig, TestConnectionResult } from '../types.js';
import { toPaypalTimestamp } from '../paypal/client.js';
import { createPaypalClient } from './auth.js';

const TEST_SEARCH_WINDOW_MS = 24 * 3600 * 1000;

export const testConnection: IntegrationHandler<
  Record<string, unknown>,
  TestConnectionResult,
  PaypalIntegrationConfig
> = async (_input, context: IntegrationContext<PaypalIntegrationConfig>): Promise<TestConnectionResult> => {
  let tokenOk = false;
  let invoicesReadable = false;
  let transactionSearchAvailable = false;
  const errors: string[] = [];

  try {
    const client = await createPaypalClient(context);

    try {
      // Force a fresh token so stale cache entries cannot mask bad credentials.
      await client.getAccessToken(true);
      tokenOk = true;
    } catch (error) {
      errors.push(`OAuth token: ${toErrorMessage(error)}`);
    }

    if (tokenOk) {
      try {
        await client.listInvoices({ page: 1, pageSize: 1 });
        invoicesReadable = true;
      } catch (error) {
        errors.push(`Invoices: ${toErrorMessage(error)}`);
      }

      try {
        const endMs = Date.now();
        await client.searchTransactions({
          startDate: toPaypalTimestamp(endMs - TEST_SEARCH_WINDOW_MS),
          endDate: toPaypalTimestamp(endMs),
          page: 1,
          pageSize: 1,
        });
        transactionSearchAvailable = true;
      } catch {
        // Not part of success: Transaction Search is an optional feature that
        // must be enabled on the REST app.
      }
    }
  } catch (error) {
    return {
      success: false,
      tokenOk,
      invoicesReadable,
      transactionSearchAvailable,
      error: `PayPal credentials are not available: ${toErrorMessage(error)}`,
    };
  }

  const success = tokenOk && invoicesReadable;
  const messageParts: string[] = [];
  if (success) {
    messageParts.push('PayPal connection verified: OAuth token obtained and invoices are readable.');
    if (!transactionSearchAvailable) {
      messageParts.push(
        'Transaction Search is unavailable; enable the Transaction Search feature on your PayPal REST app to record unmatched payments.'
      );
    }
  }
  return {
    success,
    tokenOk,
    invoicesReadable,
    transactionSearchAvailable,
    message: messageParts.length > 0 ? messageParts.join(' ') : undefined,
    error: success ? undefined : errors.join(' | '),
  };
};
