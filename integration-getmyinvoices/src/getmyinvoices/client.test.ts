import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequestWithRetry = vi.fn();
const mockRequestResponseWithRetry = vi.fn();

vi.mock('@invoiceleaf/integration-sdk', () => ({
  requestWithRetry: mockRequestWithRetry,
  requestResponseWithRetry: mockRequestResponseWithRetry,
  trimToUndefined: (v: string | undefined) => (v && v.trim() ? v.trim() : undefined),
}));

import { GetMyInvoicesApiError, GetMyInvoicesClient } from './client.js';

beforeEach(() => {
  mockRequestWithRetry.mockReset();
  mockRequestResponseWithRetry.mockReset();
});

// ---------------------------------------------------------------------------
// GetMyInvoicesApiError
// ---------------------------------------------------------------------------
describe('GetMyInvoicesApiError', () => {
  it('sets status, responseBody, name, and message', () => {
    const error = new GetMyInvoicesApiError('bad request', 400, '{"error":"bad"}');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GetMyInvoicesApiError');
    expect(error.status).toBe(400);
    expect(error.responseBody).toBe('{"error":"bad"}');
    expect(error.message).toBe('bad request');
  });
});

// ---------------------------------------------------------------------------
// GetMyInvoicesClient – constructor
// ---------------------------------------------------------------------------
describe('GetMyInvoicesClient constructor', () => {
  it('uses default baseUrl when none is provided', () => {
    const client = new GetMyInvoicesClient({ apiKey: 'key-1' });
    // Verify the default URL by calling getAccount and inspecting the URL passed
    mockRequestWithRetry.mockResolvedValue({});
    client.getAccount();
    expect(mockRequestWithRetry).toHaveBeenCalledWith(
      'https://api.getmyinvoices.com/accounts/v3/account',
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('trims trailing slash from custom baseUrl', () => {
    const client = new GetMyInvoicesClient({
      apiKey: 'key-1',
      baseUrl: 'https://custom.example.com/v3/',
    });
    mockRequestWithRetry.mockResolvedValue({});
    client.getAccount();
    expect(mockRequestWithRetry).toHaveBeenCalledWith(
      'https://custom.example.com/v3/account',
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('uses default userAgent when none is provided', () => {
    const client = new GetMyInvoicesClient({ apiKey: 'key-1' });
    mockRequestWithRetry.mockResolvedValue({});
    client.getAccount();
    const init = mockRequestWithRetry.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('InvoiceLeaf integration-getmyinvoices/1.0');
  });

  it('uses custom userAgent when provided', () => {
    const client = new GetMyInvoicesClient({ apiKey: 'key-1', userAgent: 'CustomAgent/2.0' });
    mockRequestWithRetry.mockResolvedValue({});
    client.getAccount();
    const init = mockRequestWithRetry.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('CustomAgent/2.0');
  });

  it('sets X-Application header when applicationHeader is provided', () => {
    const client = new GetMyInvoicesClient({ apiKey: 'key-1', applicationHeader: 'MyApp' });
    mockRequestWithRetry.mockResolvedValue({});
    client.getAccount();
    const init = mockRequestWithRetry.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Application']).toBe('MyApp');
  });

  it('omits X-Application header when applicationHeader is blank', () => {
    const client = new GetMyInvoicesClient({ apiKey: 'key-1', applicationHeader: '   ' });
    mockRequestWithRetry.mockResolvedValue({});
    client.getAccount();
    const init = mockRequestWithRetry.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Application']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function defaultClient() {
  return new GetMyInvoicesClient({ apiKey: 'test-key' });
}

const BASE = 'https://api.getmyinvoices.com/accounts/v3';

// ---------------------------------------------------------------------------
// getAccount
// ---------------------------------------------------------------------------
describe('getAccount', () => {
  it('calls GET /account and returns the response', async () => {
    const payload = { accountId: '123', email: 'a@b.com' };
    mockRequestWithRetry.mockResolvedValue(payload);

    const result = await defaultClient().getAccount();

    expect(result).toEqual(payload);
    expect(mockRequestWithRetry).toHaveBeenCalledWith(
      `${BASE}/account`,
      expect.objectContaining({ method: 'GET' }),
      expect.objectContaining({ method: 'GET' })
    );
  });
});

// ---------------------------------------------------------------------------
// listCompanies
// ---------------------------------------------------------------------------
describe('listCompanies', () => {
  it('returns an array when the API returns an array', async () => {
    const companies = [{ companyUid: 1, name: 'Acme' }];
    mockRequestWithRetry.mockResolvedValue(companies);

    const result = await defaultClient().listCompanies();
    expect(result).toEqual(companies);
  });

  it('returns an empty array when the API returns a non-array', async () => {
    mockRequestWithRetry.mockResolvedValue({ some: 'object' });

    const result = await defaultClient().listCompanies();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listDocuments
// ---------------------------------------------------------------------------
describe('listDocuments', () => {
  it('builds URL with pagination query params', async () => {
    mockRequestWithRetry.mockResolvedValue({
      totalCount: 10,
      maxPages: 2,
      records: [{ documentUid: 1 }],
    });

    const result = await defaultClient().listDocuments({
      perPage: 25,
      pageNumber: 2,
      loadLineItems: true,
      archivedFilter: 1,
    });

    const url = mockRequestWithRetry.mock.calls[0][0] as string;
    expect(url).toContain('perPage=25');
    expect(url).toContain('pageNumber=2');
    expect(url).toContain('loadLineItems=1');
    expect(url).toContain('archivedFilter=1');
    expect(result.totalCount).toBe(10);
    expect(result.maxPages).toBe(2);
    expect(result.records).toEqual([{ documentUid: 1 }]);
  });

  it('defaults totalCount to 0 and maxPages to 1 when missing', async () => {
    mockRequestWithRetry.mockResolvedValue({ records: [] });

    const result = await defaultClient().listDocuments();
    expect(result.totalCount).toBe(0);
    expect(result.maxPages).toBe(1);
    expect(result.records).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findDocumentByNumber
// ---------------------------------------------------------------------------
describe('findDocumentByNumber', () => {
  it('returns the first matching document', async () => {
    const doc = { documentUid: 42, documentNumber: 'INV-001' };
    mockRequestWithRetry.mockResolvedValue({
      totalCount: 1,
      maxPages: 1,
      records: [doc],
    });

    const result = await defaultClient().findDocumentByNumber('INV-001');

    expect(result).toEqual(doc);
    const url = mockRequestWithRetry.mock.calls[0][0] as string;
    expect(url).toContain('documentNumberFilter=INV-001');
    expect(url).toContain('perPage=1');
    expect(url).toContain('pageNumber=1');
    expect(url).toContain('loadLineItems=0');
  });

  it('returns null when no document matches', async () => {
    mockRequestWithRetry.mockResolvedValue({
      totalCount: 0,
      maxPages: 1,
      records: [],
    });

    const result = await defaultClient().findDocumentByNumber('INV-999');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// uploadDocument
// ---------------------------------------------------------------------------
describe('uploadDocument', () => {
  it('calls POST /documents and returns documentUid', async () => {
    mockRequestWithRetry.mockResolvedValue({ documentUid: 99 });

    const result = await defaultClient().uploadDocument({
      fileName: 'invoice.pdf',
      fileContent: 'base64data',
    });

    expect(result).toEqual({ documentUid: 99 });
    const init = mockRequestWithRetry.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(mockRequestWithRetry.mock.calls[0][0]).toBe(`${BASE}/documents`);
  });

  it('throws when documentUid is not returned', async () => {
    mockRequestWithRetry.mockResolvedValue({});

    await expect(
      defaultClient().uploadDocument({
        fileName: 'invoice.pdf',
        fileContent: 'base64data',
      })
    ).rejects.toThrow('GetMyInvoices did not return documentUid after upload.');
  });

  it('omits undefined and empty fields from the request body', async () => {
    mockRequestWithRetry.mockResolvedValue({ documentUid: 50 });

    await defaultClient().uploadDocument({
      fileName: 'invoice.pdf',
      fileContent: 'base64data',
      documentNumber: '',
      tags: [],
    });

    const init = mockRequestWithRetry.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      fileName: 'invoice.pdf',
      fileContent: 'base64data',
    });
  });
});

// ---------------------------------------------------------------------------
// updateDocument
// ---------------------------------------------------------------------------
describe('updateDocument', () => {
  it('calls PUT /documents/{uid} and returns documentUid', async () => {
    mockRequestWithRetry.mockResolvedValue({ documentUid: 42 });

    const result = await defaultClient().updateDocument(42, {
      documentNumber: 'INV-002',
    });

    expect(result).toEqual({ documentUid: 42 });
    const url = mockRequestWithRetry.mock.calls[0][0] as string;
    expect(url).toBe(`${BASE}/documents/42`);
    const init = mockRequestWithRetry.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
  });

  it('falls back to provided uid when response lacks documentUid', async () => {
    mockRequestWithRetry.mockResolvedValue({});

    const result = await defaultClient().updateDocument(77, { documentNumber: 'INV-003' });
    expect(result).toEqual({ documentUid: 77 });
  });
});

// ---------------------------------------------------------------------------
// deleteDocument
// ---------------------------------------------------------------------------
describe('deleteDocument', () => {
  it('calls DELETE /documents/{uid}', async () => {
    mockRequestWithRetry.mockResolvedValue({});

    await defaultClient().deleteDocument(42);

    const url = mockRequestWithRetry.mock.calls[0][0] as string;
    expect(url).toBe(`${BASE}/documents/42`);
    const init = mockRequestWithRetry.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// listDeletedDocuments
// ---------------------------------------------------------------------------
describe('listDeletedDocuments', () => {
  it('calls GET /documents/deleted with params', async () => {
    mockRequestWithRetry.mockResolvedValue({
      totalCount: 3,
      records: [{ documentUid: 1, deletedAt: '2025-01-01' }],
    });

    const result = await defaultClient().listDeletedDocuments({
      deletedSinceFilter: '2025-01-01',
      perPage: 10,
      pageNumber: 1,
    });

    const url = mockRequestWithRetry.mock.calls[0][0] as string;
    expect(url).toContain('/documents/deleted');
    expect(url).toContain('deletedSinceFilter=2025-01-01');
    expect(result.totalCount).toBe(3);
    expect(result.records).toEqual([{ documentUid: 1, deletedAt: '2025-01-01' }]);
  });
});

// ---------------------------------------------------------------------------
// downloadDocumentFile
// ---------------------------------------------------------------------------
describe('downloadDocumentFile', () => {
  function mockResponse(options: {
    contentType?: string;
    contentDisposition?: string;
    body: string | Uint8Array;
    isJson?: boolean;
  }): Response {
    const headers = new Headers();
    if (options.contentType) {
      headers.set('content-type', options.contentType);
    }
    if (options.contentDisposition) {
      headers.set('content-disposition', options.contentDisposition);
    }

    const rawBytes =
      typeof options.body === 'string'
        ? new TextEncoder().encode(options.body)
        : options.body;

    return {
      headers,
      arrayBuffer: () => Promise.resolve(rawBytes.buffer.slice(
        rawBytes.byteOffset,
        rawBytes.byteOffset + rawBytes.byteLength
      )),
    } as unknown as Response;
  }

  it('handles JSON response with fileContent', async () => {
    const jsonBody = JSON.stringify({
      fileContent: 'base64pdfdata',
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
    });
    mockRequestResponseWithRetry.mockResolvedValue(
      mockResponse({ contentType: 'application/json', body: jsonBody })
    );

    const result = await defaultClient().downloadDocumentFile(42);

    expect(result.contentBase64).toBe('base64pdfdata');
    expect(result.fileName).toBe('invoice.pdf');
    expect(result.contentType).toBe('application/pdf');
  });

  it('falls back to raw bytes for binary response', async () => {
    const binaryData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    mockRequestResponseWithRetry.mockResolvedValue(
      mockResponse({ contentType: 'application/pdf', body: binaryData })
    );

    const result = await defaultClient().downloadDocumentFile(42);

    expect(result.contentBase64).toBe(Buffer.from(binaryData).toString('base64'));
    expect(result.contentType).toBe('application/pdf');
  });

  it('defaults contentType to application/octet-stream when missing', async () => {
    const binaryData = new Uint8Array([0x00, 0x01]);
    mockRequestResponseWithRetry.mockResolvedValue(
      mockResponse({ body: binaryData })
    );

    const result = await defaultClient().downloadDocumentFile(42);
    expect(result.contentType).toBe('application/octet-stream');
  });

  // Content-Disposition parsing tests
  it('parses UTF-8 encoded filename from content-disposition', async () => {
    const binaryData = new Uint8Array([0x01]);
    mockRequestResponseWithRetry.mockResolvedValue(
      mockResponse({
        contentType: 'application/pdf',
        contentDisposition: "attachment; filename*=UTF-8''invoice%20%231.pdf",
        body: binaryData,
      })
    );

    const result = await defaultClient().downloadDocumentFile(1);
    expect(result.fileName).toBe('invoice #1.pdf');
  });

  it('parses quoted filename from content-disposition', async () => {
    const binaryData = new Uint8Array([0x01]);
    mockRequestResponseWithRetry.mockResolvedValue(
      mockResponse({
        contentType: 'application/pdf',
        contentDisposition: 'attachment; filename="invoice.pdf"',
        body: binaryData,
      })
    );

    const result = await defaultClient().downloadDocumentFile(2);
    expect(result.fileName).toBe('invoice.pdf');
  });

  it('parses plain filename from content-disposition', async () => {
    const binaryData = new Uint8Array([0x01]);
    mockRequestResponseWithRetry.mockResolvedValue(
      mockResponse({
        contentType: 'application/pdf',
        contentDisposition: 'attachment; filename=invoice.pdf',
        body: binaryData,
      })
    );

    const result = await defaultClient().downloadDocumentFile(3);
    expect(result.fileName).toBe('invoice.pdf');
  });

  it('returns undefined fileName when content-disposition is absent', async () => {
    const binaryData = new Uint8Array([0x01]);
    mockRequestResponseWithRetry.mockResolvedValue(
      mockResponse({
        contentType: 'application/pdf',
        body: binaryData,
      })
    );

    const result = await defaultClient().downloadDocumentFile(4);
    expect(result.fileName).toBeUndefined();
  });

  it('uses requestResponseWithRetry with correct URL', async () => {
    const binaryData = new Uint8Array([0x01]);
    mockRequestResponseWithRetry.mockResolvedValue(
      mockResponse({ contentType: 'application/pdf', body: binaryData })
    );

    await defaultClient().downloadDocumentFile(55);

    expect(mockRequestResponseWithRetry).toHaveBeenCalledWith(
      `${BASE}/documents/55/file`,
      expect.objectContaining({ method: 'GET' }),
      expect.any(Object)
    );
  });

  it('passes createError that produces GetMyInvoicesApiError', async () => {
    const binaryData = new Uint8Array([0x01]);
    mockRequestResponseWithRetry.mockResolvedValue(
      mockResponse({ contentType: 'application/pdf', body: binaryData })
    );

    await defaultClient().downloadDocumentFile(1);

    const opts = mockRequestResponseWithRetry.mock.calls[0][2];
    const err = opts.createError('fail', 500, 'body');
    expect(err).toBeInstanceOf(GetMyInvoicesApiError);
    expect(err.status).toBe(500);
    expect(err.responseBody).toBe('body');
  });
});

// ---------------------------------------------------------------------------
// createError callback on request()
// ---------------------------------------------------------------------------
describe('request error factory', () => {
  it('passes createError that produces GetMyInvoicesApiError', async () => {
    mockRequestWithRetry.mockResolvedValue({});
    await defaultClient().getAccount();

    const opts = mockRequestWithRetry.mock.calls[0][2];
    const err = opts.createError('server error', 502, 'Bad Gateway');
    expect(err).toBeInstanceOf(GetMyInvoicesApiError);
    expect(err.name).toBe('GetMyInvoicesApiError');
    expect(err.status).toBe(502);
    expect(err.responseBody).toBe('Bad Gateway');
  });
});

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------
describe('request headers', () => {
  it('includes X-API-KEY, Content-Type, and Accept for JSON requests', async () => {
    mockRequestWithRetry.mockResolvedValue({});
    await defaultClient().getAccount();

    const init = mockRequestWithRetry.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-KEY']).toBe('test-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/json');
  });

  it('uses Accept */* and omits Content-Type for raw requests', async () => {
    const binaryData = new Uint8Array([0x01]);
    mockRequestResponseWithRetry.mockResolvedValue({
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: () => Promise.resolve(binaryData.buffer),
    });

    await defaultClient().downloadDocumentFile(1);

    const init = mockRequestResponseWithRetry.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Accept']).toBe('*/*');
    expect(headers['Content-Type']).toBeUndefined();
  });
});
