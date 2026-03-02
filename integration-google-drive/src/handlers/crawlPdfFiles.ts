import type { IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import type {
  CrawlResult,
  DrivePdfFile,
  GoogleDriveIntegrationConfig,
} from '../types.js';
import { buildFileStateKey } from '../utils/dedupe.js';
import { GoogleDriveApiError, GoogleDriveClient } from '../googleDrive/client.js';

const SYSTEM = 'google-drive';
const ENTITY_FILE = 'file';
const DEFAULT_MAX_FILES = 100;

interface CrawlInput extends Partial<ScheduleInput> {
  folderId?: string;
  recursive?: boolean;
  maxFilesPerRun?: number;
}

export const crawlPdfFiles: IntegrationHandler<
  CrawlInput,
  CrawlResult,
  GoogleDriveIntegrationConfig
> = async (
  input,
  context: IntegrationContext<GoogleDriveIntegrationConfig>
): Promise<CrawlResult> => {
  const result: CrawlResult = {
    success: true,
    scannedFiles: 0,
    imported: 0,
    duplicates: 0,
    skipped: 0,
    failed: 0,
  };

  const folderId =
    trimToUndefined(input.folderId) ?? trimToUndefined(context.config.rootFolderId) ?? 'root';
  const recursive = input.recursive ?? context.config.recursive ?? false;
  const maxFiles = toBoundedInt(
    input.maxFilesPerRun ?? context.config.maxFilesPerRun,
    DEFAULT_MAX_FILES,
    1,
    1000
  );
  const statePrefix = context.config.stateKeyPrefix || 'google-drive';
  const dedupeTtlSeconds =
    context.config.dedupeTtlSeconds && context.config.dedupeTtlSeconds > 0
      ? context.config.dedupeTtlSeconds
      : 90 * 24 * 60 * 60;

  try {
    const accessToken = await context.credentials.getAccessToken('google-drive');
    const client = new GoogleDriveClient(accessToken);

    context.logger.info('Starting Google Drive PDF import run', {
      folderId,
      recursive,
      maxFiles,
      scheduledTime: input.scheduledTime,
    });

    const files = await client.listPdfFiles(folderId, recursive, maxFiles);
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
    result.error = `Google Drive crawl failed: ${toErrorMessage(error)}`;

    if (error instanceof GoogleDriveApiError) {
      context.logger.error('Google Drive crawl failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
    } else {
      context.logger.error('Google Drive crawl failed', { error: toErrorMessage(error) });
    }
  }

  result.message = `Scanned ${result.scannedFiles} files, imported ${result.imported} PDFs`;
  return result;
};

async function importSingleFile(
  context: IntegrationContext<GoogleDriveIntegrationConfig>,
  client: GoogleDriveClient,
  file: DrivePdfFile,
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
    const downloaded = await client.downloadFile(file.id);
    const importResult = await context.data.importDocument({
      fileName: file.name,
      contentType: file.mimeType || 'application/pdf',
      contentBase64: downloaded.contentBase64,
      source: context.config.importSource || 'google-drive',
      externalRef: `google-drive:file:${file.id}:${file.modifiedTime ?? 'no-modified'}`,
      metadata: {
        driveFileId: file.id,
        webViewLink: file.webViewLink ?? null,
        modifiedTime: file.modifiedTime ?? null,
        md5Checksum: file.md5Checksum ?? null,
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
        modifiedTime: file.modifiedTime ?? null,
      },
    });

    await context.data.patchDocumentIntegrationMeta({
      documentId: importResult.documentId,
      system: SYSTEM,
      externalId: file.id,
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
      metadata: {
        webViewLink: file.webViewLink ?? null,
        modifiedTime: file.modifiedTime ?? null,
        direction: 'inbound',
      },
    });

    await context.state.set(stateKey, importResult.documentId, { ttlSeconds: dedupeTtlSeconds });
    return 'imported';
  } catch (error) {
    context.logger.error('Google Drive file import failed', {
      fileId: file.id,
      fileName: file.name,
      error: toErrorMessage(error),
    });
    return 'failed';
  }
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

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
