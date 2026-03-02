import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { SevdeskIntegrationConfig, HandlerResult } from '../types.js';
import { SevdeskApiError, SevdeskClient } from '../sevdesk/client.js';
import { resolveSevdeskApiKey } from './auth.js';
import { ENTITY_INVOICE, SYSTEM } from './syncInvoices.js';

interface DocumentDeletedInput {
  documentId?: string;
}

export const deleteInvoiceEvent: IntegrationHandler<
  DocumentDeletedInput,
  HandlerResult,
  SevdeskIntegrationConfig
> = async (
  input,
  context: IntegrationContext<SevdeskIntegrationConfig>
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
      entity: ENTITY_INVOICE,
      localId: documentId,
    });

    if (!mapping?.externalId) {
      return {
        success: true,
        message: `No sevDesk mapping exists for deleted document ${documentId}; nothing to cancel.`,
      };
    }

    const apiKey = await resolveSevdeskApiKey(context);
    const client = new SevdeskClient(apiKey, context.config.baseUrl);
    const cancelledInvoice = await client.cancelInvoice(mapping.externalId);

    await context.data.patchDocumentIntegrationMeta({
      documentId,
      system: SYSTEM,
      externalId: mapping.externalId,
      status: 'deleted',
      lastSyncedAt: new Date().toISOString(),
      metadata: {
        sevdeskInvoiceId: mapping.externalId,
        sevdeskStatus: cancelledInvoice.status ?? 'cancelled',
      },
    });

    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_INVOICE,
      localId: documentId,
      externalId: mapping.externalId,
      metadata: {
        ...(mapping.metadata ?? {}),
        cancelledAt: new Date().toISOString(),
      },
    });

    return {
      success: true,
      message: `Cancelled sevDesk invoice ${mapping.externalId} for deleted document ${documentId}.`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('sevDesk delete event sync failed', {
      documentId,
      error: message,
    });
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
