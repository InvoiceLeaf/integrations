# @invoiceleaf/integration-elster

ELSTER / German Tax integration for InvoiceLeaf. Generates ELSTER-ready
**USt-Voranmeldung (XML)** and **EUER (Excel)** files, and — for verified
installations — submits the USt-VA to the Finanzamt via the host-side ERiC filing
capability.

This package is **public-mirror safe**: it contains only TypeScript that builds
XML/Excel and calls host capabilities. It ships **no native code, no certificates,
and no ERiC binary**. Certificate bytes and PIN never enter the plugin sandbox;
the plugin references the certificate by a stable handle and the irreversible send
happens host-side behind the verified-only `filing` capability.

## Surface

Exports (appear inside the normal export form):

- `ustva-xml` (`exportUstva`) — build the USt-VA XML for a period.
  Modes: `download` (return the file) or `validate` (run `context.filing.validate`).
- `euer-xlsx` (`exportEuer`) — aggregate a tax year into an Excel workbook.

Actions:

- `preview-ustva` (`previewUstva`) — read-only USt-VA figures as JSON. AI-callable.
- `filing-status` (`filingStatus`) — read-only filing history. AI-callable.
- `submit-ustva` (`submitUstva`) — **internal**, irreversible ERiC submission.
  Blocked from the AI; requires an explicit UI confirmation token.

## Config (install-time)

- `steuernummer`, `finanzamt`, `ustvaPeriod` (required)
- `certificate` (`.pfx`/`.p12`) and `certificatePin` — **sensitive**, stored
  encrypted, stripped from the sandbox config, used only host-side for ERiC.

## Category → form-line mapping

`src/mapping/` holds the category → USt-VA Kennzahlen / EUER line scaffold with
default tables. **Export quality is bounded by this mapping** — see the
`REVIEW REQUIRED` notes in `src/mapping/lines.ts` and `src/mapping/index.ts`.

## Status / TODOs

This is a compiling skeleton. Notable placeholders:

- The USt-VA XML builder (`buildUstvaXml`) emits a placeholder, schema-invalid
  document — not yet submittable.
- The EUER export returns a text placeholder under an `.xlsx` filename — not a real
  OOXML workbook.
- The aggregation/mapping defaults need tax review.
- `context.filing` is read defensively until the SDK adds `filing?: FilingClient`.

See the inline `TODO(...)` / `REVIEW REQUIRED` markers for the full list.

## Development

```bash
npm install
npm run typecheck
npm run build
```
