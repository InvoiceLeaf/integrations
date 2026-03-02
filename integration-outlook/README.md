# Outlook Integration

OAuth-based Outlook attachment import for InvoiceLeaf.

## Features

- Scheduled crawl for PDF attachments (`crawlPdfAttachments`)
- On-demand crawl action (`crawl-now`)
- Outlook connection diagnostics (`testConnection`)
- Dedupe using message + attachment fingerprint via `context.state`
- Automatic document import via `context.data.importDocument(...)`
