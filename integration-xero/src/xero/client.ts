import { requestWithRetry } from '@invoiceleaf/integration-sdk';

const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const XERO_ACCOUNTING_BASE_URL = 'https://api.xero.com/api.xro/2.0';

export interface XeroConnection {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType?: string;
}

export interface XeroContact {
  ContactID: string;
  Name?: string;
  EmailAddress?: string;
}

export interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber?: string;
  Status?: string;
}

export interface XeroContactUpsertInput {
  name: string;
  emailAddress?: string;
  taxNumber?: string;
}

export interface XeroInvoiceLineItemInput {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode?: string;
  TaxAmount?: number;
}

export interface XeroInvoiceUpsertInput {
  InvoiceID?: string;
  Type: 'ACCREC' | 'ACCPAY';
  Contact: { ContactID: string };
  Date: string;
  DueDate?: string;
  InvoiceNumber?: string;
  Reference?: string;
  Status?: 'DRAFT' | 'AUTHORISED';
  CurrencyCode?: string;
  LineAmountTypes?: 'Exclusive' | 'Inclusive' | 'NoTax';
  LineItems: XeroInvoiceLineItemInput[];
}

export class XeroApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'XeroApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export async function listXeroConnections(accessToken: string): Promise<XeroConnection[]> {
  return requestWithRetry<XeroConnection[]>(
    XERO_CONNECTIONS_URL,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    {
      method: 'GET',
      includeBodyInError: false,
      createError: (msg, status, body) => new XeroApiError(msg, status, body),
    }
  );
}

export function selectXeroTenant(
  connections: XeroConnection[],
  preferredTenantId?: string
): XeroConnection {
  if (preferredTenantId) {
    const selected = connections.find((connection) => connection.tenantId === preferredTenantId);
    if (selected) {
      return selected;
    }
    throw new Error(
      `Configured tenant "${preferredTenantId}" was not found in current Xero connections.`
    );
  }

  if (connections.length === 1) {
    return connections[0];
  }

  throw new Error(
    'Multiple Xero tenants are connected. Set xeroTenantId in integration configuration.'
  );
}

interface XeroOrganisationsResponse {
  Organisations?: Array<{ Name?: string }>;
}

interface XeroContactsResponse {
  Contacts?: XeroContact[];
}

interface XeroInvoicesResponse {
  Invoices?: XeroInvoice[];
}

export class XeroAccountingClient {
  private readonly accessToken: string;
  private readonly tenantId: string;

  constructor(accessToken: string, tenantId: string) {
    this.accessToken = accessToken;
    this.tenantId = tenantId;
  }

  async getOrganisationName(): Promise<string | null> {
    const response = await this.request<XeroOrganisationsResponse>('GET', '/Organisation');
    return response.Organisations?.[0]?.Name ?? null;
  }

  async findContactByName(name: string): Promise<XeroContact | null> {
    const where = `Name=="${escapeWhereValue(name)}"`;
    const response = await this.request<XeroContactsResponse>('GET', '/Contacts', { where });
    return response.Contacts?.[0] ?? null;
  }

  async createContact(input: XeroContactUpsertInput): Promise<XeroContact> {
    const payload: Record<string, unknown> = {
      Name: input.name,
    };

    if (input.emailAddress) {
      payload.EmailAddress = input.emailAddress;
    }
    if (input.taxNumber) {
      payload.TaxNumber = input.taxNumber;
    }

    const response = await this.request<XeroContactsResponse>('POST', '/Contacts', undefined, {
      Contacts: [payload],
    });
    const contact = response.Contacts?.[0];
    if (!contact?.ContactID) {
      throw new Error('Xero did not return a contact id.');
    }
    return contact;
  }

  async findInvoiceByNumber(invoiceNumber: string): Promise<XeroInvoice | null> {
    const where = `InvoiceNumber=="${escapeWhereValue(invoiceNumber)}"`;
    const response = await this.request<XeroInvoicesResponse>('GET', '/Invoices', { where });
    return response.Invoices?.[0] ?? null;
  }

  async upsertInvoice(input: XeroInvoiceUpsertInput): Promise<XeroInvoice> {
    const response = await this.request<XeroInvoicesResponse>('POST', '/Invoices', undefined, {
      Invoices: [input],
    });
    const invoice = response.Invoices?.[0];
    if (!invoice?.InvoiceID) {
      throw new Error('Xero did not return an invoice id.');
    }
    return invoice;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, string>,
    body?: unknown
  ): Promise<T> {
    const url = new URL(path, XERO_ACCOUNTING_BASE_URL);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: 'application/json',
      'xero-tenant-id': this.tenantId,
    };

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    return requestWithRetry<T>(url.toString(), init, {
      method,
      includeBodyInError: true,
      createError: (msg, status, body) => new XeroApiError(msg, status, body),
    });
  }
}

export function escapeWhereValue(value: string): string {
  // 1. Strip null bytes and control characters that could alter query semantics
  // 2. Escape backslashes first (before they're introduced by other escapes)
  // 3. Escape double quotes (used as the outer delimiter in our where clauses)
  // 4. Escape single quotes (Xero also accepts single-quoted strings)
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[\t\r\n]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}
