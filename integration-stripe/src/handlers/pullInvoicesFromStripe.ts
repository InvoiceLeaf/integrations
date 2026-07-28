import type {
  IntegrationContext,
  IntegrationHandler,
  ScheduleInput,
  StructuredLineItemInput,
} from '@invoiceleaf/integration-sdk';
import { toBoundedInt, toErrorMessage, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type {
  InvoiceImportResult,
  StripeIntegrationConfig,
  StripeInvoiceSyncState,
  SyncFailure,
} from '../types.js';
import type { StripeInvoice, StripeInvoiceLine } from '../stripe/client.js';
import { StripeClient, stripeAmountToDecimalString } from '../stripe/client.js';

const SYSTEM = 'stripe';
const ENTITY_INVOICE = 'invoice';
const ENTITY_COMPANY = 'company';
const ENTITY_PAYMENT = 'payment';
const SYNC_STATE_KEY = 'stripe:invoicesLastSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_MAX_INVOICES_PER_RUN = 50;
const PAGE_SIZE = 50;
const MAX_REPORTED_FAILURES = 25;

export const pullInvoicesFromStripe: IntegrationHandler<
  ScheduleInput,
  InvoiceImportResult,
  StripeIntegrationConfig
> = async (_input, context: IntegrationContext<StripeIntegrationConfig>): Promise<InvoiceImportResult> => {
  const startedAt = new Date().toISOString();
  const failures: SyncFailure[] = [];

  const resultBase: Omit<InvoiceImportResult, 'success' | 'message' | 'error'> = {
    startedAt,
    completedAt: startedAt,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    failures,
    checkpointUpdated: false,
  };

  try {
    const apiKey = await context.credentials.getApiKey(SYSTEM);
    const client = new StripeClient(apiKey, trimToUndefined(context.config.apiBaseUrl));

    const lookbackHours = toBoundedInt(context.config.initialSyncLookbackHours, DEFAULT_LOOKBACK_HOURS, 1, 720);
    const maxInvoicesPerRun = toBoundedInt(context.config.maxInvoicesPerRun, DEFAULT_MAX_INVOICES_PER_RUN, 1, 500);
    const importDrafts = context.config.importDraftInvoices ?? false;
    const importVoid = context.config.importVoidInvoices ?? false;
    const attachPdf = context.config.attachProviderPdf ?? true;

    const fallbackCreatedGt = Math.floor(Date.now() / 1000) - lookbackHours * 3600;
    let createdGt = fallbackCreatedGt;
    try {
      const syncState = await context.state.get<StripeInvoiceSyncState>(SYNC_STATE_KEY);
      if (syncState && Number.isFinite(syncState.lastCreatedAt) && syncState.lastCreatedAt > 0) {
        createdGt = syncState.lastCreatedAt;
      }
    } catch (stateError) {
      context.logger.warn('Could not read Stripe invoice sync checkpoint; using fallback lookback window.', {
        key: SYNC_STATE_KEY,
        error: toErrorMessage(stateError),
      });
    }

    // Stripe lists are reverse-chronological; collect the window first so we
    // can process oldest-first and only advance the checkpoint over a fully
    // processed prefix.
    const invoices: StripeInvoice[] = [];
    let startingAfter: string | undefined;
    let exhaustedWindow = false;
    for (;;) {
      const page = await client.listInvoices({ createdGt, startingAfter, limit: PAGE_SIZE });
      invoices.push(...page.data);
      if (!page.has_more || page.data.length === 0) {
        exhaustedWindow = true;
        break;
      }
      if (invoices.length >= maxInvoicesPerRun) {
        break;
      }
      startingAfter = page.data[page.data.length - 1]!.id;
    }

    invoices.sort((a, b) => a.created - b.created);
    const toProcess = exhaustedWindow ? invoices : invoices.slice(0, maxInvoicesPerRun);

    let maxFullyProcessedCreated = 0;
    let sawFailure = false;

    for (const invoice of toProcess) {
      resultBase.processed += 1;
      try {
        const outcome = await importInvoice(context, client, invoice, { importDrafts, importVoid, attachPdf });
        if (outcome === 'imported') {
          resultBase.imported += 1;
        } else {
          resultBase.skipped += 1;
        }
        if (!sawFailure) {
          maxFullyProcessedCreated = Math.max(maxFullyProcessedCreated, invoice.created);
        }
      } catch (error) {
        sawFailure = true;
        resultBase.failed += 1;
        if (failures.length < MAX_REPORTED_FAILURES) {
          failures.push({ externalId: invoice.id, reason: toErrorMessage(error) });
        }
        context.logger.error('Stripe invoice import failed', {
          invoiceId: invoice.id,
          error: toErrorMessage(error),
        });
      }
    }

    // Advance the checkpoint only across the contiguous, fully processed
    // prefix; failed or unprocessed invoices are retried next run (imports
    // are idempotent via mapping + externalRef dedupe).
    if (maxFullyProcessedCreated > createdGt) {
      try {
        await context.state.set<StripeInvoiceSyncState>(SYNC_STATE_KEY, {
          lastCreatedAt: maxFullyProcessedCreated,
        });
        resultBase.checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist Stripe invoice sync checkpoint.', {
          key: SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        });
      }
    }

    const completedAt = new Date().toISOString();
    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      message:
        resultBase.failed === 0
          ? `Imported ${resultBase.imported} Stripe invoice(s) into InvoiceLeaf.`
          : `Imported Stripe invoices with ${resultBase.failed} failure(s).`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('Stripe invoice import run failed', { error: message });
    return {
      ...resultBase,
      completedAt: new Date().toISOString(),
      success: false,
      error: message,
    };
  }
};

async function importInvoice(
  context: IntegrationContext<StripeIntegrationConfig>,
  client: StripeClient,
  invoice: StripeInvoice,
  options: { importDrafts: boolean; importVoid: boolean; attachPdf: boolean }
): Promise<'imported' | 'skipped'> {
  const status = (invoice.status ?? '').toLowerCase();
  if (status === 'draft' && !options.importDrafts) {
    return 'skipped';
  }
  if (status === 'void' && !options.importVoid) {
    return 'skipped';
  }

  const existing = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    externalId: invoice.id,
  });
  if (existing?.localId) {
    return 'skipped';
  }

  const currency = (invoice.currency ?? 'eur').toLowerCase();
  const invoiceNumber = trimToUndefined(invoice.number ?? undefined);
  const receiverId = await resolveReceiverCompanyId(context, invoice);

  // The invoice is created fully structured from Stripe's API data and skips
  // the OCR/AI processing pipeline entirely.
  const lineItems = buildLineItems(await resolveInvoiceLines(client, invoice), currency, invoice);

  // Attach the Stripe PDF as the original file when available; a download
  // failure downgrades to a document without a file, not an import failure.
  let contentBase64: string | undefined;
  const pdfUrl = trimToUndefined(invoice.invoice_pdf ?? undefined);
  if (options.attachPdf && pdfUrl) {
    try {
      contentBase64 = await client.downloadInvoicePdf(pdfUrl);
    } catch (pdfError) {
      context.logger.warn('Stripe invoice PDF download failed; importing without the file.', {
        invoiceId: invoice.id,
        error: toErrorMessage(pdfError),
      });
    }
  }

  const importResult = await context.data.createStructuredDocument({
    source: 'stripe',
    externalRef: `stripe:invoice:${invoice.id}`,
    description: trimToUndefined(invoice.description ?? undefined)
      ?? `Imported from Stripe invoice ${invoiceNumber ?? invoice.id}`,
    invoiceId: invoiceNumber,
    invoiceDate: toIsoDate(invoice.created),
    dueDate: invoice.due_date ? toIsoDate(invoice.due_date) : undefined,
    currency: currency.toUpperCase(),
    accountingType: 'RECEIVABLE',
    receiverId,
    netAmount: invoice.subtotal !== undefined ? stripeAmountToDecimalString(invoice.subtotal, currency) : undefined,
    taxAmount: invoice.tax != null ? stripeAmountToDecimalString(invoice.tax, currency) : undefined,
    totalAmount: invoice.total !== undefined ? stripeAmountToDecimalString(invoice.total, currency) : undefined,
    amountDue: invoice.amount_due !== undefined ? stripeAmountToDecimalString(invoice.amount_due, currency) : undefined,
    lineItems,
    fileName: contentBase64 ? `${invoiceNumber ?? `stripe-${invoice.id}`}.pdf` : undefined,
    contentType: contentBase64 ? 'application/pdf' : undefined,
    contentBase64,
  });

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: importResult.documentId,
    externalId: invoice.id,
    metadata: {
      direction: 'inbound',
      invoiceNumber: invoiceNumber ?? null,
      stripeStatus: status || null,
      customer: trimToUndefined(invoice.customer ?? undefined) ?? null,
      duplicate: importResult.duplicate,
    },
  });

  await context.data.patchDocumentIntegrationMeta({
    documentId: importResult.documentId,
    system: SYSTEM,
    externalId: invoice.id,
    status: 'synced',
    lastSyncedAt: new Date().toISOString(),
    metadata: {
      stripeInvoiceId: invoice.id,
      invoiceNumber: invoiceNumber ?? null,
      stripeStatus: status || null,
      direction: 'inbound',
      duplicate: importResult.duplicate,
    },
  });

  // An invoice that is already paid in Stripe gets its payment recorded
  // immediately so the document is marked paid without waiting for the
  // charge sync (whose lookback window may not cover old charges).
  if (!importResult.duplicate && status === 'paid' && (invoice.amount_paid ?? 0) > 0) {
    await recordImportedInvoicePayment(context, invoice, importResult.documentId, currency);
  }

  return 'imported';
}

async function resolveInvoiceLines(client: StripeClient, invoice: StripeInvoice): Promise<StripeInvoiceLine[]> {
  const embedded = invoice.lines?.data ?? [];
  if (embedded.length > 0 && !invoice.lines?.has_more) {
    return embedded;
  }
  if (embedded.length === 0 && !invoice.lines?.has_more) {
    return [];
  }
  return client.listInvoiceLines(invoice.id);
}

function buildLineItems(
  lines: StripeInvoiceLine[],
  currency: string,
  invoice: StripeInvoice
): StructuredLineItemInput[] | undefined {
  const items: StructuredLineItemInput[] = [];
  for (const line of lines) {
    const quantity = line.quantity != null && Number.isFinite(line.quantity) ? line.quantity : undefined;
    const unitAmount = line.price?.unit_amount;
    items.push({
      name: trimToUndefined(line.description ?? undefined) ?? `Stripe line ${line.id}`,
      quantity,
      unitAmount: unitAmount != null ? stripeAmountToDecimalString(unitAmount, currency) : undefined,
      totalAmount: stripeAmountToDecimalString(line.amount, currency),
    });
  }
  if (items.length > 0) {
    return items;
  }
  if (invoice.total !== undefined && invoice.total !== 0) {
    return undefined;
  }
  return undefined;
}

async function resolveReceiverCompanyId(
  context: IntegrationContext<StripeIntegrationConfig>,
  invoice: StripeInvoice
): Promise<string | undefined> {
  const customerId = trimToUndefined(invoice.customer ?? undefined);
  const customerName = trimToUndefined(invoice.customer_name ?? undefined);
  const customerEmail = trimToUndefined(invoice.customer_email ?? undefined);
  if (!customerId && !customerName && !customerEmail) {
    return undefined;
  }

  if (customerId) {
    const mapping = await context.mappings.findByExternal({
      system: SYSTEM,
      entity: ENTITY_COMPANY,
      externalId: customerId,
    });
    if (mapping?.localId) {
      return mapping.localId;
    }
  }

  let companyId: string | undefined;
  const query = customerEmail ?? customerName;
  if (query) {
    try {
      const companies = await context.data.listCompanies({ query, limit: 10 });
      const match = companies.items.find((company) => {
        if (customerEmail && company.email && company.email.toLowerCase() === customerEmail.toLowerCase()) {
          return true;
        }
        return !!customerName && company.name === customerName;
      });
      companyId = match?.id;
    } catch (searchError) {
      context.logger.warn('Company lookup failed; creating a new company.', {
        error: toErrorMessage(searchError),
      });
    }
  }

  if (!companyId) {
    const created = await context.data.createCompany({
      name: customerName ?? customerEmail ?? `Stripe customer ${customerId}`,
      email: customerEmail,
    });
    companyId = created.companyId;
  }

  if (customerId && companyId) {
    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_COMPANY,
      localId: companyId,
      externalId: customerId,
      metadata: {
        customerName: customerName ?? null,
        customerEmail: customerEmail ?? null,
      },
    });
  }

  return companyId;
}

async function recordImportedInvoicePayment(
  context: IntegrationContext<StripeIntegrationConfig>,
  invoice: StripeInvoice,
  documentId: string,
  currency: string
): Promise<void> {
  const chargeId = trimToUndefined(invoice.charge ?? undefined);
  const externalId = chargeId ?? `invoicepaid:${invoice.id}`;

  try {
    const existing = await context.mappings.findByExternal({
      system: SYSTEM,
      entity: ENTITY_PAYMENT,
      externalId,
    });
    if (existing?.localId) {
      return;
    }

    const amount = stripeAmountToDecimalString(invoice.amount_paid ?? 0, currency);
    const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
    const created = await context.payments.create({
      paymentDate: toIsoDate(paidAt),
      amount,
      currency: currency.toUpperCase(),
      direction: 'INCOMING',
      reference: chargeId ? `Stripe charge ${chargeId}` : `Stripe invoice ${invoice.id} payment`,
      externalRef: chargeId ? `stripe:charge:${chargeId}` : `stripe:invoicepaid:${invoice.id}`,
      allocations: [{ documentId, amount }],
    });

    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_PAYMENT,
      localId: created.paymentId,
      externalId,
      metadata: {
        stripeInvoiceId: invoice.id,
        allocatedDocumentId: documentId,
        amount,
        currency: currency.toUpperCase(),
        duplicate: created.duplicate,
        allocationError: created.allocationError ?? null,
        source: 'invoice-import',
      },
    });
  } catch (paymentError) {
    // The invoice import itself succeeded; the payment will be retried by the
    // charge sync (dedupe keeps this safe), so only log here.
    context.logger.warn('Could not record payment for already-paid Stripe invoice.', {
      invoiceId: invoice.id,
      error: toErrorMessage(paymentError),
    });
  }
}

function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
