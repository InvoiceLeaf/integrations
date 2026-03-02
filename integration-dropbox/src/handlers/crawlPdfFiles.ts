import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type { CrawlResult, DropboxIntegrationConfig, DropboxPdfFile } from '../types.js';
import { buildFileStateKey } from '../utils/dedupe.js';
import { DropboxApiError, DropboxClient } from '../dropbox/client.js';

const SYSTEM = 'dropbox';
const ENTITY_FILE = 'file';
const DEFAULT_MAX_FILES = 100;

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

    for (const file of files) {
      const status = await importSingleFile(context, client, file, statePrefix, dedupeTtlSeconds);
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
  dedupeTtlSeconds: number
): Promise<'imported' | 'duplicate' | 'skipped' | 'failed'> {
  const stateKey = buildFileStateKey(statePrefix, file);
  const stateValue = await context.state.get(stateKey);
  if (stateValue) {
    return 'duplicate';
  }

  const existingByExternal = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_FILE,
    externalId: file.id,
  });
  if (existingByExternal?.externalId) {
    await context.state.set(stateKey, existingByExternal.localId, { ttlSeconds: dedupeTtlSeconds });
    return 'duplicate';
  }

  try {
    const downloaded = await client.downloadFile(file.pathLower || file.pathDisplay);
    const importResult = await context.data.importDocument({
      fileName: file.name,
      contentType: 'application/pdf',
      contentBase64: downloaded.contentBase64,
      source: context.config.importSource || 'dropbox',
      externalRef: `dropbox:file:${file.id}:${file.rev ?? 'no-rev'}`,
      metadata: {
        dropboxFileId: file.id,
        pathDisplay: file.pathDisplay,
        rev: file.rev ?? null,
        contentHash: file.contentHash ?? null,
      },
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
    return 'failed';
  }
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed === '/') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function toBoundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value as number);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
