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
  context.logger.info('Applying Telegram callback document action', {
    operation: input.operation,
    documentId: input.documentId,
  });

  return {
    success: true,
    transport: 'telegram',
    template: 'document_action_result',
    operation: input.operation,
    documentId: input.documentId,
    value: input.value,
  };
};
