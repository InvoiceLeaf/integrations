import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { DatevIntegrationConfig, HandlerResult } from '../types.js';
import { toErrorMessage } from './actions.js';
import { isSyncableDocument, syncSingleDocument } from './syncInvoices.js';

interface DocumentEventInput {
  documentId?: string;
  document?: {
    id?: string;
  };
}

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

    if (!isSyncableDocument(document, context.config.includeDraftDocuments ?? false, context.config.requireProcessedDocuments ?? true)) {
      return {
        success: true,
        message: `Document ${documentId} is not syncable and was skipped.`,
      };
    }

    const synced = await syncSingleDocument(context, document);
    return {
      success: true,
      message: `Synced document ${documentId} to DATEV job ${synced.jobId}.`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('DATEV event sync failed', {
      documentId,
      error: message,
    });

    void context.data
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
};
