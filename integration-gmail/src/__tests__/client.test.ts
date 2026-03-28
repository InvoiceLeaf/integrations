import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GmailApiError, GmailClient } from '../gmail/client.js';
import type { GmailMessageDetails } from '../gmail/client.js';

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
// GmailApiError
// ---------------------------------------------------------------------------
describe('GmailApiError', () => {
  it('stores status and responseBody', () => {
    const err = new GmailApiError('unauthorized', 401, '{"error":"invalid_token"}');
    expect(err.name).toBe('GmailApiError');
    expect(err.status).toBe(401);
    expect(err.responseBody).toBe('{"error":"invalid_token"}');
    expect(err.message).toBe('unauthorized');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// GmailClient
// ---------------------------------------------------------------------------
describe('GmailClient', () => {
  let client: GmailClient;

  beforeEach(() => {
    client = new GmailClient('test-access-token');
    mockFetch.mockReset();
  });

  // -- getProfile -----------------------------------------------------------
  describe('getProfile', () => {
    it('returns profile info', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ emailAddress: 'user@gmail.com', messagesTotal: 42 })
      );

      const profile = await client.getProfile();
      expect(profile.emailAddress).toBe('user@gmail.com');
      expect(profile.messagesTotal).toBe(42);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://gmail.googleapis.com/gmail/v1/users/me/profile');
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer test-access-token'
      );
    });
  });

  // -- listMessages ---------------------------------------------------------
  describe('listMessages', () => {
    it('returns messages on success', async () => {
      const messages = [{ id: 'msg-1' }, { id: 'msg-2' }];
      mockFetch.mockResolvedValueOnce(jsonResponse({ messages }));

      const result = await client.listMessages({ maxResults: 10 });
      expect(result).toEqual(messages);
    });

    it('returns empty array when messages is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await client.listMessages({ maxResults: 5 });
      expect(result).toEqual([]);
    });

    it('filters null entries from messages', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ messages: [{ id: 'msg-1' }, null, { id: 'msg-3' }] })
      );

      const result = await client.listMessages({ maxResults: 10 });
      expect(result).toEqual([{ id: 'msg-1' }, { id: 'msg-3' }]);
    });
  });

  // -- getMessage -----------------------------------------------------------
  describe('getMessage', () => {
    it('extracts subject, from, and date from headers', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 'msg-abc',
          payload: {
            headers: [
              { name: 'Subject', value: 'Invoice #123' },
              { name: 'From', value: 'sender@example.com' },
              { name: 'Date', value: 'Mon, 1 Jan 2026 10:00:00 +0000' },
            ],
          },
        })
      );

      const msg = await client.getMessage('msg-abc');
      expect(msg.id).toBe('msg-abc');
      expect(msg.subject).toBe('Invoice #123');
      expect(msg.from).toBe('sender@example.com');
      expect(msg.date).toBe('Mon, 1 Jan 2026 10:00:00 +0000');
    });

    it('returns undefined for missing headers', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ id: 'msg-no-headers', payload: {} })
      );

      const msg = await client.getMessage('msg-no-headers');
      expect(msg.subject).toBeUndefined();
      expect(msg.from).toBeUndefined();
      expect(msg.date).toBeUndefined();
    });
  });

  // -- extractPdfAttachments ------------------------------------------------
  describe('extractPdfAttachments', () => {
    it('returns PDF attachments only', async () => {
      const message: GmailMessageDetails = {
        id: 'msg-1',
        payload: {
          parts: [
            {
              filename: 'invoice.pdf',
              mimeType: 'application/pdf',
              body: { attachmentId: 'att-1' },
            },
            {
              filename: 'image.png',
              mimeType: 'image/png',
              body: { attachmentId: 'att-2' },
            },
          ],
        },
      };

      const result = await client.extractPdfAttachments(message, 10);
      expect(result).toHaveLength(1);
      expect(result[0].attachmentId).toBe('att-1');
      expect(result[0].fileName).toBe('invoice.pdf');
      expect(result[0].mimeType).toBe('application/pdf');
    });

    it('finds PDFs in nested parts', async () => {
      const message: GmailMessageDetails = {
        id: 'msg-2',
        payload: {
          parts: [
            {
              mimeType: 'multipart/mixed',
              parts: [
                {
                  filename: 'nested.pdf',
                  mimeType: 'application/pdf',
                  body: { attachmentId: 'att-nested' },
                },
              ],
            },
          ],
        },
      };

      const result = await client.extractPdfAttachments(message, 10);
      expect(result).toHaveLength(1);
      expect(result[0].attachmentId).toBe('att-nested');
    });

    it('filters non-PDF attachments', async () => {
      const message: GmailMessageDetails = {
        id: 'msg-3',
        payload: {
          parts: [
            {
              filename: 'spreadsheet.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              body: { attachmentId: 'att-xlsx' },
            },
            {
              filename: 'document.docx',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              body: { attachmentId: 'att-docx' },
            },
          ],
        },
      };

      const result = await client.extractPdfAttachments(message, 10);
      expect(result).toEqual([]);
    });

    it('returns empty when message has no parts', async () => {
      const message: GmailMessageDetails = { id: 'msg-empty', payload: {} };

      const result = await client.extractPdfAttachments(message, 10);
      expect(result).toEqual([]);
    });
  });

  // -- getAttachment --------------------------------------------------------
  describe('getAttachment', () => {
    it('returns attachment data', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: 'base64-encoded-data' }));

      const result = await client.getAttachment('msg-1', 'att-1');
      expect(result.data).toBe('base64-encoded-data');
    });

    it('throws when data is empty', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await expect(client.getAttachment('msg-1', 'att-1')).rejects.toThrow(
        'Attachment payload is empty'
      );
    });
  });

  // -- error propagation ----------------------------------------------------
  describe('error propagation', () => {
    it('throws GmailApiError on 401', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

      await expect(client.getProfile()).rejects.toThrow(GmailApiError);
    });

    it('throws GmailApiError on 500', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Server Error'));

      await expect(client.getProfile()).rejects.toThrow(GmailApiError);
    });
  });
});
