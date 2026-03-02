import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import type { SevdeskIntegrationConfig } from '../types.js';

const SYSTEM = 'sevdesk';

export async function resolveSevdeskApiKey(
  context: IntegrationContext<SevdeskIntegrationConfig>
): Promise<string> {
  try {
    const apiKey = await context.credentials.getApiKey(SYSTEM);
    const trimmed = trimToUndefined(apiKey);
    if (trimmed) {
      return trimmed;
    }
  } catch (error) {
    context.logger.warn('Could not read sevDesk external credentials, falling back to config apiKey.', {
      error: toErrorMessage(error),
    });
  }

  const configApiKey = trimToUndefined(context.config.apiKey);
  if (configApiKey) {
    return configApiKey;
  }

  throw new Error(
    'sevDesk API key is missing. Connect sevDesk in the Connections tab or set config.apiKey in integration settings.'
  );
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
