import type { Document, IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import { toBoundedInt, toDateOnly, toDateOnlyFromTimestamp, toFiniteNumber, firstFinite, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type {
  QuickBooksIntegrationConfig,
  QuickBooksSyncState,
  SyncFailure,
  SyncInvoicesResult,
} from '../types.js';
import type {
  QuickBooksBillInput,
  QuickBooksBillLineInput,
  QuickBooksInvoiceInput,
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

export const syncInvoices: IntegrationHandler<ScheduleInput, SyncInvoicesResult, QuickBooksIntegrationConfig> = async (
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

  const resultBase: Omit<SyncInvoicesResult, 'success' | 'message' | 'error' | 'realmId' | 'checkpointUpdated'> = {
    startedAt,
    completedAt: startedAt,
    fromDate: fallbackFromDate,
    processed: 0,
    synced: 0,
    created: 0,
    updated: 0,
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

    let fromDate = fallbackFromDate;
    try {
      const syncState = await context.state.get<QuickBooksSyncState>(SYNC_STATE_KEY);
      const checkpointValue = syncState?.lastSuccessfulSyncAt;
      if (checkpointValue && Number.isFinite(Date.parse(checkpointValue))) {
        fromDate = checkpointValue;
      } else if (checkpointValue) {
        context.logger.warn('Corrupted sync checkpoint value — falling back to lookback window.', {
          key: SYNC_STATE_KEY,
          corruptedValue: checkpointValue,
        });
      }
    } catch (stateError) {
      context.logger.warn('Could not read QuickBooks sync checkpoint; using fallback lookback window.', {
        key: SYNC_STATE_KEY,
        error: toErrorMessage(stateError),
      });
    }
    resultBase.fromDate = fromDate;

    const accessToken = await context.credentials.getAccessToken(SYSTEM);
    const client = new QuickBooksClient(accessToken, realmId, context.config.apiBaseUrl);

    let cachedSalesItemId = trimToUndefined(context.config.defaultSalesItemId);
    let cachedExpenseAccountId = trimToUndefined(context.config.defaultExpenseAccountId);

    let page = 1;
    let hasMore = true;

    while (hasMore && resultBase.processed < maxDocumentsPerRun) {
      const parsedStartDate = Date.parse(fromDate);
      const pageResult = await context.data.listDocuments({
        startDate: Number.isFinite(parsedStartDate) ? parsedStartDate : Date.parse(fallbackFromDate),
        page,
        limit: Math.min(pageSize, maxDocumentsPerRun - resultBase.processed),
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

        if (!isSyncableDocument(document, context.config.includeDraftDocuments ?? false, context.config.requireProcessedDocuments ?? false)) {
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

          const isUpdate = !!externalId;

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

            const billPayload: QuickBooksBillInput = {
              VendorRef: { value: vendorId },
              TxnDate: toDateOnly(document.invoiceDate) ?? toDateOnlyFromTimestamp(document.created),
              DueDate: toDateOnly(document.dueDate),
              DocNumber: docNumber,
              CurrencyRef: trimToUndefined(document.currency?.code)
                ? { value: document.currency?.code ?? '' }
                : undefined,
              PrivateNote: `InvoiceLeaf:${document.id}`,
              Line: buildBillLines(document, cachedExpenseAccountId),
            };

            if (externalId) {
              const existing = await client.getBill(externalId);
              const updated = await client.updateBill({
                ...billPayload,
                Id: existing.Id,
                SyncToken: existing.SyncToken,
              });
              externalId = updated.Id;
            } else {
              const created = await client.createBill(billPayload);
              externalId = created.Id;
            }
          } else {
            const customerId = await resolveCustomerId(context, client, document);
            if (!cachedSalesItemId) {
              cachedSalesItemId = await client.findDefaultSalesItemId();
            }
            if (!cachedSalesItemId) {
              throw new Error('No QuickBooks sales item found. Set defaultSalesItemId in config.');
            }

            const invoicePayload: QuickBooksInvoiceInput = {
              CustomerRef: { value: customerId },
              TxnDate: toDateOnly(document.invoiceDate) ?? toDateOnlyFromTimestamp(document.created),
              DueDate: toDateOnly(document.dueDate),
              DocNumber: docNumber,
              CurrencyRef: trimToUndefined(document.currency?.code)
                ? { value: document.currency?.code ?? '' }
                : undefined,
              PrivateNote: `InvoiceLeaf:${document.id}`,
              Line: buildInvoiceLines(document, cachedSalesItemId),
            };

            if (externalId) {
              const existing = await client.getInvoice(externalId);
              const updated = await client.updateInvoice({
                ...invoicePayload,
                Id: existing.Id,
                SyncToken: existing.SyncToken,
              });
              externalId = updated.Id;
            } else {
              const created = await client.createInvoice(invoicePayload);
              externalId = created.Id;
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
          if (isUpdate) {
            resultBase.updated += 1;
          } else {
            resultBase.created += 1;
          }
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
      try {
        await context.state.set<QuickBooksSyncState>(SYNC_STATE_KEY, {
          lastSuccessfulSyncAt: completedAt,
        });
        checkpointUpdated = true;
      } catch (e) {
        context.logger.warn('Failed to persist sync checkpoint — sync results are still valid', { error: String(e) });
      }
    }

    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      message:
        resultBase.failed === 0
          ? `Synced ${resultBase.synced} document(s) to QuickBooks (${resultBase.created} created, ${resultBase.updated} updated).`
          : `Synced ${resultBase.synced} document(s) with ${resultBase.failed} failure(s) (${resultBase.created} created, ${resultBase.updated} updated).`,
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
    const safeQuantity = Math.max(Math.abs(quantity) || 1, 1);
    const rawAmount = firstFinite(item.totalAmount, item.netAmount, safeQuantity * toFiniteNumber(item.unitAmount, 0)) ?? 0;
    const amount = Math.max(Math.abs(rawAmount), 0);
    const unitPrice = Math.max(Math.abs(toFiniteNumber(item.unitAmount, amount / safeQuantity)), 0);

    if (amount === 0 && lines.length > 0) {
      continue;
    }

    lines.push({
      Amount: amount,
      Description: trimToUndefined(item.name) ?? defaultLineDescription(document),
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

  const fallbackAmount = firstFinite(document.totalAmount, document.netAmount, document.amountDue);
  if (fallbackAmount === undefined || fallbackAmount === 0) {
    throw new Error(
      `Document ${document.id} has no line items and no valid amount (totalAmount, netAmount, amountDue are all missing or zero). Cannot create a QuickBooks invoice with $0.`
    );
  }
  const absAmount = Math.abs(fallbackAmount);
  return [
    {
      Amount: absAmount,
      Description: defaultLineDescription(document),
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: salesItemId },
        Qty: 1,
        UnitPrice: absAmount,
      },
    },
  ];
}

function buildBillLines(document: Document, expenseAccountId: string): QuickBooksBillLineInput[] {
  const lines: QuickBooksBillLineInput[] = [];

  for (const item of document.lineItems ?? []) {
    const quantity = toFiniteNumber(item.quantity, 1);
    const safeQuantity = Math.max(Math.abs(quantity) || 1, 1);
    const rawAmount = firstFinite(item.totalAmount, item.netAmount, safeQuantity * toFiniteNumber(item.unitAmount, 0)) ?? 0;
    const amount = Math.max(Math.abs(rawAmount), 0);

    if (amount === 0 && lines.length > 0) {
      continue;
    }

    lines.push({
      Amount: amount,
      Description: trimToUndefined(item.name) ?? defaultLineDescription(document),
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: expenseAccountId },
      },
    });
  }

  if (lines.length > 0) {
    return lines;
  }

  const fallbackAmount = firstFinite(document.totalAmount, document.netAmount, document.amountDue);
  if (fallbackAmount === undefined || fallbackAmount === 0) {
    throw new Error(
      `Document ${document.id} has no line items and no valid amount (totalAmount, netAmount, amountDue are all missing or zero). Cannot create a QuickBooks bill with $0.`
    );
  }
  const absAmount = Math.abs(fallbackAmount);
  return [
    {
      Amount: absAmount,
      Description: defaultLineDescription(document),
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: expenseAccountId },
      },
    },
  ];
}

function buildDocumentNumber(document: Document, prefix?: string): string | undefined {
  const invoiceId = trimToUndefined(document.invoiceId);
  if (!invoiceId) {
    return undefined;
  }
  const value = `${prefix ?? ''}${invoiceId}`.trim();
  return value.length > 0 ? value.slice(0, 21) : undefined;
}

function defaultLineDescription(document: Document): string {
  return trimToUndefined(document.description) || `Invoice ${document.invoiceId ?? document.id}`;
}

function isSyncableDocument(document: Document, includeDraftDocuments: boolean, requireProcessedDocuments: boolean = true): boolean {
  if (!document.id || document.deleted || trimToUndefined(document.duplicateOfId)) {
    return false;
  }

  if (document.documentStatus === 'CANCELLED') {
    return false;
  }

  if (!includeDraftDocuments && document.documentStatus === 'DRAFT') {
    return false;
  }

  if (requireProcessedDocuments && document.processed === false) {
    return false;
  }

  // Skip zero-amount documents — they indicate missing or invalid data
  const amount = document.totalAmount ?? document.netAmount ?? document.amountDue;
  if (amount === 0) {
    return false;
  }

  return true;
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
