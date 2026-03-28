import type { IntegrationContext, IntegrationHandler, DocumentEventInput } from '@invoiceleaf/integration-sdk';
import type { DatevIntegrationConfig, HandlerResult } from '../types.js';
import { toErrorMessage } from './actions.js';
import { isSyncableDocument, syncSingleDocument } from './syncInvoices.js';

export const syncInvoiceEvent: IntegrationHandler<
  DocumentEventInput,
  HandlerResult,
  DatevIntegrationConfig
> = async (
  input,
  context: IntegrationContext<DatevIntegrationConfig>
): Promise<HandlerResult> => {
  if (context.config.enableEventSync === false) {
    return {
      success: true,
      message: 'DATEV event sync is disabled by configuration.',
    };
  }

  const documentId = input?.documentId ?? input?.document?.id;
  if (!documentId) {
    return {
      success: false,
      error: 'Missing documentId in event payload.',
    };
  }

  try {
    const document = await context.data.getDocument(documentId).catch((error) => {
      context.logger.warn('Could not load document for DATEV event sync; skipping.', {
        documentId,
        error: toErrorMessage(error),
      });
      return null;
    });

    if (!document?.id) {
      return {
        success: true,
        message: `Document ${documentId} is no longer available and was skipped.`,
      };
    }

    if (!isSyncableDocument(document, context.config.includeDraftDocuments ?? false, context.config.requireProcessedDocuments ?? false)) {
      return {
        success: true,
        message: `Document ${documentId} is not syncable and was skipped.`,
      };
    }

    let synced: Awaited<ReturnType<typeof syncSingleDocument>>;
    try {
      synced = await syncSingleDocument(context, document);
    } catch (error) {
      const message = toErrorMessage(error);
      context.logger.error('DATEV event sync failed', {
        documentId,
        error: message,
      });

      await context.data
        .patchDocumentIntegrationMeta({
          documentId,
          system: 'datev',
          status: 'failed',
          lastSyncedAt: new Date().toISOString(),
          errorSummary: message.slice(0, 500),
        })
        .catch((metaError) => {
          context.logger.warn('Failed to patch DATEV metadata after event sync error', {
            documentId,
            error: toErrorMessage(metaError),
          });
        });

      return {
        success: false,
        error: message,
      };
    }

    // Ensure metadata is patched on the success path even if syncSingleDocument's
    // own patchDocumentIntegrationMeta call was skipped or failed internally.
    await context.data
      .patchDocumentIntegrationMeta({
        documentId,
        system: 'datev',
        externalId: synced.jobId,
        status: 'synced',
        lastSyncedAt: new Date().toISOString(),
        metadata: {
          clientId: synced.clientId,
          jobId: synced.jobId,
          importType: synced.importType,
          accountingMonth: synced.accountingMonth,
          fileName: synced.fileName,
          datevJobStatus: synced.jobStatus,
        },
      })
      .catch((metaError) => {
        context.logger.warn('Failed to patch DATEV metadata after successful sync', {
          documentId,
          jobId: synced.jobId,
          error: toErrorMessage(metaError),
        });
      });

    return {
      success: true,
      message: `Synced document ${documentId} to DATEV job ${synced.jobId}.`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('DATEV event sync failed unexpectedly', {
      documentId,
      error: message,
    });

    return {
      success: false,
      error: message,
    };
  }
};
