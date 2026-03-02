import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { GetMyInvoicesIntegrationConfig, HandlerResult } from '../types.js';
import { GetMyInvoicesApiError, GetMyInvoicesClient } from '../getmyinvoices/client.js';
import { resolveGetMyInvoicesApiKey } from './auth.js';
import { ENTITY_DOCUMENT, SYSTEM } from './syncInvoices.js';

interface DocumentDeletedInput {
  documentId?: string;
}

export const deleteInvoiceEvent: IntegrationHandler<
  DocumentDeletedInput,
  HandlerResult,
  GetMyInvoicesIntegrationConfig
> = async (
  input,
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>
): Promise<HandlerResult> => {
  const documentId = input?.documentId;
  if (!documentId) {
    return {
      success: false,
      error: 'Missing documentId in deletion event payload.',
    };
  }

  try {
    const mapping = await context.mappings.get({
      system: SYSTEM,
      entity: ENTITY_DOCUMENT,
      localId: documentId,
    });

    const externalUid = toOptionalInt(mapping?.externalId);
    if (!externalUid) {
      return {
        success: true,
        message: `No GetMyInvoices mapping exists for deleted document ${documentId}; nothing to delete.`,
      };
    }

    const apiKey = await resolveGetMyInvoicesApiKey(context);
    const client = new GetMyInvoicesClient({
      apiKey,
      baseUrl: context.config.baseUrl,
      applicationHeader: context.config.applicationHeader,
      userAgent: context.config.userAgent,
    });

    await client.deleteDocument(externalUid);

    try {
      await context.data.patchDocumentIntegrationMeta({
        documentId,
        system: SYSTEM,
        externalId: String(externalUid),
        status: 'deleted',
        lastSyncedAt: new Date().toISOString(),
        metadata: {
          getmyinvoicesDocumentUid: String(externalUid),
          direction: 'outbound',
        },
      });
    } catch (metaError) {
      context.logger.warn(
        'Could not patch GetMyInvoices delete metadata after successful deletion.',
        {
          documentId,
          error: toErrorMessage(metaError),
        }
      );
    }

    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_DOCUMENT,
      localId: documentId,
      externalId: String(externalUid),
      metadata: {
        ...(mapping?.metadata ?? {}),
        deletedAt: new Date().toISOString(),
      },
    });

    return {
      success: true,
      message: `Deleted GetMyInvoices document ${externalUid} for InvoiceLeaf document ${documentId}.`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('GetMyInvoices delete event sync failed', {
      documentId,
      error: message,
    });
    return {
      success: false,
      error: message,
    };
  }
};

function toOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return undefined;
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
