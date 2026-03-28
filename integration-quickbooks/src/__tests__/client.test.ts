import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuickBooksClient, QuickBooksApiError } from '../quickbooks/client.js';

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
// QuickBooksApiError
// ---------------------------------------------------------------------------
describe('QuickBooksApiError', () => {
  it('stores status and responseBody', () => {
    const err = new QuickBooksApiError('boom', 403, '{"message":"Forbidden"}');
    expect(err.name).toBe('QuickBooksApiError');
    expect(err.status).toBe(403);
    expect(err.responseBody).toBe('{"message":"Forbidden"}');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// QuickBooksClient
// ---------------------------------------------------------------------------
describe('QuickBooksClient', () => {
  let client: QuickBooksClient;

  beforeEach(() => {
    client = new QuickBooksClient('test-token', 'realm-123');
    mockFetch.mockReset();
  });

  function expectAuthHeaders(): void {
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['Accept']).toBe('application/json');
    expect(headers['User-Agent']).toBe('InvoiceLeaf integration-quickbooks/1.0');
  }

  // -- getCompanyInfo -----------------------------------------------------
  describe('getCompanyInfo', () => {
    it('returns company info', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ CompanyInfo: { CompanyName: 'Acme Inc', LegalName: 'Acme Inc LLC', Country: 'US' } })
      );

      const info = await client.getCompanyInfo();
      expect(info.CompanyName).toBe('Acme Inc');
      expect(info.LegalName).toBe('Acme Inc LLC');
      expectAuthHeaders();

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/companyinfo/realm-123');
    });

    it('returns empty object when CompanyInfo is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const info = await client.getCompanyInfo();
      expect(info).toEqual({});
    });
  });

  // -- findCustomerByDisplayName ------------------------------------------
  describe('findCustomerByDisplayName', () => {
    it('returns customer when found', async () => {
      const customer = { Id: 'cust-1', DisplayName: 'Acme' };
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ QueryResponse: { Customer: [customer] } })
      );

      const result = await client.findCustomerByDisplayName('Acme');
      expect(result).toEqual(customer);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('query');
      expect(url).toContain('Customer');
    });

    it('returns null when no customer found', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ QueryResponse: {} })
      );

      const result = await client.findCustomerByDisplayName('Nonexistent');
      expect(result).toBeNull();
    });
  });

  // -- createCustomer -----------------------------------------------------
  describe('createCustomer', () => {
    it('creates and returns customer', async () => {
      const customer = { Id: 'cust-new', DisplayName: 'New Co' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Customer: customer }));

      const result = await client.createCustomer({ DisplayName: 'New Co' });
      expect(result).toEqual(customer);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.DisplayName).toBe('New Co');
    });

    it('throws when QuickBooks returns no customer id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ Customer: {} }));

      await expect(
        client.createCustomer({ DisplayName: 'Ghost' })
      ).rejects.toThrow('QuickBooks did not return a customer id.');
    });
  });

  // -- findInvoiceByDocNumber ---------------------------------------------
  describe('findInvoiceByDocNumber', () => {
    it('returns invoice when found', async () => {
      const invoice = { Id: 'inv-1', SyncToken: '0', DocNumber: 'INV-001' };
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ QueryResponse: { Invoice: [invoice] } })
      );

      const result = await client.findInvoiceByDocNumber('INV-001');
      expect(result).toEqual(invoice);
    });

    it('returns null when not found', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ QueryResponse: {} })
      );

      const result = await client.findInvoiceByDocNumber('NOPE');
      expect(result).toBeNull();
    });
  });

  // -- createInvoice ------------------------------------------------------
  describe('createInvoice', () => {
    it('creates invoice and returns it', async () => {
      const invoice = { Id: 'inv-new', SyncToken: '0', DocNumber: 'INV-100' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Invoice: invoice }));

      const result = await client.createInvoice({
        CustomerRef: { value: 'cust-1' },
        Line: [
          {
            Amount: 100,
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: { ItemRef: { value: 'item-1' } },
          },
        ],
      });
      expect(result).toEqual(invoice);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
    });

    it('throws when QuickBooks returns no invoice id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ Invoice: {} }));

      await expect(
        client.createInvoice({
          CustomerRef: { value: 'cust-1' },
          Line: [
            {
              Amount: 10,
              DetailType: 'SalesItemLineDetail',
              SalesItemLineDetail: { ItemRef: { value: 'item-1' } },
            },
          ],
        })
      ).rejects.toThrow('QuickBooks did not return an invoice id.');
    });
  });

  // -- updateInvoice ------------------------------------------------------
  describe('updateInvoice', () => {
    it('sends Id and SyncToken in body', async () => {
      const invoice = { Id: 'inv-existing', SyncToken: '2', DocNumber: 'INV-100' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Invoice: invoice }));

      await client.updateInvoice({
        Id: 'inv-existing',
        SyncToken: '1',
        CustomerRef: { value: 'cust-1' },
        Line: [
          {
            Amount: 200,
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: { ItemRef: { value: 'item-1' } },
          },
        ],
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.Id).toBe('inv-existing');
      expect(body.SyncToken).toBe('1');
    });
  });

  // -- getInvoice ---------------------------------------------------------
  describe('getInvoice', () => {
    it('fetches invoice by id', async () => {
      const invoice = { Id: 'inv-42', SyncToken: '3', DocNumber: 'INV-042' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Invoice: invoice }));

      const result = await client.getInvoice('inv-42');
      expect(result).toEqual(invoice);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/invoice/inv-42');
    });
  });

  // -- findBillByDocNumber ------------------------------------------------
  describe('findBillByDocNumber', () => {
    it('returns bill when found', async () => {
      const bill = { Id: 'bill-1', SyncToken: '0', DocNumber: 'BILL-001' };
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ QueryResponse: { Bill: [bill] } })
      );

      const result = await client.findBillByDocNumber('BILL-001');
      expect(result).toEqual(bill);
    });

    it('returns null when not found', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ QueryResponse: {} })
      );

      const result = await client.findBillByDocNumber('NOPE');
      expect(result).toBeNull();
    });
  });

  // -- createBill ---------------------------------------------------------
  describe('createBill', () => {
    it('creates bill and returns it', async () => {
      const bill = { Id: 'bill-new', SyncToken: '0', DocNumber: 'BILL-100' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Bill: bill }));

      const result = await client.createBill({
        VendorRef: { value: 'vendor-1' },
        Line: [
          {
            Amount: 50,
            DetailType: 'AccountBasedExpenseLineDetail',
            AccountBasedExpenseLineDetail: { AccountRef: { value: 'acct-1' } },
          },
        ],
      });
      expect(result).toEqual(bill);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
    });

    it('throws when QuickBooks returns no bill id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ Bill: {} }));

      await expect(
        client.createBill({
          VendorRef: { value: 'vendor-1' },
          Line: [
            {
              Amount: 10,
              DetailType: 'AccountBasedExpenseLineDetail',
              AccountBasedExpenseLineDetail: { AccountRef: { value: 'acct-1' } },
            },
          ],
        })
      ).rejects.toThrow('QuickBooks did not return a bill id.');
    });
  });

  // -- updateBill ---------------------------------------------------------
  describe('updateBill', () => {
    it('sends Id and SyncToken in body', async () => {
      const bill = { Id: 'bill-existing', SyncToken: '2', DocNumber: 'BILL-100' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Bill: bill }));

      await client.updateBill({
        Id: 'bill-existing',
        SyncToken: '1',
        VendorRef: { value: 'vendor-1' },
        Line: [
          {
            Amount: 75,
            DetailType: 'AccountBasedExpenseLineDetail',
            AccountBasedExpenseLineDetail: { AccountRef: { value: 'acct-1' } },
          },
        ],
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.Id).toBe('bill-existing');
      expect(body.SyncToken).toBe('1');
    });
  });

  // -- getBill ------------------------------------------------------------
  describe('getBill', () => {
    it('fetches bill by id', async () => {
      const bill = { Id: 'bill-42', SyncToken: '1', DocNumber: 'BILL-042' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ Bill: bill }));

      const result = await client.getBill('bill-42');
      expect(result).toEqual(bill);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/bill/bill-42');
    });
  });

  // -- error propagation --------------------------------------------------
  describe('error propagation', () => {
    it('throws QuickBooksApiError on 403', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

      await expect(client.getCompanyInfo()).rejects.toThrow(QuickBooksApiError);
    });

    it('throws QuickBooksApiError on 500', async () => {
      // After exhausting retries, it should throw QuickBooksApiError
      mockFetch.mockResolvedValue(errorResponse(500, 'Server Error'));

      await expect(client.getCompanyInfo()).rejects.toThrow(QuickBooksApiError);
    });
  });
});
