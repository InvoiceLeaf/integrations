import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import { DatevApiError } from '../datev/client.js';
import type { DatevIntegrationConfig, HandlerResult } from '../types.js';
import { buildRuntime, requireClientId, toErrorMessage } from './actions.js';
import { ENTITY_DXSO_JOB, SYSTEM } from './syncInvoices.js';

interface DocumentDeletedInput {
  documentId?: string;
}

export const deleteDocumentEvent: IntegrationHandler<
  DocumentDeletedInput,
  HandlerResult,
  DatevIntegrationConfig
> = async (
  input,
  context: IntegrationContext<DatevIntegrationConfig>
): Promise<HandlerResult> => {
  const documentId = input?.documentId;
  if (!documentId) {
    return {
      success: false,
      error: 'Missing documentId in deletion event payload.',
    };
  }

  if (!context.config.cancelOnDeleteEvent) {
    return {
      success: true,
      message: `DATEV cancel-on-delete is disabled; document ${documentId} event skipped.`,
    };
  }

  try {
    const mapping = await context.mappings.get({
      system: SYSTEM,
      entity: ENTITY_DXSO_JOB,
      localId: documentId,
    });

    if (!mapping?.externalId) {
      return {
        success: true,
        message: `No DATEV job mapping exists for deleted document ${documentId}; nothing to cancel.`,
      };
    }

    const runtime = await buildRuntime(context);
    const clientIdFromMapping =
      typeof mapping.metadata?.clientId === 'string' ? mapping.metadata.clientId : undefined;
    const clientId = requireClientId(clientIdFromMapping, context.config.defaultClientId);

    try {
      await runtime.client.cancelDxsoJob(clientId, mapping.externalId);
    } catch (error) {
      if (error instanceof DatevApiError && (error.status === 400 || error.status === 404)) {
        context.logger.info('DATEV delete event cancellation was not possible; treating as already finalized.', {
          documentId,
          jobId: mapping.externalId,
          status: error.status,
        });
      } else {
        throw error;
      }
    }

    await context.data.patchDocumentIntegrationMeta({
      documentId,
      system: SYSTEM,
      externalId: mapping.externalId,
      status: 'deleted',
      lastSyncedAt: new Date().toISOString(),
      metadata: {
        ...(mapping.metadata ?? {}),
        cancellationRequestedAt: new Date().toISOString(),
      },
    });

    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_DXSO_JOB,
      localId: documentId,
      externalId: mapping.externalId,
      metadata: {
        ...(mapping.metadata ?? {}),
        deletedAt: new Date().toISOString(),
      },
    });

    return {
      success: true,
      message: `Handled DATEV delete event for document ${documentId} and mapped job ${mapping.externalId}.`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('DATEV delete event sync failed', {
      documentId,
      error: message,
    });

    return {
      success: false,
      error: message,
    };
  }
};
