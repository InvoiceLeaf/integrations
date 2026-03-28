import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutlookApiError, OutlookClient } from '../outlook/client.js';

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
// OutlookApiError
// ---------------------------------------------------------------------------
describe('OutlookApiError', () => {
  it('stores status and responseBody', () => {
    const err = new OutlookApiError('forbidden', 403, '{"error":"access_denied"}');
    expect(err.name).toBe('OutlookApiError');
    expect(err.status).toBe(403);
    expect(err.responseBody).toBe('{"error":"access_denied"}');
    expect(err.message).toBe('forbidden');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// OutlookClient
// ---------------------------------------------------------------------------
describe('OutlookClient', () => {
  let client: OutlookClient;

  beforeEach(() => {
    client = new OutlookClient('test-access-token');
    mockFetch.mockReset();
  });

  // -- getProfile -----------------------------------------------------------
  describe('getProfile', () => {
    it('returns profile with mail', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 'user-id-123',
          mail: 'user@outlook.com',
          displayName: 'Test User',
          userPrincipalName: 'user@contoso.onmicrosoft.com',
        })
      );

      const profile = await client.getProfile();
      expect(profile.id).toBe('user-id-123');
      expect(profile.mail).toBe('user@outlook.com');
      expect(profile.displayName).toBe('Test User');

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://graph.microsoft.com/v1.0/me');
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer test-access-token'
      );
    });

    it('falls back to userPrincipalName when mail is missing', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 'user-id-456',
          mail: null,
          displayName: 'Fallback User',
          userPrincipalName: 'fallback@contoso.onmicrosoft.com',
        })
      );

      const profile = await client.getProfile();
      expect(profile.mail).toBe('fallback@contoso.onmicrosoft.com');
    });
  });

  // -- listMessages ---------------------------------------------------------
  describe('listMessages', () => {
    it('returns messages with from extracted', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 'msg-1',
              subject: 'Invoice',
              receivedDateTime: '2026-01-15T10:00:00Z',
              from: { emailAddress: { address: 'sender@example.com' } },
            },
            {
              id: 'msg-2',
              subject: 'Receipt',
              receivedDateTime: '2026-01-14T09:00:00Z',
              from: { emailAddress: { address: 'other@example.com' } },
            },
          ],
        })
      );

      const result = await client.listMessages({
        folderId: 'inbox',
        maxResults: 10,
        lookbackDays: 30,
      });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[0].subject).toBe('Invoice');
      expect(result[0].from).toBe('sender@example.com');
      expect(result[1].from).toBe('other@example.com');
    });

    it('returns empty array when value is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await client.listMessages({
        folderId: 'inbox',
        maxResults: 5,
        lookbackDays: 7,
      });

      expect(result).toEqual([]);
    });

    it('includes onlyUnread filter when set', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ value: [] }));

      await client.listMessages({
        folderId: 'inbox',
        maxResults: 10,
        lookbackDays: 30,
        onlyUnread: true,
      });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('isRead');
    });
  });

  // -- getPdfAttachments ----------------------------------------------------
  describe('getPdfAttachments', () => {
    it('returns only PDF file attachments', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 'att-1',
              name: 'invoice.pdf',
              contentType: 'application/pdf',
              contentBytes: 'base64data',
              '@odata.type': '#microsoft.graph.fileAttachment',
            },
            {
              id: 'att-2',
              name: 'image.png',
              contentType: 'image/png',
              contentBytes: 'pngdata',
              '@odata.type': '#microsoft.graph.fileAttachment',
            },
          ],
        })
      );

      const result = await client.getPdfAttachments('msg-1', 10);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('att-1');
      expect(result[0].name).toBe('invoice.pdf');
      expect(result[0].contentBytes).toBe('base64data');
    });

    it('filters non-fileAttachment odata types', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 'att-1',
              name: 'invoice.pdf',
              contentType: 'application/pdf',
              contentBytes: 'base64data',
              '@odata.type': '#microsoft.graph.itemAttachment',
            },
          ],
        })
      );

      const result = await client.getPdfAttachments('msg-1', 10);
      expect(result).toEqual([]);
    });

    it('filters attachments without contentBytes', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 'att-1',
              name: 'invoice.pdf',
              contentType: 'application/pdf',
              '@odata.type': '#microsoft.graph.fileAttachment',
            },
          ],
        })
      );

      const result = await client.getPdfAttachments('msg-1', 10);
      expect(result).toEqual([]);
    });

    it('respects maxAttachments limit', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 'att-1',
              name: 'first.pdf',
              contentType: 'application/pdf',
              contentBytes: 'data1',
              '@odata.type': '#microsoft.graph.fileAttachment',
            },
            {
              id: 'att-2',
              name: 'second.pdf',
              contentType: 'application/pdf',
              contentBytes: 'data2',
              '@odata.type': '#microsoft.graph.fileAttachment',
            },
            {
              id: 'att-3',
              name: 'third.pdf',
              contentType: 'application/pdf',
              contentBytes: 'data3',
              '@odata.type': '#microsoft.graph.fileAttachment',
            },
          ],
        })
      );

      const result = await client.getPdfAttachments('msg-1', 2);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('att-1');
      expect(result[1].id).toBe('att-2');
    });

    it('returns empty when no attachments', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ value: [] }));

      const result = await client.getPdfAttachments('msg-1', 10);
      expect(result).toEqual([]);
    });
  });

  // -- error propagation ----------------------------------------------------
  describe('error propagation', () => {
    it('throws OutlookApiError on 401', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

      await expect(client.getProfile()).rejects.toThrow(OutlookApiError);
    });

    it('throws OutlookApiError on 500', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Server Error'));

      await expect(client.getProfile()).rejects.toThrow(OutlookApiError);
    });
  });
});
