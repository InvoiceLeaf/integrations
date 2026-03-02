import { createHash } from 'node:crypto';
import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { CrawlResult, GmailAttachment, GmailConfig } from '../types.js';
import { buildAttachmentStateKey } from '../utils/dedupe.js';
import { GmailApiError, GmailClient } from '../gmail/client.js';

function getPrefix(config: GmailConfig): string {
  return config.stateKeyPrefix || 'gmail';
}

function getDedupeTtlSeconds(config: GmailConfig): number {
  return config.dedupeTtlSeconds && config.dedupeTtlSeconds > 0
    ? config.dedupeTtlSeconds
    : 90 * 24 * 60 * 60;
}

function getImportSource(config: GmailConfig): string {
  return config.importSource || 'gmail';
}

async function importAttachment(
  context: IntegrationContext<GmailConfig>,
  attachment: GmailAttachment,
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

export const crawlPdfAttachments: IntegrationHandler<ScheduleInput, CrawlResult, GmailConfig> = async (
  input,
  context: IntegrationContext<GmailConfig>
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
  const query = context.config.query || 'has:attachment filename:pdf newer_than:30d';

  try {
    const accessToken = await context.credentials.getAccessToken('gmail');
    const client = new GmailClient(accessToken);

    context.logger.info('Starting Gmail crawl run', {
      scheduledTime: input.scheduledTime,
      maxMessages,
      maxAttachments,
      query,
    });

    const messages = await client.listMessages({
      query,
      maxResults: maxMessages,
      includeSpamTrash: context.config.includeSpamTrash,
    });

    result.scannedMessages = messages.length;

    if (messages.length === 0) {
      result.skipped = 0;
      result.message = 'No Gmail messages matched the query.';
      return result;
    }

    for (const message of messages) {
      const detail = await client.getMessage(message.id);
      const attachments = await client.extractPdfAttachments(detail, maxAttachments);

      result.scannedAttachments += attachments.length;
      if (attachments.length === 0) {
        result.skipped += 1;
        continue;
      }

      for (const attachment of attachments) {
        const payload = await client.getAttachment(detail.id, attachment.attachmentId);
        const contentBase64 = toBase64(payload.data);
        const checksum = createHash('sha256').update(contentBase64).digest('hex');

        const importItem: GmailAttachment = {
          messageId: detail.id,
          attachmentId: attachment.attachmentId,
          fileName: attachment.fileName,
          contentType: attachment.mimeType,
          contentBase64,
          checksum,
          subject: detail.subject,
          from: detail.from,
          date: detail.date,
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

        await context.state.set(`${statePrefix}:lastProcessedMessageId`, detail.id, {
          ttlSeconds: dedupeTtlSeconds,
        });
      }
    }
  } catch (error) {
    result.success = false;
    result.error = `Crawl failed: ${toErrorMessage(error)}`;

    if (error instanceof GmailApiError) {
      context.logger.error('Gmail crawl failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
    } else {
      context.logger.error('Gmail crawl failed', { error: toErrorMessage(error) });
    }
  }

  result.message = `Scanned ${result.scannedMessages} messages, imported ${result.imported} PDFs`;
  return result;
};

function toBase64(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  const padded = remainder === 0 ? normalized : `${normalized}${'='.repeat(4 - remainder)}`;
  return Buffer.from(padded, 'base64').toString('base64');
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
