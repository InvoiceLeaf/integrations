import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { CrawlResult, CrawledPdfAttachment, SmtpMailConfig } from '../types.js';
import { buildAttachmentStateKey } from '../utils/dedupe.js';

function getPrefix(config: SmtpMailConfig): string {
  return config.stateKeyPrefix || 'smtp-mail';
}

function getDedupeTtlSeconds(config: SmtpMailConfig): number {
  return config.dedupeTtlSeconds && config.dedupeTtlSeconds > 0
    ? config.dedupeTtlSeconds
    : 90 * 24 * 60 * 60;
}

function getImportSource(config: SmtpMailConfig): string {
  return config.importSource || 'smtp-mail';
}

async function importAttachment(
  context: IntegrationContext<SmtpMailConfig>,
  attachment: CrawledPdfAttachment,
  stateKey: string,
  ttlSeconds: number
): Promise<'imported' | 'duplicate' | 'failed'> {
  const existing = await context.state.get(stateKey);
  if (existing) {
    return 'duplicate';
  }

  try {
    const result = await context.data.importDocument({
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      contentBase64: attachment.contentBase64,
      source: getImportSource(context.config),
      externalRef: `${attachment.uid}:${attachment.fileName}:${attachment.checksum}`,
      metadata: {
        uid: attachment.uid,
        subject: attachment.subject,
        from: attachment.from,
        date: attachment.date,
      },
    });

    if (result.duplicate) {
      return 'duplicate';
    }

    await context.state.set(stateKey, result.documentId, { ttlSeconds });
    return 'imported';
  } catch (error) {
    context.logger.error('Attachment import failed', {
      uid: attachment.uid,
      fileName: attachment.fileName,
      error: (error as Error).message,
    });
    return 'failed';
  }
}

export const crawlPdfAttachments: IntegrationHandler<ScheduleInput, CrawlResult, SmtpMailConfig> = async (
  input,
  context: IntegrationContext<SmtpMailConfig>
): Promise<CrawlResult> => {
  const result: CrawlResult = {
    success: true,
    scannedMessages: 0,
    scannedAttachments: 0,
    imported: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
  };

  const maxMessages = context.config.maxMessagesPerRun || 100;
  const maxAttachments = context.config.maxAttachmentsPerMessage || 10;
  const statePrefix = getPrefix(context.config);
  const dedupeTtlSeconds = getDedupeTtlSeconds(context.config);

  try {
    context.logger.info('Starting SMTP crawl run', {
      scheduledTime: input.scheduledTime,
      maxMessages,
      maxAttachments,
    });

    const crawl = await context.email.crawlImapPdfAttachments({
      imapHost: context.config.imapHost,
      imapPort: context.config.imapPort,
      imapSecure: context.config.imapSecure,
      imapUsername: context.config.imapUsername,
      imapPassword: context.config.imapPassword,
      imapFolder: context.config.imapFolder || 'INBOX',
      searchFilter: context.config.searchFilter,
      maxMessagesPerRun: maxMessages,
      maxAttachmentsPerMessage: maxAttachments,
      markAsSeen: true,
      moveToFolder: context.config.processedFolder,
    });

    result.scannedMessages = crawl.messages;
    result.scannedAttachments = crawl.attachments;

    if (crawl.items.length === 0) {
      result.skipped = crawl.messages;
    }

    for (const attachment of crawl.items) {
      const stateKey = buildAttachmentStateKey(statePrefix, attachment);
      const status = await importAttachment(context, attachment, stateKey, dedupeTtlSeconds);

      if (status === 'imported') {
        result.imported += 1;
      } else if (status === 'duplicate') {
        result.duplicates += 1;
      } else {
        result.failed += 1;
      }

      await context.state.set(`${statePrefix}:lastProcessedUid`, attachment.uid, {
        ttlSeconds: dedupeTtlSeconds,
      });
    }
  } catch (error) {
    result.success = false;
    result.error = `Crawl failed: ${(error as Error).message}`;
    context.logger.error('SMTP crawl failed', { error: (error as Error).message });
  }

  result.message = `Scanned ${result.scannedMessages} messages, imported ${result.imported} PDFs`;
  return result;
};
