import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { HandlerResult, SmtpMailConfig } from '../types.js';

export const testConnection: IntegrationHandler<unknown, HandlerResult, SmtpMailConfig> = async (
  _input,
  context: IntegrationContext<SmtpMailConfig>
): Promise<HandlerResult> => {
  try {
    await context.email.testSmtpImapConnection({
      smtpHost: context.config.smtpHost,
      smtpPort: context.config.smtpPort,
      smtpSecure: context.config.smtpSecure,
      smtpUsername: context.config.smtpUsername,
      smtpPassword: context.config.smtpPassword,
      imapHost: context.config.imapHost,
      imapPort: context.config.imapPort,
      imapSecure: context.config.imapSecure,
      imapUsername: context.config.imapUsername,
      imapPassword: context.config.imapPassword,
      imapFolder: context.config.imapFolder || 'INBOX',
    });

    return {
      success: true,
      message: 'SMTP and IMAP connections are valid',
    };
  } catch (error) {
    context.logger.error('Connection test failed', { error: (error as Error).message });
    return {
      success: false,
      error: `Connection test failed: ${(error as Error).message}`,
    };
  }
};
