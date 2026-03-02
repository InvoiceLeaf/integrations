# InvoiceLeaf Integrations

This directory contains npm packages for integrating with InvoiceLeaf.

## Packages

| Package | Description |
|---------|-------------|
| [slack-notifications](./slack-notifications) | Slack webhook notifications for invoice events |
| [telegram-bot](./telegram-bot) | Telegram bot payload builders and callback action outputs |
| [integration-smtp-mail](./integration-smtp-mail) | SMTP send + IMAP PDF crawl and import |
| [integration-xero](./integration-xero) | Scheduled InvoiceLeaf to Xero invoice synchronization |
| [integration-sevdesk](./integration-sevdesk) | Scheduled InvoiceLeaf to sevDesk invoice synchronization |
| [integration-getmyinvoices](./integration-getmyinvoices) | Bi-directional InvoiceLeaf and GetMyInvoices document synchronization |

## Development

Each package is organized as an independent npm package with its own `package.json`.

## Publishing

Packages are published to npm under the `@invoiceleaf` scope.
