# @invoiceleaf/integration-elster

ELSTER / German Tax integration for InvoiceLeaf. Generates ELSTER-ready
**USt-Voranmeldung (XML)** and **EUER (Excel)** files for manual upload in
Mein ELSTER.

This package is **public-mirror safe**: it contains only TypeScript that builds
XML/Excel. It ships **no native code, no certificates, and no ERiC binary**.
Export-only: it produces files the user uploads themselves; it does not submit to
the Finanzamt. (Direct ERiC submission is a separate, later capability.)

## Surface

Exports (appear inside the normal export form):

- `ustva-xml` (`exportUstva`) — build the USt-VA XML for a period and return it
  as a downloadable file.
- `euer-xlsx` (`exportEuer`) — aggregate a tax year into an Excel workbook.

Actions:

- `preview-ustva` (`previewUstva`) — read-only USt-VA figures as JSON. AI-callable.

## Config (install-time)

- `steuernummer`, `finanzamt`, `ustvaPeriod` (required) — used to populate the
  generated files.

## Category → form-line mapping

`src/mapping/` holds the category → USt-VA Kennzahlen / EUER line scaffold with
default tables. **Export quality is bounded by this mapping** — see the
`REVIEW REQUIRED` notes in `src/mapping/lines.ts` and `src/mapping/index.ts`.

## Status / TODOs

This is a compiling skeleton. Notable placeholders:

- The USt-VA XML builder (`buildUstvaXml`) emits a placeholder, schema-invalid
  document — not yet a valid ELSTER upload.
- The EUER export returns a text placeholder under an `.xlsx` filename — not a real
  OOXML workbook.
- The aggregation/mapping defaults need tax review.

See the inline `TODO(...)` / `REVIEW REQUIRED` markers for the full list.

## Development

```bash
npm install
npm run typecheck
npm run build
```
