import type { Document, IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import { toBoundedInt, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type {
  LexofficeIntegrationConfig,
  LexofficeSyncState,
  SyncFailure,
  SyncInvoicesResult,
} from '../types.js';
import { LexofficeApiError, LexofficeClient } from '../lexoffice/client.js';

const SYSTEM = 'lexoffice';
const ENTITY_FILE = 'file';
const SYNC_STATE_KEY = 'lexoffice:lastSuccessfulSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_DOCUMENTS_PER_RUN = 100;
const MAX_REPORTED_FAILURES = 25;

export const syncInvoices: IntegrationHandler<ScheduleInput, SyncInvoicesResult, LexofficeIntegrationConfig> = async (
  _input,
  context: IntegrationContext<LexofficeIntegrationConfig>
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
    const apiKey = await resolveApiKey(context);
    const client = new LexofficeClient(apiKey, context.config.apiBaseUrl);

    let fromDate = fallbackFromDate;
    try {
      const syncState = await context.state.get<LexofficeSyncState>(SYNC_STATE_KEY);
      const checkpointValue = syncState?.lastSuccessfulSyncAt;
      if (checkpointValue && Number.isFinite(Date.parse(checkpointValue))) {
        fromDate = checkpointValue;
      } else if (checkpointValue) {
        context.logger.warn('Corrupted sync checkpoint value — falling back to lookback window.', {
          key: SYNC_STATE_KEY,
          corruptedValue: checkpointValue,
        });
      }
    } catch (stateError) {
      context.logger.warn('Could not read lexoffice sync checkpoint. Using fallback lookback window.', {
        key: SYNC_STATE_KEY,
        error: stateError instanceof Error ? stateError.message : String(stateError),
      });
    }
    resultBase.fromDate = fromDate;

    let page = 1;
    let hasMore = true;

    while (hasMore && resultBase.processed < maxDocumentsPerRun) {
      const parsedStartDate = Date.parse(fromDate);
      const pageResult = await context.data.listDocuments({
        startDate: Number.isFinite(parsedStartDate) ? parsedStartDate : Date.parse(fallbackFromDate),
        page,
        limit: Math.min(pageSize, maxDocumentsPerRun - resultBase.processed),
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

        if (!isSyncableDocument(document, context.config.includeDraftDocuments ?? false, context.config.requireProcessedDocuments ?? false)) {
          resultBase.skipped += 1;
          continue;
        }

        try {
          const existingMapping = await context.mappings.get({
            system: SYSTEM,
            entity: ENTITY_FILE,
            localId: document.id,
          });

          if (existingMapping?.externalId) {
            resultBase.skipped += 1;
            continue;
          }

          const file = await context.data.getDocumentFile(document.id);
          const fileName =
            trimToUndefined(file.fileName) ??
            buildFallbackFileName(document, context.config.fallbackFileNamePrefix);
          const contentType = trimToUndefined(file.contentType) ?? 'application/pdf';

          const uploaded = await client.uploadVoucherFile({
            fileName,
            contentType,
            contentBase64: file.contentBase64,
          });

          await context.mappings.upsert({
            system: SYSTEM,
            entity: ENTITY_FILE,
            localId: document.id,
            externalId: uploaded.fileId,
            metadata: {
              fileName,
            },
          });

          await context.data.patchDocumentIntegrationMeta({
            documentId: document.id,
            system: SYSTEM,
            externalId: uploaded.fileId,
            status: 'synced',
            lastSyncedAt: new Date().toISOString(),
            metadata: {
              lexofficeFileId: uploaded.fileId,
              fileName,
            },
          });

          resultBase.synced += 1;
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          context.logger.error('Failed to sync document to lexoffice', {
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
            context.logger.warn('Failed to patch document sync metadata after lexoffice sync error', {
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
        await context.state.set<LexofficeSyncState>(SYNC_STATE_KEY, {
          lastSuccessfulSyncAt: completedAt,
        });
        checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist lexoffice sync checkpoint.', {
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
          ? `Synced ${resultBase.synced} document(s) to lexoffice.`
          : `Synced ${resultBase.synced} document(s) with ${resultBase.failed} failure(s).`,
      checkpointUpdated,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = toErrorMessage(error);
    context.logger.error('lexoffice scheduled sync failed', { error: message });

    return {
      ...resultBase,
      completedAt,
      success: false,
      error: message,
      checkpointUpdated: false,
    };
  }
};

async function resolveApiKey(
  context: IntegrationContext<LexofficeIntegrationConfig>
): Promise<string> {
  try {
    const key = trimToUndefined(await context.credentials.getApiKey('lexoffice'));
    if (key) {
      return key;
    }
  } catch (error) {
    context.logger.warn('Failed to resolve lexoffice API key from credentials, falling back to config.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const fallback = trimToUndefined(context.config.apiKey);
  if (fallback) {
    return fallback;
  }

  throw new Error('Missing lexoffice API key.');
}

function buildFallbackFileName(document: Document, prefix?: string): string {
  const safePrefix = trimToUndefined(prefix) ?? 'invoiceleaf';
  const invoice = trimToUndefined(document.invoiceId) ?? document.id;
  return `${safePrefix}-${invoice}.pdf`;
}

function isSyncableDocument(document: Document, includeDraftDocuments: boolean, requireProcessedDocuments: boolean = true): boolean {
  if (!document.id || document.deleted || trimToUndefined(document.duplicateOfId)) {
    return false;
  }

  if (document.documentStatus === 'CANCELLED') {
    return false;
  }

  if (!includeDraftDocuments && document.documentStatus === 'DRAFT') {
    return false;
  }

  if (requireProcessedDocuments && document.processed === false) {
    return false;
  }

  // Skip zero-amount documents — they indicate missing or invalid data
  const amount = document.totalAmount ?? document.netAmount ?? document.amountDue;
  if (amount === 0) {
    return false;
  }

  return true;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof LexofficeApiError) {
    const body = error.responseBody ? ` ${error.responseBody}` : '';
    return `lexoffice API ${error.status}:${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
