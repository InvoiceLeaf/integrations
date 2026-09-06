import { requestWithRetry, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { RequestWithRetryOptions } from '@invoiceleaf/integration-sdk';

const DEFAULT_LEXOFFICE_BASE_URL = 'https://api.lexoffice.io/v1';

export class LexofficeApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'LexofficeApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

interface LexofficeContact {
  id?: string;
}

interface LexofficeContactsResponse {
  content?: LexofficeContact[];
}

interface LexofficeFileUploadResponse {
  id?: string;
  fileId?: string;
  documentId?: string;
  resourceId?: string;
}

export class LexofficeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = trimTrailingSlash(baseUrl ?? DEFAULT_LEXOFFICE_BASE_URL);
  }

  async listContacts(limit: number): Promise<Array<{ id?: string }>> {
    const response = await this.request<LexofficeContactsResponse>('GET', '/contacts', undefined, {
      size: String(limit),
      page: '0',
    });

    return response.content ?? [];
  }

  async uploadVoucherFile(input: {
    fileName: string;
    contentType: string;
    contentBase64: string;
  }): Promise<{ fileId: string }> {
    const bytes = Buffer.from(input.contentBase64, 'base64');
    const formData = new FormData();
    formData.set('file', new Blob([bytes], { type: input.contentType }), input.fileName);
    formData.set('type', 'voucher');

    const response = await this.request<LexofficeFileUploadResponse>('POST', '/files', formData);

    const fileId =
      trimToUndefined(response.id) ??
      trimToUndefined(response.fileId) ??
      trimToUndefined(response.documentId) ??
      trimToUndefined(response.resourceId);

    if (!fileId) {
      throw new Error('lexoffice did not return a file identifier.');
    }

    return { fileId };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    query?: Record<string, string>
  ): Promise<T> {
    // The base URL carries the API version path. A leading slash would make
    // URL() replace that path, so strip it to append instead.
    const url = new URL(path.replace(/^\/+/, ''), `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'InvoiceLeaf integration-lexoffice/1.0',
    };

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      if (body instanceof FormData) {
        init.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
    }

    const retryOptions: RequestWithRetryOptions = {
      method,
      createError: (message, status, responseBody) =>
        new LexofficeApiError(message, status, responseBody),
    };

    return requestWithRetry<T>(url.toString(), init, retryOptions);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
