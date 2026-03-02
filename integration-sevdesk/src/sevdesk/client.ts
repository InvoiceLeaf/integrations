const DEFAULT_SEVDESK_BASE_URL = 'https://my.sevdesk.de/api/v1';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

export interface SevdeskReference {
  id: string;
  objectName: string;
}

export interface SevdeskContact {
  id: string;
  objectName?: string;
  name?: string;
  customerNumber?: string;
  category?: SevdeskReference;
}

export interface SevdeskInvoice {
  id: string;
  objectName?: string;
  invoiceNumber?: string;
  status?: string | number;
  create?: string;
  update?: string;
  contactPerson?: SevdeskReference;
  addressCountry?: SevdeskReference;
  currency?: string;
}

export interface SevdeskInvoicePdf {
  filename?: string;
  mimeType?: string;
  base64encoded?: boolean;
  content?: string;
}

export interface SevdeskContactCreateInput {
  name: string;
  categoryId: number;
  customerNumber?: string;
  taxNumber?: string;
  vatNumber?: string;
}

export interface SevdeskInvoicePositionInput {
  name: string;
  quantity: number;
  price: number;
  taxRate: number;
  unityId: number;
  text?: string;
  positionNumber?: number;
}

export interface SevdeskInvoiceUpsertInput {
  id?: string;
  invoiceDate: string;
  contactId: string;
  contactPersonId?: number;
  addressCountryId?: number;
  status: 100;
  invoiceType: 'RE' | 'WKR' | 'SR' | 'MA' | 'TR' | 'AR' | 'ER';
  currency: string;
  taxType: 'default' | 'eu' | 'noteu' | 'custom';
  taxRuleId: '1' | '2' | '3' | '4' | '5' | '11' | '17' | '18' | '19' | '20' | '21';
  taxText: string;
  taxRate: number;
  discount: number;
  invoiceNumber?: string;
  header?: string;
  address?: string;
  positions: SevdeskInvoicePositionInput[];
}

export class SevdeskApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'SevdeskApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class SevdeskClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = trimTrailingSlash(baseUrl || DEFAULT_SEVDESK_BASE_URL);
  }

  async getBookkeepingSystemVersion(): Promise<'1.0' | '2.0' | null> {
    const response = await this.request<Record<string, unknown>>('GET', '/Tools/bookkeepingSystemVersion');
    const objects = asRecord(response.objects);
    const version = objects?.version;
    if (version === '1.0' || version === '2.0') {
      return version;
    }
    return null;
  }

  async listContacts(
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<SevdeskContact[]> {
    const response = await this.request<Record<string, unknown>>('GET', '/Contact', params);
    return parseObjects<SevdeskContact>(response);
  }

  async createContact(input: SevdeskContactCreateInput): Promise<SevdeskContact> {
    const response = await this.request<Record<string, unknown>>('POST', '/Contact', undefined, {
      name: input.name,
      category: {
        id: input.categoryId,
        objectName: 'Category',
      },
      status: 1000,
      customerNumber: input.customerNumber,
      taxNumber: input.taxNumber,
      vatNumber: input.vatNumber,
    });

    const contact = parseSingle<SevdeskContact>(response);
    if (!contact?.id) {
      throw new Error('sevDesk did not return a contact id.');
    }

    return contact;
  }

  async listInvoices(
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<SevdeskInvoice[]> {
    const response = await this.request<Record<string, unknown>>('GET', '/Invoice', params);
    return parseObjects<SevdeskInvoice>(response);
  }

  async findInvoiceByNumber(invoiceNumber: string): Promise<SevdeskInvoice | null> {
    const invoices = await this.listInvoices({
      invoiceNumber,
      limit: 1,
      offset: 0,
    });
    return invoices[0] ?? null;
  }

  async saveInvoice(input: SevdeskInvoiceUpsertInput): Promise<SevdeskInvoice> {
    const invoice: Record<string, unknown> = {
      objectName: 'Invoice',
      mapAll: true,
      invoiceDate: input.invoiceDate,
      contact: {
        id: Number(input.contactId),
        objectName: 'Contact',
      },
      discount: input.discount,
      status: String(input.status),
      taxRate: input.taxRate,
      taxRule: {
        id: input.taxRuleId,
        objectName: 'TaxRule',
      },
      taxText: input.taxText,
      taxType: input.taxType,
      invoiceType: input.invoiceType,
      currency: input.currency,
    };

    if (input.contactPersonId) {
      invoice.contactPerson = {
        id: input.contactPersonId,
        objectName: 'SevUser',
      };
    }
    if (input.addressCountryId) {
      invoice.addressCountry = {
        id: input.addressCountryId,
        objectName: 'StaticCountry',
      };
    }

    if (input.id) {
      invoice.id = Number(input.id);
    }
    if (input.invoiceNumber) {
      invoice.invoiceNumber = input.invoiceNumber;
    }
    if (input.header) {
      invoice.header = input.header;
    }
    if (input.address) {
      invoice.address = input.address;
    }

    const invoicePos = input.positions.map((position) => ({
      objectName: 'InvoicePos',
      mapAll: true,
      name: position.name,
      quantity: position.quantity,
      price: position.price,
      taxRate: position.taxRate,
      unity: {
        id: position.unityId,
        objectName: 'Unity',
      },
      text: position.text,
      positionNumber: position.positionNumber,
    }));

    const response = await this.request<Record<string, unknown>>(
      'POST',
      '/Invoice/Factory/saveInvoice',
      undefined,
      {
        invoice,
        invoicePos,
        invoicePosSave: invoicePos,
        invoicePosDelete: null,
        discountSave: [],
        discountDelete: null,
        takeDefaultAddress: true,
      }
    );

    const result = parseSingle<SevdeskInvoice>(response);
    if (!result?.id) {
      throw new Error('sevDesk did not return an invoice id.');
    }

    return result;
  }

  async sendInvoiceBy(
    invoiceId: string,
    sendType: 'VPR' | 'VP' | 'VM' | 'VPDF' = 'VPDF'
  ): Promise<SevdeskInvoice> {
    const response = await this.request<Record<string, unknown>>(
      'PUT',
      `/Invoice/${encodeURIComponent(invoiceId)}/sendBy`,
      undefined,
      {
        sendType,
        sendDraft: false,
      }
    );

    const updated = parseSingle<SevdeskInvoice>(response);
    if (!updated?.id) {
      throw new Error(`sevDesk did not return invoice details after sendBy for invoice ${invoiceId}.`);
    }

    return updated;
  }

  async cancelInvoice(invoiceId: string): Promise<SevdeskInvoice> {
    const response = await this.request<Record<string, unknown>>(
      'POST',
      `/Invoice/${encodeURIComponent(invoiceId)}/cancelInvoice`
    );

    const cancelled = parseSingle<SevdeskInvoice>(response);
    if (!cancelled?.id) {
      throw new Error(`sevDesk did not return invoice details after cancellation for invoice ${invoiceId}.`);
    }

    return cancelled;
  }

  async getInvoicePdf(invoiceId: string): Promise<SevdeskInvoicePdf> {
    const response = await this.request<Record<string, unknown>>(
      'GET',
      `/Invoice/${encodeURIComponent(invoiceId)}/getPdf`,
      {
        download: true,
        preventSendBy: true,
      }
    );

    return {
      filename: asString(response.filename),
      mimeType: asString(response.mimeType),
      base64encoded: typeof response.base64encoded === 'boolean' ? response.base64encoded : undefined,
      content: asString(response.content),
    };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    body?: unknown
  ): Promise<T> {
    const url = buildRequestUrl(this.baseUrl, path, query);

    const headers: Record<string, string> = {
      Authorization: this.apiKey,
      Accept: 'application/json',
      'User-Agent': 'InvoiceLeaf integration-sevdesk/1.0',
    };

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    return requestWithRetry<T>(url, init);
  }
}

function parseObjects<T>(response: Record<string, unknown>): T[] {
  const objects = response.objects;
  if (Array.isArray(objects)) {
    return objects as T[];
  }
  if (objects && typeof objects === 'object') {
    return [objects as T];
  }
  return [];
}

function parseSingle<T>(response: Record<string, unknown>): T | null {
  const directInvoice = asRecord(response.invoice);
  if (directInvoice) {
    return directInvoice as T;
  }

  const objects = response.objects;
  if (Array.isArray(objects)) {
    return (objects[0] as T) ?? null;
  }
  if (objects && typeof objects === 'object') {
    return objects as T;
  }

  return response as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function buildRequestUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>
): string {
  const normalizedBase = trimTrailingSlash(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${normalizedBase}${normalizedPath}`;

  if (!query) {
    return url;
  }

  const queryParts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }

  if (queryParts.length > 0) {
    url += `?${queryParts.join('&')}`;
  }

  return url;
}

async function requestWithRetry<T>(url: string, init: RequestInit): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const body = await response.text();

      if (!response.ok) {
        const error = new SevdeskApiError(
          `sevDesk API request failed with status ${response.status}`,
          response.status,
          body
        );

        if (attempt < MAX_REQUEST_ATTEMPTS && RETRYABLE_STATUSES.has(response.status)) {
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
      if (
        attempt < MAX_REQUEST_ATTEMPTS &&
        (!(error instanceof SevdeskApiError) || RETRYABLE_STATUSES.has(error.status))
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('sevDesk request failed after retries.');
}

function backoffMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
