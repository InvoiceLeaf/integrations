const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

interface GraphMessageSender {
  emailAddress?: {
    address?: string;
  };
}

interface GraphMessage {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  from?: GraphMessageSender;
}

interface GraphListMessagesResponse {
  value?: GraphMessage[];
}

interface GraphAttachment {
  id?: string;
  name?: string;
  contentType?: string;
  contentBytes?: string;
  '@odata.type'?: string;
}

interface GraphListAttachmentsResponse {
  value?: GraphAttachment[];
}

interface GraphProfileResponse {
  id?: string;
  mail?: string;
  displayName?: string;
  userPrincipalName?: string;
}

export interface OutlookMessage {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  from?: string;
}

export interface OutlookAttachmentRef {
  id: string;
  name: string;
  contentType?: string;
  contentBytes: string;
}

export interface OutlookProfile {
  id?: string;
  mail?: string;
  displayName?: string;
}

export class OutlookApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'OutlookApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class OutlookClient {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getProfile(): Promise<OutlookProfile> {
    const response = await this.request<GraphProfileResponse>('GET', '/me');
    return {
      id: response.id,
      mail: response.mail ?? response.userPrincipalName,
      displayName: response.displayName,
    };
  }

  async listMessages(input: {
    folderId: string;
    maxResults: number;
    lookbackDays: number;
    onlyUnread?: boolean;
  }): Promise<OutlookMessage[]> {
    const minReceivedDate = new Date(Date.now() - input.lookbackDays * 24 * 60 * 60 * 1000)
      .toISOString();

    const filterParts = [`hasAttachments eq true`, `receivedDateTime ge ${minReceivedDate}`];
    if (input.onlyUnread) {
      filterParts.push('isRead eq false');
    }

    const response = await this.request<GraphListMessagesResponse>(
      'GET',
      `/me/mailFolders/${encodeURIComponent(input.folderId)}/messages`,
      undefined,
      {
        '$select': 'id,subject,receivedDateTime,from,hasAttachments,isRead',
        '$orderby': 'receivedDateTime desc',
        '$top': String(input.maxResults),
        '$filter': filterParts.join(' and '),
      }
    );

    return (response.value ?? [])
      .filter((item) => typeof item.id === 'string')
      .map((item) => ({
        id: item.id,
        subject: item.subject,
        receivedDateTime: item.receivedDateTime,
        from: item.from?.emailAddress?.address,
      }));
  }

  async getPdfAttachments(
    messageId: string,
    maxAttachments: number
  ): Promise<OutlookAttachmentRef[]> {
    const response = await this.request<GraphListAttachmentsResponse>(
      'GET',
      `/me/messages/${encodeURIComponent(messageId)}/attachments`,
      undefined,
      {
        '$select': 'id,name,contentType,contentBytes',
      }
    );

    const output: OutlookAttachmentRef[] = [];
    for (const item of response.value ?? []) {
      const id = trimToUndefined(item.id);
      const name = trimToUndefined(item.name);
      const contentBytes = trimToUndefined(item.contentBytes);
      const contentType = trimToUndefined(item.contentType);
      const odataType = trimToUndefined(item['@odata.type']) ?? '';
      const isPdf =
        contentType?.toLowerCase() === 'application/pdf' ||
        (name ? name.toLowerCase().endsWith('.pdf') : false);

      if (!id || !name || !contentBytes || !isPdf) {
        continue;
      }

      if (odataType && !odataType.toLowerCase().includes('fileattachment')) {
        continue;
      }

      output.push({
        id,
        name,
        contentType,
        contentBytes,
      });

      if (output.length >= maxAttachments) {
        break;
      }
    }

    return output;
  }

  private async request<T>(
    method: 'GET',
    path: string,
    body?: never,
    query?: Record<string, string>
  ): Promise<T> {
    const url = new URL(path, `${GRAPH_BASE_URL}/`);
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
        const error = new OutlookApiError(
          `Outlook API request failed with status ${response.status}`,
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
        (!(error instanceof OutlookApiError) || RETRYABLE_STATUSES.has(error.status))
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Outlook request failed after retries.');
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
