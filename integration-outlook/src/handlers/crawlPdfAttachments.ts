import { createHash } from 'node:crypto';
import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { CrawlResult, OutlookAttachment, OutlookConfig } from '../types.js';
import { buildAttachmentStateKey } from '../utils/dedupe.js';
import { OutlookApiError, OutlookClient } from '../outlook/client.js';

function getPrefix(config: OutlookConfig): string {
  return config.stateKeyPrefix || 'outlook';
}

function getDedupeTtlSeconds(config: OutlookConfig): number {
  return config.dedupeTtlSeconds && config.dedupeTtlSeconds > 0
    ? config.dedupeTtlSeconds
    : 90 * 24 * 60 * 60;
}

function getImportSource(config: OutlookConfig): string {
  return config.importSource || 'outlook';
}

async function importAttachment(
  context: IntegrationContext<OutlookConfig>,
  attachment: OutlookAttachment,
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
      externalRef: `${attachment.messageId}:${attachment.attachmentId}:${attachment.checksum}`,
      metadata: {
        messageId: attachment.messageId,
        attachmentId: attachment.attachmentId,
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
      messageId: attachment.messageId,
      attachmentId: attachment.attachmentId,
      fileName: attachment.fileName,
      error: toErrorMessage(error),
    });
    return 'failed';
  }
}

export const crawlPdfAttachments: IntegrationHandler<ScheduleInput, CrawlResult, OutlookConfig> = async (
  input,
  context: IntegrationContext<OutlookConfig>
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
  const folderId = context.config.folderId || 'inbox';
  const lookbackDays =
    context.config.lookbackDays && context.config.lookbackDays > 0
      ? Math.min(365, Math.floor(context.config.lookbackDays))
      : 30;

  try {
    const accessToken = await context.credentials.getAccessToken('outlook');
    const client = new OutlookClient(accessToken);

    context.logger.info('Starting Outlook crawl run', {
      scheduledTime: input.scheduledTime,
      maxMessages,
      maxAttachments,
      folderId,
      lookbackDays,
    });

    const messages = await client.listMessages({
      folderId,
      maxResults: maxMessages,
      lookbackDays,
      onlyUnread: context.config.onlyUnread,
    });

    result.scannedMessages = messages.length;

    if (messages.length === 0) {
      result.skipped = 0;
      result.message = 'No Outlook messages matched the query.';
      return result;
    }

    for (const message of messages) {
      const attachments = await client.getPdfAttachments(message.id, maxAttachments);
      result.scannedAttachments += attachments.length;

      if (attachments.length === 0) {
        result.skipped += 1;
        continue;
      }

      for (const attachment of attachments) {
        const contentBase64 = attachment.contentBytes;
        const checksum = createHash('sha256').update(contentBase64).digest('hex');

        const importItem: OutlookAttachment = {
          messageId: message.id,
          attachmentId: attachment.id,
          fileName: attachment.name,
          contentType: attachment.contentType || 'application/pdf',
          contentBase64,
          checksum,
          subject: message.subject,
          from: message.from,
          date: message.receivedDateTime,
        };

        const stateKey = buildAttachmentStateKey(statePrefix, importItem);
        const status = await importAttachment(context, importItem, stateKey, dedupeTtlSeconds);

        if (status === 'imported') {
          result.imported += 1;
        } else if (status === 'duplicate') {
          result.duplicates += 1;
        } else {
          result.failed += 1;
        }

        await context.state.set(`${statePrefix}:lastProcessedMessageId`, message.id, {
          ttlSeconds: dedupeTtlSeconds,
        });
      }
    }
  } catch (error) {
    result.success = false;
    result.error = `Crawl failed: ${toErrorMessage(error)}`;

    if (error instanceof OutlookApiError) {
      context.logger.error('Outlook crawl failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
    } else {
      context.logger.error('Outlook crawl failed', { error: toErrorMessage(error) });
    }
  }

  result.message = `Scanned ${result.scannedMessages} messages, imported ${result.imported} PDFs`;
  return result;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
