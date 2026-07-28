import type {
  IntegrationContext,
  IntegrationHandler,
  ScheduleInput,
  StructuredLineItemInput,
} from '@invoiceleaf/integration-sdk';
import { toBoundedInt, toErrorMessage, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { InvoiceImportResult, PaypalIntegrationConfig, SyncFailure } from '../types.js';
import type { PaypalClient, PaypalInvoice } from '../paypal/client.js';
import { createPaypalClient, SYSTEM } from './auth.js';
import { recordInvoicePaymentTransaction } from './invoicePayments.js';

const ENTITY_INVOICE = 'invoice';
const ENTITY_COMPANY = 'company';
const DEFAULT_MAX_INVOICES_PER_RUN = 50;
const PAGE_SIZE = 50;
const MAX_REPORTED_FAILURES = 25;
const PAID_ON_IMPORT_STATUSES = new Set(['PAID', 'MARKED_AS_PAID']);

export const pullInvoicesFromPaypal: IntegrationHandler<
  ScheduleInput,
  InvoiceImportResult,
  PaypalIntegrationConfig
> = async (_input, context: IntegrationContext<PaypalIntegrationConfig>): Promise<InvoiceImportResult> => {
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
  };

  try {
    const client = await createPaypalClient(context);
    const maxInvoicesPerRun = toBoundedInt(context.config.maxInvoicesPerRun, DEFAULT_MAX_INVOICES_PER_RUN, 1, 500);
    const importDrafts = context.config.importDraftInvoices ?? false;

    // The invoice list has no created-since filter, so there is no time
    // checkpoint here: dedupe is purely mapping-based and the page walk is
    // capped per run.
    const invoices = await collectInvoices(client, maxInvoicesPerRun);

    for (const invoice of invoices) {
      resultBase.processed += 1;
      try {
        const outcome = await importInvoice(context, client, invoice, { importDrafts });
        if (outcome === 'imported') {
          resultBase.imported += 1;
        } else {
          resultBase.skipped += 1;
        }
      } catch (error) {
        resultBase.failed += 1;
        if (failures.length < MAX_REPORTED_FAILURES) {
          failures.push({ externalId: invoice.id, reason: toErrorMessage(error) });
        }
        context.logger.error('PayPal invoice import failed', {
          invoiceId: invoice.id,
          error: toErrorMessage(error),
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
          ? `Imported ${resultBase.imported} PayPal invoice(s) into InvoiceLeaf.`
          : `Imported PayPal invoices with ${resultBase.failed} failure(s).`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('PayPal invoice import run failed', { error: message });
    return {
      ...resultBase,
      completedAt: new Date().toISOString(),
      success: false,
      error: message,
    };
  }
};

/** Walk the invoice list pages until the cap or the last page is reached. */
async function collectInvoices(client: PaypalClient, maxInvoices: number): Promise<PaypalInvoice[]> {
  const invoices: PaypalInvoice[] = [];
  let page = 1;
  for (;;) {
    const response = await client.listInvoices({ page, pageSize: PAGE_SIZE });
    const items = response.items ?? [];
    invoices.push(...items);
    const totalPages = response.total_pages;
    const lastPage = items.length === 0 || !Number.isFinite(totalPages) || page >= (totalPages as number);
    if (lastPage || invoices.length >= maxInvoices) {
      break;
    }
    page += 1;
  }
  return invoices.slice(0, maxInvoices);
}

async function importInvoice(
  context: IntegrationContext<PaypalIntegrationConfig>,
  client: PaypalClient,
  invoice: PaypalInvoice,
  options: { importDrafts: boolean }
): Promise<'imported' | 'skipped'> {
  const status = (invoice.status ?? '').toUpperCase();
  if (status === 'DRAFT' && !options.importDrafts) {
    return 'skipped';
  }
  if (status === 'CANCELLED') {
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

  const invoiceNumber = trimToUndefined(invoice.detail?.invoice_number ?? undefined);
  const currency = trimToUndefined(invoice.detail?.currency_code ?? invoice.amount?.currency_code ?? undefined);
  const receiverId = await resolveReceiverCompanyId(context, invoice);

  // The document is created fully structured from PayPal's API data and skips
  // the OCR/AI processing pipeline entirely. PayPal Invoicing v2 offers no
  // invoice PDF download endpoint, so no original file is attached.
  const importResult = await context.data.createStructuredDocument({
    source: 'paypal',
    externalRef: `paypal:invoice:${invoice.id}`,
    description:
      trimToUndefined(invoice.detail?.note ?? undefined) ??
      `Imported from PayPal invoice ${invoiceNumber ?? invoice.id}`,
    invoiceId: invoiceNumber,
    invoiceDate: trimToUndefined(invoice.detail?.invoice_date ?? undefined),
    dueDate: trimToUndefined(invoice.detail?.payment_term?.due_date ?? undefined),
    currency: currency?.toUpperCase(),
    accountingType: 'RECEIVABLE',
    receiverId,
    netAmount: trimToUndefined(invoice.amount?.breakdown?.item_total?.value ?? undefined),
    taxAmount: trimToUndefined(invoice.amount?.breakdown?.tax_total?.value ?? undefined),
    totalAmount: trimToUndefined(invoice.amount?.value ?? undefined),
    amountDue: trimToUndefined(invoice.due_amount?.value ?? undefined),
    lineItems: buildLineItems(invoice),
  });

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: importResult.documentId,
    externalId: invoice.id,
    metadata: {
      direction: 'inbound',
      invoiceNumber: invoiceNumber ?? null,
      paypalStatus: status || null,
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
      paypalInvoiceId: invoice.id,
      invoiceNumber: invoiceNumber ?? null,
      paypalStatus: status || null,
      direction: 'inbound',
      duplicate: importResult.duplicate,
    },
  });

  // An invoice that is already paid in PayPal gets its payments recorded
  // immediately so the document arrives marked paid without waiting for the
  // payment sync.
  if (!importResult.duplicate && PAID_ON_IMPORT_STATUSES.has(status)) {
    await recordPaymentsForImportedInvoice(context, client, invoice.id, importResult.documentId);
  }

  return 'imported';
}

function buildLineItems(invoice: PaypalInvoice): StructuredLineItemInput[] | undefined {
  const items: StructuredLineItemInput[] = [];
  for (const item of invoice.items ?? []) {
    const quantity = trimToUndefined(item.quantity ?? undefined);
    const unitAmount = trimToUndefined(item.unit_amount?.value ?? undefined);
    const taxPercentage = trimToUndefined(item.tax?.percent ?? undefined);
    const computed = computeLineTotals(quantity, unitAmount, taxPercentage);
    items.push({
      name: trimToUndefined(item.name ?? undefined) ?? 'PayPal invoice item',
      quantity,
      unitAmount,
      taxPercentage,
      netAmount: computed.netAmount,
      taxAmount: computed.taxAmount,
      totalAmount: computed.totalAmount,
    });
  }
  return items.length > 0 ? items : undefined;
}

/**
 * PayPal invoice items carry quantity, unit amount, and tax percent but no
 * line totals; compute them in integer cents to avoid float drift.
 */
function computeLineTotals(
  quantity: string | undefined,
  unitAmount: string | undefined,
  taxPercentage: string | undefined
): { netAmount?: string; taxAmount?: string; totalAmount?: string } {
  const qty = Number(quantity ?? '1');
  const unit = Number(unitAmount);
  if (!Number.isFinite(qty) || !Number.isFinite(unit)) {
    return {};
  }
  const netCents = Math.round(qty * unit * 100);
  const percent = Number(taxPercentage);
  if (!Number.isFinite(percent)) {
    return { netAmount: centsToDecimal(netCents), totalAmount: centsToDecimal(netCents) };
  }
  const taxCents = Math.round((netCents * percent) / 100);
  return {
    netAmount: centsToDecimal(netCents),
    taxAmount: centsToDecimal(taxCents),
    totalAmount: centsToDecimal(netCents + taxCents),
  };
}

function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Resolve the PayPal invoice recipient to an InvoiceLeaf company: mapping by
 * external ref first, then an exact email/name match, then a new company.
 */
async function resolveReceiverCompanyId(
  context: IntegrationContext<PaypalIntegrationConfig>,
  invoice: PaypalInvoice
): Promise<string | undefined> {
  const billing = invoice.primary_recipients?.[0]?.billing_info;
  const email = trimToUndefined(billing?.email_address ?? undefined);
  const name = resolveRecipientName(invoice);
  if (!email && !name) {
    return undefined;
  }

  // PayPal recipients have no stable customer id; the email (or name as a
  // fallback) is used as the external mapping key.
  const externalId = (email ?? name)!.toLowerCase();
  const mapping = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_COMPANY,
    externalId,
  });
  if (mapping?.localId) {
    return mapping.localId;
  }

  let companyId: string | undefined;
  const query = email ?? name;
  if (query) {
    try {
      const companies = await context.data.listCompanies({ query, limit: 10 });
      const match = companies.items.find((company) => {
        if (email && company.email && company.email.toLowerCase() === email.toLowerCase()) {
          return true;
        }
        return !!name && company.name === name;
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
      name: name ?? email!,
      email,
    });
    companyId = created.companyId;
  }

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_COMPANY,
    localId: companyId,
    externalId,
    metadata: {
      recipientName: name ?? null,
      recipientEmail: email ?? null,
    },
  });

  return companyId;
}

function resolveRecipientName(invoice: PaypalInvoice): string | undefined {
  const billing = invoice.primary_recipients?.[0]?.billing_info;
  if (!billing) {
    return undefined;
  }
  const businessName = trimToUndefined(billing.business_name ?? undefined);
  if (businessName) {
    return businessName;
  }
  const fullName = trimToUndefined(billing.name?.full_name ?? undefined);
  if (fullName) {
    return fullName;
  }
  const parts = [billing.name?.given_name, billing.name?.surname]
    .map((part) => trimToUndefined(part ?? undefined))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

async function recordPaymentsForImportedInvoice(
  context: IntegrationContext<PaypalIntegrationConfig>,
  client: PaypalClient,
  invoiceId: string,
  documentId: string
): Promise<void> {
  try {
    // The list response omits the payments block; the detail carries it.
    const detail = await client.getInvoice(invoiceId);
    for (const transaction of detail.payments?.transactions ?? []) {
      const paymentId = trimToUndefined(transaction.payment_id ?? undefined);
      if (!paymentId) {
        // External cash or check payments carry no PayPal payment id.
        continue;
      }
      await recordInvoicePaymentTransaction(context, detail, documentId, transaction, paymentId);
    }
  } catch (paymentError) {
    // The invoice import itself succeeded; the payment sync retries this
    // (dedupe keeps it safe), so only log here.
    context.logger.warn('Could not record payments for already-paid PayPal invoice.', {
      invoiceId,
      error: toErrorMessage(paymentError),
    });
  }
}
