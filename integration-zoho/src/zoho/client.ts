import { trimToUndefined, requestWithRetry, type RequestWithRetryOptions } from '@invoiceleaf/integration-sdk';

const DEFAULT_ZOHO_BASE_URL = 'https://www.zohoapis.com/books/v3';

export interface ZohoOrganization {
  organization_id: string;
  name: string;
  currency_code?: string;
}

export interface ZohoContact {
  contact_id: string;
  contact_name?: string;
  email?: string;
}

export interface ZohoInvoice {
  invoice_id: string;
  invoice_number?: string;
  status?: string;
}

export class ZohoBooksApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'ZohoBooksApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

interface ZohoApiResponse<T> {
  code: number;
  message?: string;
  organizations?: ZohoOrganization[];
  contacts?: ZohoContact[];
  invoices?: ZohoInvoice[];
  items?: Array<{ item_id?: string }>;
  organization?: ZohoOrganization;
  contact?: ZohoContact;
  invoice?: ZohoInvoice;
  data?: T;
}

export class ZohoBooksClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(accessToken: string, baseUrl?: string) {
    this.accessToken = accessToken;
    this.baseUrl = trimTrailingSlash(baseUrl ?? DEFAULT_ZOHO_BASE_URL);
  }

  async listOrganizations(): Promise<ZohoOrganization[]> {
    const response = await this.request<ZohoApiResponse<unknown>>('GET', '/organizations');
    return response.organizations ?? [];
  }

  async findContactByName(
    organizationId: string,
    contactName: string
  ): Promise<ZohoContact | null> {
    const response = await this.request<ZohoApiResponse<unknown>>('GET', '/contacts', undefined, {
      organization_id: organizationId,
      contact_name: contactName,
      page: '1',
      per_page: '1',
    });
    return response.contacts?.[0] ?? null;
  }

  async createContact(
    organizationId: string,
    input: { contact_name: string; contact_type: 'customer' | 'vendor'; email?: string }
  ): Promise<ZohoContact> {
    const response = await this.request<ZohoApiResponse<unknown>>('POST', '/contacts', input, {
      organization_id: organizationId,
    });
    if (!response.contact?.contact_id) {
      throw new Error('Zoho Books did not return a contact id.');
    }
    return response.contact;
  }

  async findInvoiceByNumber(
    organizationId: string,
    invoiceNumber: string
  ): Promise<ZohoInvoice | null> {
    const response = await this.request<ZohoApiResponse<unknown>>('GET', '/invoices', undefined, {
      organization_id: organizationId,
      invoice_number: invoiceNumber,
      page: '1',
      per_page: '1',
    });
    return response.invoices?.[0] ?? null;
  }

  async createInvoice(
    organizationId: string,
    input: {
      customer_id: string;
      date?: string;
      due_date?: string;
      invoice_number?: string;
      reference_number?: string;
      line_items: Array<{ item_id: string; name?: string; description?: string; quantity: number; rate: number }>;
    }
  ): Promise<ZohoInvoice> {
    const response = await this.request<ZohoApiResponse<unknown>>('POST', '/invoices', input, {
      organization_id: organizationId,
    });

    if (!response.invoice?.invoice_id) {
      throw new Error('Zoho Books did not return an invoice id.');
    }

    return response.invoice;
  }

  async findDefaultItemId(organizationId: string): Promise<string | undefined> {
    const response = await this.request<ZohoApiResponse<unknown>>('GET', '/items', undefined, {
      organization_id: organizationId,
      page: '1',
      per_page: '1',
    });

    return trimToUndefined(response.items?.[0]?.item_id);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    query?: Record<string, string>
  ): Promise<T> {
    const url = new URL(path, `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'InvoiceLeaf integration-zoho/1.0',
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
      createError: (message, status, responseBody) =>
        new ZohoBooksApiError(message, status, responseBody),
    });
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
