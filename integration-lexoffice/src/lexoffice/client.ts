const DEFAULT_LEXOFFICE_BASE_URL = 'https://api.lexoffice.io/v1';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

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
    const url = new URL(path, `${this.baseUrl}/`);
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

    return requestWithRetry<T>(url.toString(), init);
  }
}

async function requestWithRetry<T>(url: string, init: RequestInit): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const body = await response.text();

      if (!response.ok) {
        const error = new LexofficeApiError(
          `lexoffice API request failed with status ${response.status}`,
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
        (!(error instanceof LexofficeApiError) || RETRYABLE_STATUSES.has(error.status))
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('lexoffice request failed after retries.');
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

function backoffMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
