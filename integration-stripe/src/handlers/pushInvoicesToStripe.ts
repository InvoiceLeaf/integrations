import type { Document, IntegrationContext, IntegrationHandler, ScheduleInput } from '@invoiceleaf/integration-sdk';
import { firstFinite, toBoundedInt, toErrorMessage, toFiniteNumber, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type {
  PushFailure,
  PushInvoicesResult,
  StripeIntegrationConfig,
  StripePushSyncState,
} from '../types.js';
import { StripeClient, decimalToStripeAmount } from '../stripe/client.js';

const SYSTEM = 'stripe';
const ENTITY_INVOICE = 'invoice';
const ENTITY_COMPANY = 'company';
const SYNC_STATE_KEY = 'stripe:pushLastSyncAt';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_MAX_PUSH_PER_RUN = 50;
const DEFAULT_DAYS_UNTIL_DUE = 30;
const PAGE_SIZE = 50;
const MAX_REPORTED_FAILURES = 25;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pushes InvoiceLeaf receivable invoices to Stripe as invoices so customers
 * can pay them there. Payments collected in Stripe flow back through the
 * charge sync, which allocates them to the original document via the mapping
 * created here (marking it paid).
 */
export const pushInvoicesToStripe: IntegrationHandler<
  ScheduleInput,
  PushInvoicesResult,
  StripeIntegrationConfig
> = async (_input, context: IntegrationContext<StripeIntegrationConfig>): Promise<PushInvoicesResult> => {
  const startedAt = new Date().toISOString();
  const failures: PushFailure[] = [];

  const resultBase: Omit<PushInvoicesResult, 'success' | 'message' | 'error'> = {
    startedAt,
    completedAt: startedAt,
    processed: 0,
    pushed: 0,
    skipped: 0,
    failed: 0,
    failures,
    checkpointUpdated: false,
  };

  try {
    const apiKey = await context.credentials.getApiKey(SYSTEM);
    const client = new StripeClient(apiKey, trimToUndefined(context.config.apiBaseUrl));

    const lookbackHours = toBoundedInt(context.config.initialSyncLookbackHours, DEFAULT_LOOKBACK_HOURS, 1, 720);
    const maxPushPerRun = toBoundedInt(context.config.maxPushPerRun, DEFAULT_MAX_PUSH_PER_RUN, 1, 500);
    const daysUntilDue = toBoundedInt(context.config.daysUntilDue, DEFAULT_DAYS_UNTIL_DUE, 1, 365);
    const autoFinalize = context.config.autoFinalizeInvoices ?? true;
    const includeDrafts = context.config.includeDraftDocuments ?? false;

    const fallbackFromDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
    let fromDate = fallbackFromDate;
    try {
      const syncState = await context.state.get<StripePushSyncState>(SYNC_STATE_KEY);
      const checkpointValue = syncState?.lastSuccessfulSyncAt;
      if (checkpointValue && Number.isFinite(Date.parse(checkpointValue))) {
        fromDate = checkpointValue;
      }
    } catch (stateError) {
      context.logger.warn('Could not read Stripe push checkpoint; using fallback lookback window.', {
        key: SYNC_STATE_KEY,
        error: toErrorMessage(stateError),
      });
    }

    let page = 1;
    let hasMore = true;
    while (hasMore && resultBase.processed < maxPushPerRun) {
      const parsedStartDate = Date.parse(fromDate);
      const pageResult = await context.data.listDocuments({
        startDate: Number.isFinite(parsedStartDate) ? parsedStartDate : Date.parse(fallbackFromDate),
        page,
        limit: Math.min(PAGE_SIZE, maxPushPerRun - resultBase.processed),
      });

      if (pageResult.items.length === 0) {
        break;
      }

      for (const document of pageResult.items) {
        if (resultBase.processed >= maxPushPerRun) {
          break;
        }
        resultBase.processed += 1;

        if (!isPushableDocument(document, includeDrafts)) {
          resultBase.skipped += 1;
          continue;
        }

        try {
          const outcome = await pushDocument(context, client, document, { daysUntilDue, autoFinalize });
          if (outcome === 'pushed') {
            resultBase.pushed += 1;
          } else {
            resultBase.skipped += 1;
          }
        } catch (error) {
          resultBase.failed += 1;
          const message = toErrorMessage(error);
          if (failures.length < MAX_REPORTED_FAILURES) {
            failures.push({ documentId: document.id, reason: message });
          }
          context.logger.error('Failed to push document to Stripe', {
            documentId: document.id,
            error: message,
          });

          try {
            await context.data.patchDocumentIntegrationMeta({
              documentId: document.id,
              system: SYSTEM,
              status: 'failed',
              lastSyncedAt: new Date().toISOString(),
              errorSummary: message.slice(0, 500),
            });
          } catch (metaError) {
            context.logger.warn('Failed to patch document sync metadata after Stripe push error', {
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
    if (resultBase.failed === 0) {
      try {
        await context.state.set<StripePushSyncState>(SYNC_STATE_KEY, {
          lastSuccessfulSyncAt: completedAt,
        });
        resultBase.checkpointUpdated = true;
      } catch (stateError) {
        context.logger.warn('Could not persist Stripe push checkpoint.', {
          key: SYNC_STATE_KEY,
          error: toErrorMessage(stateError),
        });
      }
    }

    return {
      ...resultBase,
      completedAt,
      success: resultBase.failed === 0,
      message:
        resultBase.failed === 0
          ? `Pushed ${resultBase.pushed} invoice(s) to Stripe.`
          : `Pushed invoices to Stripe with ${resultBase.failed} failure(s).`,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    context.logger.error('Stripe push run failed', { error: message });
    return {
      ...resultBase,
      completedAt: new Date().toISOString(),
      success: false,
      error: message,
    };
  }
};

function isPushableDocument(document: Document, includeDrafts: boolean): boolean {
  if (!document.id || document.deleted || trimToUndefined(document.duplicateOfId)) {
    return false;
  }
  // Only receivable invoices are pushed: Stripe collects money owed to the user.
  if (document.accountingType !== 'RECEIVABLE') {
    return false;
  }
  if (document.documentStatus === 'CANCELLED') {
    return false;
  }
  if (!includeDrafts && document.documentStatus === 'DRAFT') {
    return false;
  }
  // Already (partially) paid invoices are not pushed — collecting the full
  // amount again through Stripe would double-charge the customer.
  if (document.paymentStatus === 'PAID' || document.paymentStatus === 'PARTIAL') {
    return false;
  }
  const amount = firstFinite(document.totalAmount, document.amountDue, document.netAmount);
  if (amount === undefined || amount === 0) {
    return false;
  }
  return true;
}

async function pushDocument(
  context: IntegrationContext<StripeIntegrationConfig>,
  client: StripeClient,
  document: Document,
  options: { daysUntilDue: number; autoFinalize: boolean }
): Promise<'pushed' | 'skipped'> {
  // A mapping in either direction means this document already exists in
  // Stripe: outbound (pushed before) or inbound (imported FROM Stripe, which
  // must never be pushed back — that would loop).
  const existingMapping = await context.mappings.get({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: document.id,
  });
  if (existingMapping?.externalId) {
    return 'skipped';
  }
  if (document.uploadSource === 'stripe') {
    return 'skipped';
  }

  const currency = (trimToUndefined(document.currency?.code) ?? 'EUR').toLowerCase();
  const customerId = await resolveCustomerId(context, client, document);

  const invoice = await client.createInvoice({
    customerId,
    currency,
    daysUntilDue: computeDaysUntilDue(document, options.daysUntilDue),
    description: buildInvoiceDescription(document),
    invoiceleafDocumentId: document.id,
  });

  const lines = buildStripeLines(document, currency);
  for (const line of lines) {
    await client.createInvoiceItem({
      customerId,
      invoiceId: invoice.id,
      amountCents: line.amountCents,
      currency,
      description: line.description,
    });
  }

  let finalized = invoice;
  if (options.autoFinalize) {
    finalized = await client.finalizeInvoice(invoice.id);
  }

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_INVOICE,
    localId: document.id,
    externalId: invoice.id,
    metadata: {
      direction: 'outbound',
      invoiceNumber: trimToUndefined(document.invoiceId) ?? null,
      stripeNumber: trimToUndefined(finalized.number ?? undefined) ?? null,
      hostedInvoiceUrl: trimToUndefined(finalized.hosted_invoice_url ?? undefined) ?? null,
      finalized: options.autoFinalize,
    },
  });

  await context.data.patchDocumentIntegrationMeta({
    documentId: document.id,
    system: SYSTEM,
    externalId: invoice.id,
    status: 'synced',
    lastSyncedAt: new Date().toISOString(),
    metadata: {
      direction: 'outbound',
      stripeInvoiceId: invoice.id,
      hostedInvoiceUrl: trimToUndefined(finalized.hosted_invoice_url ?? undefined) ?? null,
      finalized: options.autoFinalize,
    },
  });

  return 'pushed';
}

async function resolveCustomerId(
  context: IntegrationContext<StripeIntegrationConfig>,
  client: StripeClient,
  document: Document
): Promise<string> {
  const company = document.receiver ?? undefined;
  const companyId = trimToUndefined(company?.id);

  if (companyId) {
    const mapping = await context.mappings.get({
      system: SYSTEM,
      entity: ENTITY_COMPANY,
      localId: companyId,
    });
    if (mapping?.externalId) {
      return mapping.externalId;
    }
  }

  const name =
    trimToUndefined(company?.name) ??
    trimToUndefined(context.config.fallbackCustomerName) ??
    'InvoiceLeaf Customer';
  const email = trimToUndefined(company?.email);

  let customer = email ? await client.findCustomerByEmail(email) : undefined;
  if (!customer) {
    customer = await client.createCustomer({ name, email });
  }

  if (companyId) {
    await context.mappings.upsert({
      system: SYSTEM,
      entity: ENTITY_COMPANY,
      localId: companyId,
      externalId: customer.id,
      metadata: {
        customerName: name,
        customerEmail: email ?? null,
      },
    });
  }

  return customer.id;
}

function computeDaysUntilDue(document: Document, fallbackDays: number): number {
  const invoiceDate = document.invoiceDate ? Date.parse(document.invoiceDate) : Number.NaN;
  const dueDate = document.dueDate ? Date.parse(document.dueDate) : Number.NaN;
  const reference = Number.isFinite(invoiceDate) ? invoiceDate : Date.now();
  if (!Number.isFinite(dueDate)) {
    return fallbackDays;
  }
  const days = Math.ceil((dueDate - reference) / MS_PER_DAY);
  return Math.min(Math.max(days, 1), 365);
}

function buildInvoiceDescription(document: Document): string {
  const invoiceNumber = trimToUndefined(document.invoiceId);
  const description = trimToUndefined(document.description);
  if (invoiceNumber && description) {
    return `${invoiceNumber}: ${description}`.slice(0, 500);
  }
  return (description ?? (invoiceNumber ? `Invoice ${invoiceNumber}` : `InvoiceLeaf document ${document.id}`)).slice(0, 500);
}

interface StripeLineInput {
  amountCents: number;
  description: string;
}

function buildStripeLines(document: Document, currency: string): StripeLineInput[] {
  const lines: StripeLineInput[] = [];
  for (const item of document.lineItems ?? []) {
    const quantity = Math.max(Math.abs(toFiniteNumber(item.quantity, 1)) || 1, 1);
    const rawAmount = firstFinite(item.totalAmount, item.netAmount, quantity * toFiniteNumber(item.unitAmount, 0)) ?? 0;
    const amount = Math.abs(rawAmount);
    if (amount === 0) {
      continue;
    }
    lines.push({
      amountCents: decimalToStripeAmount(amount, currency),
      description: trimToUndefined(item.name) ?? buildInvoiceDescription(document),
    });
  }
  if (lines.length > 0) {
    return lines;
  }

  const fallbackAmount = firstFinite(document.totalAmount, document.amountDue, document.netAmount);
  if (fallbackAmount === undefined || fallbackAmount === 0) {
    throw new Error(
      `Document ${document.id} has no line items and no valid amount. Cannot create a Stripe invoice with 0.`
    );
  }
  return [
    {
      amountCents: decimalToStripeAmount(Math.abs(fallbackAmount), currency),
      description: buildInvoiceDescription(document),
    },
  ];
}
