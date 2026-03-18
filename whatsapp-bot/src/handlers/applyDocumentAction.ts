import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

interface DocumentActionInput {
  operation: string;
  documentId: string;
  value?: unknown;
}

export const applyDocumentAction = async (
  input: DocumentActionInput,
  context: IntegrationContext
) => {
  try {
    if (!input.operation || !input.documentId) {
      context.logger.warn('Missing required fields for document action', { input });
      return { success: false, error: 'Missing required fields: operation and documentId' };
    }

    context.logger.info('Applying WhatsApp interactive document action', {
      operation: input.operation,
      documentId: input.documentId,
    });

    return {
      success: true,
      transport: 'whatsapp',
      template: 'document_action_result',
      operation: input.operation,
      documentId: input.documentId,
      value: input.value,
    };
  } catch (error) {
    context.logger.error('Failed to apply document action', {
      error: (error as Error).message,
      operation: input?.operation,
      documentId: input?.documentId,
    });
    return { success: false, error: `Handler error: ${(error as Error).message}` };
  }
};
