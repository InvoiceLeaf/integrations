import { requestWithRetry, trimToUndefined } from '@invoiceleaf/integration-sdk';
import { base64EncodeUtf8 } from './base64.js';

const LIVE_BASE_URL = 'https://api-m.paypal.com';
const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

/** Installation state key the OAuth token is cached under. */
export const OAUTH_TOKEN_STATE_KEY = 'paypal:oauthToken';

/** Refresh the cached token when it expires within this many milliseconds. */
const TOKEN_EXPIRY_MARGIN_MS = 120_000;

export interface PaypalOauthTokenState {
  accessToken: string;
  /** Unix epoch milliseconds when the token expires. */
  expiresAt: number;
}

interface PaypalOauthTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Minimal view of the SDK state client used for token caching. The cache is
 * best effort: read or write failures fall back to fetching a fresh token.
 */
export interface TokenCache {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, opts?: { ttlSeconds?: number }): Promise<void>;
}

export interface PaypalAmount {
  value?: string | null;
  currency_code?: string | null;
}

export interface PaypalAmountWithBreakdown extends PaypalAmount {
  breakdown?: {
    item_total?: PaypalAmount | null;
    tax_total?: PaypalAmount | null;
  } | null;
}

export interface PaypalInvoiceDetailInfo {
  invoice_number?: string | null;
  invoice_date?: string | null;
  currency_code?: string | null;
  note?: string | null;
  payment_term?: {
    term_type?: string | null;
    due_date?: string | null;
  } | null;
}

export interface PaypalRecipientName {
  given_name?: string | null;
  surname?: string | null;
  full_name?: string | null;
}

export interface PaypalRecipient {
  billing_info?: {
    business_name?: string | null;
    name?: PaypalRecipientName | null;
    email_address?: string | null;
  } | null;
}

export interface PaypalInvoiceItem {
  name?: string | null;
  description?: string | null;
  /** Decimal string, e.g. "2" or "1.5". */
  quantity?: string | null;
  unit_amount?: PaypalAmount | null;
  tax?: {
    name?: string | null;
    /** Tax rate percentage as a decimal string, e.g. "19". */
    percent?: string | null;
  } | null;
}

export interface PaypalInvoicePaymentTransaction {
  type?: string | null;
  payment_id?: string | null;
  payment_date?: string | null;
  method?: string | null;
  note?: string | null;
  amount?: PaypalAmount | null;
}

export interface PaypalInvoice {
  id: string;
  status?: string | null;
  detail?: PaypalInvoiceDetailInfo | null;
  amount?: PaypalAmountWithBreakdown | null;
  due_amount?: PaypalAmount | null;
  primary_recipients?: PaypalRecipient[] | null;
  items?: PaypalInvoiceItem[] | null;
  payments?: {
    paid_amount?: PaypalAmount | null;
    transactions?: PaypalInvoicePaymentTransaction[] | null;
  } | null;
}

export interface PaypalInvoiceListResponse {
  items?: PaypalInvoice[];
  total_items?: number;
  total_pages?: number;
}

/** Draft invoice payload for POST /v2/invoicing/invoices. */
export interface PaypalInvoiceCreatePayload {
  detail: {
    invoice_number?: string;
    invoice_date?: string;
    currency_code: string;
    note?: string;
    payment_term?: {
      term_type: string;
      due_date: string;
    };
  };
  primary_recipients?: Array<{
    billing_info: {
      business_name?: string;
      email_address?: string;
    };
  }>;
  items: Array<{
    name: string;
    quantity: string;
    unit_amount: {
      currency_code: string;
      value: string;
    };
  }>;
}

export interface PaypalTransactionInfo {
  transaction_id?: string | null;
  transaction_status?: string | null;
  transaction_amount?: PaypalAmount | null;
  transaction_initiation_date?: string | null;
  transaction_subject?: string | null;
}

export interface PaypalPayerInfo {
  email_address?: string | null;
  payer_name?: {
    given_name?: string | null;
    surname?: string | null;
    alternate_full_name?: string | null;
  } | null;
}

export interface PaypalTransaction {
  transaction_info?: PaypalTransactionInfo | null;
  payer_info?: PaypalPayerInfo | null;
}

export interface PaypalTransactionSearchResponse {
  transaction_details?: PaypalTransaction[];
  total_pages?: number;
  page?: number;
}

export class PaypalApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'PaypalApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/** Resolve the API base URL for the configured environment (default: live). */
export function resolveBaseUrl(environment: string | undefined): string {
  return (environment ?? '').trim().toLowerCase() === 'sandbox' ? SANDBOX_BASE_URL : LIVE_BASE_URL;
}

/**
 * Format an epoch-milliseconds timestamp the way the PayPal reporting API
 * expects (RFC 3339 without fractional seconds).
 */
export function toPaypalTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Extract the invoice id from a `.../v2/invoicing/invoices/{id}` href. */
export function parseInvoiceIdFromHref(href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }
  const match = /\/invoices\/([^/?#]+)/.exec(href);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

export class PaypalClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly tokenCache: TokenCache | undefined;

  constructor(options: {
    clientId: string;
    clientSecret: string;
    environment?: string;
    tokenCache?: TokenCache;
  }) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.baseUrl = resolveBaseUrl(options.environment);
    this.tokenCache = options.tokenCache;
  }

  /**
   * Return a valid OAuth access token, reusing the cached one until it is
   * within the expiry margin. `forceRefresh` skips the cache (used after a
   * 401 and for connection tests).
   */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = await this.readCachedToken();
      if (cached) {
        return cached.accessToken;
      }
    }
    return this.fetchAccessToken();
  }

  private async readCachedToken(): Promise<PaypalOauthTokenState | null> {
    if (!this.tokenCache) {
      return null;
    }
    try {
      const cached = await this.tokenCache.get<PaypalOauthTokenState>(OAUTH_TOKEN_STATE_KEY);
      if (
        cached &&
        typeof cached.accessToken === 'string' &&
        cached.accessToken.length > 0 &&
        Number.isFinite(cached.expiresAt) &&
        cached.expiresAt - Date.now() > TOKEN_EXPIRY_MARGIN_MS
      ) {
        return cached;
      }
    } catch {
      // Token caching is best effort; fall through to a fresh fetch.
    }
    return null;
  }

  private async fetchAccessToken(): Promise<string> {
    const response = await requestWithRetry<PaypalOauthTokenResponse>(
      `${this.baseUrl}/v1/oauth2/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${base64EncodeUtf8(`${this.clientId}:${this.clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      },
      {
        method: 'POST',
        // The client_credentials grant is safe to retry.
        idempotent: true,
        createError: (message, status, responseBody) => new PaypalApiError(message, status, responseBody),
      }
    );

    const accessToken = response.access_token;
    if (!accessToken) {
      throw new PaypalApiError('PayPal OAuth token response contained no access_token', 200, '');
    }

    const expiresInSeconds = Number.isFinite(response.expires_in) ? Number(response.expires_in) : 0;
    if (this.tokenCache && expiresInSeconds > 0) {
      try {
        await this.tokenCache.set<PaypalOauthTokenState>(OAUTH_TOKEN_STATE_KEY, {
          accessToken,
          expiresAt: Date.now() + expiresInSeconds * 1000,
        });
      } catch {
        // Best effort; the token is still valid for this run.
      }
    }
    return accessToken;
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.length > 0 ? `?${parts.join('&')}` : '';
  }

  /**
   * Execute an authorized request. An expired or revoked cached token yields
   * 401: refresh once and retry (requestWithRetry itself never retries 401).
   * A 401-then-retry is safe for the POSTs used here because PayPal rejects
   * unauthorized requests before creating anything.
   */
  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string | number | undefined> = {},
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}${this.buildQuery(params)}`;
    const token = await this.getAccessToken();
    try {
      return await this.authorizedRequest<T>(method, url, token, body);
    } catch (error) {
      if (error instanceof PaypalApiError && error.status === 401) {
        const freshToken = await this.getAccessToken(true);
        return this.authorizedRequest<T>(method, url, freshToken, body);
      }
      throw error;
    }
  }

  private async authorizedRequest<T>(
    method: 'GET' | 'POST',
    url: string,
    token: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    return requestWithRetry<T>(
      url,
      {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      {
        method,
        createError: (message, status, responseBody) => new PaypalApiError(message, status, responseBody),
      }
    );
  }

  /** List invoices (newest first). The list endpoint has no created-since filter. */
  async listInvoices(options: { page?: number; pageSize?: number } = {}): Promise<PaypalInvoiceListResponse> {
    return this.requestJson<PaypalInvoiceListResponse>('GET', '/v2/invoicing/invoices', {
      page: options.page ?? 1,
      page_size: options.pageSize ?? 50,
      total_required: 'true',
    });
  }

  /** Fetch full invoice details including items and registered payments. */
  async getInvoice(invoiceId: string): Promise<PaypalInvoice> {
    return this.requestJson<PaypalInvoice>('GET', `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
  }

  /**
   * Create a draft invoice. PayPal answers 201 with either the invoice
   * object or a minimal `{ href }` link; both are handled and the invoice id
   * is returned.
   */
  async createDraftInvoice(payload: PaypalInvoiceCreatePayload): Promise<string> {
    const response = await this.requestJson<{ id?: string | null; href?: string | null }>(
      'POST',
      '/v2/invoicing/invoices',
      {},
      payload
    );
    const id = trimToUndefined(response.id ?? undefined) ?? parseInvoiceIdFromHref(response.href ?? undefined);
    if (!id) {
      throw new PaypalApiError(
        'PayPal create-invoice response contained no invoice id',
        201,
        JSON.stringify(response).slice(0, 500)
      );
    }
    return id;
  }

  /** Send an invoice to its recipient (this emails the customer). */
  async sendInvoice(invoiceId: string): Promise<void> {
    await this.requestJson<unknown>(
      'POST',
      `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
      {},
      { send_to_recipient: true }
    );
  }

  /**
   * Search account transactions. Requires the Transaction Search feature on
   * the REST app; PayPal caps the start/end window at 31 days.
   */
  async searchTransactions(options: {
    startDate: string;
    endDate: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaypalTransactionSearchResponse> {
    return this.requestJson<PaypalTransactionSearchResponse>('GET', '/v1/reporting/transactions', {
      start_date: options.startDate,
      end_date: options.endDate,
      page: options.page ?? 1,
      page_size: options.pageSize ?? 100,
      fields: 'transaction_info,payer_info',
    });
  }
}
