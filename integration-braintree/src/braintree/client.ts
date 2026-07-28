import { requestWithRetry } from '@invoiceleaf/integration-sdk';
import { basicAuthHeader } from './base64.js';

const PRODUCTION_GRAPHQL_URL = 'https://payments.braintree-api.com/graphql';
const SANDBOX_GRAPHQL_URL = 'https://payments.sandbox.braintree-api.com/graphql';
const BRAINTREE_VERSION = '2019-01-01';
const MAX_ATTEMPTS = 3;

export interface BraintreeTransactionAmount {
  /** Decimal string in the currency's major unit, e.g. "123.45". */
  value: string;
  currencyCode: string;
}

export interface BraintreeTransactionCustomer {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export interface BraintreeTransaction {
  /** GraphQL global id (stable, used for mappings and externalRef). */
  id: string;
  /** Control-panel transaction id. */
  legacyId?: string | null;
  orderId?: string | null;
  status?: string | null;
  amount?: BraintreeTransactionAmount | null;
  createdAt: string;
  customer?: BraintreeTransactionCustomer | null;
  paymentMethodSnapshot?: { __typename?: string } | null;
}

export interface BraintreeTransactionPage {
  transactions: BraintreeTransaction[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export class BraintreeApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'BraintreeApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: Array<{ message?: string }>;
}

interface TransactionSearchData {
  search?: {
    transactions?: {
      edges?: Array<{ node?: BraintreeTransaction | null } | null> | null;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
    } | null;
  } | null;
}

const TRANSACTION_SEARCH_QUERY = `query TransactionSearch($input: TransactionSearchInput, $first: Int, $after: String) {
  search {
    transactions(input: $input, first: $first, after: $after) {
      edges {
        node {
          id
          legacyId
          orderId
          status
          amount { value currencyCode }
          createdAt
          customer { firstName lastName email }
          paymentMethodSnapshot { __typename }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export class BraintreeClient {
  private readonly url: string;
  private readonly authHeader: string;

  constructor(publicKey: string, privateKey: string, environment?: string) {
    this.url = environment === 'sandbox' ? SANDBOX_GRAPHQL_URL : PRODUCTION_GRAPHQL_URL;
    this.authHeader = basicAuthHeader(publicKey, privateKey);
  }

  /**
   * Execute a GraphQL operation. Braintree's GraphQL API uses POST for
   * reads, so requests are marked semantically idempotent to keep the
   * SDK's retry behavior for transient failures.
   */
  private async execute<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await requestWithRetry<GraphQLResponse<T>>(
      this.url,
      {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Braintree-Version': BRAINTREE_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
      },
      {
        method: 'POST',
        idempotent: true,
        maxAttempts: MAX_ATTEMPTS,
        createError: (message, status, responseBody) => new BraintreeApiError(message, status, responseBody),
      }
    );

    if (response.errors && response.errors.length > 0) {
      const messages = response.errors
        .map((error) => error?.message ?? 'Unknown GraphQL error')
        .join('; ');
      throw new BraintreeApiError(
        `Braintree GraphQL error: ${messages}`,
        200,
        JSON.stringify(response.errors).slice(0, 500)
      );
    }
    if (response.data === undefined || response.data === null) {
      throw new BraintreeApiError('Braintree GraphQL response contained no data', 200, '');
    }
    return response.data;
  }

  /** `query { ping }` — returns true when the API answers "pong". */
  async ping(): Promise<boolean> {
    const data = await this.execute<{ ping?: string }>('query { ping }');
    return data.ping === 'pong';
  }

  /**
   * Search transactions created at or after the given ISO timestamp,
   * newest-window pagination via Relay cursors.
   */
  async searchTransactions(options: {
    createdAtGte: string;
    first?: number;
    after?: string;
  }): Promise<BraintreeTransactionPage> {
    const data = await this.execute<TransactionSearchData>(TRANSACTION_SEARCH_QUERY, {
      input: { createdAt: { greaterThanOrEqualTo: options.createdAtGte } },
      first: options.first ?? 50,
      after: options.after ?? null,
    });

    const connection = data.search?.transactions;
    if (!connection) {
      throw new BraintreeApiError('Braintree transaction search returned no result set', 200, '');
    }
    const transactions: BraintreeTransaction[] = [];
    for (const edge of connection.edges ?? []) {
      if (edge?.node) {
        transactions.push(edge.node);
      }
    }
    return {
      transactions,
      hasNextPage: connection.pageInfo?.hasNextPage ?? false,
      endCursor: connection.pageInfo?.endCursor ?? null,
    };
  }
}
