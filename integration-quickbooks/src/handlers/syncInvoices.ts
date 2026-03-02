import type { Document, IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  QuickBooksIntegrationConfig,
  QuickBooksSyncState,
  SyncFailure,
  SyncInvoicesResult,
} from '../types.js';
import type {
  QuickBooksBillLineInput,
  QuickBooksInvoiceLineInput,
} from '../quickbooks/client.js';
import { QuickBooksApiError, QuickBooksClient } from '../quickbooks/client.js';

const SYSTEM = 'quickbooks';
const ENTITY_INVOICE = 'invoice';
const ENTITY_CUSTOMER = 'customer';
const ENTITY_VENDOR = 'vendor';
const SYNC_STATE_KEY = 'quickbooks:lastSuccessfulSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_DOCUMENTS_PER_RUN = 100;
const MAX_REPORTED_FAILURES = 25;

export const syncInvoices: IntegrationHandler<unknown, SyncInvoicesResult, QuickBooksIntegrationConfig> = async (
  _input,
  context: IntegrationContext<QuickBooksIntegrationConfig>
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
    'success' | 'message' | 'error' | 'realmId' | 'checkpointUpdated'
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
        error: 'QuickBooks is not connected. Complete OAuth authorization first.',
        realmId: '',
        checkpointUpdated: false,
      };
    }

    const realmId =
      trimToUndefined(context.config.realmId) ?? trimToUndefined(connectionInfo.accountId);
    if (!realmId) {
      return {
        ...resultBase,
        success: false,
        error:
          'QuickBooks realmId is missing. Set config.realmId or reconnect so accountId is available.',
        realmId: '',
        checkpointUpdated: false,
      };
    }

    const syncState = await context.state.get<QuickBooksSyncState>(SYNC_STATE_KEY);
    const fromDate = syncState?.lastSuccessfulSyncAt ?? fallbackFromDate;
    resultBase.fromDate = fromDate;

    const accessToken = await context.credentials.getAccessToken(SYSTEM);
    const client = new QuickBooksClient(accessToken, realmId, context.config.apiBaseUrl);

    let cachedSalesItemId = trimToUndefined(context.config.defaultSalesItemId);
    let cachedExpenseAccountId = trimToUndefined(context.config.defaultExpenseAccountId);

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

        try {
          const existingMapping = await context.mappings.get({
            system: SYSTEM,
            entity: ENTITY_INVOICE,
            localId: document.id,
          });

          const docNumber = buildDocumentNumber(document, context.config.invoiceNumberPrefix);
          const accountingType = document.accountingType === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE';

          let externalId = trimToUndefined(existingMapping?.externalId);
          if (!externalId && docNumber) {
            if (accountingType === 'PAYABLE') {
              const existingBill = await client.findBillByDocNumber(docNumber);
              externalId = existingBill?.Id;
            } else {
              const existingInvoice = await client.findInvoiceByDocNumber(docNumber);
              externalId = existingInvoice?.Id;
            }
          }

          if (!externalId) {
            if (accountingType === 'PAYABLE') {
              const vendorId = await resolveVendorId(context, client, document);
              if (!cachedExpenseAccountId) {
                cachedExpenseAccountId = await client.findDefaultExpenseAccountId();
              }
              if (!cachedExpenseAccountId) {
                throw new Error(
                  'No QuickBooks expense account found. Set defaultExpenseAccountId in config.'
                );
              }

              const createdBill = await client.createBill({
                VendorRef: { value: vendorId },
                TxnDate: toDateOnly(document.invoiceDate) ?? toDateOnlyFromTimestamp(document.created),
                DueDate: toDateOnly(document.dueDate),
                DocNumber: docNumber,
                CurrencyRef: trimToUndefined(document.currency?.code)
                  ? { value: document.currency?.code ?? '' }
                  : undefined,
                PrivateNote: `InvoiceLeaf:${document.id}`,
                Line: buildBillLines(document, cachedExpenseAccountId),
              });
              externalId = createdBill.Id;
            } else {
              const customerId = await resolveCustomerId(context, client, document);
              if (!cachedSalesItemId) {
                cachedSalesItemId = await client.findDefaultSalesItemId();
              }
              if (!cachedSalesItemId) {
                throw new Error('No QuickBooks sales item found. Set defaultSalesItemId in config.');
              }

              const createdInvoice = await client.createInvoice({
                CustomerRef: { value: customerId },
                TxnDate: toDateOnly(document.invoiceDate) ?? toDateOnlyFromTimestamp(document.created),
                DueDate: toDateOnly(document.dueDate),
                DocNumber: docNumber,
                CurrencyRef: trimToUndefined(document.currency?.code)
                  ? { value: document.currency?.code ?? '' }
                  : undefined,
                PrivateNote: `InvoiceLeaf:${document.id}`,
                Line: buildInvoiceLines(document, cachedSalesItemId),
              });
              externalId = createdInvoice.Id;
            }
          }

          await context.mappings.upsert({
            system: SYSTEM,
            entity: ENTITY_INVOICE,
            localId: document.id,
            externalId,
            metadata: {
              accountingType,
              documentNumber: docNumber ?? null,
            },
          });

          await context.data.patchDocumentIntegrationMeta({
            documentId: document.id,
            system: SYSTEM,
            externalId,
            status: 'synced',
            lastSyncedAt: new Date().toISOString(),
            metadata: {
              realmId,
              accountingType,
              documentNumber: docNumber ?? null,
            },
          });

          resultBase.synced += 1;
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          context.logger.error('Failed to sync document to QuickBooks', {
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
            context.logger.warn('Failed to patch document sync metadata after QuickBooks error', {
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
      await context.state.set<QuickBooksSyncState>(SYNC_STATE_KEY, {
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
          ? `Synced ${resultBase.synced} document(s) to QuickBooks.`
          : `Synced ${resultBase.synced} document(s) with ${resultBase.failed} failure(s).`,
      realmId,
      checkpointUpdated,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = toErrorMessage(error);
    context.logger.error('QuickBooks scheduled sync failed', { error: message });

    return {
      ...resultBase,
      completedAt,
      success: false,
      error: message,
      realmId: '',
      checkpointUpdated: false,
    };
  }
};

async function resolveCustomerId(
  context: IntegrationContext<QuickBooksIntegrationConfig>,
  client: QuickBooksClient,
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

  const displayName =
    trimToUndefined(company?.name) ?? context.config.fallbackCustomerName ?? 'InvoiceLeaf Customer';

  let customer = await client.findCustomerByDisplayName(displayName);
  if (!customer) {
    customer = await client.createCustomer({
      DisplayName: displayName,
      PrimaryEmailAddr: trimToUndefined(company?.email)
        ? { Address: company?.email ?? '' }
        : undefined,
    });
  }

  if (companyId) {
    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_CUSTOMER,
      localId: companyId,
      externalId: customer.Id,
      metadata: {
        displayName,
      },
    });
  }

  return customer.Id;
}

async function resolveVendorId(
  context: IntegrationContext<QuickBooksIntegrationConfig>,
  client: QuickBooksClient,
  document: Document
): Promise<string> {
  const company = document.supplier ?? document.receiver;
  const companyId = trimToUndefined(company?.id);

  if (companyId) {
    const mapping = await context.mappings.get({
      system: SYSTEM,
      entity: ENTITY_VENDOR,
      localId: companyId,
    });
    if (mapping?.externalId) {
      return mapping.externalId;
    }
  }

  const displayName =
    trimToUndefined(company?.name) ?? context.config.fallbackVendorName ?? 'InvoiceLeaf Vendor';

  let vendor = await client.findVendorByDisplayName(displayName);
  if (!vendor) {
    vendor = await client.createVendor({
      DisplayName: displayName,
      PrimaryEmailAddr: trimToUndefined(company?.email)
        ? { Address: company?.email ?? '' }
        : undefined,
    });
  }

  if (companyId) {
    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_VENDOR,
      localId: companyId,
      externalId: vendor.Id,
      metadata: {
        displayName,
      },
    });
  }

  return vendor.Id;
}

function buildInvoiceLines(document: Document, salesItemId: string): QuickBooksInvoiceLineInput[] {
  const lines: QuickBooksInvoiceLineInput[] = [];

  for (const item of document.lineItems ?? []) {
    const quantity = toFiniteNumber(item.quantity, 1);
    const safeQuantity = quantity === 0 ? 1 : quantity;
    const amount = firstFinite(item.totalAmount, item.netAmount, safeQuantity * toFiniteNumber(item.unitPrice, 0));
    const unitPrice = toFiniteNumber(item.unitPrice, amount / safeQuantity);

    lines.push({
      Amount: amount,
      Description: trimToUndefined(item.description) ?? defaultLineDescription(document),
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: salesItemId },
        Qty: safeQuantity,
        UnitPrice: unitPrice,
      },
    });
  }

  if (lines.length > 0) {
    return lines;
  }

  const fallbackAmount = firstFinite(document.totalAmount, document.netAmount, document.amountDue, 0);
  return [
    {
      Amount: fallbackAmount,
      Description: defaultLineDescription(document),
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: salesItemId },
        Qty: 1,
        UnitPrice: fallbackAmount,
      },
    },
  ];
}

function buildBillLines(document: Document, expenseAccountId: string): QuickBooksBillLineInput[] {
  const lines: QuickBooksBillLineInput[] = [];

  for (const item of document.lineItems ?? []) {
    const amount = firstFinite(item.totalAmount, item.netAmount, item.unitPrice, 0);
    lines.push({
      Amount: amount,
      Description: trimToUndefined(item.description) ?? defaultLineDescription(document),
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: expenseAccountId },
      },
    });
  }

  if (lines.length > 0) {
    return lines;
  }

  const fallbackAmount = firstFinite(document.totalAmount, document.netAmount, document.amountDue, 0);
  return [
    {
      Amount: fallbackAmount,
      Description: defaultLineDescription(document),
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: expenseAccountId },
      },
    },
  ];
}

function buildDocumentNumber(document: Document, prefix?: string): string | undefined {
  const invoiceId = trimToUndefined(document.invoiceId) ?? document.id;
  const value = `${prefix ?? ''}${invoiceId}`.trim();
  return value.length > 0 ? value.slice(0, 21) : undefined;
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

function toDateOnly(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
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
  if (error instanceof QuickBooksApiError) {
    const body = error.responseBody ? ` ${error.responseBody}` : '';
    return `QuickBooks API ${error.status}:${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
