import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  GetMyInvoicesInboundSyncState,
  GetMyInvoicesIntegrationConfig,
  InboundSyncResult,
  SyncFailure,
} from '../types.js';
import type {
  GetMyInvoicesDeletedDocument,
  GetMyInvoicesDocument,
} from '../getmyinvoices/client.js';
import { GetMyInvoicesApiError, GetMyInvoicesClient } from '../getmyinvoices/client.js';
import { resolveGetMyInvoicesApiKey } from './auth.js';
import {
  ENTITY_DOCUMENT,
  INBOUND_SYNC_STATE_KEY,
  SYSTEM,
} from './syncInvoices.js';

const DEFAULT_INBOUND_LOOKBACK_HOURS = 24;
const DEFAULT_INBOUND_PAGE_SIZE = 50;
const DEFAULT_INBOUND_MAX_DOCUMENTS_PER_RUN = 100;
const MAX_REPORTED_FAILURES = 25;

export const pullDocumentsFromGetmyinvoices: IntegrationHandler<
  unknown,
  InboundSyncResult,
  GetMyInvoicesIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>
): Promise<InboundSyncResult> => {
  const startedAt = new Date().toISOString();
  const failures: SyncFailure[] = [];

  const resultBase: Omit<
    InboundSyncResult,
    'success' | 'message' | 'error' | 'checkpointUpdated'
  > = {
    startedAt,
    completedAt: startedAt,
    fromDate: startedAt,
    processed: 0,
    imported: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    failures,
  };

  if (context.config.enableInboundSync === false) {
    return {
      ...resultBase,
      completedAt: new Date().toISOString(),
      success: true,
      checkpointUpdated: false,
      message: 'Inbound GetMyInvoices sync is disabled in config.',
    };
  }

  const lookbackHours = toBoundedInt(
    context.config.inboundInitialSyncLookbackHours,
    DEFAULT_INBOUND_LOOKBACK_HOURS,
    1,
    24 * 30
  );
  const pageSize = toBoundedInt(context.config.inboundPageSize, DEFAULT_INBOUND_PAGE_SIZE, 1, 500);
  const maxDocumentsPerRun = toBoundedInt(
    context.config.inboundMaxDocumentsPerRun,
    DEFAULT_INBOUND_MAX_DOCUMENTS_PER_RUN,
    1,
    1000
  );

  const fallbackFromDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  try {
    let fromDate = fallbackFromDate;
    try {
      const inboundState = await context.state.get<GetMyInvoicesInboundSyncState>(
        INBOUND_SYNC_STATE_KEY
      );
      fromDate = inboundState?.lastInboundSyncAt ?? fallbackFromDate;
    } catch (stateError) {
      context.logger.warn(
        'Could not read GetMyInvoices inbound sync checkpoint. Using fallback lookback window.',
        {
          key: INBOUND_SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        }
      );
    }
    resultBase.fromDate = fromDate;

    const apiKey = await resolveGetMyInvoicesApiKey(context);
    const client = new GetMyInvoicesClient({
      apiKey,
      baseUrl: context.config.baseUrl,
      applicationHeader: context.config.applicationHeader,
      userAgent: context.config.userAgent,
    });

    const fromDateFilter = toDateTimeFilter(fromDate);

    let pageNumber = 1;
    let hasMore = true;
    while (hasMore && resultBase.processed < maxDocumentsPerRun) {
      const listed = await client.listDocuments({
        updatedOrNewSinceFilter: fromDateFilter,
        perPage: Math.min(pageSize, maxDocumentsPerRun - resultBase.processed),
        pageNumber,
        loadLineItems: false,
        archivedFilter: context.config.inboundIncludeArchived === false ? 0 : 1,
      });

      if (listed.records.length === 0) {
        hasMore = false;
        continue;
      }

      for (const remoteDocument of listed.records) {
        if (resultBase.processed >= maxDocumentsPerRun) {
          break;
        }

        resultBase.processed += 1;

        try {
          const outcome = await importOrUpdateDocument(context, client, remoteDocument);
          if (outcome === 'imported') {
            resultBase.imported += 1;
          } else if (outcome === 'updated') {
            resultBase.updated += 1;
          } else {
            resultBase.skipped += 1;
          }
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          const docUid = toOptionalInt(remoteDocument.documentUid);

          if (failures.length < MAX_REPORTED_FAILURES) {
            failures.push({
              documentId: docUid ? String(docUid) : 'unknown',
              error: message,
            });
          }

          context.logger.error('Failed to import/update GetMyInvoices document', {
            documentUid: docUid,
            error: message,
          });
        }
      }

      const maxPages = listed.maxPages > 0 ? listed.maxPages : 1;
      hasMore = pageNumber < maxPages;
      pageNumber += 1;
    }

    if (context.config.inboundIncludeDeleted !== false) {
      let deletedPageNumber = 1;
      let deletedHasMore = true;
      while (deletedHasMore) {
        const deleted = await client.listDeletedDocuments({
          deletedSinceFilter: fromDateFilter,
          perPage: pageSize,
          pageNumber: deletedPageNumber,
        });

        if (deleted.records.length === 0) {
          deletedHasMore = false;
          continue;
        }

        for (const deletedRecord of deleted.records) {
          try {
            const outcome = await reconcileDeletedDocument(context, deletedRecord);
            if (outcome === 'updated') {
              resultBase.deleted += 1;
            } else {
              resultBase.skipped += 1;
            }
          } catch (error) {
            resultBase.failed += 1;
            const message = toErrorMessage(error);
            const docUid = toOptionalInt(deletedRecord.documentUid);

            if (failures.length < MAX_REPORTED_FAILURES) {
              failures.push({
                documentId: docUid ? String(docUid) : 'unknown',
                error: message,
              });
            }

            context.logger.error('Failed to reconcile deleted GetMyInvoices document', {
              documentUid: docUid,
              error: message,
            });
          }
        }

        deletedHasMore = deleted.records.length >= pageSize;
        deletedPageNumber += 1;
      }
    }

    const completedAt = new Date().toISOString();
    let checkpointUpdated = false;
    if (resultBase.failed === 0) {
      try {
        await context.state.set<GetMyInvoicesInboundSyncState>(INBOUND_SYNC_STATE_KEY, {
          lastInboundSyncAt: completedAt,
        });
        checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist GetMyInvoices inbound sync checkpoint.', {
          key: INBOUND_SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        });
      }
    }

    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      checkpointUpdated,
      message:
        resultBase.failed === 0
          ? `Imported ${resultBase.imported}, updated ${resultBase.updated}, marked ${resultBase.deleted} deleted.`
          : `Inbound sync completed with ${resultBase.failed} failure(s).`,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = toErrorMessage(error);
    context.logger.error('GetMyInvoices inbound sync failed', { error: message });

    return {
      ...resultBase,
      completedAt,
      success: false,
      error: message,
      checkpointUpdated: false,
    };
  }
};

async function importOrUpdateDocument(
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>,
  client: GetMyInvoicesClient,
  remoteDocument: GetMyInvoicesDocument
): Promise<'imported' | 'updated' | 'skipped'> {
  const documentUid = toOptionalInt(remoteDocument.documentUid);
  if (!documentUid) {
    return 'skipped';
  }

  const externalId = String(documentUid);
  const existing = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_DOCUMENT,
    externalId,
  });

  if (existing?.localId) {
    await context.data.patchDocumentIntegrationMeta({
      documentId: existing.localId,
      system: SYSTEM,
      externalId,
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
      metadata: {
        getmyinvoicesDocumentUid: externalId,
        documentNumber: trimToUndefined(remoteDocument.documentNumber) ?? null,
        paymentStatus: trimToUndefined(remoteDocument.paymentStatus) ?? null,
        direction: 'inbound',
      },
    });

    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_DOCUMENT,
      localId: existing.localId,
      externalId,
      metadata: {
        ...(existing.metadata ?? {}),
        direction: 'inbound',
        documentNumber: trimToUndefined(remoteDocument.documentNumber) ?? null,
        paymentStatus: trimToUndefined(remoteDocument.paymentStatus) ?? null,
      },
    });

    return 'updated';
  }

  const file = await client.downloadDocumentFile(documentUid);
  const fileName =
    trimToUndefined(file.fileName) ??
    trimToUndefined(remoteDocument.filename) ??
    `getmyinvoices-${documentUid}.pdf`;
  const contentType = trimToUndefined(file.contentType) ?? inferContentTypeFromFileName(fileName);

  const importResult = await context.data.importDocument({
    fileName,
    contentType,
    contentBase64: file.contentBase64,
    source: 'getmyinvoices',
    description: `Imported from GetMyInvoices document ${trimToUndefined(remoteDocument.documentNumber) ?? externalId}`,
    externalRef: `getmyinvoices:document:${externalId}`,
    metadata: {
      getmyinvoicesDocumentUid: externalId,
      documentNumber: trimToUndefined(remoteDocument.documentNumber) ?? null,
      paymentStatus: trimToUndefined(remoteDocument.paymentStatus) ?? null,
      direction: 'inbound',
      importedBy: 'integration-getmyinvoices',
    },
  });

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_DOCUMENT,
    localId: importResult.documentId,
    externalId,
    metadata: {
      direction: 'inbound',
      documentNumber: trimToUndefined(remoteDocument.documentNumber) ?? null,
      duplicate: importResult.duplicate,
    },
  });

  await context.data.patchDocumentIntegrationMeta({
    documentId: importResult.documentId,
    system: SYSTEM,
    externalId,
    status: 'synced',
    lastSyncedAt: new Date().toISOString(),
    metadata: {
      getmyinvoicesDocumentUid: externalId,
      documentNumber: trimToUndefined(remoteDocument.documentNumber) ?? null,
      direction: 'inbound',
      duplicate: importResult.duplicate,
    },
  });

  return 'imported';
}

async function reconcileDeletedDocument(
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>,
  deletedRecord: GetMyInvoicesDeletedDocument
): Promise<'updated' | 'skipped'> {
  const documentUid = toOptionalInt(deletedRecord.documentUid);
  if (!documentUid) {
    return 'skipped';
  }

  const externalId = String(documentUid);
  const existing = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_DOCUMENT,
    externalId,
  });

  if (!existing?.localId) {
    return 'skipped';
  }

  await context.data.patchDocumentIntegrationMeta({
    documentId: existing.localId,
    system: SYSTEM,
    externalId,
    status: 'deleted',
    lastSyncedAt: new Date().toISOString(),
    metadata: {
      getmyinvoicesDocumentUid: externalId,
      deletedAt: trimToUndefined(deletedRecord.deletedAt) ?? new Date().toISOString(),
      direction: 'inbound',
    },
  });

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_DOCUMENT,
    localId: existing.localId,
    externalId,
    metadata: {
      ...(existing.metadata ?? {}),
      direction: 'inbound',
      inboundDeletedAt: trimToUndefined(deletedRecord.deletedAt) ?? new Date().toISOString(),
    },
  });

  return 'updated';
}

function toDateTimeFilter(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return formatDateTime(new Date());
  }
  return formatDateTime(date);
}

function formatDateTime(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hour = String(value.getUTCHours()).padStart(2, '0');
  const minute = String(value.getUTCMinutes()).padStart(2, '0');
  const second = String(value.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function inferContentTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  if (lower.endsWith('.xml')) {
    return 'application/xml';
  }
  if (lower.endsWith('.eml')) {
    return 'message/rfc822';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  return 'application/octet-stream';
}

function toBoundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value as number);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function toOptionalInt(value: number | string | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof GetMyInvoicesApiError) {
    const body = error.responseBody ? ` ${error.responseBody}` : '';
    return `GetMyInvoices API ${error.status}:${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
