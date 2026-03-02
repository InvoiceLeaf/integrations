import type { Document, IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import { DatevApiError } from '../datev/client.js';
import type {
  DatevImportType,
  DatevIntegrationConfig,
  DatevSyncState,
  SyncFailure,
  SyncInvoicesResult,
} from '../types.js';
import { buildRuntime, requireClientId, toErrorMessage, trimToUndefined } from './actions.js';

export const SYSTEM = 'datev';
export const ENTITY_DXSO_JOB = 'dxso-job';
export const SYNC_STATE_KEY = 'datev:lastSuccessfulSyncAt';

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_DOCUMENTS_PER_RUN = 100;
const MAX_REPORTED_FAILURES = 25;

interface SyncSingleDocumentResult {
  jobId: string;
  clientId: string;
  fileName: string;
  importType: DatevImportType;
  accountingMonth: string;
  jobStatus?: number;
}

export const syncInvoices: IntegrationHandler<unknown, SyncInvoicesResult, DatevIntegrationConfig> = async (
  _input,
  context: IntegrationContext<DatevIntegrationConfig>
): Promise<SyncInvoicesResult> => {
  const startedAt = new Date().toISOString();
  const failures: SyncFailure[] = [];

  const lookbackHours = toBoundedInt(
    context.config.initialSyncLookbackHours,
    DEFAULT_LOOKBACK_HOURS,
    1,
    24 * 30
  );
  const pageSize = toBoundedInt(context.config.pageSize, DEFAULT_PAGE_SIZE, 1, 200);
  const maxDocumentsPerRun = toBoundedInt(
    context.config.maxDocumentsPerRun,
    DEFAULT_MAX_DOCUMENTS_PER_RUN,
    1,
    1000
  );

  const fallbackFromDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const resultBase: Omit<SyncInvoicesResult, 'success' | 'message' | 'error' | 'checkpointUpdated'> = {
    startedAt,
    completedAt: startedAt,
    fromDate: fallbackFromDate,
    processed: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    failures,
  };

  try {
    let fromDate = fallbackFromDate;
    try {
      const state = await context.state.get<DatevSyncState>(SYNC_STATE_KEY);
      fromDate = state?.lastSuccessfulSyncAt ?? fallbackFromDate;
    } catch (stateError) {
      context.logger.warn('Could not read DATEV sync checkpoint; using fallback lookback window.', {
        key: SYNC_STATE_KEY,
        error: toErrorMessage(stateError),
      });
    }
    resultBase.fromDate = fromDate;

    let page = 1;
    let hasMore = true;

    while (hasMore && resultBase.processed < maxDocumentsPerRun) {
      const pageResult = await context.data.listDocuments({
        fromDate,
        page,
        size: Math.min(pageSize, maxDocumentsPerRun - resultBase.processed),
      });

      if (pageResult.items.length === 0) {
        hasMore = false;
        continue;
      }

      for (const document of pageResult.items) {
        if (resultBase.processed >= maxDocumentsPerRun) {
          break;
        }

        resultBase.processed += 1;

        if (!isSyncableDocument(document, context.config.includeDraftDocuments ?? false, context.config.requireProcessedDocuments ?? true)) {
          resultBase.skipped += 1;
          continue;
        }

        try {
          await syncSingleDocument(context, document);
          resultBase.synced += 1;
        } catch (error) {
          resultBase.failed += 1;
          const message = formatSyncError(error);
          context.logger.error('Failed to sync document to DATEV', {
            documentId: document.id,
            error: message,
          });

          if (failures.length < MAX_REPORTED_FAILURES) {
            failures.push({
              documentId: document.id,
              error: message,
            });
          }

          try {
            await context.data.patchDocumentIntegrationMeta({
              documentId: document.id,
              system: SYSTEM,
              status: 'failed',
              lastSyncedAt: new Date().toISOString(),
              errorSummary: message.slice(0, 500),
            });
          } catch (metaError) {
            context.logger.warn('Failed to patch document metadata after DATEV sync error', {
              documentId: document.id,
              error: toErrorMessage(metaError),
            });
          }
        }
      }

      hasMore = pageResult.hasMore;
      page += 1;
    }

    const completedAt = new Date().toISOString();
    let checkpointUpdated = false;
    if (resultBase.failed === 0) {
      try {
        await context.state.set<DatevSyncState>(SYNC_STATE_KEY, {
          lastSuccessfulSyncAt: completedAt,
        });
        checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist DATEV sync checkpoint.', {
          key: SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        });
      }
    }

    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      message:
        resultBase.failed === 0
          ? `Synced ${resultBase.synced} document(s) to DATEV.`
          : `Synced ${resultBase.synced} document(s) with ${resultBase.failed} failure(s).`,
      checkpointUpdated,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = formatSyncError(error);
    context.logger.error('DATEV scheduled sync failed', { error: message });

    return {
      ...resultBase,
      completedAt,
      success: false,
      error: message,
      checkpointUpdated: false,
    };
  }
};

export async function syncSingleDocument(
  context: IntegrationContext<DatevIntegrationConfig>,
  document: Document
): Promise<SyncSingleDocumentResult> {
  const runtime = await buildRuntime(context);
  const clientId = requireClientId(undefined, context.config.defaultClientId);
  const importType = resolveImportType(document, context.config.defaultImportType);
  const accountingMonth =
    trimToUndefined(context.config.defaultAccountingMonth) ?? resolveAccountingMonth(document);

  const file = await context.data.getDocumentFile(document.id);
  if (!trimToUndefined(file.contentBase64)) {
    throw new Error(`Document ${document.id} does not have file content.`);
  }

  const fileName =
    trimToUndefined(file.fileName) ??
    trimToUndefined(document.fileName) ??
    trimToUndefined(document.invoiceId) ??
    `document-${document.id}.bin`;

  const job = await runtime.client.createDxsoJob(clientId, {
    import_type: importType,
    accounting_month: accountingMonth,
  });

  const jobId = trimToUndefined(job.id);
  if (!jobId) {
    throw new Error('DATEV did not return a dxso-job id.');
  }

  await runtime.client.uploadDxsoJobFile({
    clientId,
    jobId,
    fileName,
    fileContent: Buffer.from(file.contentBase64, 'base64'),
    contentType: trimToUndefined(file.contentType) ?? 'application/octet-stream',
  });

  const finalized = await runtime.client.finalizeDxsoJob(clientId, jobId, true);

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_DXSO_JOB,
    localId: document.id,
    externalId: jobId,
    metadata: {
      clientId,
      importType,
      accountingMonth,
      fileName,
      jobStatus: finalized.status ?? null,
      finalizedAt: new Date().toISOString(),
    },
  });

  await context.data.patchDocumentIntegrationMeta({
    documentId: document.id,
    system: SYSTEM,
    externalId: jobId,
    status: 'synced',
    lastSyncedAt: new Date().toISOString(),
    metadata: {
      clientId,
      jobId,
      importType,
      accountingMonth,
      fileName,
      datevJobStatus: finalized.status,
    },
  });

  return {
    jobId,
    clientId,
    importType,
    accountingMonth,
    fileName,
    jobStatus: finalized.status,
  };
}

export function isSyncableDocument(
  document: Document,
  includeDraftDocuments: boolean,
  requireProcessedDocuments: boolean
): boolean {
  if (!document.id || document.deleted || trimToUndefined(document.duplicateOfId)) {
    return false;
  }

  if (!includeDraftDocuments && document.documentStatus === 'DRAFT') {
    return false;
  }

  if (requireProcessedDocuments && document.processed === false) {
    return false;
  }

  return true;
}

function resolveImportType(
  document: Document,
  fallback: DatevImportType | undefined
): DatevImportType {
  if (document.accountingType === 'PAYABLE') {
    return 'accountsPayableLedgerImport';
  }

  if (document.accountingType === 'RECEIVABLE') {
    return 'accountsReceivableLedgerImport';
  }

  return fallback ?? 'accountsReceivableLedgerImport';
}

function resolveAccountingMonth(document: Document): string {
  const sourceDate = trimToUndefined(document.invoiceDate);
  if (sourceDate) {
    const parsed = new Date(sourceDate);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`;
    }
  }

  const created = typeof document.created === 'number' ? new Date(document.created) : new Date();
  const safeDate = Number.isNaN(created.getTime()) ? new Date() : created;
  return `${safeDate.getUTCFullYear()}-${String(safeDate.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatSyncError(error: unknown): string {
  if (error instanceof DatevApiError) {
    const body = trimToUndefined(error.responseBody);
    return body
      ? `DATEV API error (${error.status}): ${truncate(body, 800)}`
      : `DATEV API error (${error.status}).`;
  }

  return toErrorMessage(error);
}

function toBoundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value as number);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
