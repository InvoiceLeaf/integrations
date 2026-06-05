/**
 * Shared helpers for the ELSTER handlers: period parsing, document aggregation,
 * and the placeholder XML builder.
 */

import type { Document } from '@invoiceleaf/integration-sdk';
import type { ElsterContext, UstvaComputation } from '../types.js';
import { USTVA_KENNZAHLEN } from '../mapping/index.js';
import { base64, latin1Bytes } from '../encoding.js';

/** Page size used when listing documents for a period/year. */
const LIST_PAGE_SIZE = 100;
/** Safety cap so a runaway aggregation never loops forever. */
const MAX_PAGES = 500;

export interface ParsedPeriod {
  year: number;
  /** Inclusive ISO start timestamp (ms) of the period. */
  startMs: number;
  /** Exclusive ISO end timestamp (ms) of the period. */
  endMs: number;
  /** Normalized canonical period string (echoed in outputs). */
  canonical: string;
  /** Official ELSTER Zeitraum code: "01".."12" for months, "41".."44" for quarters. */
  zeitraum: string;
}

/**
 * Parse a USt-VA period string into a date window and the official ELSTER
 * Zeitraum code. Accepts "YYYY-MM" (monthly) and "YYYY-Qn" (quarterly).
 *
 * ELSTER Zeitraum encoding: months are "01".."12"; quarters are "41".."44".
 */
export function parsePeriod(period: string): ParsedPeriod {
  const monthly = /^(\d{4})-(\d{2})$/.exec(period);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]); // 1-12
    if (month < 1 || month > 12) {
      throw new Error(`Invalid month in period "${period}".`);
    }
    const startMs = Date.UTC(year, month - 1, 1);
    const endMs = Date.UTC(year, month, 1);
    const mm = String(month).padStart(2, '0');
    return { year, startMs, endMs, canonical: `${year}-${mm}`, zeitraum: mm };
  }

  const quarterly = /^(\d{4})-Q([1-4])$/.exec(period);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const quarter = Number(quarterly[2]); // 1-4
    const startMonth = (quarter - 1) * 3; // 0,3,6,9
    const startMs = Date.UTC(year, startMonth, 1);
    const endMs = Date.UTC(year, startMonth + 3, 1);
    // ELSTER encodes quarters as 41..44.
    return { year, startMs, endMs, canonical: `${year}-Q${quarter}`, zeitraum: String(40 + quarter) };
  }

  throw new Error(`Unrecognized period format "${period}". Expected "YYYY-MM" or "YYYY-Qn".`);
}

/** Compute the [start, end) window for a full tax year. */
export function yearWindow(year: number): { startMs: number; endMs: number } {
  return { startMs: Date.UTC(year, 0, 1), endMs: Date.UTC(year + 1, 0, 1) };
}

/**
 * List all documents whose date falls in [startMs, endMs), paging through results.
 *
 * REVIEW REQUIRED: this uses `startDate`/`endDate` filters on the list API, which
 * filter on the document's primary date. Whether that is the invoice date or the
 * booking/accounting date must be confirmed for correct period attribution.
 */
export async function listDocumentsInWindow(
  context: ElsterContext,
  startMs: number,
  endMs: number
): Promise<Document[]> {
  const out: Document[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= MAX_PAGES) {
    const result = await context.data.listDocuments({
      startDate: startMs,
      endDate: endMs,
      page,
      limit: LIST_PAGE_SIZE,
    });
    out.push(...result.items);
    hasMore = result.hasMore;
    page += 1;
  }
  return out;
}

/**
 * Compute USt-VA Kennzahlen from a set of documents.
 *
 * Each tax line item is routed to the correct Kennzahl using the document's
 * `taxTreatment` (TaxTreatment enum), `accountingType` (sale vs purchase) and VAT
 * rate. Output VAT (incl. self-assessed intra-community acquisitions and §13b
 * reverse charge) minus deductible input VAT yields the payable (Kz83). Credit
 * notes / cancellations flip the sign.
 *
 * Items that cannot be mapped confidently (unknown treatment/direction, margin
 * scheme, triangular, missing tax breakdown, non-standard acquisition rate) are
 * collected in `review` instead of being silently mis-bucketed.
 *
 * REVIEW REQUIRED: these assignments implement the standard German USt-VA cases
 * but are not a substitute for a Steuerberater's sign-off. Validate the figures
 * and especially the §13b / intra-community / import handling before filing.
 */
export function computeUstvaKennzahlen(documents: Document[]): UstvaComputation {
  const kennzahlen: Record<string, number> = {};
  for (const k of USTVA_KENNZAHLEN) kennzahlen[k.kennziffer] = 0;

  let outputVat = 0; // total VAT we owe (incl. self-assessed reverse charge / acquisitions)
  let inputVat = 0; // total deductible Vorsteuer

  const reviewMap = new Map<string, { count: number; net: number }>();
  const flag = (reason: string, net: number): void => {
    const cur = reviewMap.get(reason) ?? { count: 0, net: 0 };
    cur.count += 1;
    cur.net = round2(cur.net + net);
    reviewMap.set(reason, cur);
  };
  const add = (kz: string, amount: number): void => {
    kennzahlen[kz] = round2((kennzahlen[kz] ?? 0) + amount);
  };

  let documentCount = 0;

  for (const doc of documents) {
    if (doc.deleted || doc.duplicateOfId) continue;
    documentCount += 1;

    // Credit notes / cancellations reverse the sign of the reported amounts.
    // ASSUMES amounts are stored as positive magnitudes; verify against the data.
    const sign = doc.legalKind === 'CREDIT_NOTE' || doc.legalKind === 'CANCELLATION' ? -1 : 1;
    const treatment = (doc.taxTreatment ?? 'UNKNOWN').toUpperCase();
    const side = doc.accountingType; // 'RECEIVABLE' (sale) | 'PAYABLE' (purchase) | 'UNKNOWN'

    const items = doc.taxItems ?? [];
    if (items.length === 0) {
      flag('Document without a tax breakdown (no taxItems)', (doc.netAmount ?? 0) * sign);
      continue;
    }

    for (const item of items) {
      const net = round2((item.netAmount ?? 0) * sign);
      const rate = Math.round(item.taxPercentage ?? 0);
      const tax = round2((item.taxAmount ?? item.totalTax ?? (net * rate) / 100) * sign);

      if (side === 'RECEIVABLE') {
        // Seller / output side.
        switch (treatment) {
          case 'DOMESTIC_TAXABLE':
            if (rate === 19) {
              add('81', net);
              outputVat = round2(outputVat + net * 0.19);
            } else if (rate === 7) {
              add('86', net);
              outputVat = round2(outputVat + net * 0.07);
            } else if (rate === 0) {
              flag('Domestic sale flagged taxable but at 0% rate', net);
            } else {
              add('35', net);
              add('36', tax);
              outputVat = round2(outputVat + tax);
            }
            break;
          case 'EU_INTRA_COMMUNITY':
            add('41', net); // steuerfreie innergemeinschaftliche Lieferung
            break;
          case 'EXPORT':
            add('43', net); // steuerfreie Ausfuhr
            break;
          case 'DOMESTIC_EXEMPT':
            add('48', net); // steuerfrei ohne Vorsteuerabzug
            break;
          case 'EU_REVERSE_CHARGE':
            add('60', net); // Leistungsempfänger schuldet die Steuer
            break;
          case 'SMALL_BUSINESS_EXEMPT':
            flag('Kleinunternehmer sale (§19) — not reported in USt-VA', net);
            break;
          case 'MARGIN_SCHEME':
            flag('Margin-scheme sale (§25/§25a) — requires special handling, not mapped', net);
            break;
          case 'TRIANGULAR':
            flag('Triangular transaction — requires special handling, not mapped', net);
            break;
          default:
            flag(`Sale with undetermined tax treatment (${treatment})`, net);
        }
      } else if (side === 'PAYABLE') {
        // Buyer / input / self-assessment side.
        switch (treatment) {
          case 'DOMESTIC_TAXABLE':
            if (tax !== 0) {
              add('66', tax);
              inputVat = round2(inputVat + tax);
            }
            break;
          case 'EU_INTRA_COMMUNITY': {
            // Intra-community acquisition: self-assess output VAT, deduct the same as input.
            let acqVat = 0;
            if (rate === 19) {
              add('89', net);
              acqVat = round2(net * 0.19);
            } else if (rate === 7) {
              add('93', net);
              acqVat = round2(net * 0.07);
            } else {
              flag('Intra-community acquisition at a non-standard rate, not mapped', net);
              break;
            }
            outputVat = round2(outputVat + acqVat);
            add('61', acqVat);
            inputVat = round2(inputVat + acqVat);
            break;
          }
          case 'EU_REVERSE_CHARGE': {
            // §13b recipient: self-assess output VAT, deduct the same as input.
            const rcVat = tax !== 0 ? tax : round2((net * rate) / 100);
            add('46', net);
            add('47', rcVat);
            outputVat = round2(outputVat + rcVat);
            add('67', rcVat);
            inputVat = round2(inputVat + rcVat);
            break;
          }
          case 'IMPORT':
            if (tax !== 0) {
              add('62', tax); // Entrichtete Einfuhrumsatzsteuer
              inputVat = round2(inputVat + tax);
            }
            break;
          case 'DOMESTIC_EXEMPT':
          case 'EXPORT':
          case 'SMALL_BUSINESS_EXEMPT':
            break; // purchase without deductible VAT — nothing to report
          case 'MARGIN_SCHEME':
          case 'TRIANGULAR':
            flag(`Purchase with ${treatment} treatment — requires special handling, not mapped`, net);
            break;
          default:
            flag(`Purchase with undetermined tax treatment (${treatment})`, net);
        }
      } else {
        flag('Document with UNKNOWN direction (sale vs purchase undetermined)', net);
      }
    }
  }

  const payable = round2(outputVat - inputVat);
  kennzahlen['83'] = payable;

  const review = [...reviewMap.entries()].map(([reason, v]) => ({ reason, count: v.count, net: v.net }));
  return { kennzahlen, payable, documentCount, review };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * ELSTER Anmeldungssteuern namespace + version attribute for a tax year.
 *
 * The namespace path and `version` are the SCHEMA YEAR (e.g. v2026 / "2026").
 * ELSTER publishes one schema per year; this must match a schema year ELSTER
 * actually accepts. Verify against the official Steuerdatenschema (developer
 * portal) when a new tax year opens.
 */
export function ustvaNamespace(year: number): string {
  return `http://finkonsens.de/elster/elsteranmeldung/ustva/v${year}`;
}

/**
 * Normalize the configured Steuernummer to the 13-digit bundeseinheitliche
 * (federal) format ELSTER requires in the XML.
 *
 * We require the 13-digit form directly rather than converting from the regional
 * format: the regional -> 13-digit conversion is Bundesland-specific and error
 * prone, and users get the 13-digit number from the official ELSTER converter.
 */
export function normalizeSteuernummer(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length !== 13) {
    throw new Error(
      'ELSTER requires the 13-digit bundeseinheitliche Steuernummer. Set it in the integration settings (convert your regional Steuernummer with the official ELSTER converter).'
    );
  }
  return digits;
}

/** Current date as YYYYMMDD (UTC), for the Erstellungsdatum element. */
export function todayYyyymmdd(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export interface BuildUstvaArgs {
  /** Tax year (also selects the schema namespace/version). */
  year: number;
  /** ELSTER Zeitraum code ("01".."12" or "41".."44"). */
  zeitraum: string;
  /** 13-digit bundeseinheitliche Steuernummer. */
  steuernummer: string;
  /** Business / data-supplier name. */
  companyName: string;
  /** Creation date, YYYYMMDD. */
  erstellungsdatum: string;
  /** Computed Kennzahlen keyed by Kennziffer (e.g. "81", "66", "83"). */
  kennzahlen: Record<string, number>;
}

/**
 * Build an ELSTER-ready USt-VA XML in the Mein-ELSTER UPLOAD format: the
 * <Anmeldungssteuern> data block (NOT the ERiC transfer envelope, which needs a
 * HerstellerID and encryption that require developer registration).
 *
 * Format basis (researched against the ELSTER Mein-ELSTER upload help and forum):
 * - root <Anmeldungssteuern> with the year-specific finkonsens.de namespace and
 *   `version` attribute; encoding ISO-8859-15.
 * - the imported subtree is /Anmeldungssteuern/Steuerfall.
 * - base Kennzahlen (Bemessungsgrundlagen, e.g. Kz81/Kz86) are whole euros; tax
 *   Kennzahlen (e.g. Kz66 input VAT, Kz83 payable) carry two decimals.
 * - empty Kennzahlen are omitted; the payable (Kz83) is always emitted so a
 *   Nullmeldung is well-formed.
 *
 * VERIFY before relying on a submission: the exact mandatory <Unternehmer> /
 * <DatenLieferant> child elements are defined only in the official XSD (developer
 * portal) and are kept minimal here. Validate the file by uploading it to Mein
 * ELSTER (which reports schema errors precisely) or against the official
 * Steuerdatenschema for the tax year.
 */
export function buildUstvaXml(args: BuildUstvaArgs): string {
  const ns = ustvaNamespace(args.year);

  const kzLines = USTVA_KENNZAHLEN.map((k) => {
    const value = args.kennzahlen[k.kennziffer] ?? 0;
    // Emit non-zero Kennzahlen; always emit those marked alwaysEmit (Kz83 / Nullmeldung).
    if (value === 0 && !k.alwaysEmit) return null;
    // Bemessungsgrundlagen are whole euros (cents dropped); tax/input fields keep 2 decimals.
    const formatted = k.format === 'euro' ? String(Math.trunc(value)) : value.toFixed(2);
    return `      <Kz${k.kennziffer}>${formatted}</Kz${k.kennziffer}>`;
  }).filter((line): line is string => line !== null);

  return [
    '<?xml version="1.0" encoding="ISO-8859-15" standalone="no"?>',
    `<Anmeldungssteuern xmlns="${ns}" version="${args.year}">`,
    `  <Erstellungsdatum>${escapeXml(args.erstellungsdatum)}</Erstellungsdatum>`,
    `  <DatenLieferant>${escapeXml(args.companyName)}</DatenLieferant>`,
    '  <Steuerfall>',
    '    <Unternehmer>',
    `      <Bezeichnung>${escapeXml(args.companyName)}</Bezeichnung>`,
    '    </Unternehmer>',
    '    <Umsatzsteuervoranmeldung>',
    `      <Jahr>${args.year}</Jahr>`,
    `      <Zeitraum>${escapeXml(args.zeitraum)}</Zeitraum>`,
    `      <Steuernummer>${escapeXml(args.steuernummer)}</Steuernummer>`,
    ...kzLines,
    '    </Umsatzsteuervoranmeldung>',
    '  </Steuerfall>',
    '</Anmeldungssteuern>',
    '',
  ].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the USt-VA `<Anmeldungssteuern>` XML for a reporting period: parse the
 * period, aggregate documents in the window, compute the Kennzahlen, and render the
 * XML. Shared by the export (download), validate, and submit handlers so the figures
 * and the XML are produced identically.
 */
export async function buildUstva(
  context: ElsterContext,
  periodString: string
): Promise<{ period: ParsedPeriod; xml: string; computation: UstvaComputation }> {
  const period = parsePeriod(periodString);
  const steuernummer = normalizeSteuernummer(context.config.steuernummer);
  const companyName = context.config.companyName?.trim() || 'InvoiceLeaf';

  const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
  const computation = computeUstvaKennzahlen(documents);

  const xml = buildUstvaXml({
    year: period.year,
    zeitraum: period.zeitraum,
    steuernummer,
    companyName,
    erstellungsdatum: todayYyyymmdd(),
    kennzahlen: computation.kennzahlen,
  });

  return { period, xml, computation };
}

/**
 * Encode a string as ISO-8859-15 bytes, base64-encoded for {@link FileOutput.fileBase64}.
 * Used for the USt-VA XML (declared encoding ISO-8859-15). Pure-JS (no Buffer) so the
 * package depends only on what the isolate runtime provides.
 */
export function toBase64Latin1(value: string): string {
  return base64(latin1Bytes(value));
}

/**
 * Extract a human-readable message from an unknown error. Inlined locally so the
 * compiled package carries no @invoiceleaf/integration-sdk runtime import (the SDK
 * is used for types only, matching how published integrations ship).
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
