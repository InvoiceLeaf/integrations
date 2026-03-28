import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZohoBooksClient, ZohoBooksApiError } from '../zoho/client.js';

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
// ZohoBooksApiError
// ---------------------------------------------------------------------------
describe('ZohoBooksApiError', () => {
  it('stores status and responseBody', () => {
    const err = new ZohoBooksApiError('boom', 403, '{"message":"Forbidden"}');
    expect(err.name).toBe('ZohoBooksApiError');
    expect(err.status).toBe(403);
    expect(err.responseBody).toBe('{"message":"Forbidden"}');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// ZohoBooksClient
// ---------------------------------------------------------------------------
describe('ZohoBooksClient', () => {
  const client = new ZohoBooksClient('test-token');

  function lastFetchUrl(): URL {
    const [url] = mockFetch.mock.calls[0];
    return new URL(url);
  }

  function lastFetchInit(): RequestInit {
    return mockFetch.mock.calls[0][1];
  }

  // -------------------------------------------------------------------------
  // Auth header
  // -------------------------------------------------------------------------
  it('sends Zoho-oauthtoken authorization header', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ organizations: [] }));
    await client.listOrganizations();

    const headers = lastFetchInit().headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Zoho-oauthtoken test-token');
  });

  it('uses default base URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ organizations: [] }));
    await client.listOrganizations();

    expect(lastFetchUrl().origin).toBe('https://www.zohoapis.com');
    expect(lastFetchUrl().pathname).toContain('/books/v3/');
  });

  it('accepts a custom base URL', async () => {
    const custom = new ZohoBooksClient('tok', 'https://custom.zoho.eu/books/v3');
    mockFetch.mockResolvedValueOnce(jsonResponse({ organizations: [] }));
    await custom.listOrganizations();

    expect(lastFetchUrl().origin).toBe('https://custom.zoho.eu');
  });

  // -------------------------------------------------------------------------
  // listOrganizations
  // -------------------------------------------------------------------------
  describe('listOrganizations', () => {
    it('returns organizations', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          organizations: [
            { organization_id: 'org-1', name: 'Acme Corp', currency_code: 'USD' },
            { organization_id: 'org-2', name: 'Other Inc' },
          ],
        })
      );

      const result = await client.listOrganizations();

      expect(result).toHaveLength(2);
      expect(result[0].organization_id).toBe('org-1');
      expect(result[0].name).toBe('Acme Corp');
    });

    it('returns empty array when organizations field is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0 }));

      const result = await client.listOrganizations();

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // findContactByName
  // -------------------------------------------------------------------------
  describe('findContactByName', () => {
    it('returns contact when found', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          contacts: [{ contact_id: 'c-1', contact_name: 'John Doe', email: 'john@example.com' }],
        })
      );

      const result = await client.findContactByName('org-1', 'John Doe');

      expect(result).not.toBeNull();
      expect(result!.contact_id).toBe('c-1');
      expect(result!.contact_name).toBe('John Doe');
    });

    it('returns null when no contacts found', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0, contacts: [] }));

      const result = await client.findContactByName('org-1', 'Unknown');

      expect(result).toBeNull();
    });

    it('passes organization_id as query parameter', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0, contacts: [] }));

      await client.findContactByName('org-42', 'Acme');

      const url = lastFetchUrl();
      expect(url.searchParams.get('organization_id')).toBe('org-42');
      expect(url.searchParams.get('contact_name')).toBe('Acme');
    });
  });

  // -------------------------------------------------------------------------
  // createContact
  // -------------------------------------------------------------------------
  describe('createContact', () => {
    it('sends POST and returns created contact', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          contact: { contact_id: 'c-new', contact_name: 'New Contact' },
        })
      );

      const result = await client.createContact('org-1', {
        contact_name: 'New Contact',
        contact_type: 'vendor',
      });

      expect(result.contact_id).toBe('c-new');
      expect(lastFetchInit().method).toBe('POST');
      const body = JSON.parse(lastFetchInit().body as string);
      expect(body.contact_name).toBe('New Contact');
      expect(body.contact_type).toBe('vendor');
    });

    it('passes organization_id as query parameter', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          contact: { contact_id: 'c-1', contact_name: 'Test' },
        })
      );

      await client.createContact('org-99', {
        contact_name: 'Test',
        contact_type: 'customer',
      });

      expect(lastFetchUrl().searchParams.get('organization_id')).toBe('org-99');
    });

    it('throws when no contact_id returned', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ code: 0, contact: {} })
      );

      await expect(
        client.createContact('org-1', { contact_name: 'Bad', contact_type: 'vendor' })
      ).rejects.toThrow('Zoho Books did not return a contact id.');
    });

    it('throws when contact field is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0 }));

      await expect(
        client.createContact('org-1', { contact_name: 'Bad', contact_type: 'vendor' })
      ).rejects.toThrow('Zoho Books did not return a contact id.');
    });
  });

  // -------------------------------------------------------------------------
  // findInvoiceByNumber
  // -------------------------------------------------------------------------
  describe('findInvoiceByNumber', () => {
    it('returns invoice when found', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          invoices: [{ invoice_id: 'inv-1', invoice_number: 'INV-001', status: 'draft' }],
        })
      );

      const result = await client.findInvoiceByNumber('org-1', 'INV-001');

      expect(result).not.toBeNull();
      expect(result!.invoice_id).toBe('inv-1');
      expect(result!.invoice_number).toBe('INV-001');
    });

    it('returns null when no invoice found', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0, invoices: [] }));

      const result = await client.findInvoiceByNumber('org-1', 'MISSING');

      expect(result).toBeNull();
    });

    it('passes organization_id and invoice_number as query parameters', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0, invoices: [] }));

      await client.findInvoiceByNumber('org-7', 'INV-999');

      const url = lastFetchUrl();
      expect(url.searchParams.get('organization_id')).toBe('org-7');
      expect(url.searchParams.get('invoice_number')).toBe('INV-999');
    });
  });

  // -------------------------------------------------------------------------
  // createInvoice
  // -------------------------------------------------------------------------
  describe('createInvoice', () => {
    it('sends POST and returns created invoice', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          invoice: { invoice_id: 'inv-new', invoice_number: 'INV-100', status: 'draft' },
        })
      );

      const result = await client.createInvoice('org-1', {
        customer_id: 'c-1',
        date: '2026-01-01',
        line_items: [{ item_id: 'item-1', quantity: 2, rate: 50 }],
      });

      expect(result.invoice_id).toBe('inv-new');
      expect(lastFetchInit().method).toBe('POST');
      const body = JSON.parse(lastFetchInit().body as string);
      expect(body.customer_id).toBe('c-1');
      expect(body.line_items).toHaveLength(1);
    });

    it('passes organization_id as query parameter', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          invoice: { invoice_id: 'inv-1' },
        })
      );

      await client.createInvoice('org-55', {
        customer_id: 'c-1',
        line_items: [{ item_id: 'i-1', quantity: 1, rate: 10 }],
      });

      expect(lastFetchUrl().searchParams.get('organization_id')).toBe('org-55');
    });

    it('throws when no invoice_id returned', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ code: 0, invoice: {} })
      );

      await expect(
        client.createInvoice('org-1', {
          customer_id: 'c-1',
          line_items: [{ item_id: 'i-1', quantity: 1, rate: 10 }],
        })
      ).rejects.toThrow('Zoho Books did not return an invoice id.');
    });

    it('throws when invoice field is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0 }));

      await expect(
        client.createInvoice('org-1', {
          customer_id: 'c-1',
          line_items: [{ item_id: 'i-1', quantity: 1, rate: 10 }],
        })
      ).rejects.toThrow('Zoho Books did not return an invoice id.');
    });
  });

  // -------------------------------------------------------------------------
  // findDefaultItemId
  // -------------------------------------------------------------------------
  describe('findDefaultItemId', () => {
    it('returns item_id when items exist', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ code: 0, items: [{ item_id: 'item-42' }] })
      );

      const result = await client.findDefaultItemId('org-1');

      expect(result).toBe('item-42');
    });

    it('returns undefined when no items exist', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0, items: [] }));

      const result = await client.findDefaultItemId('org-1');

      expect(result).toBeUndefined();
    });

    it('returns undefined when item_id is empty string', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ code: 0, items: [{ item_id: '' }] })
      );

      const result = await client.findDefaultItemId('org-1');

      expect(result).toBeUndefined();
    });

    it('passes organization_id as query parameter', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ code: 0, items: [] }));

      await client.findDefaultItemId('org-77');

      expect(lastFetchUrl().searchParams.get('organization_id')).toBe('org-77');
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation
  // -------------------------------------------------------------------------
  describe('error propagation', () => {
    it('throws ZohoBooksApiError on 401', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

      await expect(client.listOrganizations()).rejects.toThrow(ZohoBooksApiError);

      try {
        mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));
        await client.listOrganizations();
      } catch (err) {
        expect(err).toBeInstanceOf(ZohoBooksApiError);
        expect((err as ZohoBooksApiError).status).toBe(401);
        expect((err as ZohoBooksApiError).responseBody).toBe('Unauthorized');
      }
    });

    it('throws ZohoBooksApiError on 500 after retries', async () => {
      // GET requests retry on 500, so provide 3 responses (default max attempts)
      mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

      await expect(client.listOrganizations()).rejects.toThrow(ZohoBooksApiError);

      try {
        await client.listOrganizations();
      } catch (err) {
        expect(err).toBeInstanceOf(ZohoBooksApiError);
        expect((err as ZohoBooksApiError).status).toBe(500);
      }
    });

    it('throws ZohoBooksApiError on 403 for POST requests', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

      await expect(
        client.createContact('org-1', { contact_name: 'Test', contact_type: 'vendor' })
      ).rejects.toThrow(ZohoBooksApiError);
    });
  });
});
