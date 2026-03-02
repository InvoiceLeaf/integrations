import type { Document, IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  SyncFailure,
  SyncInvoicesResult,
  ZohoIntegrationConfig,
  ZohoSyncState,
} from '../types.js';
import { ZohoBooksApiError, ZohoBooksClient } from '../zoho/client.js';

const SYSTEM = 'zoho-books';
const ENTITY_INVOICE = 'invoice';
const ENTITY_CUSTOMER = 'contact';
const SYNC_STATE_KEY = 'zoho-books:lastSuccessfulSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_DOCUMENTS_PER_RUN = 100;
const MAX_REPORTED_FAILURES = 25;

export const syncInvoices: IntegrationHandler<unknown, SyncInvoicesResult, ZohoIntegrationConfig> = async (
  _input,
  context: IntegrationContext<ZohoIntegrationConfig>
): Promise<SyncInvoicesResult> => {
  const startedAt = new Date().toISOString();
  const failures: SyncFailure[] = [];

  const lookbackHours = toBoundedInt(
    context.config.initialSyncLookbackHours,
    DEFAULT_LOOKBACK_HOURS,
    1,
    24 * 30
  );
  const pageSize = toBoundedInt(context.config.pageSize, DEFAULT_PAGE_SIZE, 1, 200);
  const maxDocumentsPerRun = toBoundedInt(
    context.config.maxDocumentsPerRun,
    DEFAULT_MAX_DOCUMENTS_PER_RUN,
    1,
    1000
  );

  const fallbackFromDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const resultBase: Omit<
    SyncInvoicesResult,
    'success' | 'message' | 'error' | 'organizationId' | 'checkpointUpdated'
  > = {
    startedAt,
    completedAt: startedAt,
    fromDate: fallbackFromDate,
    processed: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    failures,
  };

  try {
    const connectionInfo = await context.credentials.getConnectionInfo(SYSTEM);
    if (!connectionInfo.connected) {
      return {
        ...resultBase,
        success: false,
        error: 'Zoho Books is not connected. Complete OAuth authorization first.',
        organizationId: '',
        checkpointUpdated: false,
      };
    }

    const syncState = await context.state.get<ZohoSyncState>(SYNC_STATE_KEY);
    const fromDate = syncState?.lastSuccessfulSyncAt ?? fallbackFromDate;
    resultBase.fromDate = fromDate;

    const accessToken = await context.credentials.getAccessToken(SYSTEM);
    const client = new ZohoBooksClient(accessToken, context.config.apiBaseUrl);

    const organizations = await client.listOrganizations();
    const organization = selectOrganization(organizations, context.config.organizationId);
    const organizationId = organization.organization_id;

    let cachedItemId = trimToUndefined(context.config.defaultItemId);
    if (!cachedItemId) {
      cachedItemId = await client.findDefaultItemId(organizationId);
    }

    let page = 1;
    let hasMore = true;

    while (hasMore && resultBase.processed < maxDocumentsPerRun) {
      const pageResult = await context.data.listDocuments({
        fromDate,
        page,
        size: Math.min(pageSize, maxDocumentsPerRun - resultBase.processed),
      });

      if (pageResult.items.length === 0) {
        hasMore = false;
        continue;
      }

      for (const document of pageResult.items) {
        if (resultBase.processed >= maxDocumentsPerRun) {
          break;
        }

        resultBase.processed += 1;

        if (!isSyncableDocument(document, context.config.includeDraftDocuments ?? false)) {
          resultBase.skipped += 1;
          continue;
        }

        if (document.accountingType === 'PAYABLE' && context.config.syncPayables !== true) {
          resultBase.skipped += 1;
          continue;
        }

        try {
          const existingMapping = await context.mappings.get({
            system: SYSTEM,
            entity: ENTITY_INVOICE,
            localId: document.id,
          });

          const invoiceNumber = buildInvoiceNumber(document, context.config.invoiceNumberPrefix);
          let externalId = trimToUndefined(existingMapping?.externalId);

          if (!externalId && invoiceNumber) {
            const existingInvoice = await client.findInvoiceByNumber(organizationId, invoiceNumber);
            externalId = existingInvoice?.invoice_id;
          }

          if (!externalId) {
            if (!cachedItemId) {
              throw new Error('No Zoho item found. Set defaultItemId in integration config.');
            }

            const customerId = await resolveCustomerId(context, client, organizationId, document);
            const created = await client.createInvoice(organizationId, {
              customer_id: customerId,
              date: toDateOnly(document.invoiceDate) ?? toDateOnlyFromTimestamp(document.created),
              due_date: toDateOnly(document.dueDate),
              invoice_number: invoiceNumber,
              reference_number: `InvoiceLeaf:${document.id}`,
              line_items: buildLineItems(document, cachedItemId),
            });

            externalId = created.invoice_id;
          }

          await context.mappings.upsert({
            system: SYSTEM,
            entity: ENTITY_INVOICE,
            localId: document.id,
            externalId,
            metadata: {
              organizationId,
              invoiceNumber: invoiceNumber ?? null,
            },
          });

          await context.data.patchDocumentIntegrationMeta({
            documentId: document.id,
            system: SYSTEM,
            externalId,
            status: 'synced',
            lastSyncedAt: new Date().toISOString(),
            metadata: {
              organizationId,
              invoiceNumber: invoiceNumber ?? null,
            },
          });

          resultBase.synced += 1;
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          context.logger.error('Failed to sync document to Zoho Books', {
            documentId: document.id,
            error: message,
          });

          if (failures.length < MAX_REPORTED_FAILURES) {
            failures.push({
              documentId: document.id,
              error: message,
            });
          }

          try {
            await context.data.patchDocumentIntegrationMeta({
              documentId: document.id,
              system: SYSTEM,
              status: 'failed',
              lastSyncedAt: new Date().toISOString(),
              errorSummary: message.slice(0, 500),
            });
          } catch (metaError) {
            context.logger.warn('Failed to patch document sync metadata after Zoho sync error', {
              documentId: document.id,
              error: toErrorMessage(metaError),
            });
          }
        }
      }

      hasMore = pageResult.hasMore;
      page += 1;
    }

    const completedAt = new Date().toISOString();
    let checkpointUpdated = false;
    if (resultBase.failed === 0) {
      await context.state.set<ZohoSyncState>(SYNC_STATE_KEY, {
        lastSuccessfulSyncAt: completedAt,
      });
      checkpointUpdated = true;
    }

    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      message:
        resultBase.failed === 0
          ? `Synced ${resultBase.synced} document(s) to Zoho Books.`
          : `Synced ${resultBase.synced} document(s) with ${resultBase.failed} failure(s).`,
      organizationId,
      checkpointUpdated,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = toErrorMessage(error);
    context.logger.error('Zoho Books scheduled sync failed', { error: message });

    return {
      ...resultBase,
      completedAt,
      success: false,
      error: message,
      organizationId: '',
      checkpointUpdated: false,
    };
  }
};

async function resolveCustomerId(
  context: IntegrationContext<ZohoIntegrationConfig>,
  client: ZohoBooksClient,
  organizationId: string,
  document: Document
): Promise<string> {
  const company = document.receiver ?? document.supplier;
  const companyId = trimToUndefined(company?.id);

  if (companyId) {
    const mapping = await context.mappings.get({
      system: SYSTEM,
      entity: ENTITY_CUSTOMER,
      localId: companyId,
    });
    if (mapping?.externalId) {
      return mapping.externalId;
    }
  }

  const customerName =
    trimToUndefined(company?.name) ?? context.config.fallbackCustomerName ?? 'InvoiceLeaf Customer';

  let customer = await client.findContactByName(organizationId, customerName);
  if (!customer) {
    customer = await client.createContact(organizationId, {
      contact_name: customerName,
      contact_type: 'customer',
      email: trimToUndefined(company?.email),
    });
  }

  if (companyId) {
    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_CUSTOMER,
      localId: companyId,
      externalId: customer.contact_id,
      metadata: {
        customerName,
      },
    });
  }

  return customer.contact_id;
}

function selectOrganization(
  organizations: Array<{ organization_id: string; name: string }>,
  configuredId?: string
): { organization_id: string; name: string } {
  const preferred = trimToUndefined(configuredId);
  if (preferred) {
    const match = organizations.find((item) => item.organization_id === preferred);
    if (match) {
      return match;
    }
    throw new Error(`Configured Zoho organizationId "${preferred}" is not accessible.`);
  }

  if (organizations.length === 0) {
    throw new Error('No Zoho organizations returned for this account.');
  }

  return organizations[0];
}

function buildLineItems(
  document: Document,
  itemId: string
): Array<{ item_id: string; name?: string; description?: string; quantity: number; rate: number }> {
  const lineItems: Array<{
    item_id: string;
    name?: string;
    description?: string;
    quantity: number;
    rate: number;
  }> = [];

  for (const item of document.lineItems ?? []) {
    const quantity = toFiniteNumber(item.quantity, 1);
    const safeQuantity = quantity === 0 ? 1 : quantity;
    const amount = firstFinite(item.totalAmount, item.netAmount, safeQuantity * toFiniteNumber(item.unitPrice, 0));
    const rate = toFiniteNumber(item.unitPrice, amount / safeQuantity);

    lineItems.push({
      item_id: itemId,
      name: trimToUndefined(item.description) ?? undefined,
      description: trimToUndefined(item.description) ?? defaultLineDescription(document),
      quantity: safeQuantity,
      rate,
    });
  }

  if (lineItems.length > 0) {
    return lineItems;
  }

  const fallbackAmount = firstFinite(document.totalAmount, document.netAmount, document.amountDue, 0);
  return [
    {
      item_id: itemId,
      description: defaultLineDescription(document),
      quantity: 1,
      rate: fallbackAmount,
    },
  ];
}

function buildInvoiceNumber(document: Document, prefix?: string): string | undefined {
  const invoiceId = trimToUndefined(document.invoiceId) ?? document.id;
  const value = `${prefix ?? ''}${invoiceId}`.trim();
  return value.length > 0 ? value.slice(0, 100) : undefined;
}

function defaultLineDescription(document: Document): string {
  return trimToUndefined(document.description) || `Invoice ${document.invoiceId ?? document.id}`;
}

function isSyncableDocument(document: Document, includeDraftDocuments: boolean): boolean {
  if (document.deleted) {
    return false;
  }

  if (document.documentStatus === 'CANCELLED') {
    return false;
  }

  if (document.documentStatus === 'DRAFT' && !includeDraftDocuments) {
    return false;
  }

  return true;
}

function toBoundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
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

function toDateOnly(isoDate: string | undefined): string | undefined {
  if (!isoDate) {
    return undefined;
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function toDateOnlyFromTimestamp(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const date = new Date(value as number);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function toFiniteNumber(value: number | undefined, fallback: number): number {
  if (Number.isFinite(value)) {
    return value as number;
  }
  return fallback;
}

function firstFinite(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value as number;
    }
  }
  return 0;
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ZohoBooksApiError) {
    const body = error.responseBody ? ` ${error.responseBody}` : '';
    return `Zoho API ${error.status}:${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
