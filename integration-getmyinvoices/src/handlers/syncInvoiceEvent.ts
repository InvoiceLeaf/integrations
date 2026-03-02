import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { GetMyInvoicesIntegrationConfig, HandlerResult } from '../types.js';
import { GetMyInvoicesApiError, GetMyInvoicesClient } from '../getmyinvoices/client.js';
import { resolveGetMyInvoicesApiKey } from './auth.js';
import {
  isSyncableDocument,
  resolveRuntimeDefaults,
  syncSingleDocument,
  SYSTEM,
} from './syncInvoices.js';

interface DocumentEventInput {
  documentId?: string;
  document?: {
    id?: string;
  };
}

export const syncInvoiceEvent: IntegrationHandler<
  DocumentEventInput,
  HandlerResult,
  GetMyInvoicesIntegrationConfig
> = async (
  input,
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>
): Promise<HandlerResult> => {
  const documentId = input?.documentId ?? input?.document?.id;
  if (!documentId) {
    return {
      success: false,
      error: 'Missing documentId in event payload.',
    };
  }

  try {
    const apiKey = await resolveGetMyInvoicesApiKey(context);
    const client = new GetMyInvoicesClient({
      apiKey,
      baseUrl: context.config.baseUrl,
      applicationHeader: context.config.applicationHeader,
      userAgent: context.config.userAgent,
    });

    const runtimeDefaults = resolveRuntimeDefaults(context);
    const companyCache = {
      byKey: new Map(),
      byNormalizedName: new Map(),
      loaded: false,
    };
    const countryCache = {
      byName: new Map(),
      byCode: new Map(),
      loaded: false,
    };

    const document = await context.data.getDocument(documentId).catch((error) => {
      context.logger.warn('Could not load document for GetMyInvoices event sync; skipping event sync.', {
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

    if (!isSyncableDocument(document, context.config.includeDraftDocuments ?? false)) {
      return {
        success: true,
        message: `Document ${documentId} is not syncable and was skipped.`,
      };
    }

    const synced = await syncSingleDocument(
      context,
      client,
      document,
      runtimeDefaults,
      companyCache,
      countryCache
    );

    try {
      await context.data.patchDocumentIntegrationMeta({
        documentId: document.id,
        system: SYSTEM,
        externalId: synced.id,
        status: 'synced',
        lastSyncedAt: new Date().toISOString(),
        metadata: {
          getmyinvoicesDocumentUid: synced.id,
          documentNumber: synced.documentNumber,
          direction: 'outbound',
        },
      });
    } catch (metaError) {
      context.logger.warn(
        'Could not patch GetMyInvoices sync metadata after successful event sync.',
        {
          documentId: document.id,
          error: toErrorMessage(metaError),
        }
      );
    }

    return {
      success: true,
      message: `Synced document ${documentId} to GetMyInvoices.`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('GetMyInvoices event sync failed', {
      documentId,
      error: message,
    });

    void context.data
      .patchDocumentIntegrationMeta({
        documentId,
        system: SYSTEM,
        status: 'failed',
        lastSyncedAt: new Date().toISOString(),
        errorSummary: message.slice(0, 500),
      })
      .catch((metaError) => {
        context.logger.warn(
          'Failed to patch sync metadata after GetMyInvoices event sync error',
          {
            documentId,
            error: toErrorMessage(metaError),
          }
        );
      });

    return {
      success: false,
      error: message,
    };
  }
};

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
