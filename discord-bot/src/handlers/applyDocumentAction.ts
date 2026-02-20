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
  context.logger.info('Applying Discord component document action', {
    operation: input.operation,
    documentId: input.documentId,
  });

  return {
    success: true,
    transport: 'discord',
    template: 'document_action_result',
    operation: input.operation,
    documentId: input.documentId,
    value: input.value,
  };
};
