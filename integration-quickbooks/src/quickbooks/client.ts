const DEFAULT_QUICKBOOKS_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

interface QueryResponse<T> {
  QueryResponse?: T;
}

export interface QuickBooksCompanyInfo {
  CompanyName?: string;
  LegalName?: string;
  Country?: string;
}

export interface QuickBooksCustomer {
  Id: string;
  DisplayName?: string;
}

export interface QuickBooksVendor {
  Id: string;
  DisplayName?: string;
}

export interface QuickBooksRef {
  value: string;
  name?: string;
}

export interface QuickBooksInvoiceLineInput {
  Amount: number;
  Description?: string;
  DetailType: 'SalesItemLineDetail';
  SalesItemLineDetail: {
    ItemRef: QuickBooksRef;
    Qty?: number;
    UnitPrice?: number;
  };
}

export interface QuickBooksBillLineInput {
  Amount: number;
  Description?: string;
  DetailType: 'AccountBasedExpenseLineDetail';
  AccountBasedExpenseLineDetail: {
    AccountRef: QuickBooksRef;
  };
}

export interface QuickBooksInvoiceInput {
  CustomerRef: QuickBooksRef;
  TxnDate?: string;
  DueDate?: string;
  DocNumber?: string;
  PrivateNote?: string;
  CurrencyRef?: QuickBooksRef;
  Line: QuickBooksInvoiceLineInput[];
}

export interface QuickBooksBillInput {
  VendorRef: QuickBooksRef;
  TxnDate?: string;
  DueDate?: string;
  DocNumber?: string;
  PrivateNote?: string;
  CurrencyRef?: QuickBooksRef;
  Line: QuickBooksBillLineInput[];
}

interface QuickBooksInvoice {
  Id: string;
  DocNumber?: string;
}

interface QuickBooksBill {
  Id: string;
  DocNumber?: string;
}

interface QuickBooksItem {
  Id?: string;
  Type?: string;
}

interface QuickBooksAccount {
  Id?: string;
}

export class QuickBooksApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'QuickBooksApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class QuickBooksClient {
  private readonly accessToken: string;
  private readonly realmId: string;
  private readonly baseUrl: string;

  constructor(accessToken: string, realmId: string, baseUrl?: string) {
    this.accessToken = accessToken;
    this.realmId = realmId;
    this.baseUrl = trimTrailingSlash(baseUrl ?? DEFAULT_QUICKBOOKS_BASE_URL);
  }

  async getCompanyInfo(): Promise<QuickBooksCompanyInfo> {
    const response = await this.request<{ CompanyInfo?: QuickBooksCompanyInfo }>(
      'GET',
      `/companyinfo/${encodeURIComponent(this.realmId)}`
    );
    return response.CompanyInfo ?? {};
  }

  async findCustomerByDisplayName(displayName: string): Promise<QuickBooksCustomer | null> {
    const response = await this.query<{ Customer?: QuickBooksCustomer[] }>(
      qbQuery('Customer', 'DisplayName', displayName)
    );
    return response.Customer?.[0] ?? null;
  }

  async createCustomer(input: {
    DisplayName: string;
    PrimaryEmailAddr?: { Address: string };
  }): Promise<QuickBooksCustomer> {
    const response = await this.request<{ Customer?: QuickBooksCustomer }>('POST', '/customer', input);
    const customer = response.Customer;
    if (!customer?.Id) {
      throw new Error('QuickBooks did not return a customer id.');
    }
    return customer;
  }

  async findVendorByDisplayName(displayName: string): Promise<QuickBooksVendor | null> {
    const response = await this.query<{ Vendor?: QuickBooksVendor[] }>(
      qbQuery('Vendor', 'DisplayName', displayName)
    );
    return response.Vendor?.[0] ?? null;
  }

  async createVendor(input: {
    DisplayName: string;
    PrimaryEmailAddr?: { Address: string };
  }): Promise<QuickBooksVendor> {
    const response = await this.request<{ Vendor?: QuickBooksVendor }>('POST', '/vendor', input);
    const vendor = response.Vendor;
    if (!vendor?.Id) {
      throw new Error('QuickBooks did not return a vendor id.');
    }
    return vendor;
  }

  async findInvoiceByDocNumber(docNumber: string): Promise<QuickBooksInvoice | null> {
    const response = await this.query<{ Invoice?: QuickBooksInvoice[] }>(
      qbQuery('Invoice', 'DocNumber', docNumber)
    );
    return response.Invoice?.[0] ?? null;
  }

  async createInvoice(input: QuickBooksInvoiceInput): Promise<QuickBooksInvoice> {
    const response = await this.request<{ Invoice?: QuickBooksInvoice }>('POST', '/invoice', input);
    const invoice = response.Invoice;
    if (!invoice?.Id) {
      throw new Error('QuickBooks did not return an invoice id.');
    }
    return invoice;
  }

  async findBillByDocNumber(docNumber: string): Promise<QuickBooksBill | null> {
    const response = await this.query<{ Bill?: QuickBooksBill[] }>(
      qbQuery('Bill', 'DocNumber', docNumber)
    );
    return response.Bill?.[0] ?? null;
  }

  async createBill(input: QuickBooksBillInput): Promise<QuickBooksBill> {
    const response = await this.request<{ Bill?: QuickBooksBill }>('POST', '/bill', input);
    const bill = response.Bill;
    if (!bill?.Id) {
      throw new Error('QuickBooks did not return a bill id.');
    }
    return bill;
  }

  async findDefaultSalesItemId(): Promise<string | undefined> {
    const response = await this.query<{ Item?: QuickBooksItem[] }>(
      "select * from Item where Active = true and Type = 'Service' maxresults 1"
    );
    return trimToUndefined(response.Item?.[0]?.Id);
  }

  async findDefaultExpenseAccountId(): Promise<string | undefined> {
    const response = await this.query<{ Account?: QuickBooksAccount[] }>(
      "select * from Account where Active = true and Classification = 'Expense' maxresults 1"
    );
    return trimToUndefined(response.Account?.[0]?.Id);
  }

  private async query<T extends object>(statement: string): Promise<T> {
    const response = await this.request<QueryResponse<T>>('GET', '/query', undefined, {
      query: statement,
      minorversion: '75',
    });

    return (response.QueryResponse ?? {}) as T;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>
  ): Promise<T> {
    const url = new URL(
      `${encodeURIComponent(this.realmId)}${path}`,
      `${this.baseUrl}/`
    );

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'InvoiceLeaf integration-quickbooks/1.0',
    };

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    return requestWithRetry<T>(url.toString(), init, method);
  }
}

const SAFE_RETRY_STATUSES_FOR_MUTATING = new Set([429, 502, 503]);

async function requestWithRetry<T>(url: string, init: RequestInit, method: string): Promise<T> {
  let lastError: Error | null = null;
  const isIdempotent = method === 'GET';

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const body = await response.text();

      if (!response.ok) {
        const error = new QuickBooksApiError(
          `QuickBooks API request failed with status ${response.status}`,
          response.status,
          body
        );

        const canRetryStatus = isIdempotent
          ? RETRYABLE_STATUSES.has(response.status)
          : SAFE_RETRY_STATUSES_FOR_MUTATING.has(response.status);

        if (attempt < MAX_REQUEST_ATTEMPTS && canRetryStatus) {
          await sleep(backoffMs(attempt));
          continue;
        }

        throw error;
      }

      if (body.length === 0) {
        return {} as T;
      }

      return JSON.parse(body) as T;
    } catch (error) {
      lastError = error as Error;
      if (error instanceof QuickBooksApiError) {
        const canRetryStatus = isIdempotent
          ? RETRYABLE_STATUSES.has(error.status)
          : SAFE_RETRY_STATUSES_FOR_MUTATING.has(error.status);
        if (attempt < MAX_REQUEST_ATTEMPTS && canRetryStatus) {
          await sleep(backoffMs(attempt));
          continue;
        }
      } else if (isIdempotent && attempt < MAX_REQUEST_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('QuickBooks request failed after retries.');
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const MAX_QUERY_VALUE_LENGTH = 500;

function escapeSqlValue(value: string): string {
  // QuickBooks Query Language escaping:
  // 1. Truncate to prevent excessively long queries
  // 2. Escape backslashes first (before they're introduced by other escapes)
  // 3. Escape single quotes
  // 4. Strip control characters that could alter query semantics
  const truncated = value.length > MAX_QUERY_VALUE_LENGTH
    ? value.slice(0, MAX_QUERY_VALUE_LENGTH)
    : value;
  return truncated
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/[\x00\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[\t\r\n]/g, ' ');
}

/**
 * Build a QuickBooks Query Language WHERE clause with safe value interpolation.
 * Centralizes escaping so callers don't embed template literals directly.
 */
function qbQuery(entity: string, field: string, value: string, maxResults = 1): string {
  return `select * from ${entity} where ${field} = '${escapeSqlValue(value)}' maxresults ${maxResults}`;
}

function backoffMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
