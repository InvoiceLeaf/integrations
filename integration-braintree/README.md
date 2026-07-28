# InvoiceLeaf Braintree Integration

Records Braintree transactions as payments in InvoiceLeaf and allocates them to existing invoices where possible.

Braintree is a payment gateway without an invoicing product, so this integration does not import any documents. It only records payments. Invoices must already exist in InvoiceLeaf (created there or imported from another source); the integration then matches Braintree transactions to them via the transaction order ID.

## What it does

- **Sync Braintree Payments** (hourly): settled and settling transactions (and, by default, transactions submitted for settlement) are recorded as incoming payments. When the transaction's order ID equals the invoice number of exactly one InvoiceLeaf document, the payment is allocated to that document, marking it as paid (or partially paid). All other transactions are recorded as unmatched payments for manual reconciliation (configurable). Each transaction is recorded at most once (mapping + external reference deduplication).
- **Test Braintree Connection** (action): verifies the API credentials against the Braintree GraphQL ping endpoint and confirms transactions are searchable.

## Setup

1. In the Braintree control panel, go to Settings > API Keys and view your key pair.
2. Install the integration in InvoiceLeaf, enter the **merchant ID**, **public key**, and **environment** (production or sandbox) in the integration settings, and paste the **Private Key** in the connection settings.
3. Run "Test Braintree Connection" to verify.

## Matching rules

- A transaction is matched only when its order ID exactly equals the invoice number of one InvoiceLeaf document. Zero matches or several matches leave the payment unmatched.
- Transactions without an order ID are always recorded as unmatched payments (unless unmatched recording is disabled).
- Authorized, voided, failed, rejected, and declined transactions are never recorded.

## Notes

- Amounts come from Braintree already in the currency's major unit and are passed through unchanged.
- Refunds are not reversed in InvoiceLeaf; record adjustments manually if needed.
- The first run looks back 24 hours by default (configurable); subsequent runs continue from a stored checkpoint.
