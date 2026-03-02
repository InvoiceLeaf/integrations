import type { Document, IntegrationContext, IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type {
  GetMyInvoicesDocumentType,
  GetMyInvoicesIntegrationConfig,
  GetMyInvoicesPaymentMethod,
  GetMyInvoicesPaymentStatus,
  GetMyInvoicesSyncState,
  SyncFailure,
  SyncInvoicesResult,
} from '../types.js';
import type {
  GetMyInvoicesCompany,
  GetMyInvoicesCountry,
  GetMyInvoicesDocumentMetadataInput,
} from '../getmyinvoices/client.js';
import { GetMyInvoicesApiError, GetMyInvoicesClient } from '../getmyinvoices/client.js';
import { resolveGetMyInvoicesApiKey } from './auth.js';

export const SYSTEM = 'getmyinvoices';
export const ENTITY_DOCUMENT = 'document';
export const ENTITY_COMPANY = 'company';
export const OUTBOUND_SYNC_STATE_KEY = 'getmyinvoices:lastSuccessfulSyncAt';
export const INBOUND_SYNC_STATE_KEY = 'getmyinvoices:lastInboundSyncAt';

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_DOCUMENTS_PER_RUN = 100;
const MAX_REPORTED_FAILURES = 25;

interface CompanyLookupCache {
  byKey: Map<string, GetMyInvoicesCompany>;
  byNormalizedName: Map<string, GetMyInvoicesCompany>;
  loaded: boolean;
}

interface CountryLookupCache {
  byName: Map<string, GetMyInvoicesCountry>;
  byCode: Map<string, GetMyInvoicesCountry>;
  loaded: boolean;
}

export interface RuntimeDefaults {
  defaultDocumentType: GetMyInvoicesDocumentType;
  payableDocumentType: GetMyInvoicesDocumentType;
  receivableDocumentType: GetMyInvoicesDocumentType;
  defaultPaymentMethod: GetMyInvoicesPaymentMethod;
  defaultPaymentStatus: GetMyInvoicesPaymentStatus;
  defaultCurrency: string;
  autoCreateCompanies: boolean;
  defaultCountryUid?: number;
  fallbackCompanyName: string;
  runOcrOnUpload: boolean;
}

export const syncInvoices: IntegrationHandler<
  unknown,
  SyncInvoicesResult,
  GetMyInvoicesIntegrationConfig
> = async (
  _input,
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>
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

  const resultBase: Omit<SyncInvoicesResult, 'success' | 'message' | 'error' | 'checkpointUpdated'> = {
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
    let fromDate = fallbackFromDate;
    try {
      const syncState = await context.state.get<GetMyInvoicesSyncState>(OUTBOUND_SYNC_STATE_KEY);
      fromDate = syncState?.lastSuccessfulSyncAt ?? fallbackFromDate;
    } catch (stateError) {
      context.logger.warn(
        'Could not read GetMyInvoices outbound sync checkpoint. Using fallback lookback window.',
        {
          key: OUTBOUND_SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        }
      );
    }
    resultBase.fromDate = fromDate;

    const apiKey = await resolveGetMyInvoicesApiKey(context);
    const client = new GetMyInvoicesClient({
      apiKey,
      baseUrl: context.config.baseUrl,
      applicationHeader: context.config.applicationHeader,
      userAgent: context.config.userAgent,
    });

    const runtimeDefaults = resolveRuntimeDefaults(context);
    const companyCache: CompanyLookupCache = {
      byKey: new Map<string, GetMyInvoicesCompany>(),
      byNormalizedName: new Map<string, GetMyInvoicesCompany>(),
      loaded: false,
    };
    const countryCache: CountryLookupCache = {
      byName: new Map<string, GetMyInvoicesCountry>(),
      byCode: new Map<string, GetMyInvoicesCountry>(),
      loaded: false,
    };

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
          const syncedDocument = await syncSingleDocument(
            context,
            client,
            document,
            runtimeDefaults,
            companyCache,
            countryCache
          );
          resultBase.synced += 1;

          await context.data.patchDocumentIntegrationMeta({
            documentId: document.id,
            system: SYSTEM,
            externalId: syncedDocument.id,
            status: 'synced',
            lastSyncedAt: new Date().toISOString(),
            metadata: {
              getmyinvoicesDocumentUid: syncedDocument.id,
              documentNumber: syncedDocument.documentNumber,
              direction: 'outbound',
            },
          });
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          context.logger.error('Failed to sync document to GetMyInvoices', {
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
            context.logger.warn(
              'Failed to patch document sync metadata after GetMyInvoices sync error',
              {
                documentId: document.id,
                error: toErrorMessage(metaError),
              }
            );
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
        await context.state.set<GetMyInvoicesSyncState>(OUTBOUND_SYNC_STATE_KEY, {
          lastSuccessfulSyncAt: completedAt,
        });
        checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist GetMyInvoices outbound sync checkpoint.', {
          key: OUTBOUND_SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        });
      }
    }

    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      checkpointUpdated,
      message:
        resultBase.failed === 0
          ? `Synced ${resultBase.synced} document(s) to GetMyInvoices.`
          : `Synced ${resultBase.synced} document(s) with ${resultBase.failed} failure(s).`,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = toErrorMessage(error);
    context.logger.error('GetMyInvoices scheduled outbound sync failed', { error: message });

    return {
      ...resultBase,
      completedAt,
      success: false,
      error: message,
      checkpointUpdated: false,
    };
  }
};

export async function syncSingleDocument(
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>,
  client: GetMyInvoicesClient,
  document: Document,
  runtimeDefaults: RuntimeDefaults,
  companyCache: CompanyLookupCache,
  countryCache: CountryLookupCache
): Promise<{ id: string; documentNumber?: string }> {
  const companyUid = await resolveCompanyUid(
    context,
    client,
    document,
    runtimeDefaults,
    companyCache,
    countryCache
  );

  const existingMapping = await context.mappings.get({
    system: SYSTEM,
    entity: ENTITY_DOCUMENT,
    localId: document.id,
  });

  let existingDocumentUid = toOptionalInt(existingMapping?.externalId);
  const documentNumber = buildDocumentNumber(
    document,
    trimToUndefined(context.config.documentNumberPrefix)
  );

  if (!existingDocumentUid && documentNumber) {
    const existingByNumber = await client.findDocumentByNumber(documentNumber);
    existingDocumentUid = existingByNumber?.documentUid;
  }

  const metadataPayload = buildMetadataPayload({
    document,
    runtimeDefaults,
    companyUid,
    documentNumber,
  });

  let syncedUid: number;
  if (existingDocumentUid) {
    const updated = await client.updateDocument(existingDocumentUid, metadataPayload);
    syncedUid = updated.documentUid;
  } else {
    const file = await context.data.getDocumentFile(document.id);
    const fileName = trimToUndefined(file.fileName) ?? buildFallbackFileName(document);
    const uploaded = await client.uploadDocument({
      ...metadataPayload,
      fileName,
      fileContent: file.contentBase64,
      runOCR: runtimeDefaults.runOcrOnUpload,
    });
    syncedUid = uploaded.documentUid;
  }

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_DOCUMENT,
    localId: document.id,
    externalId: String(syncedUid),
    metadata: {
      documentNumber: documentNumber ?? null,
      direction: 'outbound',
    },
  });

  return {
    id: String(syncedUid),
    documentNumber,
  };
}

export function resolveRuntimeDefaults(
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>
): RuntimeDefaults {
  return {
    defaultDocumentType: context.config.defaultDocumentType ?? 'INCOMING_INVOICE',
    payableDocumentType: context.config.payableDocumentType ?? 'INCOMING_INVOICE',
    receivableDocumentType: context.config.receivableDocumentType ?? 'SALES_INVOICE',
    defaultPaymentMethod: context.config.defaultPaymentMethod ?? 'bank_transfer',
    defaultPaymentStatus: context.config.defaultPaymentStatus ?? 'Unknown',
    defaultCurrency: trimToUndefined(context.config.defaultCurrency) ?? 'EUR',
    autoCreateCompanies: context.config.autoCreateCompanies ?? true,
    defaultCountryUid: toOptionalInt(context.config.defaultCountryUid),
    fallbackCompanyName:
      trimToUndefined(context.config.fallbackCompanyName) ?? 'InvoiceLeaf Company',
    runOcrOnUpload: context.config.runOcrOnUpload ?? false,
  };
}

async function resolveCompanyUid(
  context: IntegrationContext<GetMyInvoicesIntegrationConfig>,
  client: GetMyInvoicesClient,
  document: Document,
  runtimeDefaults: RuntimeDefaults,
  companyCache: CompanyLookupCache,
  countryCache: CountryLookupCache
): Promise<number | undefined> {
  const company = pickCompanyForDocument(document);
  const companyId = trimToUndefined(company?.id);
  const companyName = trimToUndefined(company?.name) ?? runtimeDefaults.fallbackCompanyName;

  if (!companyName) {
    return undefined;
  }

  const cacheKey = companyId ?? `name:${normalizeString(companyName)}`;
  const cached = companyCache.byKey.get(cacheKey);
  if (cached?.companyUid) {
    return cached.companyUid;
  }

  if (companyId) {
    const mapping = await context.mappings.get({
      system: SYSTEM,
      entity: ENTITY_COMPANY,
      localId: companyId,
    });
    const mappedUid = toOptionalInt(mapping?.externalId);
    if (mappedUid) {
      const mappedCompany: GetMyInvoicesCompany = {
        companyUid: mappedUid,
        name: companyName,
      };
      companyCache.byKey.set(cacheKey, mappedCompany);
      const normalizedCompanyName = normalizeString(companyName);
      if (normalizedCompanyName) {
        companyCache.byNormalizedName.set(normalizedCompanyName, mappedCompany);
      }
      return mappedUid;
    }
  }

  await ensureCompanyCacheLoaded(client, companyCache);
  const normalizedName = normalizeString(companyName);
  if (!normalizedName) {
    return undefined;
  }
  const existing = companyCache.byNormalizedName.get(normalizedName);
  if (existing?.companyUid) {
    if (companyId) {
      await context.mappings.upsert({
        system: SYSTEM,
        entity: ENTITY_COMPANY,
        localId: companyId,
        externalId: String(existing.companyUid),
        metadata: {
          companyName: existing.name ?? companyName,
        },
      });
    }
    companyCache.byKey.set(cacheKey, existing);
    return existing.companyUid;
  }

  if (!runtimeDefaults.autoCreateCompanies) {
    return undefined;
  }

  const countryUid = await resolveCountryUid(client, company?.address?.country, runtimeDefaults, countryCache);
  const created = await client.createCompany({
    name: companyName,
    countryUid,
    street: trimToUndefined(company?.address?.street),
    zip: trimToUndefined(company?.address?.postalCode),
    city: trimToUndefined(company?.address?.city),
    email: trimToUndefined(company?.email),
    phone: trimToUndefined(company?.phone),
    taxNumber: trimToUndefined(company?.taxId),
    vatId: trimToUndefined(company?.taxId),
    url: trimToUndefined(company?.website),
  });

  const createdUid = created.companyUid;
  if (!createdUid) {
    throw new Error(`GetMyInvoices did not return companyUid while creating company ${companyName}.`);
  }

  companyCache.byKey.set(cacheKey, created);
  companyCache.byNormalizedName.set(normalizedName, created);

  if (companyId) {
    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_COMPANY,
      localId: companyId,
      externalId: String(createdUid),
      metadata: {
        companyName: created.name ?? companyName,
      },
    });
  }

  return createdUid;
}

async function ensureCompanyCacheLoaded(
  client: GetMyInvoicesClient,
  companyCache: CompanyLookupCache
): Promise<void> {
  if (companyCache.loaded) {
    return;
  }

  const companies = await client.listCompanies();
  for (const company of companies) {
    if (!company.companyUid) {
      continue;
    }
    const name = trimToUndefined(company.name);
    const key = name ? normalizeString(name) : undefined;
    if (key) {
      companyCache.byNormalizedName.set(key, company);
    }
    companyCache.byKey.set(`uid:${company.companyUid}`, company);
  }

  companyCache.loaded = true;
}

async function resolveCountryUid(
  client: GetMyInvoicesClient,
  countryName: string | undefined,
  runtimeDefaults: RuntimeDefaults,
  countryCache: CountryLookupCache
): Promise<number | undefined> {
  if (runtimeDefaults.defaultCountryUid) {
    return runtimeDefaults.defaultCountryUid;
  }

  const normalized = normalizeString(trimToUndefined(countryName));
  if (!normalized) {
    return undefined;
  }

  await ensureCountryCacheLoaded(client, countryCache);

  const byName = countryCache.byName.get(normalized);
  if (byName?.countryUid) {
    return byName.countryUid;
  }

  const byCode = countryCache.byCode.get(normalized);
  if (byCode?.countryUid) {
    return byCode.countryUid;
  }

  return undefined;
}

async function ensureCountryCacheLoaded(
  client: GetMyInvoicesClient,
  countryCache: CountryLookupCache
): Promise<void> {
  if (countryCache.loaded) {
    return;
  }

  const countries = await client.listCountries();
  for (const country of countries) {
    if (!country.countryUid) {
      continue;
    }

    const name = normalizeString(trimToUndefined(country.name));
    const code = normalizeString(trimToUndefined(country.countryCode));

    if (name) {
      countryCache.byName.set(name, country);
    }
    if (code) {
      countryCache.byCode.set(code, country);
    }
  }

  countryCache.loaded = true;
}

interface BuildPayloadInput {
  document: Document;
  runtimeDefaults: RuntimeDefaults;
  companyUid?: number;
  documentNumber?: string;
}

function buildMetadataPayload(input: BuildPayloadInput): GetMyInvoicesDocumentMetadataInput {
  const documentType = chooseDocumentType(input.document, input.runtimeDefaults);
  const documentDate = toDateOnly(input.document.invoiceDate) ?? toDateFromTimestamp(input.document.created);
  const documentDueDate = toDateOnly(input.document.dueDate);

  return {
    companyId: input.companyUid,
    documentType,
    documentNumber: input.documentNumber,
    documentDate,
    documentDueDate,
    orderNumber: trimToUndefined(input.document.purchaseOrderReference),
    paymentMethod: input.runtimeDefaults.defaultPaymentMethod,
    paymentStatus: mapPaymentStatus(input.document, input.runtimeDefaults.defaultPaymentStatus),
    paidAt: toDateOnly(input.document.paymentDate),
    netAmount: toOptionalAmountString(input.document.netAmount),
    grossAmount: toOptionalAmountString(
      firstFinite(input.document.totalAmount, input.document.amountDue, input.document.subtotalAmount)
    ),
    currency:
      trimToUndefined(input.document.currency?.code) ?? input.runtimeDefaults.defaultCurrency,
    taxRates: collectTaxRates(input.document),
    tags: uniqueStrings((input.document.tags ?? []).map((tag) => trimToUndefined(tag.name))),
    note: trimToUndefined(input.document.description),
    lineItems: buildLineItems(input.document),
    isArchived: 0,
  };
}

function chooseDocumentType(
  document: Document,
  runtimeDefaults: RuntimeDefaults
): GetMyInvoicesDocumentType {
  if (document.accountingType === 'PAYABLE') {
    return runtimeDefaults.payableDocumentType;
  }
  if (document.accountingType === 'RECEIVABLE') {
    return runtimeDefaults.receivableDocumentType;
  }
  return runtimeDefaults.defaultDocumentType;
}

function mapPaymentStatus(
  document: Document,
  fallback: GetMyInvoicesPaymentStatus
): GetMyInvoicesPaymentStatus {
  if (document.paymentStatus === 'PAID') {
    return 'Paid';
  }
  if (document.paymentStatus === 'PARTIAL') {
    return 'Partially';
  }
  if (document.paymentStatus === 'UNPAID') {
    return 'Not paid';
  }
  return fallback;
}

function collectTaxRates(document: Document): number[] | undefined {
  const fromTaxItems = uniqueNumbers((document.taxItems ?? []).map((item) => item.taxRate));
  if (fromTaxItems.length > 0) {
    return fromTaxItems;
  }

  const derivedRate = toTaxRateFromAmounts(document.taxAmount, document.netAmount);
  if (derivedRate !== undefined) {
    return [derivedRate];
  }

  return undefined;
}

function buildLineItems(document: Document): GetMyInvoicesDocumentMetadataInput['lineItems'] {
  const result: NonNullable<GetMyInvoicesDocumentMetadataInput['lineItems']> = [];

  for (const item of document.lineItems ?? []) {
    const quantity = toFiniteNumber(item.quantity, 1);
    const safeQuantity = quantity === 0 ? 1 : quantity;
    const totalGross =
      firstFinite(item.totalAmount, item.netAmount, safeQuantity * toFiniteNumber(item.unitPrice, 0)) ??
      0;
    const unitNetPrice = toFiniteNumber(item.unitPrice, totalGross / safeQuantity);
    const taxPercentage = toTaxRateFromAmounts(item.taxAmount, item.netAmount);

    result.push({
      description: trimToUndefined(item.description),
      quantity: safeQuantity,
      unit_net_price: roundTo2(unitNetPrice),
      tax_percentage: taxPercentage,
      total_gross: roundTo2(totalGross),
    });
  }

  const filtered = result.filter((line) => {
    const quantity = line.quantity;
    const unitPrice = line.unit_net_price;
    return Number.isFinite(quantity) && Number.isFinite(unitPrice);
  });

  return filtered.length > 0 ? filtered : undefined;
}

function buildFallbackFileName(document: Document): string {
  const invoiceId = trimToUndefined(document.invoiceId);
  const safeInvoiceId = invoiceId?.replace(/[^a-zA-Z0-9-_]/g, '_');
  if (safeInvoiceId) {
    return `${safeInvoiceId}.pdf`;
  }

  const safeDocumentId = document.id.replace(/[^a-zA-Z0-9-_]/g, '_');
  return `document-${safeDocumentId}.pdf`;
}

function pickCompanyForDocument(document: Document): Document['supplier'] | Document['receiver'] {
  if (document.accountingType === 'PAYABLE') {
    return document.supplier ?? document.receiver;
  }
  return document.receiver ?? document.supplier;
}

function buildDocumentNumber(document: Document, prefix?: string): string | undefined {
  const invoiceId = trimToUndefined(document.invoiceId);
  if (!invoiceId) {
    return undefined;
  }

  const value = `${prefix ?? ''}${invoiceId}`.trim();
  return value.length > 0 ? value.slice(0, 120) : undefined;
}

export function isSyncableDocument(document: Document, includeDraftDocuments: boolean): boolean {
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
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`;
}

function toDateFromTimestamp(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const date = new Date(value as number);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`;
}

function toOptionalAmountString(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return roundTo2(value as number).toFixed(2);
}

function roundTo2(value: number): number {
  return Number(value.toFixed(2));
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
  return Math.max(0, Math.min(100, roundTo2(rate)));
}

function toFiniteNumber(value: number | undefined, fallback: number): number {
  if (Number.isFinite(value)) {
    return value as number;
  }
  return fallback;
}

function firstFinite(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value as number;
    }
  }
  return undefined;
}

function uniqueNumbers(values: Array<number | undefined>): number[] {
  const seen = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    seen.add(roundTo2(value as number));
  }
  return Array.from(seen.values());
}

function uniqueStrings(values: Array<string | undefined>): string[] | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = trimToUndefined(value);
    if (normalized) {
      seen.add(normalized);
    }
  }
  return seen.size > 0 ? Array.from(seen.values()) : undefined;
}

function normalizeString(value: string | undefined): string | undefined {
  const trimmed = trimToUndefined(value);
  if (!trimmed) {
    return undefined;
  }
  return trimmed.toLowerCase();
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
  if (error instanceof GetMyInvoicesApiError) {
    const body = error.responseBody ? ` ${error.responseBody}` : '';
    return `GetMyInvoices API ${error.status}:${body}`.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
