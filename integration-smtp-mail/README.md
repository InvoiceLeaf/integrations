# SMTP Mail Integration

SMTP + IMAP integration for InvoiceLeaf.

## Features

- Action: Send email through SMTP
- Scheduled trigger: Crawl IMAP mailbox for PDF attachments
- Automatic import of discovered PDFs into InvoiceLeaf
- Dedupe based on message UID + attachment checksum

## Notes

- SMTP is used for outbound sending.
- IMAP is used for mailbox crawling.
- This integration requires runtime support for:
  - `context.data.importDocument(...)`
  - `context.state.get/set/delete(...)`
  - `context.email.sendSmtpEmail(...)`
  - `context.email.testSmtpImapConnection(...)`
  - `context.email.crawlImapPdfAttachments(...)`
