# InvoiceLeaf Integrations

This directory contains npm packages for integrating with InvoiceLeaf.

## Packages

| Package | Description |
|---------|-------------|
| [slack-notifications](./slack-notifications) | Slack webhook notifications for invoice events |
| [telegram-bot](./telegram-bot) | Telegram bot payload builders and callback action outputs |
| [integration-smtp-mail](./integration-smtp-mail) | SMTP send + IMAP PDF crawl and import |
| [integration-gmail](./integration-gmail) | Gmail OAuth mailbox crawl and PDF import |
| [integration-outlook](./integration-outlook) | Outlook OAuth mailbox crawl and PDF import |
| [integration-dropbox](./integration-dropbox) | Dropbox PDF import, directory lookup, and document upload |
| [integration-google-drive](./integration-google-drive) | Google Drive PDF import, directory lookup, and document upload |
| [integration-xero](./integration-xero) | Scheduled InvoiceLeaf to Xero invoice synchronization |
| [integration-quickbooks](./integration-quickbooks) | Scheduled InvoiceLeaf to QuickBooks Online synchronization |
| [integration-zoho](./integration-zoho) | Scheduled InvoiceLeaf to Zoho Books invoice synchronization |
| [integration-lexoffice](./integration-lexoffice) | Scheduled InvoiceLeaf document synchronization to lexoffice vouchers |
| [integration-sevdesk](./integration-sevdesk) | Scheduled InvoiceLeaf to sevDesk invoice synchronization |
| [integration-getmyinvoices](./integration-getmyinvoices) | Bi-directional InvoiceLeaf and GetMyInvoices document synchronization |
| [integration-datev](./integration-datev) | DATEV accounting:dxso-jobs integration with endpoint discovery and dxso lifecycle actions |

## Development

Each package is organized as an independent npm package with its own `package.json`.

## Publishing

Packages are published to npm under the `@invoiceleaf` scope.
