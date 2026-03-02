import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  DropboxIntegrationConfig,
  ListDirectoriesInput,
  ListDirectoriesResult,
} from '../types.js';
import { DropboxApiError, DropboxClient } from '../dropbox/client.js';

const DEFAULT_LIMIT = 200;

export const listDirectories: IntegrationHandler<
  ListDirectoriesInput,
  ListDirectoriesResult,
  DropboxIntegrationConfig
> = async (
  input,
  context: IntegrationContext<DropboxIntegrationConfig>
): Promise<ListDirectoriesResult> => {
  const path = normalizePath(input?.path ?? context.config.rootPath ?? '');
  const recursive = input?.recursive ?? false;
  const limit = toBoundedInt(input?.limit, DEFAULT_LIMIT, 1, 2000);

  try {
    const accessToken = await context.credentials.getAccessToken('dropbox');
    const client = new DropboxClient(accessToken);
    const directories = await client.listDirectories(path, recursive, limit);

    return {
      success: true,
      message: `Found ${directories.length} director${directories.length === 1 ? 'y' : 'ies'}.`,
      path,
      count: directories.length,
      directories,
    };
  } catch (error) {
    if (error instanceof DropboxApiError) {
      context.logger.error('Dropbox list directories failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
    } else {
      context.logger.error('Dropbox list directories failed', { error: toErrorMessage(error) });
    }

    return {
      success: false,
      path,
      count: 0,
      directories: [],
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
