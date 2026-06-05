# @invoiceleaf/integration-finanzonline

FinanzOnline / Austrian Tax integration for InvoiceLeaf. Generates **FinanzOnline-ready
XML** from your invoice data for manual upload in [FinanzOnline](https://finanzonline.bmf.gv.at):

- **U30** — Umsatzsteuervoranmeldung (USt-Voranmeldung / UVA)
- **ZM** — Zusammenfassende Meldung (recapitulative statement, art `U13`)

It is the Austrian counterpart to the German `integration-elster` plugin.

## Export-only

This plugin only **builds** XML files. It performs no submission to the BMF. The XML is
produced by the pure, credential-free builders in the [`fon-api`](https://www.npmjs.com/package/fon-api)
package; you upload the file yourself in FinanzOnline. Direct submission (SOAP
`fileupload`) requires a registered Hersteller-ID and must run host-side, never inside
the plugin sandbox.

## Handlers

| Handler | Kind | Purpose |
|---|---|---|
| `exportU30` | export | U30 (USt-Voranmeldung) XML for a period |
| `exportZm` | export | ZM (U13) XML: one line per EU customer UID |
| `previewU30` | action | Read-only U30 Kennzahlen + review list as JSON (AI-callable) |

Period strings are `YYYY-MM` (monthly) or `YYYY-Qn` (quarterly). The U30 schema version
(`01_2022` vs `07_2026`) is selected automatically from the period and fails loudly for
periods before the earliest supported schema.

## Build

Unlike `integration-elster` (zero-dependency, `tsc`-only), this plugin depends on the
`fon-api` package, so the publish build **bundles** `fon-api` (+ its `zod` dependency)
into a single self-contained `dist/index.js` via esbuild (`build.mjs`). This is required
because the plugin-runtime esbuild-bundles the published tarball under
`platform: 'neutral'` and never runs `npm install`. The bundle is checked for
isolate-safety (no Node `Buffer`/`process`/`require`/`node:` builtins); the plugin uses a
pure-JS base64 encoder because the isolate provides no `Buffer`.

```bash
npm install
npm run typecheck
npm run build      # esbuild bundle + isolate-safety guard + d.ts emit
```

## REVIEW REQUIRED

The mapping from an InvoiceLeaf document's `taxTreatment` / `accountingType` / VAT rate to
the Austrian U30 Kennzahlen and ZM classification is a best-effort default and is **not a
substitute for a Steuerberater's sign-off**. Use the `preview-u30` action to inspect the
computed figures and the `review` list of unmapped documents before relying on any
generated file. Validate the file by uploading it in FinanzOnline (which reports schema
errors precisely).
