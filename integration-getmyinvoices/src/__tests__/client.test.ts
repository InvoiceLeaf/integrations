import { describe, it, expect, beforeEach } from 'vitest';
import {
  GetMyInvoicesClient,
  GetMyInvoicesApiError,
} from '../getmyinvoices/client.js';
import { mockFetch, jsonResponse, fakeResponse } from './helpers.js';

const BASE_URL = 'https://api.getmyinvoices.com/accounts/v3';

function createClient(overrides: Record<string, string> = {}): GetMyInvoicesClient {
  return new GetMyInvoicesClient({
    apiKey: 'test-key',
    baseUrl: overrides.baseUrl,
    applicationHeader: overrides.applicationHeader,
    userAgent: overrides.userAgent,
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Constructor & headers
// ---------------------------------------------------------------------------
describe('GetMyInvoicesClient constructor', () => {
  it('uses default base URL when none is provided', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ accountId: '42' }));

    await client.getAccount();

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(BASE_URL);
  });

  it('strips trailing slash from custom base URL', async () => {
    const client = createClient({ baseUrl: 'https://custom.api/v3/' });
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await client.getAccount();

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://custom.api/v3/account');
  });

  it('sends X-API-KEY, Accept, Content-Type, and User-Agent headers', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await client.getAccount();

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-KEY']).toBe('test-key');
    expect(headers['Accept']).toBe('application/json');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toBe('InvoiceLeaf integration-getmyinvoices/1.0');
  });

  it('sends custom User-Agent when provided', async () => {
    const client = createClient({ userAgent: 'Custom/2.0' });
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await client.getAccount();

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('Custom/2.0');
  });

  it('sends X-Application header when applicationHeader is set', async () => {
    const client = createClient({ applicationHeader: 'MyApp' });
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await client.getAccount();

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Application']).toBe('MyApp');
  });

  it('does not send X-Application header when applicationHeader is empty', async () => {
    const client = createClient({ applicationHeader: '   ' });
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await client.getAccount();

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Application']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAccount
// ---------------------------------------------------------------------------
describe('getAccount', () => {
  it('returns account data', async () => {
    const client = createClient();
    const accountData = { accountId: '42', email: 'test@example.com', organization: 'Acme' };
    mockFetch.mockResolvedValueOnce(jsonResponse(accountData));

    const result = await client.getAccount();

    expect(result).toEqual(accountData);
  });
});

// ---------------------------------------------------------------------------
// listCompanies
// ---------------------------------------------------------------------------
describe('listCompanies', () => {
  it('returns array of companies', async () => {
    const client = createClient();
    const companies = [
      { companyUid: 1, name: 'Company A' },
      { companyUid: 2, name: 'Company B' },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse(companies));

    const result = await client.listCompanies();

    expect(result).toEqual(companies);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when response is not an array', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'no companies' }));

    const result = await client.listCompanies();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createCompany
// ---------------------------------------------------------------------------
describe('createCompany', () => {
  it('sends POST with company fields and returns parsed result', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ companyUid: 99 }));

    const result = await client.createCompany({
      name: 'New Corp',
      countryUid: 1,
      street: 'Main St',
      email: 'info@new.com',
      taxNumber: 'TX-123',
      vatId: 'VAT-456',
    });

    expect(result.companyUid).toBe(99);
    expect(result.name).toBe('New Corp');

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('New Corp');
    expect(body.countryUid).toBe(1);
  });

  it('uses input name as fallback when response has no name', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ companyUid: 5 }));

    const result = await client.createCompany({ name: 'Fallback Name' });

    expect(result.name).toBe('Fallback Name');
  });
});

// ---------------------------------------------------------------------------
// listCountries
// ---------------------------------------------------------------------------
describe('listCountries', () => {
  it('returns array of countries', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { countryUid: 1, name: 'Germany', countryCode: 'DE' },
      ])
    );

    const result = await client.listCountries();

    expect(result).toEqual([{ countryUid: 1, name: 'Germany', countryCode: 'DE' }]);
  });
});

// ---------------------------------------------------------------------------
// listDocuments
// ---------------------------------------------------------------------------
describe('listDocuments', () => {
  it('returns parsed list result', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 10,
        maxPages: 2,
        records: [{ documentUid: 1, documentNumber: 'INV-001' }],
      })
    );

    const result = await client.listDocuments({ perPage: 5, pageNumber: 1 });

    expect(result.totalCount).toBe(10);
    expect(result.maxPages).toBe(2);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].documentNumber).toBe('INV-001');
  });

  it('handles missing totalCount and maxPages gracefully', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ records: [] }));

    const result = await client.listDocuments();

    expect(result.totalCount).toBe(0);
    expect(result.maxPages).toBe(1);
    expect(result.records).toEqual([]);
  });

  it('handles records as an object instead of array', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        maxPages: 1,
        records: { documentUid: 77, documentNumber: 'SINGLE' },
      })
    );

    const result = await client.listDocuments();

    expect(result.records).toHaveLength(1);
    expect(result.records[0].documentUid).toBe(77);
  });

  it('appends query parameters to URL', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ totalCount: 0, maxPages: 1, records: [] }));

    await client.listDocuments({
      updatedOrNewSinceFilter: '2025-01-01',
      perPage: 10,
      pageNumber: 2,
      loadLineItems: true,
      archivedFilter: 1,
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('updatedOrNewSinceFilter=2025-01-01');
    expect(calledUrl).toContain('perPage=10');
    expect(calledUrl).toContain('pageNumber=2');
    expect(calledUrl).toContain('loadLineItems=1');
    expect(calledUrl).toContain('archivedFilter=1');
  });
});

// ---------------------------------------------------------------------------
// findDocumentByNumber
// ---------------------------------------------------------------------------
describe('findDocumentByNumber', () => {
  it('returns first matching document', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        maxPages: 1,
        records: [{ documentUid: 42, documentNumber: 'INV-001' }],
      })
    );

    const result = await client.findDocumentByNumber('INV-001');

    expect(result).not.toBeNull();
    expect(result?.documentUid).toBe(42);
  });

  it('returns null when no match found', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalCount: 0, maxPages: 1, records: [] })
    );

    const result = await client.findDocumentByNumber('NONEXISTENT');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// uploadDocument
// ---------------------------------------------------------------------------
describe('uploadDocument', () => {
  it('sends POST and returns documentUid', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ documentUid: 123 }));

    const result = await client.uploadDocument({
      fileName: 'test.pdf',
      fileContent: 'dGVzdA==',
      documentType: 'INCOMING_INVOICE',
      documentNumber: 'INV-001',
    });

    expect(result.documentUid).toBe(123);

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.fileName).toBe('test.pdf');
    expect(body.fileContent).toBe('dGVzdA==');
  });

  it('throws when documentUid is missing from response', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await expect(
      client.uploadDocument({
        fileName: 'test.pdf',
        fileContent: 'dGVzdA==',
      })
    ).rejects.toThrow('did not return documentUid');
  });

  it('strips undefined/null/empty fields from request body', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ documentUid: 1 }));

    await client.uploadDocument({
      fileName: 'test.pdf',
      fileContent: 'dGVzdA==',
      documentNumber: undefined,
      tags: [],
      note: '   ',
    });

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.documentNumber).toBeUndefined();
    expect(body.tags).toBeUndefined();
    expect(body.note).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateDocument
// ---------------------------------------------------------------------------
describe('updateDocument', () => {
  it('sends PUT to correct URL', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ documentUid: 42 }));

    const result = await client.updateDocument(42, {
      documentType: 'SALES_INVOICE',
      documentNumber: 'INV-002',
    });

    expect(result.documentUid).toBe(42);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/documents/42');
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
  });

  it('falls back to input documentUid when response is missing it', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    const result = await client.updateDocument(99, {});

    expect(result.documentUid).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// deleteDocument
// ---------------------------------------------------------------------------
describe('deleteDocument', () => {
  it('sends DELETE to correct URL', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await client.deleteDocument(42);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/documents/42');
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// listDeletedDocuments
// ---------------------------------------------------------------------------
describe('listDeletedDocuments', () => {
  it('returns parsed deleted documents result', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        totalCount: 1,
        records: [{ documentUid: 10, deletedAt: '2025-01-01' }],
      })
    );

    const result = await client.listDeletedDocuments({ deletedSinceFilter: '2025-01-01' });

    expect(result.totalCount).toBe(1);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].documentUid).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// getDocumentById
// ---------------------------------------------------------------------------
describe('getDocumentById', () => {
  it('returns document from response top-level', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ documentUid: 42, documentNumber: 'INV-001' })
    );

    const result = await client.getDocumentById(42);

    expect(result.documentUid).toBe(42);
    expect(result.documentNumber).toBe('INV-001');
  });

  it('returns document from meta_data field when present', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        meta_data: { documentUid: 42, documentNumber: 'META-001' },
      })
    );

    const result = await client.getDocumentById(42);

    expect(result.documentUid).toBe(42);
    expect(result.documentNumber).toBe('META-001');
  });
});

// ---------------------------------------------------------------------------
// downloadDocumentFile
// ---------------------------------------------------------------------------
describe('downloadDocumentFile', () => {
  it('returns base64 encoded binary file', async () => {
    const client = createClient();
    const binaryContent = Buffer.from('fake-pdf-content');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="invoice.pdf"',
      }),
      arrayBuffer: async () => binaryContent.buffer.slice(binaryContent.byteOffset, binaryContent.byteOffset + binaryContent.byteLength),
    });

    const result = await client.downloadDocumentFile(42);

    expect(result.contentType).toBe('application/pdf');
    expect(result.fileName).toBe('invoice.pdf');
    expect(result.contentBase64).toBe(binaryContent.toString('base64'));
  });

  it('extracts JSON-embedded fileContent when content-type is application/json', async () => {
    const client = createClient();
    const jsonBody = JSON.stringify({
      fileContent: 'YmFzZTY0ZGF0YQ==',
      fileName: 'doc.pdf',
      contentType: 'application/pdf',
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => new TextEncoder().encode(jsonBody).buffer,
    });

    const result = await client.downloadDocumentFile(42);

    expect(result.contentBase64).toBe('YmFzZTY0ZGF0YQ==');
    expect(result.fileName).toBe('doc.pdf');
    expect(result.contentType).toBe('application/pdf');
  });

  it('parses filename from content-disposition with UTF-8 encoding', async () => {
    const client = createClient();
    const binaryContent = Buffer.from('data');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-disposition': "attachment; filename*=UTF-8''Rechnung%202025.pdf",
      }),
      arrayBuffer: async () => binaryContent.buffer.slice(binaryContent.byteOffset, binaryContent.byteOffset + binaryContent.byteLength),
    });

    const result = await client.downloadDocumentFile(42);

    expect(result.fileName).toBe('Rechnung 2025.pdf');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
describe('error handling', () => {
  it('throws GetMyInvoicesApiError on non-OK responses', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      fakeResponse('Unauthorized', 401)
    );

    await expect(client.getAccount()).rejects.toBeInstanceOf(GetMyInvoicesApiError);
  });

  it('GetMyInvoicesApiError contains status and responseBody', async () => {
    const client = createClient();
    mockFetch.mockResolvedValueOnce(
      fakeResponse('{"error":"invalid_key"}', 403)
    );

    try {
      await client.getAccount();
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(GetMyInvoicesApiError);
      const apiError = error as GetMyInvoicesApiError;
      expect(apiError.status).toBe(403);
      expect(apiError.responseBody).toContain('invalid_key');
    }
  });
});
