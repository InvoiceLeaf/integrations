import { defineHandler } from '@invoiceleaf/integration-sdk';

interface DocumentActionInput {
  operation: string;
  documentId: string;
  value?: unknown;
}

export const applyDocumentAction = defineHandler<DocumentActionInput>(async (input, context) => {
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
});
