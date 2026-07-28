import { requestWithRetry } from '@invoiceleaf/integration-sdk';

const DEFAULT_STRIPE_BASE_URL = 'https://api.stripe.com';

/**
 * Currencies Stripe treats as zero-decimal: amounts are already in the
 * currency's major unit rather than in "cents".
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

export interface StripeListResponse<T> {
  object: string;
  data: T[];
  has_more: boolean;
}

export interface StripeInvoiceLine {
  id: string;
  description?: string | null;
  quantity?: number | null;
  /** Line total in the smallest currency unit. */
  amount: number;
  currency?: string;
  price?: { unit_amount?: number | null } | null;
}

export interface StripeInvoice {
  id: string;
  object?: string;
  number?: string | null;
  status?: string | null;
  created: number;
  currency?: string;
  customer?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  subtotal?: number;
  tax?: number | null;
  total?: number;
  amount_due?: number;
  amount_paid?: number;
  charge?: string | null;
  due_date?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
  lines?: { data: StripeInvoiceLine[]; has_more?: boolean } | null;
  invoice_pdf?: string | null;
  hosted_invoice_url?: string | null;
  description?: string | null;
}

export interface StripeCustomer {
  id: string;
  name?: string | null;
  email?: string | null;
}

export interface StripeCharge {
  id: string;
  object?: string;
  amount: number;
  amount_refunded?: number;
  currency: string;
  created: number;
  paid?: boolean;
  status?: string | null;
  refunded?: boolean;
  invoice?: string | null;
  payment_intent?: string | null;
  description?: string | null;
  receipt_url?: string | null;
  billing_details?: { name?: string | null; email?: string | null } | null;
  metadata?: Record<string, string> | null;
}

export class StripeApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'StripeApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Convert a decimal amount in the currency's major unit to Stripe's integer
 * smallest-unit representation.
 */
export function decimalToStripeAmount(value: number | string, currency: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }
  const normalizedCurrency = (currency || '').toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return Math.round(num);
  }
  return Math.round(num * 100);
}

/**
 * Convert a Stripe integer amount to a decimal string in the currency's major
 * unit, preserving precision (no floating point math).
 */
export function stripeAmountToDecimalString(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid Stripe amount: ${amount}`);
  }
  const normalizedCurrency = (currency || '').toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return String(amount);
  }
  const negative = amount < 0;
  const cents = Math.abs(Math.trunc(amount));
  const major = Math.trunc(cents / 100);
  const minor = String(cents % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${major}.${minor}`;
}

export class StripeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl && baseUrl.trim() ? baseUrl.trim() : DEFAULT_STRIPE_BASE_URL).replace(/\/$/, '');
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.length > 0 ? `?${parts.join('&')}` : '';
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = `${this.baseUrl}${path}${this.buildQuery(params)}`;
    return requestWithRetry<T>(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
      {
        method: 'GET',
        createError: (message, status, responseBody) => new StripeApiError(message, status, responseBody),
      }
    );
  }

  /**
   * List invoices, oldest window first is not supported by Stripe (lists are
   * reverse-chronological); pagination walks from newest to older items.
   */
  async listInvoices(options: {
    createdGt?: number;
    startingAfter?: string;
    limit?: number;
  }): Promise<StripeListResponse<StripeInvoice>> {
    return this.get<StripeListResponse<StripeInvoice>>('/v1/invoices', {
      'created[gt]': options.createdGt,
      starting_after: options.startingAfter,
      limit: options.limit ?? 50,
    });
  }

  /**
   * List all line items of an invoice (the embedded `lines` list on the
   * invoice object is capped, so page through the dedicated endpoint).
   */
  async listInvoiceLines(invoiceId: string): Promise<StripeInvoiceLine[]> {
    const lines: StripeInvoiceLine[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      const page = await this.get<StripeListResponse<StripeInvoiceLine>>(
        `/v1/invoices/${encodeURIComponent(invoiceId)}/lines`,
        { starting_after: startingAfter, limit: 100 }
      );
      lines.push(...page.data);
      if (!page.has_more || page.data.length === 0) {
        return lines;
      }
      startingAfter = page.data[page.data.length - 1]!.id;
    }
  }

  async listCharges(options: {
    createdGt?: number;
    startingAfter?: string;
    limit?: number;
  }): Promise<StripeListResponse<StripeCharge>> {
    return this.get<StripeListResponse<StripeCharge>>('/v1/charges', {
      'created[gt]': options.createdGt,
      starting_after: options.startingAfter,
      limit: options.limit ?? 100,
    });
  }

  /**
   * POST with Stripe's form-encoded body convention.
   */
  private async postForm<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return requestWithRetry<T>(
      `${this.baseUrl}${path}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: parts.join('&'),
      },
      {
        method: 'POST',
        createError: (message, status, responseBody) => new StripeApiError(message, status, responseBody),
      }
    );
  }

  async findCustomerByEmail(email: string): Promise<StripeCustomer | undefined> {
    const result = await this.get<StripeListResponse<StripeCustomer>>('/v1/customers', {
      email,
      limit: 1,
    });
    return result.data[0];
  }

  async createCustomer(input: { name: string; email?: string }): Promise<StripeCustomer> {
    return this.postForm<StripeCustomer>('/v1/customers', {
      name: input.name,
      email: input.email,
    });
  }

  async createInvoice(input: {
    customerId: string;
    currency: string;
    daysUntilDue: number;
    description?: string;
    invoiceleafDocumentId: string;
  }): Promise<StripeInvoice> {
    return this.postForm<StripeInvoice>('/v1/invoices', {
      customer: input.customerId,
      currency: input.currency,
      collection_method: 'send_invoice',
      days_until_due: input.daysUntilDue,
      auto_advance: 'false',
      description: input.description,
      'metadata[invoiceleaf_document_id]': input.invoiceleafDocumentId,
    });
  }

  async createInvoiceItem(input: {
    customerId: string;
    invoiceId: string;
    amountCents: number;
    currency: string;
    description?: string;
  }): Promise<{ id: string }> {
    return this.postForm<{ id: string }>('/v1/invoiceitems', {
      customer: input.customerId,
      invoice: input.invoiceId,
      amount: input.amountCents,
      currency: input.currency,
      description: input.description,
    });
  }

  async finalizeInvoice(invoiceId: string): Promise<StripeInvoice> {
    return this.postForm<StripeInvoice>(`/v1/invoices/${encodeURIComponent(invoiceId)}/finalize`, {
      auto_advance: 'false',
    });
  }

  /**
   * Download the invoice PDF from the (pre-signed) `invoice_pdf` URL.
   * Uses the runtime fetch bridge's base64 response mode so the binary
   * content survives the isolate boundary intact.
   */
  async downloadInvoicePdf(pdfUrl: string): Promise<string> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(pdfUrl, {
          method: 'GET',
          responseType: 'base64',
        } as unknown as RequestInit);
        if (!response.ok) {
          const body = await response.text();
          const error = new StripeApiError(
            `Stripe invoice PDF download failed with status ${response.status}`,
            response.status,
            body.slice(0, 500)
          );
          if (response.status >= 400 && response.status < 500) {
            throw error;
          }
          lastError = error;
          continue;
        }
        const base64 = await response.text();
        if (!base64) {
          throw new StripeApiError('Stripe invoice PDF download returned an empty body', response.status, '');
        }
        return base64;
      } catch (e) {
        if (e instanceof StripeApiError && e.status >= 400 && e.status < 500) {
          throw e;
        }
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastError ?? new Error('Stripe invoice PDF download failed');
  }
}
