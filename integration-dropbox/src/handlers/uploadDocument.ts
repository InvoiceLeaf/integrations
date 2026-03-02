import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  DropboxIntegrationConfig,
  UploadDocumentInput,
  UploadDocumentResult,
} from '../types.js';
import { DropboxApiError, DropboxClient } from '../dropbox/client.js';

const SYSTEM = 'dropbox';
const ENTITY_UPLOAD = 'uploaded-file';

export const uploadDocument: IntegrationHandler<
  UploadDocumentInput,
  UploadDocumentResult,
  DropboxIntegrationConfig
> = async (
  input,
  context: IntegrationContext<DropboxIntegrationConfig>
): Promise<UploadDocumentResult> => {
  const documentId = input?.documentId;
  if (!documentId) {
    return {
      success: false,
      documentId: '',
      error: 'documentId is required.',
    };
  }

  try {
    const accessToken = await context.credentials.getAccessToken('dropbox');
    const client = new DropboxClient(accessToken);

    const file = await context.data.getDocumentFile(documentId);
    const fallbackName = `document-${documentId}.pdf`;
    const fileName = trimToUndefined(input.fileName) ?? trimToUndefined(file.fileName) ?? fallbackName;

    const targetFolder = normalizePath(
      input.targetPath ?? context.config.uploadTargetPath ?? '/InvoiceLeaf'
    );
    const targetPath = joinDropboxPath(targetFolder, fileName);

    const uploaded = await client.uploadFile({
      path: targetPath,
      contentBase64: file.contentBase64,
      overwrite: input.overwrite,
    });

    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_UPLOAD,
      localId: documentId,
      externalId: uploaded.id,
      metadata: {
        pathDisplay: uploaded.pathDisplay ?? targetPath,
        rev: uploaded.rev ?? null,
      },
    });

    await context.data.patchDocumentIntegrationMeta({
      documentId,
      system: SYSTEM,
      externalId: uploaded.id,
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
      metadata: {
        uploadPath: uploaded.pathDisplay ?? targetPath,
        rev: uploaded.rev ?? null,
      },
    });

    return {
      success: true,
      documentId,
      dropboxFileId: uploaded.id,
      pathDisplay: uploaded.pathDisplay ?? targetPath,
      message: `Uploaded document ${documentId} to Dropbox.`,
    };
  } catch (error) {
    if (error instanceof DropboxApiError) {
      context.logger.error('Dropbox upload failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
        documentId,
      });
    } else {
      context.logger.error('Dropbox upload failed', {
        documentId,
        error: toErrorMessage(error),
      });
    }

    return {
      success: false,
      documentId,
      error: toErrorMessage(error),
    };
  }
};

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed === '/') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function joinDropboxPath(folder: string, fileName: string): string {
  const normalizedFile = fileName.replace(/\//g, '-');
  if (!folder) {
    return `/${normalizedFile}`;
  }
  return `${folder}/${normalizedFile}`.replace(/\/+/g, '/');
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
