const GOOGLE_DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

interface DriveFileResponse {
  id?: string;
  name?: string;
  mimeType?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
}

interface DriveFileListResponse {
  files?: DriveFileResponse[];
  nextPageToken?: string;
}

interface DriveAboutResponse {
  user?: {
    displayName?: string;
    emailAddress?: string;
  };
}

export interface DrivePdfFile {
  id: string;
  name: string;
  mimeType?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parentIds?: string[];
}

export interface DriveDirectory {
  id: string;
  name: string;
  parentIds?: string[];
}

export class GoogleDriveApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'GoogleDriveApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class GoogleDriveClient {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getAbout(): Promise<{ displayName?: string; emailAddress?: string }> {
    const response = await this.request<DriveAboutResponse>('GET', '/about', undefined, {
      fields: 'user(displayName,emailAddress)',
    });

    return {
      displayName: trimToUndefined(response.user?.displayName),
      emailAddress: trimToUndefined(response.user?.emailAddress),
    };
  }

  async listDirectories(folderId: string, recursive: boolean, limit: number): Promise<DriveDirectory[]> {
    const cappedLimit = Math.max(1, Math.min(2000, limit));
    const output: DriveDirectory[] = [];
    const queue: string[] = [folderId || 'root'];
    const visited = new Set<string>();

    while (queue.length > 0 && output.length < cappedLimit) {
      const currentFolderId = queue.shift() as string;
      if (visited.has(currentFolderId)) {
        continue;
      }
      visited.add(currentFolderId);

      const directories = await this.listFilesQuery(
        `'${escapeQueryValue(currentFolderId)}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
        cappedLimit - output.length
      );

      for (const item of directories) {
        if (!item.id || !item.name) {
          continue;
        }

        output.push({
          id: item.id,
          name: item.name,
          parentIds: item.parents,
        });

        if (recursive && output.length < cappedLimit) {
          queue.push(item.id);
        }

        if (output.length >= cappedLimit) {
          break;
        }
      }
    }

    return output;
  }

  async listPdfFiles(folderId: string, recursive: boolean, limit: number): Promise<DrivePdfFile[]> {
    const cappedLimit = Math.max(1, Math.min(1000, limit));
    const output: DrivePdfFile[] = [];
    const queue: string[] = [folderId || 'root'];
    const visited = new Set<string>();

    while (queue.length > 0 && output.length < cappedLimit) {
      const currentFolderId = queue.shift() as string;
      if (visited.has(currentFolderId)) {
        continue;
      }
      visited.add(currentFolderId);

      const files = await this.listFilesQuery(
        `'${escapeQueryValue(currentFolderId)}' in parents and trashed = false`,
        cappedLimit - output.length
      );

      for (const item of files) {
        const id = trimToUndefined(item.id);
        const name = trimToUndefined(item.name);
        if (!id || !name) {
          continue;
        }

        if (item.mimeType === 'application/vnd.google-apps.folder') {
          if (recursive) {
            queue.push(id);
          }
          continue;
        }

        const mimeType = trimToUndefined(item.mimeType);
        const isPdf = mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
          continue;
        }

        output.push({
          id,
          name,
          mimeType,
          md5Checksum: trimToUndefined(item.md5Checksum),
          modifiedTime: trimToUndefined(item.modifiedTime),
          webViewLink: trimToUndefined(item.webViewLink),
          parentIds: item.parents,
        });

        if (output.length >= cappedLimit) {
          break;
        }
      }
    }

    return output;
  }

  async downloadFile(fileId: string): Promise<{ contentBase64: string }> {
    const response = await this.requestRaw('GET', `/files/${encodeURIComponent(fileId)}`, undefined, {
      alt: 'media',
    });

    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      contentBase64: bytes.toString('base64'),
    };
  }

  async uploadFile(input: {
    folderId: string;
    fileName: string;
    contentBase64: string;
    mimeType?: string;
  }): Promise<{ id: string; name?: string; webViewLink?: string; mimeType?: string }> {
    const boundary = `invoiceleaf-${Math.random().toString(16).slice(2)}`;
    const metadata = {
      name: input.fileName,
      parents: [input.folderId || 'root'],
    };

    const mimeType = input.mimeType || 'application/octet-stream';
    const binary = Buffer.from(input.contentBase64, 'base64');

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      binary,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await this.uploadRequest<DriveFileResponse>('POST', '/files', body, {
      uploadType: 'multipart',
      fields: 'id,name,webViewLink,mimeType',
    }, {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    });

    const id = trimToUndefined(response.id);
    if (!id) {
      throw new Error('Google Drive upload did not return a file id.');
    }

    return {
      id,
      name: trimToUndefined(response.name),
      webViewLink: trimToUndefined(response.webViewLink),
      mimeType: trimToUndefined(response.mimeType),
    };
  }

  private async listFilesQuery(query: string, limit: number): Promise<DriveFileResponse[]> {
    const output: DriveFileResponse[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.request<DriveFileListResponse>('GET', '/files', undefined, {
        q: query,
        fields: 'nextPageToken,files(id,name,mimeType,md5Checksum,modifiedTime,webViewLink,parents)',
        pageSize: String(Math.max(1, Math.min(1000, limit - output.length))),
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        corpora: 'user',
        ...(pageToken ? { pageToken } : {}),
      });

      output.push(...(response.files ?? []));
      pageToken = trimToUndefined(response.nextPageToken);
    } while (pageToken && output.length < limit);

    return output.slice(0, limit);
  }

  private async request<T>(
    method: 'GET',
    path: string,
    body?: never,
    query?: Record<string, string>
  ): Promise<T> {
    const response = await this.requestRaw(method, path, body, query);
    const text = await response.text();
    if (text.length === 0) {
      return {} as T;
    }
    return JSON.parse(text) as T;
  }

  private async requestRaw(
    method: 'GET',
    path: string,
    body?: never,
    query?: Record<string, string>
  ): Promise<Response> {
    const url = new URL(path, `${GOOGLE_DRIVE_BASE}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    return requestWithRetry(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
      body,
    });
  }

  private async uploadRequest<T>(
    method: 'POST',
    path: string,
    body: Buffer,
    query?: Record<string, string>,
    headers?: Record<string, string>
  ): Promise<T> {
    const url = new URL(path, `${GOOGLE_DRIVE_UPLOAD_BASE}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await requestWithRetry(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        ...headers,
      },
      body,
    });

    const text = await response.text();
    if (text.length === 0) {
      return {} as T;
    }
    return JSON.parse(text) as T;
  }
}

async function requestWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        const body = await response.text();
        const error = new GoogleDriveApiError(
          `Google Drive API request failed with status ${response.status}`,
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
        (!(error instanceof GoogleDriveApiError) || RETRYABLE_STATUSES.has(error.status))
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Google Drive request failed after retries.');
}

function escapeQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
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
