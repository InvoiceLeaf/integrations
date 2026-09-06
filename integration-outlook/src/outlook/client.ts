import { requestWithRetry, trimToUndefined, type RequestWithRetryOptions } from '@invoiceleaf/integration-sdk';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

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

const OUTLOOK_RETRY_OPTIONS: RequestWithRetryOptions = {
  method: 'GET',
  createError: (message, status, responseBody) => new OutlookApiError(message, status, responseBody),
};

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
    // The base URL carries the API version path. A leading slash would make
    // URL() replace that path, so strip it to append instead.
    const url = new URL(path.replace(/^\/+/, ''), `${GRAPH_BASE_URL}/`);
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

    return requestWithRetry<T>(url.toString(), init, OUTLOOK_RETRY_OPTIONS);
  }
}
