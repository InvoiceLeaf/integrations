const GMAIL_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

interface GmailMessageListResponse {
  messages?: Array<{ id: string }>;
}

interface GmailMessagePartBody {
  attachmentId?: string;
}

interface GmailMessagePart {
  filename?: string;
  mimeType?: string;
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

interface GmailMessagePayload {
  headers?: Array<{ name?: string; value?: string }>;
  parts?: GmailMessagePart[];
}

interface GmailMessageResponse {
  id: string;
  payload?: GmailMessagePayload;
}

interface GmailProfileResponse {
  emailAddress?: string;
  messagesTotal?: number;
}

interface GmailAttachmentResponse {
  data?: string;
}

export interface GmailMessage {
  id: string;
}

export interface GmailMessageDetails {
  id: string;
  subject?: string;
  from?: string;
  date?: string;
  payload?: GmailMessagePayload;
}

export interface GmailAttachmentRef {
  attachmentId: string;
  fileName: string;
  mimeType: string;
}

export class GmailApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'GmailApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class GmailClient {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getProfile(): Promise<{ emailAddress?: string; messagesTotal?: number }> {
    const response = await this.request<GmailProfileResponse>('GET', '/profile');
    return {
      emailAddress: response.emailAddress,
      messagesTotal: response.messagesTotal,
    };
  }

  async listMessages(input: {
    query: string;
    maxResults: number;
    includeSpamTrash?: boolean;
  }): Promise<GmailMessage[]> {
    const response = await this.request<GmailMessageListResponse>('GET', '/messages', undefined, {
      q: input.query,
      maxResults: String(input.maxResults),
      includeSpamTrash: input.includeSpamTrash ? 'true' : 'false',
    });

    return (response.messages ?? []).filter((item) => typeof item.id === 'string');
  }

  async getMessage(messageId: string): Promise<GmailMessageDetails> {
    const response = await this.request<GmailMessageResponse>(
      'GET',
      `/messages/${encodeURIComponent(messageId)}`,
      undefined,
      { format: 'full' }
    );

    const headers = response.payload?.headers ?? [];

    return {
      id: response.id,
      payload: response.payload,
      subject: findHeader(headers, 'subject'),
      from: findHeader(headers, 'from'),
      date: findHeader(headers, 'date'),
    };
  }

  async extractPdfAttachments(
    message: GmailMessageDetails,
    maxAttachments: number
  ): Promise<GmailAttachmentRef[]> {
    const output: GmailAttachmentRef[] = [];
    const stack = [...(message.payload?.parts ?? [])];

    while (stack.length > 0 && output.length < maxAttachments) {
      const part = stack.pop();
      if (!part) {
        continue;
      }

      if (part.parts?.length) {
        stack.push(...part.parts);
      }

      const fileName = part.filename?.trim();
      const mimeType = (part.mimeType ?? '').toLowerCase();
      const attachmentId = part.body?.attachmentId;

      const isPdf =
        mimeType === 'application/pdf' ||
        (fileName ? fileName.toLowerCase().endsWith('.pdf') : false);

      if (!isPdf || !attachmentId || !fileName) {
        continue;
      }

      output.push({
        attachmentId,
        fileName,
        mimeType: part.mimeType ?? 'application/pdf',
      });
    }

    return output;
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<{ data: string }> {
    const response = await this.request<GmailAttachmentResponse>(
      'GET',
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
    );

    if (!response.data) {
      throw new Error(`Attachment payload is empty for message ${messageId}.`);
    }

    return { data: response.data };
  }

  private async request<T>(
    method: 'GET',
    path: string,
    body?: never,
    query?: Record<string, string>
  ): Promise<T> {
    const url = new URL(path, `${GMAIL_BASE_URL}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
      body,
    };

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
        const error = new GmailApiError(
          `Gmail API request failed with status ${response.status}`,
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
        (!(error instanceof GmailApiError) || RETRYABLE_STATUSES.has(error.status))
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Gmail request failed after retries.');
}

function findHeader(
  headers: Array<{ name?: string; value?: string }>,
  key: string
): string | undefined {
  const needle = key.toLowerCase();
  for (const header of headers) {
    if (header.name?.toLowerCase() === needle) {
      const value = header.value?.trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function backoffMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
