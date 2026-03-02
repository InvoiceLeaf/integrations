import type { Document, IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  SyncFailure,
  SyncInvoicesResult,
  XeroIntegrationConfig,
  XeroSyncState,
} from '../types.js';
import type { XeroContact, XeroInvoiceLineItemInput, XeroInvoiceUpsertInput } from '../xero/client.js';
import {
  listXeroConnections,
  selectXeroTenant,
  XeroAccountingClient,
  XeroApiError,
} from '../xero/client.js';

const SYSTEM = 'xero';
const ENTITY_INVOICE = 'invoice';
const ENTITY_CONTACT = 'contact';
const SYNC_STATE_KEY = 'xero:lastSuccessfulSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_DOCUMENTS_PER_RUN = 100;
const MAX_REPORTED_FAILURES = 25;

export const syncInvoices: IntegrationHandler<unknown, SyncInvoicesResult, XeroIntegrationConfig> = async (
  _input,
  context: IntegrationContext<XeroIntegrationConfig>
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

  const syncState = await context.state.get<XeroSyncState>(SYNC_STATE_KEY);
  const fallbackFromDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const fromDate = syncState?.lastSuccessfulSyncAt ?? fallbackFromDate;

  const resultBase: Omit<
    SyncInvoicesResult,
    'success' | 'message' | 'error' | 'tenantId' | 'tenantName' | 'checkpointUpdated'
  > = {
    startedAt,
    completedAt: startedAt,
    fromDate,
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
        error: 'Xero is not connected. Complete OAuth authorization first.',
        tenantId: '',
        tenantName: '',
        checkpointUpdated: false,
      };
    }

    const accessToken = await context.credentials.getAccessToken(SYSTEM);
    const connections = await listXeroConnections(accessToken);
    const preferredTenantId = context.config.xeroTenantId || connectionInfo.accountId;
    const tenant = selectXeroTenant(connections, preferredTenantId);

    const xeroClient = new XeroAccountingClient(accessToken, tenant.tenantId);

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
          const syncedInvoice = await syncSingleDocument(context, xeroClient, document);
          resultBase.synced += 1;

          await context.data.patchDocumentIntegrationMeta({
            documentId: document.id,
            system: SYSTEM,
            externalId: syncedInvoice.InvoiceID,
            status: 'synced',
            lastSyncedAt: new Date().toISOString(),
            metadata: {
              tenantId: tenant.tenantId,
              tenantName: tenant.tenantName,
              invoiceNumber: syncedInvoice.InvoiceNumber,
              xeroStatus: syncedInvoice.Status,
            },
          });
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          context.logger.error('Failed to sync document to Xero', {
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
            context.logger.warn('Failed to patch document sync metadata after Xero sync error', {
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
      await context.state.set<XeroSyncState>(SYNC_STATE_KEY, {
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
          ? `Synced ${resultBase.synced} document(s) to Xero.`
          : `Synced ${resultBase.synced} document(s) with ${resultBase.failed} failure(s).`,
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      checkpointUpdated,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = toErrorMessage(error);
    context.logger.error('Xero scheduled sync failed', { error: message });

    return {
      ...resultBase,
      completedAt,
      success: false,
      error: message,
      tenantId: '',
      tenantName: '',
      checkpointUpdated: false,
    };
  }
};

async function syncSingleDocument(
  context: IntegrationContext<XeroIntegrationConfig>,
  xeroClient: XeroAccountingClient,
  document: Document
): Promise<{ InvoiceID: string; InvoiceNumber?: string; Status?: string }> {
  const invoiceType = document.accountingType === 'PAYABLE' ? 'ACCPAY' : 'ACCREC';
  const accountCode =
    invoiceType === 'ACCPAY'
      ? trimToUndefined(context.config.defaultExpenseAccountCode)
      : trimToUndefined(context.config.defaultRevenueAccountCode);

  const contact = await resolveContact(context, xeroClient, document, invoiceType);

  const existingMapping = await context.mappings.get({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: document.id,
  });

  let existingInvoiceId = existingMapping?.externalId;
  const invoiceNumber = buildInvoiceNumber(document, trimToUndefined(context.config.invoiceNumberPrefix));
  if (!existingInvoiceId && invoiceNumber) {
    const existingByNumber = await xeroClient.findInvoiceByNumber(invoiceNumber);
    if (existingByNumber?.InvoiceID) {
      existingInvoiceId = existingByNumber.InvoiceID;
    }
  }

  const payload = buildInvoicePayload({
    document,
    invoiceType,
    contactId: contact.ContactID,
    invoiceId: existingInvoiceId,
    invoiceNumber,
    targetStatus: context.config.targetStatus ?? 'DRAFT',
    accountCode,
  });

  const syncedInvoice = await xeroClient.upsertInvoice(payload);

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: document.id,
    externalId: syncedInvoice.InvoiceID,
    metadata: {
      invoiceNumber: syncedInvoice.InvoiceNumber ?? invoiceNumber ?? null,
      status: syncedInvoice.Status ?? null,
    },
  });

  return syncedInvoice;
}

async function resolveContact(
  context: IntegrationContext<XeroIntegrationConfig>,
  xeroClient: XeroAccountingClient,
  document: Document,
  invoiceType: 'ACCREC' | 'ACCPAY'
): Promise<XeroContact> {
  const company = pickCompanyForDocument(document, invoiceType);
  const companyId = trimToUndefined(company?.id);

  if (companyId) {
    const mapping = await context.mappings.get({
      system: SYSTEM,
      entity: ENTITY_CONTACT,
      localId: companyId,
    });
    if (mapping?.externalId) {
      return { ContactID: mapping.externalId };
    }
  }

  const contactName = trimToUndefined(company?.name) || context.config.fallbackContactName || 'InvoiceLeaf Contact';
  let contact = await xeroClient.findContactByName(contactName);
  if (!contact) {
    contact = await xeroClient.createContact({
      name: contactName,
      emailAddress: trimToUndefined(company?.email),
      taxNumber: trimToUndefined(company?.taxId),
    });
  }

  if (companyId && contact.ContactID) {
    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_CONTACT,
      localId: companyId,
      externalId: contact.ContactID,
      metadata: {
        contactName: contact.Name ?? contactName,
      },
    });
  }

  return contact;
}

function pickCompanyForDocument(
  document: Document,
  invoiceType: 'ACCREC' | 'ACCPAY'
): Document['supplier'] | Document['receiver'] {
  if (invoiceType === 'ACCPAY') {
    return document.supplier ?? document.receiver;
  }
  return document.receiver ?? document.supplier;
}

interface BuildInvoicePayloadInput {
  document: Document;
  invoiceType: 'ACCREC' | 'ACCPAY';
  contactId: string;
  invoiceId?: string;
  invoiceNumber?: string;
  targetStatus: 'DRAFT' | 'AUTHORISED';
  accountCode?: string;
}

function buildInvoicePayload(input: BuildInvoicePayloadInput): XeroInvoiceUpsertInput {
  const lineItems = buildLineItems(input.document, input.accountCode);
  const date = toDateOnly(input.document.invoiceDate) ?? toDateOnlyFromTimestamp(input.document.created);
  if (!date) {
    throw new Error(`Document ${input.document.id} is missing invoice date information.`);
  }

  const payload: XeroInvoiceUpsertInput = {
    Type: input.invoiceType,
    Contact: { ContactID: input.contactId },
    Date: date,
    Status: input.targetStatus,
    LineAmountTypes: 'Exclusive',
    LineItems: lineItems,
    Reference: `InvoiceLeaf:${input.document.id}`,
  };

  const dueDate = toDateOnly(input.document.dueDate);
  if (dueDate) {
    payload.DueDate = dueDate;
  }
  if (input.invoiceId) {
    payload.InvoiceID = input.invoiceId;
  }
  if (input.invoiceNumber) {
    payload.InvoiceNumber = input.invoiceNumber;
  }
  if (input.document.currency?.code) {
    payload.CurrencyCode = input.document.currency.code;
  }

  return payload;
}

function buildLineItems(document: Document, accountCode?: string): XeroInvoiceLineItemInput[] {
  const lineItems: XeroInvoiceLineItemInput[] = [];

  for (const item of document.lineItems ?? []) {
    const quantity = toFiniteNumber(item.quantity, 1);
    const safeQuantity = quantity === 0 ? 1 : quantity;
    const computedLineAmount = firstFinite(item.netAmount, item.totalAmount, 0);
    const unitAmount = toFiniteNumber(item.unitPrice, computedLineAmount / safeQuantity);
    const taxAmount = Number.isFinite(item.taxAmount) ? (item.taxAmount as number) : undefined;

    lineItems.push({
      Description: trimToUndefined(item.description) || defaultLineDescription(document),
      Quantity: safeQuantity,
      UnitAmount: unitAmount,
      AccountCode: accountCode,
      TaxAmount: taxAmount,
    });
  }

  const filtered = lineItems.filter(
    (item) => Number.isFinite(item.UnitAmount) && Number.isFinite(item.Quantity)
  );

  if (filtered.length > 0) {
    return filtered;
  }

  const amount = firstFinite(document.netAmount, document.totalAmount, document.amountDue, 0);
  return [
    {
      Description: defaultLineDescription(document),
      Quantity: 1,
      UnitAmount: amount,
      AccountCode: accountCode,
    },
  ];
}

function buildInvoiceNumber(document: Document, prefix?: string): string | undefined {
  const invoiceId = trimToUndefined(document.invoiceId);
  if (!invoiceId) {
    return undefined;
  }

  const value = `${prefix ?? ''}${invoiceId}`.trim();
  return value.length > 0 ? value.slice(0, 255) : undefined;
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

function toFiniteNumber(value: number | undefined, fallback: number | undefined): number {
  if (Number.isFinite(value)) {
    return value as number;
  }
  return fallback ?? 0;
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
  if (error instanceof XeroApiError) {
    const body = error.responseBody ? ` ${error.responseBody}` : '';
    return `Xero API ${error.status}:${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
