import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
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

    const result = await context.email.sendSmtpEmail({
      smtpHost: context.config.smtpHost,
      smtpPort: context.config.smtpPort,
      smtpSecure: context.config.smtpSecure,
      smtpUsername: context.config.smtpUsername,
      smtpPassword: context.config.smtpPassword,
      fromAddress: context.config.fromAddress,
      to: toAddressList(input.to),
      cc: toAddressList(input.cc),
      bcc: toAddressList(input.bcc),
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    });

    context.logger.info('SMTP sendEmail succeeded', { messageId: result.messageId });

    return {
      success: true,
      message: 'Email sent successfully',
      details: { messageId: result.messageId },
    };
  } catch (error) {
    context.logger.error('SMTP sendEmail failed', { error: (error as Error).message });
    return {
      success: false,
      error: `Failed to send email: ${(error as Error).message}`,
    };
  }
};
