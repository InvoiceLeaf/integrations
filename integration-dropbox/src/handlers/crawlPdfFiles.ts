import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import { toBoundedInt, toErrorMessage } from '@invoiceleaf/integration-sdk';
import type { CrawlResult, DropboxIntegrationConfig, DropboxPdfFile } from '../types.js';
import { buildFileStateKey } from '../utils/dedupe.js';
import { DropboxApiError, DropboxClient } from '../dropbox/client.js';

const SYSTEM = 'dropbox';
const ENTITY_FILE = 'file';
const DEFAULT_MAX_FILES = 100;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

interface CrawlInput extends Partial<ScheduleInput> {
  path?: string;
  recursive?: boolean;
  maxFilesPerRun?: number;
}

export const crawlPdfFiles: IntegrationHandler<CrawlInput, CrawlResult, DropboxIntegrationConfig> = async (
  input,
  context: IntegrationContext<DropboxIntegrationConfig>
): Promise<CrawlResult> => {
  const result: CrawlResult = {
    success: true,
    scannedFiles: 0,
    imported: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
  };

  const path = normalizePath(input.path ?? context.config.rootPath ?? '');
  const recursive = input.recursive ?? context.config.recursive ?? false;
  const maxFiles = toBoundedInt(
    input.maxFilesPerRun ?? context.config.maxFilesPerRun,
    DEFAULT_MAX_FILES,
    1,
    1000
  );
  const statePrefix = context.config.stateKeyPrefix || 'dropbox';
  const dedupeTtlSeconds =
    context.config.dedupeTtlSeconds && context.config.dedupeTtlSeconds > 0
      ? context.config.dedupeTtlSeconds
      : 90 * 24 * 60 * 60;

  try {
    const accessToken = await context.credentials.getAccessToken('dropbox');
    const client = new DropboxClient(accessToken);

    context.logger.info('Starting Dropbox PDF import run', {
      path,
      recursive,
      maxFiles,
      scheduledTime: input.scheduledTime,
    });

    const files = await client.listPdfFiles(path, recursive, maxFiles);
    result.scannedFiles = files.length;

    const errors: string[] = [];
    for (const file of files) {
      const status = await importSingleFile(context, client, file, statePrefix, dedupeTtlSeconds, errors);
      if (status === 'imported') {
        result.imported += 1;
      } else if (status === 'duplicate') {
        result.duplicates += 1;
      } else if (status === 'skipped') {
        result.skipped += 1;
      } else {
        result.failed += 1;
      }
    }
    if (errors.length > 0) {
      result.errors = errors;
    }
  } catch (error) {
    result.success = false;
    result.error = `Dropbox crawl failed: ${toErrorMessage(error)}`;

    if (error instanceof DropboxApiError) {
      context.logger.error('Dropbox crawl failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
    } else {
      context.logger.error('Dropbox crawl failed', { error: toErrorMessage(error) });
    }
  }

  result.message = `Scanned ${result.scannedFiles} files, imported ${result.imported} PDFs`;
  return result;
};

async function importSingleFile(
  context: IntegrationContext<DropboxIntegrationConfig>,
  client: DropboxClient,
  file: DropboxPdfFile,
  statePrefix: string,
  dedupeTtlSeconds: number,
  errors: string[]
): Promise<'imported' | 'duplicate' | 'skipped' | 'failed'> {
  const stateKey = buildFileStateKey(statePrefix, file);
  try {
    const stateValue = await context.state.get(stateKey);
    if (stateValue) {
      return 'duplicate';
    }
  } catch (stateError) {
    context.logger.warn('Could not check dedup state; proceeding with import to avoid data loss.', {
      stateKey,
      error: toErrorMessage(stateError),
    });
  }

  // Claim the state key immediately after the check to minimize the race window.
  // Without this, the mappings lookup below would widen the gap between check and claim,
  // allowing concurrent crawls to both pass the state check for the same file.
  await context.state.set(stateKey, 'pending', { ttlSeconds: dedupeTtlSeconds });

  const existingByExternal = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_FILE,
    externalId: file.id,
  });
  if (existingByExternal?.externalId) {
    await context.state.set(stateKey, existingByExternal.localId, { ttlSeconds: dedupeTtlSeconds });
    return 'duplicate';
  }

  const downloadPath = file.pathLower || file.pathDisplay;
  if (!downloadPath) {
    context.logger.warn('Skipping Dropbox file with no pathLower or pathDisplay', {
      fileId: file.id,
      name: file.name,
    });
    await clearStateOrFallback(context, stateKey, `dropbox:${file.id}:no-path`, errors);
    return 'skipped';
  }

  try {
    const downloaded = await client.downloadFile(downloadPath);

    const estimatedSizeBytes = Math.ceil(downloaded.contentBase64.length * 3 / 4);
    if (estimatedSizeBytes > MAX_FILE_SIZE_BYTES) {
      context.logger.warn('Skipping oversized Dropbox file', {
        fileId: file.id,
        pathDisplay: file.pathDisplay,
        estimatedSizeBytes,
        maxSizeBytes: MAX_FILE_SIZE_BYTES,
      });
      await clearStateOrFallback(context, stateKey, `dropbox:${file.id}:oversized`, errors);
      return 'skipped';
    }

    const importResult = await context.data.importDocument({
      fileName: file.name,
      contentType: 'application/pdf',
      contentBase64: downloaded.contentBase64,
      source: context.config.importSource || 'dropbox',
      externalRef: `dropbox:file:${file.id}:${file.rev ?? 'no-rev'}`,
    });

    if (importResult.duplicate) {
      await context.state.set(stateKey, importResult.documentId, { ttlSeconds: dedupeTtlSeconds });
      return 'duplicate';
    }

    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_FILE,
      localId: importResult.documentId,
      externalId: file.id,
      metadata: {
        pathDisplay: file.pathDisplay,
        rev: file.rev ?? null,
      },
    });

    await context.data.patchDocumentIntegrationMeta({
      documentId: importResult.documentId,
      system: SYSTEM,
      externalId: file.id,
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
      metadata: {
        pathDisplay: file.pathDisplay,
        rev: file.rev ?? null,
        direction: 'inbound',
      },
    });

    await context.state.set(stateKey, importResult.documentId, { ttlSeconds: dedupeTtlSeconds });
    return 'imported';
  } catch (error) {
    context.logger.error('Dropbox file import failed', {
      fileId: file.id,
      pathDisplay: file.pathDisplay,
      error: toErrorMessage(error),
    });
    await clearStateOrFallback(context, stateKey, `dropbox:${file.id}:import-failed`, errors);
    return 'failed';
  }
}

async function clearStateOrFallback(
  context: IntegrationContext<DropboxIntegrationConfig>,
  stateKey: string,
  fileRef: string,
  errors: string[]
): Promise<void> {
  try {
    await context.state.delete(stateKey);
  } catch (deleteError) {
    context.logger.warn('Failed to delete state key; attempting short TTL fallback', {
      stateKey,
      error: toErrorMessage(deleteError),
    });
    try {
      await context.state.set(stateKey, 'failed', { ttlSeconds: 300 });
    } catch (setError) {
      context.logger.error('State key permanently locked — delete and TTL fallback both failed', {
        stateKey,
        error: toErrorMessage(setError),
      });
      errors.push(`${fileRef}: state key "${stateKey}" locked — manual cleanup required`);
    }
  }
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed === '/') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

