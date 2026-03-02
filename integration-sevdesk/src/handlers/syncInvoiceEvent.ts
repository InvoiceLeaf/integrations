import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { SevdeskIntegrationConfig, HandlerResult } from '../types.js';
import type { SevdeskContact } from '../sevdesk/client.js';
import { SevdeskApiError, SevdeskClient } from '../sevdesk/client.js';
import { resolveSevdeskApiKey } from './auth.js';
import {
  SYSTEM,
  isSyncableDocument,
  resolveRuntimeDefaults,
  syncSingleDocument,
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
  SevdeskIntegrationConfig
> = async (
  input,
  context: IntegrationContext<SevdeskIntegrationConfig>
): Promise<HandlerResult> => {
  const documentId = input?.documentId ?? input?.document?.id;
  if (!documentId) {
    return {
      success: false,
      error: 'Missing documentId in event payload.',
    };
  }

  try {
    const apiKey = await resolveSevdeskApiKey(context);
    const client = new SevdeskClient(apiKey, context.config.baseUrl);
    const runtimeDefaults = await resolveRuntimeDefaults(context, client);
    const contactCache = new Map<string, SevdeskContact>();
    const document = await context.data.getDocument(documentId);

    if (!isSyncableDocument(document, context.config.includeDraftDocuments ?? false)) {
      return {
        success: true,
        message: `Document ${documentId} is not syncable and was skipped.`,
      };
    }

    const syncedInvoice = await syncSingleDocument(
      context,
      client,
      document,
      runtimeDefaults,
      contactCache
    );

    await context.data.patchDocumentIntegrationMeta({
      documentId: document.id,
      system: SYSTEM,
      externalId: syncedInvoice.id,
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
      metadata: {
        sevdeskInvoiceId: syncedInvoice.id,
        invoiceNumber: syncedInvoice.invoiceNumber,
        sevdeskStatus: syncedInvoice.status,
      },
    });

    return {
      success: true,
      message: `Synced document ${documentId} to sevDesk.`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('sevDesk event sync failed', {
      documentId,
      error: message,
    });

    try {
      await context.data.patchDocumentIntegrationMeta({
        documentId,
        system: SYSTEM,
        status: 'failed',
        lastSyncedAt: new Date().toISOString(),
        errorSummary: message.slice(0, 500),
      });
    } catch (metaError) {
      context.logger.warn('Failed to patch sync metadata after sevDesk event sync error', {
        documentId,
        error: toErrorMessage(metaError),
      });
    }

    return {
      success: false,
      error: message,
    };
  }
};

function toErrorMessage(error: unknown): string {
  if (error instanceof SevdeskApiError) {
    const body = error.responseBody ? ` ${error.responseBody}` : '';
    return `sevDesk API ${error.status}:${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
