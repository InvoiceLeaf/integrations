import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import { toErrorMessage } from '@invoiceleaf/integration-sdk';
import type { HandlerResult, SendEmailInput, SmtpMailConfig } from '../types.js';
import { toAddressList } from '../utils/dedupe.js';

export const sendEmail: IntegrationHandler<SendEmailInput, HandlerResult, SmtpMailConfig> = async (
  input,
  context: IntegrationContext<SmtpMailConfig>
): Promise<HandlerResult> => {
  try {
    if (!input.subject || (!input.text && !input.html)) {
      return {
        success: false,
        error: 'subject and at least one body field (text or html) are required',
      };
    }

    const combinedAttachments = [...(input.attachments || [])];
    const requestedDocumentIds = Array.from(
      new Set([
        ...(input.documentId ? [input.documentId] : []),
        ...((input.documentIds || []).filter(Boolean)),
      ])
    );

    for (const documentId of requestedDocumentIds) {
      const file = await context.data.getDocumentFile(documentId);
      combinedAttachments.push({
        fileName: file.fileName || `document-${documentId}.bin`,
        contentType: file.contentType,
        contentBase64: file.contentBase64,
      });
    }

    const result = await context.email.sendSmtpEmail({
      to: toAddressList(input.to),
      cc: toAddressList(input.cc),
      bcc: toAddressList(input.bcc),
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: combinedAttachments.length > 0 ? combinedAttachments : undefined,
    });

    context.logger.info('SMTP sendEmail succeeded', { messageId: result.messageId });

    return {
      success: true,
      message: 'Email sent successfully',
      details: { messageId: result.messageId },
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('SMTP sendEmail failed', { error: message });
    return {
      success: false,
      error: `Failed to send email: ${message}`,
    };
  }
};
