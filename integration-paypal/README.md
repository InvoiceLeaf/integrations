# InvoiceLeaf PayPal Integration

Two-way sync between PayPal Invoicing and InvoiceLeaf: imports PayPal invoices as fully structured documents, pushes InvoiceLeaf invoices to PayPal for payment collection, and records PayPal payments in the InvoiceLeaf accounting model.

## What it does

- **Import PayPal Invoices** (hourly): invoices created in PayPal Invoicing are imported as fully structured InvoiceLeaf documents (invoice number, dates, amounts, line items, recipient company) straight from the PayPal API, skipping the OCR processing pipeline. Invoices that are already paid in PayPal arrive with their payments recorded and allocated, so they show up as paid. Each import is idempotent (mapping + external reference deduplication).
- **Push Invoices to PayPal** (hourly): unpaid receivable InvoiceLeaf invoices are created as PayPal draft invoices so customers can pay them via PayPal. With auto-send enabled, PayPal sends the invoice to the customer by email. Documents imported from PayPal are never pushed back.
- **Sync PayPal Payments** (hourly): payments registered against synced PayPal invoices are recorded as incoming payments and allocated to the matching document, marking it paid (or partially paid). Optionally, other successful PayPal transactions are recorded as unmatched payments for manual reconciliation via the Transaction Search API.
- **Test PayPal Connection** (action): verifies the REST app credentials can obtain an OAuth token, read invoices, and use Transaction Search.

## Setup

1. In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/), open Apps & Credentials and create (or select) a REST app.
2. Install the integration in InvoiceLeaf, paste the app's **Client Secret** in the connection settings, and enter the **Client ID** and environment (live or sandbox) in the integration configuration.
3. Optional: enable the **Transaction Search** feature on the REST app if you want unmatched PayPal transactions recorded as payments.
4. Run "Test PayPal Connection" to verify.

## Notes

- Authentication uses the OAuth client credentials flow; the access token is cached in installation state and refreshed automatically before expiry or after a 401.
- PayPal Invoicing v2 offers no invoice PDF download endpoint, so imported documents carry the structured data from the API but no original file.
- Amounts are decimal strings in the PayPal API and are passed through without conversion; line totals are computed from quantity, unit amount, and tax percent.
- The PayPal invoice list cannot be filtered by creation time, so the import deduplicates purely via mappings and caps the pages walked per run.
- Transaction Search is limited to a 31 day window per request; the sync clamps its checkpoint window accordingly and catches up run by run.
- If Transaction Search is not enabled on the REST app, the payment sync still succeeds and reports the feature as unavailable instead of failing.
- Auto-send is off by default because sending a pushed invoice emails the customer.
