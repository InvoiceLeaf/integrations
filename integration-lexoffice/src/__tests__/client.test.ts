import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexofficeApiError, LexofficeClient } from '../lexoffice/client.js';

// Stub global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): object {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: vi.fn().mockResolvedValue(text),
    arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(text).buffer),
  };
}

function errorResponse(status: number, body = ''): object {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(body),
    arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(body).buffer),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// LexofficeApiError
// ---------------------------------------------------------------------------
describe('LexofficeApiError', () => {
  it('stores status and responseBody', () => {
    const err = new LexofficeApiError('boom', 403, '{"message":"Forbidden"}');
    expect(err.name).toBe('LexofficeApiError');
    expect(err.status).toBe(403);
    expect(err.responseBody).toBe('{"message":"Forbidden"}');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// LexofficeClient
// ---------------------------------------------------------------------------
describe('LexofficeClient', () => {
  let client: LexofficeClient;

  beforeEach(() => {
    client = new LexofficeClient('test-api-key');
    mockFetch.mockReset();
  });

  // -- listContacts ---------------------------------------------------------
  describe('listContacts', () => {
    it('returns contacts on success', async () => {
      const contacts = [{ id: 'contact-1' }, { id: 'contact-2' }];
      mockFetch.mockResolvedValueOnce(jsonResponse({ content: contacts }));

      const result = await client.listContacts(10);
      expect(result).toEqual(contacts);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://api.lexoffice.io/v1/contacts');
      expect(url).toContain('size=10');
      expect(url).toContain('page=0');
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer test-api-key'
      );
    });

    it('returns empty array when content is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await client.listContacts(5);
      expect(result).toEqual([]);
    });
  });

  // -- uploadVoucherFile ----------------------------------------------------
  describe('uploadVoucherFile', () => {
    it('sends FormData and returns fileId from id field', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'file-abc' }));

      const result = await client.uploadVoucherFile({
        fileName: 'invoice.pdf',
        contentType: 'application/pdf',
        contentBase64: Buffer.from('pdf-content').toString('base64'),
      });

      expect(result).toEqual({ fileId: 'file-abc' });

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://api.lexoffice.io/v1/files');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
    });

    it('returns fileId from fileId field', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ fileId: 'fid-123' }));

      const result = await client.uploadVoucherFile({
        fileName: 'doc.pdf',
        contentType: 'application/pdf',
        contentBase64: Buffer.from('data').toString('base64'),
      });

      expect(result).toEqual({ fileId: 'fid-123' });
    });

    it('returns fileId from documentId field', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ documentId: 'did-456' }));

      const result = await client.uploadVoucherFile({
        fileName: 'doc.pdf',
        contentType: 'application/pdf',
        contentBase64: Buffer.from('data').toString('base64'),
      });

      expect(result).toEqual({ fileId: 'did-456' });
    });

    it('returns fileId from resourceId field', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ resourceId: 'rid-789' }));

      const result = await client.uploadVoucherFile({
        fileName: 'doc.pdf',
        contentType: 'application/pdf',
        contentBase64: Buffer.from('data').toString('base64'),
      });

      expect(result).toEqual({ fileId: 'rid-789' });
    });

    it('throws when no id is returned', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await expect(
        client.uploadVoucherFile({
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('data').toString('base64'),
        })
      ).rejects.toThrow('lexoffice did not return a file identifier.');
    });
  });

  // -- custom base URL ------------------------------------------------------
  describe('custom base URL', () => {
    it('uses provided base URL', async () => {
      const customClient = new LexofficeClient('key', 'https://custom.lexoffice.io/v1');
      mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }));

      await customClient.listContacts(1);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('https://custom.lexoffice.io/v1/contacts');
    });
  });

  // -- error propagation ----------------------------------------------------
  describe('error propagation', () => {
    it('throws LexofficeApiError on 401', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

      await expect(client.listContacts(1)).rejects.toThrow(LexofficeApiError);
    });

    it('throws LexofficeApiError on 500', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Server Error'));

      await expect(client.listContacts(1)).rejects.toThrow(LexofficeApiError);
    });
  });
});
