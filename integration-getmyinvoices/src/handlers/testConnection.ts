import type { IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { GetMyInvoicesIntegrationConfig, TestConnectionResult } from '../types.js';
import { GetMyInvoicesApiError, GetMyInvoicesClient } from '../getmyinvoices/client.js';
import { resolveGetMyInvoicesApiKey } from './auth.js';

export const testConnection: IntegrationHandler<
  unknown,
  TestConnectionResult,
  GetMyInvoicesIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>
): Promise<TestConnectionResult> => {
  try {
    const apiKey = await resolveGetMyInvoicesApiKey(context);
    const client = new GetMyInvoicesClient({
      apiKey,
      baseUrl: context.config.baseUrl,
      applicationHeader: context.config.applicationHeader,
      userAgent: context.config.userAgent,
    });

    const [account, documents] = await Promise.all([
      client.getAccount(),
      client.listDocuments({ perPage: 1, pageNumber: 1 }),
    ]);

    return {
      success: true,
      connected: true,
      message: `GetMyInvoices API key is valid. Found ${documents.totalCount} document(s).`,
      accountId: account.accountId,
      email: account.email,
      organization: account.organization,
      apiKeyType: account.apiKeyType,
    };
  } catch (error) {
    if (error instanceof GetMyInvoicesApiError) {
      context.logger.error('GetMyInvoices connection test failed with API error', {
        status: error.status,
        responseBody: error.responseBody,
      });
      return {
        success: false,
        connected: false,
        error: `GetMyInvoices API error (${error.status}): ${truncate(error.responseBody)}`,
      };
    }

    context.logger.error('GetMyInvoices connection test failed', {
      error: toErrorMessage(error),
    });
    return {
      success: false,
      connected: false,
      error: `Connection test failed: ${toErrorMessage(error)}`,
    };
  }
};

function truncate(value: string): string {
  return value.length > 280 ? `${value.slice(0, 277)}...` : value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
