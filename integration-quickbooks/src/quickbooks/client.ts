import { trimToUndefined, requestWithRetry, type RequestWithRetryOptions } from '@invoiceleaf/integration-sdk';

const DEFAULT_QUICKBOOKS_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company';

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

export interface QuickBooksInvoice {
  Id: string;
  SyncToken: string;
  DocNumber?: string;
}

export interface QuickBooksBill {
  Id: string;
  SyncToken: string;
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
      `/companyinfo/${this.realmId}`
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

  async getInvoice(id: string): Promise<QuickBooksInvoice> {
    const response = await this.request<{ Invoice?: QuickBooksInvoice }>('GET', `/invoice/${id}`);
    const invoice = response.Invoice;
    if (!invoice?.Id) {
      throw new Error(`QuickBooks did not return invoice ${id}.`);
    }
    return invoice;
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

  async updateInvoice(input: QuickBooksInvoiceInput & { Id: string; SyncToken: string }): Promise<QuickBooksInvoice> {
    const response = await this.request<{ Invoice?: QuickBooksInvoice }>('POST', '/invoice', input);
    const invoice = response.Invoice;
    if (!invoice?.Id) {
      throw new Error('QuickBooks did not return an invoice id after update.');
    }
    return invoice;
  }

  async getBill(id: string): Promise<QuickBooksBill> {
    const response = await this.request<{ Bill?: QuickBooksBill }>('GET', `/bill/${id}`);
    const bill = response.Bill;
    if (!bill?.Id) {
      throw new Error(`QuickBooks did not return bill ${id}.`);
    }
    return bill;
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

  async updateBill(input: QuickBooksBillInput & { Id: string; SyncToken: string }): Promise<QuickBooksBill> {
    const response = await this.request<{ Bill?: QuickBooksBill }>('POST', '/bill', input);
    const bill = response.Bill;
    if (!bill?.Id) {
      throw new Error('QuickBooks did not return a bill id after update.');
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

    const retryOptions: RequestWithRetryOptions = {
      method,
      createError: (message, status, responseBody) => {
        const error = new QuickBooksApiError(message, status, responseBody);
        return error as QuickBooksApiError & { status: number };
      },
    };

    return requestWithRetry<T>(url.toString(), init, retryOptions);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
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

