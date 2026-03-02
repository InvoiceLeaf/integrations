import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  GoogleDriveIntegrationConfig,
  ListDirectoriesInput,
  ListDirectoriesResult,
} from '../types.js';
import { GoogleDriveApiError, GoogleDriveClient } from '../googleDrive/client.js';

const DEFAULT_LIMIT = 200;

export const listDirectories: IntegrationHandler<
  ListDirectoriesInput,
  ListDirectoriesResult,
  GoogleDriveIntegrationConfig
> = async (
  input,
  context: IntegrationContext<GoogleDriveIntegrationConfig>
): Promise<ListDirectoriesResult> => {
  const folderId = trimToUndefined(input?.folderId) ?? trimToUndefined(context.config.rootFolderId) ?? 'root';
  const recursive = input?.recursive ?? false;
  const limit = toBoundedInt(input?.limit, DEFAULT_LIMIT, 1, 2000);

  try {
    const accessToken = await context.credentials.getAccessToken('google-drive');
    const client = new GoogleDriveClient(accessToken);
    const directories = await client.listDirectories(folderId, recursive, limit);

    return {
      success: true,
      message: `Found ${directories.length} director${directories.length === 1 ? 'y' : 'ies'}.`,
      folderId,
      count: directories.length,
      directories,
    };
  } catch (error) {
    if (error instanceof GoogleDriveApiError) {
      context.logger.error('Google Drive list directories failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
    } else {
      context.logger.error('Google Drive list directories failed', { error: toErrorMessage(error) });
    }

    return {
      success: false,
      folderId,
      count: 0,
      directories: [],
      error: toErrorMessage(error),
    };
  }
};

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
