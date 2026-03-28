import type { IntegrationContext, IntegrationHandler, UserActionInput } from '@invoiceleaf/integration-sdk';
import { toErrorMessage } from '@invoiceleaf/integration-sdk';
import type { HandlerResult, SmtpMailConfig } from '../types.js';

export const testConnection: IntegrationHandler<UserActionInput, HandlerResult, SmtpMailConfig> = async (
  _input,
  context: IntegrationContext<SmtpMailConfig>
): Promise<HandlerResult> => {
  try {
    const result = await context.email.testSmtpImapConnection({
      imapFolder: context.config.imapFolder || 'INBOX',
    });

    if (!result.smtp || !result.imap) {
      const errors: string[] = [];
      if (!result.smtp) errors.push(`SMTP: ${result.smtpError || 'connection failed'}`);
      if (!result.imap) errors.push(`IMAP: ${result.imapError || 'connection failed'}`);
      const detail = errors.join('; ');
      context.logger.error('Connection test failed', { smtpOk: result.smtp, imapOk: result.imap, detail });
      return {
        success: false,
        error: `Connection test failed: ${detail}`,
      };
    }

    return {
      success: true,
      message: 'SMTP and IMAP connections are valid',
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('Connection test failed', { error: message });
    return {
      success: false,
      error: `Connection test failed: ${message}`,
    };
  }
};
