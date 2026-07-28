# InvoiceLeaf Stripe Integration

Two-way Stripe sync: imports invoices created in Stripe as fully structured InvoiceLeaf documents, pushes InvoiceLeaf invoices to Stripe for payment collection, and records Stripe payments in the InvoiceLeaf accounting model.

## What it does

- **Import Stripe Invoices** (hourly): finalized Stripe invoices are created as structured documents directly from the Stripe API data (invoice number, dates, amounts, line items, customer resolved to a company). They do NOT run through the OCR processing pipeline. The Stripe PDF is attached as the original file when available. Invoices already paid in Stripe get their payment recorded immediately, so they arrive marked as paid.
- **Push Invoices to Stripe** (hourly): unpaid receivable InvoiceLeaf invoices are created as Stripe invoices (customer resolved or created by email, line items mapped, finalized so they are payable). Documents imported from Stripe are never pushed back.
- **Sync Stripe Payments** (hourly): succeeded charges are recorded as incoming payments. When a charge pays a synced invoice (imported or pushed), the payment is allocated to that document, marking it paid or partially paid. Other charges are recorded as unmatched payments for manual reconciliation (configurable).
- **Test Stripe Connection** (action): verifies the API key can read invoices and charges.

## Setup

1. In the Stripe dashboard, go to Developers > API keys and create a **restricted key** with read access to Invoices, Charges, and Customers. If you use the push direction, the key also needs write access to Invoices, Invoice Items, and Customers.
2. Install the integration in InvoiceLeaf and paste the key in the connection settings.
3. Run "Test Stripe Connection" to verify.

## Notes

- Refunds are not reversed in InvoiceLeaf; a refunded charge is annotated in the payment notes.
- Draft and void Stripe invoices are skipped on import by default (configurable).
- Paid or partially paid documents are never pushed, so customers cannot be double-charged.
- Amounts are converted from Stripe's smallest currency unit, including zero-decimal currencies (JPY, KRW, ...).
