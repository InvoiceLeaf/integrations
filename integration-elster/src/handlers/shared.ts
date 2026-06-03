/**
 * Shared helpers for the ELSTER handlers: period parsing, document aggregation,
 * and the placeholder XML builder.
 */

import type { Document } from '@invoiceleaf/integration-sdk';
import type { ElsterContext } from '../types.js';
import { USTVA_KENNZAHLEN, vatRateBucket } from '../mapping/index.js';

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
 * Compute USt-VA Kennzahlen from a set of documents (stub aggregation).
 *
 * REVIEW REQUIRED: this is a simplistic sum over document tax items by rate
 * bucket. It does NOT distinguish output vs input VAT by document direction
 * correctly beyond `accountingType`, ignores reverse-charge / intra-EU, and does
 * not handle credit notes' sign conventions. A tax-reviewed implementation must
 * replace this.
 */
export function computeUstvaKennzahlen(documents: Document[]): {
  kennzahlen: Record<string, number>;
  payable: number;
  documentCount: number;
} {
  const kennzahlen: Record<string, number> = {};
  for (const k of USTVA_KENNZAHLEN) {
    kennzahlen[k.kennziffer] = 0;
  }

  let outputTax = 0;
  let inputTax = 0;

  for (const doc of documents) {
    if (doc.deleted || doc.duplicateOfId) continue;
    const isIncome = doc.accountingType === 'RECEIVABLE';
    const isExpense = doc.accountingType === 'PAYABLE';

    for (const item of doc.taxItems ?? []) {
      const net = item.netAmount ?? 0;
      const tax = item.taxAmount ?? 0;
      const bucket = vatRateBucket(item.taxPercentage);

      if (isIncome) {
        // Net base goes to the rate-bucket base Kennziffer.
        const baseKz = USTVA_KENNZAHLEN.find((k) => k.role === 'base' && k.bucket === bucket);
        if (baseKz) {
          kennzahlen[baseKz.kennziffer] = round2((kennzahlen[baseKz.kennziffer] ?? 0) + net);
        }
        outputTax = round2(outputTax + tax);
      } else if (isExpense) {
        inputTax = round2(inputTax + tax);
      }
      // TODO(direction): documents with accountingType UNKNOWN are skipped here.
    }
  }

  // Kz 66 = abziehbare Vorsteuer.
  const inputKz = USTVA_KENNZAHLEN.find((k) => k.role === 'input');
  if (inputKz) kennzahlen[inputKz.kennziffer] = inputTax;

  const payable = round2(outputTax - inputTax);
  const payableKz = USTVA_KENNZAHLEN.find((k) => k.role === 'payable');
  if (payableKz) kennzahlen[payableKz.kennziffer] = payable;

  return { kennzahlen, payable, documentCount: documents.length };
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
    // Emit non-zero Kennzahlen; always emit the payable (Kz83) for a Nullmeldung.
    if (value === 0 && k.role !== 'payable') return null;
    const formatted = k.role === 'base' ? String(Math.floor(value)) : value.toFixed(2);
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

/** Encode a UTF-8 string as base64 for {@link FileOutput.fileBase64}. */
export function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

/**
 * Encode a string as ISO-8859-15 bytes, base64-encoded for {@link FileOutput.fileBase64}.
 * Used for the USt-VA XML, whose declared encoding is ISO-8859-15.
 *
 * Node's 'latin1' is ISO-8859-1, which is byte-identical to ISO-8859-15 for every
 * character this document emits (digits, ASCII markup, German umlauts). The few
 * code points where -15 differs (e.g. the euro sign) are never written here.
 */
export function toBase64Latin1(value: string): string {
  return Buffer.from(value, 'latin1').toString('base64');
}
