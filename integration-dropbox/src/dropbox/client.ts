const DROPBOX_API_BASE = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_BASE = 'https://content.dropboxapi.com/2';
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;

interface DropboxListFolderFileEntry {
  '.tag': 'file';
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
  rev?: string;
  content_hash?: string;
  client_modified?: string;
  server_modified?: string;
}

interface DropboxListFolderFolderEntry {
  '.tag': 'folder';
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
}

type DropboxListFolderEntry = DropboxListFolderFileEntry | DropboxListFolderFolderEntry;

interface DropboxListFolderResponse {
  entries?: DropboxListFolderEntry[];
  cursor?: string;
  has_more?: boolean;
}

interface DropboxCurrentAccountResponse {
  account_id?: string;
  email?: string;
  name?: {
    display_name?: string;
  };
}

interface DropboxDownloadMetadata {
  id?: string;
  name?: string;
  path_display?: string;
  rev?: string;
}

interface DropboxUploadResponse {
  id?: string;
  name?: string;
  path_display?: string;
  rev?: string;
}

export interface DropboxPdfFile {
  id: string;
  name: string;
  pathDisplay: string;
  pathLower: string;
  rev?: string;
  contentHash?: string;
  clientModified?: string;
  serverModified?: string;
}

export interface DropboxDirectory {
  id: string;
  name: string;
  pathDisplay: string;
  pathLower: string;
}

export class DropboxApiError extends Error {
  public readonly status: number;
  public readonly responseBody: string;

  constructor(message: string, status: number, responseBody: string) {
    super(message);
    this.name = 'DropboxApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class DropboxClient {
  private readonly accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getCurrentAccount(): Promise<{ accountId?: string; email?: string; displayName?: string }> {
    const response = await this.rpc<DropboxCurrentAccountResponse>('POST', '/users/get_current_account', null);
    return {
      accountId: trimToUndefined(response.account_id),
      email: trimToUndefined(response.email),
      displayName: trimToUndefined(response.name?.display_name),
    };
  }

  async listPdfFiles(path: string, recursive: boolean, limit: number): Promise<DropboxPdfFile[]> {
    const entries = await this.listEntries(path, recursive, limit, (entry): entry is DropboxListFolderFileEntry => entry['.tag'] === 'file');

    return entries
      .filter((entry) => entry.name.toLowerCase().endsWith('.pdf'))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        pathDisplay: entry.path_display,
        pathLower: entry.path_lower,
        rev: trimToUndefined(entry.rev),
        contentHash: trimToUndefined(entry.content_hash),
        clientModified: trimToUndefined(entry.client_modified),
        serverModified: trimToUndefined(entry.server_modified),
      }));
  }

  async listDirectories(path: string, recursive: boolean, limit: number): Promise<DropboxDirectory[]> {
    const entries = await this.listEntries(path, recursive, limit, (entry): entry is DropboxListFolderFolderEntry => entry['.tag'] === 'folder');

    return entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      pathDisplay: entry.path_display,
      pathLower: entry.path_lower,
    }));
  }

  async downloadFile(path: string): Promise<{ metadata: { id?: string; name?: string; pathDisplay?: string; rev?: string }; contentBase64: string }> {
    const url = `${DROPBOX_CONTENT_BASE}/files/download`;
    const arg = JSON.stringify({ path });

    const response = await requestWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Dropbox-API-Arg': arg,
      },
    });

    const rawMetadata = response.headers.get('dropbox-api-result');
    const metadata = rawMetadata ? (JSON.parse(rawMetadata) as DropboxDownloadMetadata) : {};

    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      metadata: {
        id: trimToUndefined(metadata.id),
        name: trimToUndefined(metadata.name),
        pathDisplay: trimToUndefined(metadata.path_display),
        rev: trimToUndefined(metadata.rev),
      },
      contentBase64: bytes.toString('base64'),
    };
  }

  async uploadFile(input: {
    path: string;
    contentBase64: string;
    overwrite?: boolean;
  }): Promise<{ id: string; name?: string; pathDisplay?: string; rev?: string }> {
    const bytes = Buffer.from(input.contentBase64, 'base64');
    const arg = JSON.stringify({
      path: input.path,
      mode: {
        '.tag': input.overwrite ? 'overwrite' : 'add',
      },
      autorename: !input.overwrite,
      mute: false,
      strict_conflict: false,
    });

    const response = await content<DropboxUploadResponse>('POST', '/files/upload', bytes, {
      'Dropbox-API-Arg': arg,
      'Content-Type': 'application/octet-stream',
    }, this.accessToken);

    const id = trimToUndefined(response.id);
    if (!id) {
      throw new Error('Dropbox upload did not return a file id.');
    }

    return {
      id,
      name: trimToUndefined(response.name),
      pathDisplay: trimToUndefined(response.path_display),
      rev: trimToUndefined(response.rev),
    };
  }

  private async listEntries<T extends DropboxListFolderEntry>(
    path: string,
    recursive: boolean,
    limit: number,
    predicate: (entry: DropboxListFolderEntry) => entry is T
  ): Promise<T[]> {
    const cappedLimit = Math.max(1, Math.min(2000, limit));
    const normalizedPath = normalizePath(path);

    const output: T[] = [];
    let cursor: string | undefined;

    do {
      const response: DropboxListFolderResponse = cursor
        ? await this.rpc<DropboxListFolderResponse>('POST', '/files/list_folder/continue', { cursor })
        : await this.rpc<DropboxListFolderResponse>('POST', '/files/list_folder', {
            path: normalizedPath,
            recursive,
            include_non_downloadable_files: false,
            include_deleted: false,
            include_mounted_folders: true,
            limit: Math.min(2000, cappedLimit),
          });

      for (const entry of response.entries ?? []) {
        if (predicate(entry)) {
          output.push(entry);
          if (output.length >= cappedLimit) {
            return output;
          }
        }
      }

      cursor = trimToUndefined(response.cursor);
      if (!response.has_more) {
        cursor = undefined;
      }
    } while (cursor);

    return output;
  }

  private async rpc<T>(method: 'POST', path: string, body: unknown): Promise<T> {
    return rpc<T>(method, path, body, this.accessToken);
  }
}

async function rpc<T>(
  method: 'POST',
  path: string,
  body: unknown,
  accessToken: string
): Promise<T> {
  const url = `${DROPBOX_API_BASE}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === null ? 'null' : JSON.stringify(body),
  };

  return requestJsonWithRetry<T>(url, init);
}

async function content<T>(
  method: 'POST',
  path: string,
  body: Buffer,
  headers: Record<string, string>,
  accessToken: string
): Promise<T> {
  const url = `${DROPBOX_CONTENT_BASE}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
    body,
  };

  return requestJsonWithRetry<T>(url, init);
}

async function requestJsonWithRetry<T>(url: string, init: RequestInit): Promise<T> {
  const response = await requestWithRetry(url, init);
  const body = await response.text();
  if (body.length === 0) {
    return {} as T;
  }
  return JSON.parse(body) as T;
}

async function requestWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        const body = await response.text();
        const error = new DropboxApiError(
          `Dropbox API request failed with status ${response.status}`,
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
        (!(error instanceof DropboxApiError) || RETRYABLE_STATUSES.has(error.status))
      ) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error('Dropbox request failed after retries.');
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed === '/') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
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
