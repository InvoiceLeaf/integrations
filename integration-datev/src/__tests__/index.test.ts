import { describe, it, expect, vi } from 'vitest';

// Stub global fetch since handlers module transitively imports DatevClient
vi.stubGlobal('fetch', vi.fn());

import {
  testConnection,
  discoverAuthEndpoints,
  listEndpointOptions,
  callDatevEndpoint,
  listClients,
  getClient,
  createDxsoJob,
  uploadDxsoJobFile,
  getDxsoJob,
  finalizeDxsoJob,
  cancelDxsoJob,
  listDxsoJobProtocolEntries,
  syncInvoices,
  syncInvoiceEvent,
  deleteDocumentEvent,
} from '../handlers/index.js';

describe('handlers/index re-exports', () => {
  it('exports testConnection', () => {
    expect(testConnection).toBeTypeOf('function');
  });

  it('exports discoverAuthEndpoints', () => {
    expect(discoverAuthEndpoints).toBeTypeOf('function');
  });

  it('exports listEndpointOptions', () => {
    expect(listEndpointOptions).toBeTypeOf('function');
  });

  it('exports callDatevEndpoint', () => {
    expect(callDatevEndpoint).toBeTypeOf('function');
  });

  it('exports listClients', () => {
    expect(listClients).toBeTypeOf('function');
  });

  it('exports getClient', () => {
    expect(getClient).toBeTypeOf('function');
  });

  it('exports createDxsoJob', () => {
    expect(createDxsoJob).toBeTypeOf('function');
  });

  it('exports uploadDxsoJobFile', () => {
    expect(uploadDxsoJobFile).toBeTypeOf('function');
  });

  it('exports getDxsoJob', () => {
    expect(getDxsoJob).toBeTypeOf('function');
  });

  it('exports finalizeDxsoJob', () => {
    expect(finalizeDxsoJob).toBeTypeOf('function');
  });

  it('exports cancelDxsoJob', () => {
    expect(cancelDxsoJob).toBeTypeOf('function');
  });

  it('exports listDxsoJobProtocolEntries', () => {
    expect(listDxsoJobProtocolEntries).toBeTypeOf('function');
  });

  it('exports syncInvoices', () => {
    expect(syncInvoices).toBeTypeOf('function');
  });

  it('exports syncInvoiceEvent', () => {
    expect(syncInvoiceEvent).toBeTypeOf('function');
  });

  it('exports deleteDocumentEvent', () => {
    expect(deleteDocumentEvent).toBeTypeOf('function');
  });
});
