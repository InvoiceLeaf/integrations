import type { IntegrationHandler, HandlerResult } from '@invoiceleaf/integration-sdk';
import type { TelegramBotConfig } from '../types.js';

interface DocumentActionInput {
  operation: string;
  documentId: string;
  value?: unknown;
}

export const applyDocumentAction: IntegrationHandler<DocumentActionInput, HandlerResult, TelegramBotConfig> = async (input, context) => {
  try {
    if (!input.operation || !input.documentId) {
      context.logger.warn('Missing required fields for document action', { input });
      return { success: false, error: 'Missing required fields: operation and documentId' };
    }

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
  } catch (error) {
    context.logger.error('Failed to apply document action', {
      error: error instanceof Error ? error.message : String(error),
      operation: input?.operation,
      documentId: input?.documentId,
    });
    return { success: false, error: `Handler error: ${error instanceof Error ? error.message : String(error)}` };
  }
};
