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
}

/**
 * Parse a USt-VA period string into a date window.
 * Accepts "YYYY-MM" (monthly) and "YYYY-Qn" (quarterly).
 *
 * TODO(period): the canonical ELSTER Zeitraum encoding (e.g. month 41-44 for
 *   quarters) is NOT applied here — only the date window is computed. The XML
 *   builder must translate `canonical` into the official Zeitraum code.
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
    return { year, startMs, endMs, canonical: `${year}-${String(month).padStart(2, '0')}` };
  }

  const quarterly = /^(\d{4})-Q([1-4])$/.exec(period);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const quarter = Number(quarterly[2]); // 1-4
    const startMonth = (quarter - 1) * 3; // 0,3,6,9
    const startMs = Date.UTC(year, startMonth, 1);
    const endMs = Date.UTC(year, startMonth + 3, 1);
    return { year, startMs, endMs, canonical: `${year}-Q${quarter}` };
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
 * Build the placeholder ELSTER USt-VA Nutzdaten/transfer XML.
 *
 * TODO(xml): this is a PLACEHOLDER. A real implementation must produce a valid
 *   ELSTER transfer document (Elster/TransferHeader + DatenTeil/Nutzdaten with the
 *   correct UStVA Steuerfall structure, Steuernummer/Finanzamt encoding, the
 *   official Zeitraum code, and the Kennzahlen as Kz elements) conforming to the
 *   Steuerdatenschema for the tax year. Until then this is NOT submittable.
 */
export function buildUstvaXml(args: {
  period: string;
  steuernummer: string | undefined;
  finanzamt: string | undefined;
  kennzahlen: Record<string, number>;
}): string {
  const kzLines = Object.entries(args.kennzahlen)
    .map(([kz, value]) => `      <Kz nr="${escapeXml(kz)}">${value.toFixed(2)}</Kz>`)
    .join('\n');

  // PLACEHOLDER structure — not a valid ELSTER schema document.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- PLACEHOLDER USt-VA document — see TODO(xml) in shared.ts. NOT ELSTER-schema-valid. -->',
    '<UStVA>',
    `  <Steuernummer>${escapeXml(args.steuernummer ?? '')}</Steuernummer>`,
    `  <Finanzamt>${escapeXml(args.finanzamt ?? '')}</Finanzamt>`,
    `  <Zeitraum>${escapeXml(args.period)}</Zeitraum>`,
    '  <Kennzahlen>',
    kzLines,
    '  </Kennzahlen>',
    '</UStVA>',
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
