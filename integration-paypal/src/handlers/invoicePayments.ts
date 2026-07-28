import type { IntegrationContext } from '@invoiceleaf/integration-sdk';
import { toDateOnly, trimToUndefined } from '@invoiceleaf/integration-sdk';
import type { PaypalIntegrationConfig } from '../types.js';
import type { PaypalInvoice, PaypalInvoicePaymentTransaction } from '../paypal/client.js';
import { SYSTEM } from './auth.js';

export const ENTITY_PAYMENT = 'payment';

/**
 * Record one payment transaction registered against a PayPal invoice as an
 * InvoiceLeaf payment allocated to the mapped document. Idempotent via
 * mapping + externalRef ("paypal:invpay:{payment_id}") dedupe. Used by both
 * the invoice import (already-paid invoices) and the payment sync.
 */
export async function recordInvoicePaymentTransaction(
  context: IntegrationContext<PaypalIntegrationConfig>,
  invoice: PaypalInvoice,
  documentId: string,
  transaction: PaypalInvoicePaymentTransaction,
  paymentId: string
): Promise<'allocated' | 'unallocated' | 'skipped'> {
  const externalId = `paypal:invpay:${paymentId}`;
  const existing = await context.mappings.findByExternal({
    system: SYSTEM,
    entity: ENTITY_PAYMENT,
    externalId,
  });
  if (existing?.localId) {
    return 'skipped';
  }

  // PayPal omits the transaction amount when the payment covers the full
  // invoice amount.
  const amount =
    trimToUndefined(transaction.amount?.value ?? undefined) ?? trimToUndefined(invoice.amount?.value ?? undefined);
  if (!amount) {
    throw new Error(`PayPal payment ${paymentId} on invoice ${invoice.id} has no amount`);
  }
  const currency =
    trimToUndefined(transaction.amount?.currency_code ?? undefined) ??
    trimToUndefined(invoice.detail?.currency_code ?? invoice.amount?.currency_code ?? undefined);
  if (!currency) {
    throw new Error(`PayPal payment ${paymentId} on invoice ${invoice.id} has no currency`);
  }

  const paymentDate = toDateOnly(transaction.payment_date ?? undefined) ?? new Date().toISOString().slice(0, 10);

  const created = await context.payments.create({
    paymentDate,
    amount,
    currency: currency.toUpperCase(),
    direction: 'INCOMING',
    reference: `PayPal payment ${paymentId}`,
    notes: buildInvoicePaymentNotes(invoice, transaction),
    externalRef: externalId,
    allocations: [{ documentId, amount }],
  });

  if (created.allocationError) {
    context.logger.warn('PayPal invoice payment recorded but allocation failed; payment left unmatched.', {
      paymentId,
      invoiceId: invoice.id,
      localPaymentId: created.paymentId,
      allocationError: created.allocationError,
    });
  }

  await context.mappings.upsert({
    system: SYSTEM,
    entity: ENTITY_PAYMENT,
    localId: created.paymentId,
    externalId,
    metadata: {
      paypalInvoiceId: invoice.id,
      allocatedDocumentId: documentId,
      amount,
      currency: currency.toUpperCase(),
      method: trimToUndefined(transaction.method ?? undefined) ?? null,
      duplicate: created.duplicate,
      allocationError: created.allocationError ?? null,
    },
  });

  return created.allocationError ? 'unallocated' : 'allocated';
}

function buildInvoicePaymentNotes(invoice: PaypalInvoice, transaction: PaypalInvoicePaymentTransaction): string {
  const parts: string[] = [];
  const invoiceNumber = trimToUndefined(invoice.detail?.invoice_number ?? undefined);
  parts.push(`Payment for PayPal invoice ${invoiceNumber ?? invoice.id}`);
  const method = trimToUndefined(transaction.method ?? undefined);
  if (method) {
    parts.push(`Method: ${method}`);
  }
  const note = trimToUndefined(transaction.note ?? undefined);
  if (note) {
    parts.push(note);
  }
  return parts.join('\n');
}
