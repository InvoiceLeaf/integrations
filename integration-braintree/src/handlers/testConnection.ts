import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import { toErrorMessage } from '@invoiceleaf/integration-sdk';
import type { BraintreeIntegrationConfig, TestConnectionResult } from '../types.js';
import { createBraintreeClient } from '../braintree/connection.js';

export const testConnection: IntegrationHandler<
  Record<string, unknown>,
  TestConnectionResult,
  BraintreeIntegrationConfig
> = async (_input, context: IntegrationContext<BraintreeIntegrationConfig>): Promise<TestConnectionResult> => {
  let pingOk = false;
  let searchOk = false;
  const errors: string[] = [];

  let client;
  try {
    client = await createBraintreeClient(context);
  } catch (error) {
    return {
      success: false,
      pingOk,
      searchOk,
      error: `Braintree connection is not configured: ${toErrorMessage(error)}`,
    };
  }

  try {
    pingOk = await client.ping();
    if (!pingOk) {
      errors.push('Ping: the Braintree API did not answer "pong".');
    }
  } catch (error) {
    errors.push(`Ping: ${toErrorMessage(error)}`);
  }

  if (pingOk) {
    try {
      await client.searchTransactions({ createdAtGte: new Date().toISOString(), first: 1 });
      searchOk = true;
    } catch (error) {
      errors.push(`Transaction search: ${toErrorMessage(error)}`);
    }
  }

  const success = pingOk && searchOk;
  return {
    success,
    pingOk,
    searchOk,
    message: success
      ? 'Braintree connection verified: API reachable and transactions are searchable.'
      : undefined,
    error: success ? undefined : errors.join(' | '),
  };
};
