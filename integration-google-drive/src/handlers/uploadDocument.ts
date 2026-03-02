import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  GoogleDriveIntegrationConfig,
  UploadDocumentInput,
  UploadDocumentResult,
} from '../types.js';
import { GoogleDriveApiError, GoogleDriveClient } from '../googleDrive/client.js';

const SYSTEM = 'google-drive';
const ENTITY_UPLOAD = 'uploaded-file';

export const uploadDocument: IntegrationHandler<
  UploadDocumentInput,
  UploadDocumentResult,
  GoogleDriveIntegrationConfig
> = async (
  input,
  context: IntegrationContext<GoogleDriveIntegrationConfig>
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
    const accessToken = await context.credentials.getAccessToken('google-drive');
    const client = new GoogleDriveClient(accessToken);

    const file = await context.data.getDocumentFile(documentId);
    const fallbackName = `document-${documentId}.pdf`;
    const fileName = trimToUndefined(input.fileName) ?? trimToUndefined(file.fileName) ?? fallbackName;
    const folderId =
      trimToUndefined(input.targetFolderId) ??
      trimToUndefined(context.config.uploadTargetFolderId) ??
      'root';

    const uploaded = await client.uploadFile({
      folderId,
      fileName,
      contentBase64: file.contentBase64,
      mimeType: file.contentType,
    });

    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_UPLOAD,
      localId: documentId,
      externalId: uploaded.id,
      metadata: {
        folderId,
        webViewLink: uploaded.webViewLink ?? null,
      },
    });

    await context.data.patchDocumentIntegrationMeta({
      documentId,
      system: SYSTEM,
      externalId: uploaded.id,
      status: 'synced',
      lastSyncedAt: new Date().toISOString(),
      metadata: {
        folderId,
        webViewLink: uploaded.webViewLink ?? null,
      },
    });

    return {
      success: true,
      documentId,
      driveFileId: uploaded.id,
      webViewLink: uploaded.webViewLink,
      message: `Uploaded document ${documentId} to Google Drive.`,
    };
  } catch (error) {
    if (error instanceof GoogleDriveApiError) {
      context.logger.error('Google Drive upload failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
        documentId,
      });
    } else {
      context.logger.error('Google Drive upload failed', {
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
