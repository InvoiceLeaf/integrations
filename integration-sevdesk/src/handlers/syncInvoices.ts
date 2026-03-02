import type { Document, IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  SevdeskIntegrationConfig,
  SevdeskSyncState,
  SyncFailure,
  SyncInvoicesResult,
} from '../types.js';
import type {
  SevdeskContact,
  SevdeskContactCreateInput,
  SevdeskInvoicePositionInput,
  SevdeskInvoiceUpsertInput,
} from '../sevdesk/client.js';
import { SevdeskApiError, SevdeskClient } from '../sevdesk/client.js';

const SYSTEM = 'sevdesk';
const ENTITY_INVOICE = 'invoice';
const ENTITY_CONTACT = 'contact';
const SYNC_STATE_KEY = 'sevdesk:lastSuccessfulSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_DOCUMENTS_PER_RUN = 100;
const MAX_REPORTED_FAILURES = 25;

interface RuntimeDefaults {
  contactPersonId: number;
  addressCountryId: number;
  unityId: number;
  taxType: NonNullable<SevdeskIntegrationConfig['taxType']>;
  taxRuleId: NonNullable<SevdeskIntegrationConfig['taxRuleId']>;
  taxText: string;
  targetStatus: NonNullable<SevdeskIntegrationConfig['targetStatus']>;
  invoiceType: NonNullable<SevdeskIntegrationConfig['invoiceType']>;
  defaultCurrency: string;
  defaultTaxRate: number;
  contactCategoryId: number;
}

export const syncInvoices: IntegrationHandler<
  unknown,
  SyncInvoicesResult,
  SevdeskIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<SevdeskIntegrationConfig>
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

  const syncState = await context.state.get<SevdeskSyncState>(SYNC_STATE_KEY);
  const fallbackFromDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const fromDate = syncState?.lastSuccessfulSyncAt ?? fallbackFromDate;

  const resultBase: Omit<SyncInvoicesResult, 'success' | 'message' | 'error' | 'checkpointUpdated'> = {
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
        error: 'sevDesk is not connected. Add an API key first.',
        checkpointUpdated: false,
      };
    }

    const apiKey = await context.credentials.getApiKey(SYSTEM);
    const sevdeskClient = new SevdeskClient(apiKey, context.config.baseUrl);
    const runtimeDefaults = await resolveRuntimeDefaults(context, sevdeskClient);
    const contactCache = new Map<string, SevdeskContact>();

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
          const syncedInvoice = await syncSingleDocument(
            context,
            sevdeskClient,
            document,
            runtimeDefaults,
            contactCache
          );
          resultBase.synced += 1;

          await context.data.patchDocumentIntegrationMeta({
            documentId: document.id,
            system: SYSTEM,
            externalId: syncedInvoice.id,
            status: 'synced',
            lastSyncedAt: new Date().toISOString(),
            metadata: {
              sevdeskInvoiceId: syncedInvoice.id,
              invoiceNumber: syncedInvoice.invoiceNumber,
              sevdeskStatus: syncedInvoice.status,
            },
          });
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          context.logger.error('Failed to sync document to sevDesk', {
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
            context.logger.warn('Failed to patch document sync metadata after sevDesk sync error', {
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
      await context.state.set<SevdeskSyncState>(SYNC_STATE_KEY, {
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
          ? `Synced ${resultBase.synced} document(s) to sevDesk.`
          : `Synced ${resultBase.synced} document(s) with ${resultBase.failed} failure(s).`,
      checkpointUpdated,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = toErrorMessage(error);
    context.logger.error('sevDesk scheduled sync failed', { error: message });

    return {
      ...resultBase,
      completedAt,
      success: false,
      error: message,
      checkpointUpdated: false,
    };
  }
};

async function syncSingleDocument(
  context: IntegrationContext<SevdeskIntegrationConfig>,
  client: SevdeskClient,
  document: Document,
  runtimeDefaults: RuntimeDefaults,
  contactCache: Map<string, SevdeskContact>
): Promise<{ id: string; invoiceNumber?: string; status?: string | number }> {
  const contact = await resolveContact(context, client, document, runtimeDefaults, contactCache);

  const existingMapping = await context.mappings.get({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: document.id,
  });

  let existingInvoiceId = existingMapping?.externalId;
  const invoiceNumber = buildInvoiceNumber(document, trimToUndefined(context.config.invoiceNumberPrefix));
  if (!existingInvoiceId && invoiceNumber) {
    const existingByNumber = await client.findInvoiceByNumber(invoiceNumber);
    if (existingByNumber?.id) {
      existingInvoiceId = existingByNumber.id;
    }
  }

  const payload = buildInvoicePayload({
    document,
    contactId: contact.id,
    invoiceId: existingInvoiceId,
    invoiceNumber,
    runtimeDefaults,
  });

  const syncedInvoice = await client.saveInvoice(payload);

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: document.id,
    externalId: syncedInvoice.id,
    metadata: {
      invoiceNumber: syncedInvoice.invoiceNumber ?? invoiceNumber ?? null,
      status: syncedInvoice.status ?? null,
    },
  });

  return syncedInvoice;
}

async function resolveRuntimeDefaults(
  context: IntegrationContext<SevdeskIntegrationConfig>,
  client: SevdeskClient
): Promise<RuntimeDefaults> {
  const discovered = (await client.listInvoices({ limit: 1, offset: 0 }))[0];

  const contactPersonId =
    toOptionalInt(context.config.contactPersonId) ?? toOptionalInt(discovered?.contactPerson?.id);
  const addressCountryId =
    toOptionalInt(context.config.addressCountryId) ?? toOptionalInt(discovered?.addressCountry?.id);

  if (!contactPersonId) {
    throw new Error(
      'Missing contactPersonId in config and unable to auto-discover from existing sevDesk invoices.'
    );
  }

  if (!addressCountryId) {
    throw new Error(
      'Missing addressCountryId in config and unable to auto-discover from existing sevDesk invoices.'
    );
  }

  const sampleContact = (await client.listContacts({ limit: 1, offset: 0 }))[0];
  const contactCategoryId =
    toOptionalInt(context.config.contactCategoryId) ??
    toOptionalInt(sampleContact?.category?.id) ??
    3;

  return {
    contactPersonId,
    addressCountryId,
    unityId: toOptionalInt(context.config.unityId) ?? 1,
    taxType: context.config.taxType ?? 'default',
    taxRuleId: context.config.taxRuleId ?? '1',
    taxText: trimToUndefined(context.config.taxText) ?? 'Umsatzsteuer 19%',
    targetStatus: context.config.targetStatus ?? 100,
    invoiceType: context.config.invoiceType ?? 'RE',
    defaultCurrency:
      trimToUndefined(context.config.defaultCurrency) ??
      trimToUndefined(discovered?.currency) ??
      'EUR',
    defaultTaxRate: toBoundedNumber(context.config.defaultTaxRate, 19, 0, 100),
    contactCategoryId,
  };
}

async function resolveContact(
  context: IntegrationContext<SevdeskIntegrationConfig>,
  client: SevdeskClient,
  document: Document,
  runtimeDefaults: RuntimeDefaults,
  contactCache: Map<string, SevdeskContact>
): Promise<SevdeskContact> {
  const company = pickCompanyForDocument(document);
  const companyId = trimToUndefined(company?.id);
  const cacheKey = companyId ?? trimToUndefined(company?.name) ?? `document:${document.id}`;
  const cached = contactCache.get(cacheKey);
  if (cached?.id) {
    return cached;
  }

  if (companyId) {
    const mapping = await context.mappings.get({
      system: SYSTEM,
      entity: ENTITY_CONTACT,
      localId: companyId,
    });
    if (mapping?.externalId) {
      const mapped = { id: mapping.externalId, objectName: 'Contact' };
      contactCache.set(cacheKey, mapped);
      return mapped;
    }
  }

  const customerNumber = companyId ? buildCustomerNumber(companyId) : undefined;
  if (customerNumber) {
    const existing = await client.listContacts({ customerNumber, limit: 1, offset: 0 });
    if (existing[0]?.id) {
      if (companyId) {
        await context.mappings.upsert({
          system: SYSTEM,
          entity: ENTITY_CONTACT,
          localId: companyId,
          externalId: existing[0].id,
          metadata: {
            contactName: existing[0].name ?? null,
            customerNumber,
          },
        });
      }
      contactCache.set(cacheKey, existing[0]);
      return existing[0];
    }
  }

  const contactName =
    trimToUndefined(company?.name) ||
    trimToUndefined(context.config.fallbackContactName) ||
    'InvoiceLeaf Contact';

  const createInput: SevdeskContactCreateInput = {
    name: contactName,
    categoryId: runtimeDefaults.contactCategoryId,
    customerNumber,
    taxNumber: trimToUndefined(company?.taxId),
    vatNumber: trimToUndefined(company?.taxId),
  };

  const created = await client.createContact(createInput);

  if (companyId && created.id) {
    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_CONTACT,
      localId: companyId,
      externalId: created.id,
      metadata: {
        contactName: created.name ?? contactName,
        customerNumber: createInput.customerNumber ?? null,
      },
    });
  }

  contactCache.set(cacheKey, created);
  return created;
}

function pickCompanyForDocument(document: Document): Document['supplier'] | Document['receiver'] {
  if (document.accountingType === 'PAYABLE') {
    return document.supplier ?? document.receiver;
  }
  return document.receiver ?? document.supplier;
}

interface BuildInvoicePayloadInput {
  document: Document;
  contactId: string;
  invoiceId?: string;
  invoiceNumber?: string;
  runtimeDefaults: RuntimeDefaults;
}

function buildInvoicePayload(input: BuildInvoicePayloadInput): SevdeskInvoiceUpsertInput {
  const lineItems = buildLineItems(input.document, input.runtimeDefaults);
  const invoiceDate = toSevDate(input.document.invoiceDate) ?? toSevDateFromTimestamp(input.document.created);
  if (!invoiceDate) {
    throw new Error(`Document ${input.document.id} is missing invoice date information.`);
  }

  const company = pickCompanyForDocument(input.document);
  const payload: SevdeskInvoiceUpsertInput = {
    id: input.invoiceId,
    invoiceDate,
    contactId: input.contactId,
    contactPersonId: input.runtimeDefaults.contactPersonId,
    addressCountryId: input.runtimeDefaults.addressCountryId,
    status: input.runtimeDefaults.targetStatus,
    invoiceType: input.runtimeDefaults.invoiceType,
    currency: trimToUndefined(input.document.currency?.code) ?? input.runtimeDefaults.defaultCurrency,
    taxType: input.runtimeDefaults.taxType,
    taxRuleId: input.runtimeDefaults.taxRuleId,
    taxText: input.runtimeDefaults.taxText,
    taxRate: 0,
    discount: 0,
    invoiceNumber: input.invoiceNumber,
    header: input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : undefined,
    address: formatAddress(company),
    positions: lineItems,
  };

  return payload;
}

function buildLineItems(document: Document, runtimeDefaults: RuntimeDefaults): SevdeskInvoicePositionInput[] {
  const lineItems: SevdeskInvoicePositionInput[] = [];

  for (const [index, item] of (document.lineItems ?? []).entries()) {
    const quantity = toFiniteNumber(item.quantity, 1);
    const safeQuantity = quantity === 0 ? 1 : quantity;
    const computedLineAmount = firstFinite(item.netAmount, item.totalAmount, 0);
    const unitAmount = toFiniteNumber(item.unitPrice, computedLineAmount / safeQuantity);
    const taxRate =
      toTaxRateFromAmounts(item.taxAmount, item.netAmount) ??
      toFiniteNumber(document.taxItems?.[0]?.taxRate, runtimeDefaults.defaultTaxRate);

    lineItems.push({
      name: trimToUndefined(item.description) || defaultLineDescription(document),
      quantity: safeQuantity,
      price: unitAmount,
      taxRate,
      unityId: runtimeDefaults.unityId,
      text: trimToUndefined(item.description),
      positionNumber: index,
    });
  }

  const filtered = lineItems.filter(
    (item) => Number.isFinite(item.price) && Number.isFinite(item.quantity) && item.price >= 0
  );

  if (filtered.length > 0) {
    return filtered;
  }

  const amount = firstFinite(document.netAmount, document.totalAmount, document.amountDue, 0);
  return [
    {
      name: defaultLineDescription(document),
      quantity: 1,
      price: amount,
      taxRate: runtimeDefaults.defaultTaxRate,
      unityId: runtimeDefaults.unityId,
      positionNumber: 0,
    },
  ];
}

function buildCustomerNumber(companyId: string): string {
  const normalized = companyId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  return `IL-${normalized || 'CONTACT'}`;
}

function buildInvoiceNumber(document: Document, prefix?: string): string | undefined {
  const invoiceId = trimToUndefined(document.invoiceId);
  if (!invoiceId) {
    return undefined;
  }

  const value = `${prefix ?? ''}${invoiceId}`.trim();
  return value.length > 0 ? value.slice(0, 80) : undefined;
}

function formatAddress(company: Document['supplier'] | Document['receiver'] | undefined): string | undefined {
  if (!company) {
    return undefined;
  }

  const lines = [
    trimToUndefined(company.name),
    trimToUndefined(company.address?.street),
    formatCityLine(company.address?.postalCode, company.address?.city),
    trimToUndefined(company.address?.country),
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join('\n') : undefined;
}

function formatCityLine(postalCode?: string, city?: string): string | undefined {
  const value = [trimToUndefined(postalCode), trimToUndefined(city)].filter(
    (part): part is string => Boolean(part)
  );
  return value.length > 0 ? value.join(' ') : undefined;
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

function toBoundedNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const parsed = value as number;
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
}

function toSevDate(isoDate: string | undefined): string | undefined {
  if (!isoDate) {
    return undefined;
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
}

function toSevDateFromTimestamp(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const date = new Date(value as number);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
}

function toTaxRateFromAmounts(
  taxAmount: number | undefined,
  netAmount: number | undefined
): number | undefined {
  if (!Number.isFinite(taxAmount) || !Number.isFinite(netAmount) || (netAmount as number) === 0) {
    return undefined;
  }
  const rate = ((taxAmount as number) / (netAmount as number)) * 100;
  if (!Number.isFinite(rate)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Number(rate.toFixed(2))));
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

function toOptionalInt(value: number | string | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof SevdeskApiError) {
    const body = error.responseBody ? ` ${error.responseBody}` : '';
    return `sevDesk API ${error.status}:${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
