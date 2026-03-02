const DEFAULT_GETMYINVOICES_BASE_URL = 'https://api.getmyinvoices.com/accounts/v3';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

export interface GetMyInvoicesAccount {
  accountId?: string;
  email?: string;
  organization?: string;
  apiKeyType?: string;
  name?: string;
  timezone?: string;
}

export interface GetMyInvoicesCompany {
  companyUid?: number;
  name?: string;
  countryUid?: number;
  countryCode?: string;
  companyType?: string;
  supplierUid?: number;
  taxNumber?: string;
  vatId?: string;
}

export interface GetMyInvoicesCountry {
  countryUid?: number;
  name?: string;
  countryCode?: string;
}

export interface GetMyInvoicesLineItem {
  lineItemUid?: number;
  description?: string;
  quantity?: number;
  unit_net_price?: number;
  tax_percentage?: number;
  tax_amount?: number;
  total_gross?: number;
  order_number?: string;
}

export interface GetMyInvoicesDocument {
  documentUid?: number;
  createdAt?: string;
  dateTimeCreatedAt?: string;
  companyUid?: number;
  companyName?: string;
  documentType?: string;
  documentNumber?: string;
  documentDate?: string;
  documentDueDate?: string;
  netAmount?: number;
  grossAmount?: number;
  vat?: number;
  taxRates?: number[];
  currency?: string;
  isArchived?: boolean | number;
  isLocked?: boolean | number;
  tags?: string[];
  note?: string;
  source?: string;
  filename?: string;
  paymentStatus?: string;
  paidAt?: string;
  paymentMethod?: string;
  lineItems?: GetMyInvoicesLineItem[];
}

export interface GetMyInvoicesDeletedDocument {
  documentUid?: number;
  deletedAt?: string;
}

export interface GetMyInvoicesListDocumentsResult {
  totalCount: number;
  maxPages: number;
  records: GetMyInvoicesDocument[];
}

export interface GetMyInvoicesListDeletedDocumentsResult {
  totalCount: number;
  records: GetMyInvoicesDeletedDocument[];
}

export interface GetMyInvoicesDocumentFile {
  fileName?: string;
  contentType?: string;
  contentBase64: string;
}

export interface GetMyInvoicesCreateCompanyInput {
  name: string;
  countryUid?: number;
  street?: string;
  zip?: string;
  city?: string;
  email?: string;
  phone?: string;
  taxNumber?: string;
  vatId?: string;
  url?: string;
}

export interface GetMyInvoicesDocumentMetadataInput {
  companyId?: number;
  documentType?: string;
  documentNumber?: string;
  documentDate?: string;
  documentDueDate?: string;
  orderNumber?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paidAt?: string;
  netAmount?: string;
  grossAmount?: string;
  currency?: string;
  taxRates?: number[];
  tags?: string[];
  note?: string;
  lineItems?: Array<{
    description?: string;
    quantity?: number;
    unit_net_price?: number;
    tax_percentage?: number;
    total_gross?: number;
    order_number?: string;
  }>;
  isArchived?: 0 | 1;
}

export interface GetMyInvoicesUploadDocumentInput extends GetMyInvoicesDocumentMetadataInput {
  fileName: string;
  fileContent: string;
  runOCR?: boolean;
}

export class GetMyInvoicesApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'GetMyInvoicesApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class GetMyInvoicesClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly applicationHeader?: string;
  private readonly userAgent: string;

  constructor(input: {
    apiKey: string;
    baseUrl?: string;
    applicationHeader?: string;
    userAgent?: string;
  }) {
    this.apiKey = input.apiKey;
    this.baseUrl = trimTrailingSlash(input.baseUrl || DEFAULT_GETMYINVOICES_BASE_URL);
    this.applicationHeader = trimToUndefined(input.applicationHeader);
    this.userAgent =
      trimToUndefined(input.userAgent) ?? 'InvoiceLeaf integration-getmyinvoices/1.0';
  }

  async getAccount(): Promise<GetMyInvoicesAccount> {
    return this.request<GetMyInvoicesAccount>('GET', '/account');
  }

  async listCompanies(): Promise<GetMyInvoicesCompany[]> {
    const response = await this.request<unknown>('GET', '/companies');
    return ensureArray<GetMyInvoicesCompany>(response);
  }

  async createCompany(input: GetMyInvoicesCreateCompanyInput): Promise<GetMyInvoicesCompany> {
    const response = await this.request<Record<string, unknown>>('POST', '/companies', undefined, {
      name: input.name,
      countryUid: input.countryUid,
      street: input.street,
      zip: input.zip,
      city: input.city,
      email: input.email,
      phone: input.phone,
      taxNumber: input.taxNumber,
      vatId: input.vatId,
      url: input.url,
    });

    return {
      companyUid: toOptionalInt(response.companyUid),
      name: asString(response.name) ?? input.name,
      countryUid: input.countryUid,
      taxNumber: input.taxNumber,
      vatId: input.vatId,
    };
  }

  async listCountries(): Promise<GetMyInvoicesCountry[]> {
    const response = await this.request<unknown>('GET', '/countries');
    return ensureArray<GetMyInvoicesCountry>(response);
  }

  async listDocuments(params?: {
    updatedOrNewSinceFilter?: string;
    documentNumberFilter?: string;
    perPage?: number;
    pageNumber?: number;
    loadLineItems?: boolean;
    archivedFilter?: 0 | 1 | 2;
  }): Promise<GetMyInvoicesListDocumentsResult> {
    const response = await this.request<Record<string, unknown>>('GET', '/documents', params);

    return {
      totalCount: toOptionalInt(response.totalCount) ?? 0,
      maxPages: toOptionalInt(response.maxPages) ?? 1,
      records: parseRecords<GetMyInvoicesDocument>(response.records),
    };
  }

  async findDocumentByNumber(documentNumber: string): Promise<GetMyInvoicesDocument | null> {
    const listed = await this.listDocuments({
      documentNumberFilter: documentNumber,
      perPage: 1,
      pageNumber: 1,
      loadLineItems: false,
    });

    return listed.records[0] ?? null;
  }

  async uploadDocument(input: GetMyInvoicesUploadDocumentInput): Promise<{ documentUid: number }> {
    const response = await this.request<Record<string, unknown>>(
      'POST',
      '/documents',
      undefined,
      compactObject({
        fileName: input.fileName,
        fileContent: input.fileContent,
        companyId: input.companyId,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        documentDate: input.documentDate,
        documentDueDate: input.documentDueDate,
        orderNumber: input.orderNumber,
        paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentStatus,
        paidAt: input.paidAt,
        netAmount: input.netAmount,
        grossAmount: input.grossAmount,
        currency: input.currency,
        taxRates: input.taxRates,
        tags: input.tags,
        note: input.note,
        lineItems: input.lineItems,
        runOCR: input.runOCR,
      })
    );

    const documentUid = toOptionalInt(response.documentUid);
    if (!documentUid) {
      throw new Error('GetMyInvoices did not return documentUid after upload.');
    }

    return { documentUid };
  }

  async updateDocument(
    documentUid: number,
    input: GetMyInvoicesDocumentMetadataInput
  ): Promise<{ documentUid: number }> {
    const response = await this.request<Record<string, unknown>>(
      'PUT',
      `/documents/${encodeURIComponent(String(documentUid))}`,
      undefined,
      compactObject({
        companyId: input.companyId,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        documentDate: input.documentDate,
        documentDueDate: input.documentDueDate,
        orderNumber: input.orderNumber,
        paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentStatus,
        paidAt: input.paidAt,
        netAmount: input.netAmount,
        grossAmount: input.grossAmount,
        currency: input.currency,
        taxRates: input.taxRates,
        tags: input.tags,
        note: input.note,
        lineItems: input.lineItems,
        isArchived: input.isArchived,
      })
    );

    return {
      documentUid: toOptionalInt(response.documentUid) ?? documentUid,
    };
  }

  async deleteDocument(documentUid: number): Promise<void> {
    await this.request<Record<string, unknown>>(
      'DELETE',
      `/documents/${encodeURIComponent(String(documentUid))}`
    );
  }

  async listDeletedDocuments(params?: {
    deletedSinceFilter?: string;
    perPage?: number;
    pageNumber?: number;
  }): Promise<GetMyInvoicesListDeletedDocumentsResult> {
    const response = await this.request<Record<string, unknown>>(
      'GET',
      '/documents/deleted',
      params
    );

    return {
      totalCount: toOptionalInt(response.totalCount) ?? 0,
      records: parseRecords<GetMyInvoicesDeletedDocument>(response.records),
    };
  }

  async getDocumentById(documentUid: number): Promise<GetMyInvoicesDocument> {
    const response = await this.request<Record<string, unknown>>(
      'GET',
      `/documents/${encodeURIComponent(String(documentUid))}`
    );

    const metaData = asRecord(response.meta_data);
    if (metaData) {
      return {
        ...metaData,
        documentUid: toOptionalInt(metaData.documentUid),
      } as GetMyInvoicesDocument;
    }

    return {
      ...response,
      documentUid: toOptionalInt(response.documentUid),
    } as GetMyInvoicesDocument;
  }

  async downloadDocumentFile(documentUid: number): Promise<GetMyInvoicesDocumentFile> {
    const response = await this.requestRaw(
      'GET',
      `/documents/${encodeURIComponent(String(documentUid))}/file`
    );

    const contentTypeHeader = response.headers.get('content-type');
    const contentType = trimToUndefined(contentTypeHeader?.split(';')[0]);
    const contentDisposition = response.headers.get('content-disposition') ?? undefined;
    const rawBytes = new Uint8Array(await response.arrayBuffer());

    if (contentType?.includes('application/json')) {
      const text = Buffer.from(rawBytes).toString('utf8');
      const parsed = parseJsonRecord(text);
      if (parsed) {
        const fileContent = asString(parsed.fileContent) ?? asString(parsed.content);
        const fileName =
          asString(parsed.fileName) ??
          asString(parsed.filename) ??
          parseFilenameFromContentDisposition(contentDisposition);
        if (fileContent) {
          return {
            fileName,
            contentType: asString(parsed.contentType) ?? contentType,
            contentBase64: fileContent,
          };
        }
      }
    }

    const contentBase64 = Buffer.from(rawBytes).toString('base64');
    return {
      fileName: parseFilenameFromContentDisposition(contentDisposition),
      contentType: contentType ?? 'application/octet-stream',
      contentBase64,
    };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    body?: unknown
  ): Promise<T> {
    const url = buildRequestUrl(this.baseUrl, path, query);
    const headers = this.buildHeaders(true);

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    return requestJsonWithRetry<T>(url, init);
  }

  private async requestRaw(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<Response> {
    const url = buildRequestUrl(this.baseUrl, path, query);
    const headers = this.buildHeaders(false);
    const init: RequestInit = {
      method,
      headers,
    };

    return requestResponseWithRetry(url, init);
  }

  private buildHeaders(includeJson: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'X-API-KEY': this.apiKey,
      Accept: includeJson ? 'application/json' : '*/*',
      'User-Agent': this.userAgent,
    };

    if (this.applicationHeader) {
      headers['X-Application'] = this.applicationHeader;
    }

    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }
}

function parseRecords<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (value && typeof value === 'object') {
    return [value as T];
  }
  return [];
}

function ensureArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  return [];
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

function toOptionalInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function compactObject<T extends Record<string, unknown>>(input: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string' && value.trim().length === 0) {
      continue;
    }

    if (Array.isArray(value) && value.length === 0) {
      continue;
    }

    result[key] = value;
  }

  return result as T;
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

async function requestJsonWithRetry<T>(url: string, init: RequestInit): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const body = await response.text();

      if (!response.ok) {
        const error = new GetMyInvoicesApiError(
          `GetMyInvoices API request failed with status ${response.status}`,
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
        (!(error instanceof GetMyInvoicesApiError) || RETRYABLE_STATUSES.has(error.status))
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('GetMyInvoices request failed after retries.');
}

async function requestResponseWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);

      if (!response.ok) {
        const body = await response.text();
        const error = new GetMyInvoicesApiError(
          `GetMyInvoices API request failed with status ${response.status}`,
          response.status,
          body
        );

        if (attempt < MAX_REQUEST_ATTEMPTS && RETRYABLE_STATUSES.has(response.status)) {
          await sleep(backoffMs(attempt));
          continue;
        }

        throw error;
      }

      return response;
    } catch (error) {
      lastError = error as Error;
      if (
        attempt < MAX_REQUEST_ATTEMPTS &&
        (!(error instanceof GetMyInvoicesApiError) || RETRYABLE_STATUSES.has(error.status))
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('GetMyInvoices request failed after retries.');
}

function backoffMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseFilenameFromContentDisposition(value: string | undefined): string | undefined {
  const header = trimToUndefined(value);
  if (!header) {
    return undefined;
  }

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = header.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return null;
  }
}
