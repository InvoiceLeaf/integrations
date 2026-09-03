# InvoiceLeaf Integrations

This directory contains npm packages for integrating with InvoiceLeaf.

## Packages

| Package | Description |
|---------|-------------|
| [slack-notifications](./slack-notifications) | Slack webhook notifications for invoice events |
| [telegram-bot](./telegram-bot) | Telegram bot payload builders and callback action outputs |
| [discord-bot](./discord-bot) | Discord notification payload builders and callback action outputs |
| [messenger-bot](./messenger-bot) | Facebook Messenger notification payload builders |
| [whatsapp-bot](./whatsapp-bot) | WhatsApp notification payload builders via the WhatsApp Business API |
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
| [integration-elster](./integration-elster) | German USt-VA (XML) and EÜR (Excel) generation, plus direct USt-VA filing via ERiC |
| [integration-finanzonline](./integration-finanzonline) | Austrian U30 and ZM generation, plus direct FinanzOnline filing |
| [integration-stripe](./integration-stripe) | Two-way Stripe sync: invoices in both directions, plus payment recording and allocation |
| [integration-paypal](./integration-paypal) | Two-way PayPal sync: invoices in both directions, plus payment recording and allocation |
| [integration-braintree](./integration-braintree) | Records Braintree transactions as payments and allocates them to invoices (payments only) |

## Development

Each package is organized as an independent npm package with its own
`package.json`. The SDK is declared as a peer and dev dependency, so it must be
resolvable from npm before `npm install` will succeed in a package directory.

```bash
cd integrations/integration-stripe
npm install
npm run typecheck
npm test
npm run build
```

Plugins consume `@invoiceleaf/integration-sdk` for types only; the plugin
runtime aliases SDK imports to its own bundled copy at execution time. Declare
the lowest SDK major that the package actually needs as the peer range.

## Publishing

Packages are published to npm under the `@invoiceleaf` scope.

**Publishing is not optional.** The plugin runtime resolves plugin tarballs
directly from `registry.npmjs.org` (see
`plugin-runtime/src/executor/PackageLoader.ts`), so an integration that is not
published cannot run in production, and a stale published version is the version
production runs.

Publishing is handled by `.github/workflows/publish-integrations.yml`:

- **Manual:** run the workflow with `packages: all` (or a comma-separated list).
  Leave `dry_run: true` for a preview. It publishes the SDK first, then the
  integrations, and skips any version already on npm, so re-running is safe.
- **By tag:** push `<dir>-v<version>`, e.g. `integration-stripe-v1.0.0` or
  `integration-sdk-v2.1.0`.

It requires the `NPM_TOKEN` repository secret.

Keep `manifest.json` and `package.json` versions identical. Nothing in the
platform enforces parity, but the registry resolves packages by npm version, so
a mismatch serves a package whose manifest claims a different version. The
publish workflow and `invoiceleaf integrations sync` both fail on a mismatch.

## Registering with the platform

Publishing to npm makes a package installable; the platform additionally needs a
registry entry pointing at it. Use the CLI:

```bash
invoiceleaf integrations sync integrations/*/ --dry-run
invoiceleaf integrations sync integrations/integration-stripe --refresh
```

See `packages/invoiceleaf-cli/README.md` for details.
