import { requestWithRetry, type RequestWithRetryOptions } from '@invoiceleaf/integration-sdk';

const GMAIL_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

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

const GMAIL_RETRY_OPTIONS: RequestWithRetryOptions = {
  method: 'GET',
  createError: (message, status, responseBody) => new GmailApiError(message, status, responseBody),
};

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
    query?: string | null;
    maxResults: number;
    includeSpamTrash?: boolean;
  }): Promise<GmailMessage[]> {
    const params: Record<string, string> = {
      maxResults: String(input.maxResults),
      includeSpamTrash: input.includeSpamTrash ? 'true' : 'false',
    };

    if (input.query != null && input.query.trim().length > 0) {
      params.q = input.query.trim();
    }

    const response = await this.request<GmailMessageListResponse>('GET', '/messages', undefined, params);

    return (response.messages ?? []).filter((item) => item != null && typeof item.id === 'string');
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
    // The base URL carries the API version path. A leading slash would make
    // URL() replace that path, so strip it to append instead.
    const url = new URL(path.replace(/^\/+/, ''), `${GMAIL_BASE_URL}/`);
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

    return requestWithRetry<T>(url.toString(), init, GMAIL_RETRY_OPTIONS);
  }
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
