import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import { toErrorMessage } from '@invoiceleaf/integration-sdk';
import type { CrawlResult, CrawledPdfAttachment, SmtpMailConfig } from '../types.js';
import { buildAttachmentStateKey } from '../utils/dedupe.js';

function getPrefix(config: Partial<SmtpMailConfig>): string {
  return config.stateKeyPrefix || 'smtp-mail';
}

function getDedupeTtlSeconds(config: Partial<SmtpMailConfig>): number {
  return config.dedupeTtlSeconds && config.dedupeTtlSeconds > 0
    ? config.dedupeTtlSeconds
    : 90 * 24 * 60 * 60;
}

function getImportSource(config: Partial<SmtpMailConfig>): string {
  return config.importSource || 'smtp-mail';
}

/**
 * Sentinel value written to state before the actual import starts.
 * This closes the TOCTOU window between state.get and state.set: a concurrent
 * run will see the sentinel and treat the attachment as a duplicate instead of
 * importing it a second time.
 */
const DEDUP_CLAIM_SENTINEL = '__importing__';

async function importAttachment(
  context: IntegrationContext<SmtpMailConfig>,
  attachment: CrawledPdfAttachment,
  stateKey: string,
  ttlSeconds: number
): Promise<'imported' | 'duplicate' | 'failed'> {
  // ---- 1. Check remote dedup state ----
  try {
    const existing = await context.state.get(stateKey);
    if (existing) {
      return 'duplicate';
    }
  } catch (stateError) {
    context.logger.warn('Could not check dedup state; proceeding with import to avoid data loss.', {
      stateKey,
      error: toErrorMessage(stateError),
    });
  }

  // ---- 2. Claim the key with a sentinel to close the TOCTOU race window ----
  // A short TTL (5 min) ensures the sentinel is cleaned up if the import
  // crashes before writing the real document ID.
  try {
    await context.state.set(stateKey, DEDUP_CLAIM_SENTINEL, { ttlSeconds: 300 });
  } catch (claimError) {
    context.logger.warn('Could not claim dedup key; proceeding with import.', {
      stateKey,
      error: toErrorMessage(claimError),
    });
  }

  // ---- 3. Import the document ----
  try {
    const result = await context.data.importDocument({
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      contentBase64: attachment.contentBase64,
      source: getImportSource(context.config),
      externalRef: `${attachment.uid}:${attachment.fileName}:${attachment.checksum}`,
    });

    if (result.duplicate) {
      return 'duplicate';
    }

    // ---- 4. Replace sentinel with real document ID (full TTL) ----
    await context.state.set(stateKey, result.documentId, { ttlSeconds });
    return 'imported';
  } catch (error) {
    // Import failed — remove the sentinel so a future retry can re-attempt
    try {
      await context.state.delete(stateKey);
    } catch {
      // best-effort cleanup
    }
    context.logger.error('Attachment import failed', {
      uid: attachment.uid,
      fileName: attachment.fileName,
      error: toErrorMessage(error),
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

  // In-memory set to prevent intra-run duplicates when the same checksum
  // appears multiple times in a single batch (e.g., forwarded copies).
  const seenInRun = new Set<string>();

  try {
    context.logger.info('Starting SMTP crawl run', {
      scheduledTime: input.scheduledTime,
      maxMessages,
      maxAttachments,
    });

    const crawl = await context.email.crawlImapPdfAttachments({
      imapFolder: context.config.imapFolder || 'INBOX',
      searchFilter: context.config.searchFilter,
      maxMessagesPerRun: maxMessages,
      maxAttachmentsPerMessage: maxAttachments,
      markAsSeen: true,
      moveToFolder: context.config.processedFolder,
    });

    result.scannedMessages = crawl.messages;
    result.scannedAttachments = crawl.attachments;

    // UIDs are unique per IMAP message; multiple attachments from the same
    // message share one UID.  The Set counts distinct messages that yielded at
    // least one PDF.  "skipped" = messages with no PDF attachments.
    const messagesWithPdfs = new Set(crawl.items.map((item) => item.uid));
    result.skipped = crawl.messages - messagesWithPdfs.size;

    for (const attachment of crawl.items) {
      const stateKey = buildAttachmentStateKey(statePrefix, attachment);

      // Fast intra-run dedup: skip if we already processed this exact key
      if (seenInRun.has(stateKey)) {
        result.duplicates += 1;
        continue;
      }
      seenInRun.add(stateKey);

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
    const errorMessage = toErrorMessage(error);
    result.error = `Crawl failed: ${errorMessage}`;
    context.logger.error('SMTP crawl failed', { error: errorMessage });
  }

  result.message = `Scanned ${result.scannedMessages} messages, imported ${result.imported} PDFs`;
  return result;
};
