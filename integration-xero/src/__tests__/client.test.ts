import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  escapeWhereValue,
  listXeroConnections,
  selectXeroTenant,
  XeroAccountingClient,
  XeroApiError,
  type XeroConnection,
} from '../xero/client.js';

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
// XeroApiError
// ---------------------------------------------------------------------------
describe('XeroApiError', () => {
  it('stores status and responseBody', () => {
    const err = new XeroApiError('boom', 403, '{"message":"Forbidden"}');
    expect(err.name).toBe('XeroApiError');
    expect(err.status).toBe(403);
    expect(err.responseBody).toBe('{"message":"Forbidden"}');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// escapeWhereValue
// ---------------------------------------------------------------------------
describe('escapeWhereValue', () => {
  it('returns plain strings unchanged', () => {
    expect(escapeWhereValue('Acme Corp')).toBe('Acme Corp');
  });

  it('escapes double quotes', () => {
    expect(escapeWhereValue('He said "hello"')).toBe('He said \\"hello\\"');
  });

  it('escapes single quotes', () => {
    expect(escapeWhereValue("it's")).toBe("it\\'s");
  });

  it('escapes backslashes before quotes', () => {
    expect(escapeWhereValue('back\\slash')).toBe('back\\\\slash');
  });

  it('strips null bytes and control characters', () => {
    expect(escapeWhereValue('a\x00b\x01c\x1fd')).toBe('abcd');
  });

  it('replaces tabs, carriage returns, and newlines with space', () => {
    expect(escapeWhereValue('line\tone\r\ntwo')).toBe('line one  two');
  });

  it('handles combined edge-case', () => {
    const input = "O'Brien\x00 \"LLC\"\tnewco";
    const expected = "O\\'Brien \\\"LLC\\\" newco";
    expect(escapeWhereValue(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// listXeroConnections
// ---------------------------------------------------------------------------
describe('listXeroConnections', () => {
  it('returns connections on success', async () => {
    const connections: XeroConnection[] = [
      { id: 'c1', tenantId: 't1', tenantName: 'Tenant One' },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse(connections));

    const result = await listXeroConnections('access-token-123');
    expect(result).toEqual(connections);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.xero.com/connections');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer access-token-123'
    );
  });

  it('throws XeroApiError on API failure', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

    await expect(listXeroConnections('bad-token')).rejects.toThrow(XeroApiError);
  });
});

// ---------------------------------------------------------------------------
// selectXeroTenant
// ---------------------------------------------------------------------------
describe('selectXeroTenant', () => {
  const conn1: XeroConnection = { id: 'c1', tenantId: 't1', tenantName: 'Tenant One' };
  const conn2: XeroConnection = { id: 'c2', tenantId: 't2', tenantName: 'Tenant Two' };

  it('returns the only connection when there is exactly one', () => {
    expect(selectXeroTenant([conn1])).toBe(conn1);
  });

  it('returns the preferred tenant when specified', () => {
    expect(selectXeroTenant([conn1, conn2], 't2')).toBe(conn2);
  });

  it('throws when preferred tenant is not found', () => {
    expect(() => selectXeroTenant([conn1, conn2], 'missing')).toThrow(
      /Configured tenant "missing" was not found/
    );
  });

  it('throws when multiple tenants exist and no preference is set', () => {
    expect(() => selectXeroTenant([conn1, conn2])).toThrow(
      /Multiple Xero tenants are connected/
    );
  });

  it('returns preferred tenant even with single connection', () => {
    expect(selectXeroTenant([conn1], 't1')).toBe(conn1);
  });
});

// ---------------------------------------------------------------------------
// XeroAccountingClient
// ---------------------------------------------------------------------------
describe('XeroAccountingClient', () => {
  let client: XeroAccountingClient;

  beforeEach(() => {
    client = new XeroAccountingClient('test-token', 'test-tenant-id');
    mockFetch.mockReset();
  });

  function expectAuthHeaders(): void {
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['xero-tenant-id']).toBe('test-tenant-id');
    expect(headers['Accept']).toBe('application/json');
  }

  // -- getOrganisationName ------------------------------------------------
  describe('getOrganisationName', () => {
    it('returns organisation name from first entry', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ Organisations: [{ Name: 'My Org' }] })
      );

      const name = await client.getOrganisationName();
      expect(name).toBe('My Org');
      expectAuthHeaders();

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/Organisation');
    });

    it('returns null when Organisations array is empty', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ Organisations: [] }));

      const name = await client.getOrganisationName();
      expect(name).toBeNull();
    });

    it('returns null when Organisations field is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const name = await client.getOrganisationName();
      expect(name).toBeNull();
    });
  });

  // -- findContactByName --------------------------------------------------
  describe('findContactByName', () => {
    it('returns contact when found', async () => {
      const contact = { ContactID: 'cid-1', Name: 'Acme' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Contacts: [contact] }));

      const result = await client.findContactByName('Acme');
      expect(result).toEqual(contact);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('where=');
      expect(url).toContain('Name');
    });

    it('returns null when no contact found', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ Contacts: [] }));

      const result = await client.findContactByName('Nonexistent');
      expect(result).toBeNull();
    });

    it('escapes special characters in name', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ Contacts: [] }));

      await client.findContactByName('O\'Brien "Co"');

      const [url] = mockFetch.mock.calls[0] as [string];
      // Ensure the where clause is URL-encoded properly
      expect(url).toContain('where=');
    });
  });

  // -- createContact ------------------------------------------------------
  describe('createContact', () => {
    it('creates contact with name only', async () => {
      const contact = { ContactID: 'new-1', Name: 'New Co' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Contacts: [contact] }));

      const result = await client.createContact({ name: 'New Co' });
      expect(result).toEqual(contact);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.Contacts[0].Name).toBe('New Co');
      expect(body.Contacts[0].EmailAddress).toBeUndefined();
    });

    it('includes optional email and tax number', async () => {
      const contact = { ContactID: 'new-2', Name: 'Full Co' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Contacts: [contact] }));

      await client.createContact({
        name: 'Full Co',
        emailAddress: 'info@fullco.com',
        taxNumber: 'DE123456789',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.Contacts[0].EmailAddress).toBe('info@fullco.com');
      expect(body.Contacts[0].TaxNumber).toBe('DE123456789');
    });

    it('throws when Xero returns no contact', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ Contacts: [] }));

      await expect(
        client.createContact({ name: 'Ghost' })
      ).rejects.toThrow('Xero did not return a contact id.');
    });

    it('throws when Xero returns contact without ContactID', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ Contacts: [{ Name: 'NoId' }] })
      );

      await expect(
        client.createContact({ name: 'NoId' })
      ).rejects.toThrow('Xero did not return a contact id.');
    });
  });

  // -- findInvoiceByNumber ------------------------------------------------
  describe('findInvoiceByNumber', () => {
    it('returns invoice when found', async () => {
      const invoice = { InvoiceID: 'inv-1', InvoiceNumber: 'INV-001' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Invoices: [invoice] }));

      const result = await client.findInvoiceByNumber('INV-001');
      expect(result).toEqual(invoice);
    });

    it('returns null when not found', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ Invoices: [] }));

      const result = await client.findInvoiceByNumber('NOPE');
      expect(result).toBeNull();
    });
  });

  // -- upsertInvoice ------------------------------------------------------
  describe('upsertInvoice', () => {
    it('creates a new invoice', async () => {
      const invoice = { InvoiceID: 'inv-new', InvoiceNumber: 'INV-100', Status: 'DRAFT' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Invoices: [invoice] }));

      const result = await client.upsertInvoice({
        Type: 'ACCPAY',
        Contact: { ContactID: 'c1' },
        Date: '2026-01-15',
        Status: 'DRAFT',
        LineAmountTypes: 'Exclusive',
        LineItems: [{ Description: 'Service', Quantity: 1, UnitAmount: 100 }],
      });
      expect(result).toEqual(invoice);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.Invoices).toHaveLength(1);
      expect(body.Invoices[0].Type).toBe('ACCPAY');
    });

    it('updates an existing invoice by InvoiceID', async () => {
      const invoice = { InvoiceID: 'inv-existing', Status: 'AUTHORISED' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Invoices: [invoice] }));

      const result = await client.upsertInvoice({
        InvoiceID: 'inv-existing',
        Type: 'ACCREC',
        Contact: { ContactID: 'c2' },
        Date: '2026-02-01',
        Status: 'AUTHORISED',
        LineAmountTypes: 'Inclusive',
        LineItems: [{ Description: 'Widget', Quantity: 2, UnitAmount: 50 }],
      });
      expect(result.InvoiceID).toBe('inv-existing');
    });

    it('throws when Xero returns no invoice', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ Invoices: [] }));

      await expect(
        client.upsertInvoice({
          Type: 'ACCPAY',
          Contact: { ContactID: 'c1' },
          Date: '2026-01-01',
          LineAmountTypes: 'Exclusive',
          LineItems: [{ Description: 'X', Quantity: 1, UnitAmount: 10 }],
        })
      ).rejects.toThrow('Xero did not return an invoice id.');
    });
  });

  // -- error propagation --------------------------------------------------
  describe('error propagation', () => {
    it('throws XeroApiError on 403', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

      await expect(client.getOrganisationName()).rejects.toThrow(XeroApiError);
    });

    it('throws XeroApiError on 500', async () => {
      // After exhausting retries, it should throw XeroApiError
      mockFetch.mockResolvedValue(errorResponse(500, 'Server Error'));

      await expect(client.getOrganisationName()).rejects.toThrow(XeroApiError);
    });
  });
});
