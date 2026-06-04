import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { Document } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, ExportEuerInput, FileOutput } from '../types.js';
import { EUER_LINES, mapCategoryToEuerLine, type EuerLine } from '../mapping/index.js';
import { listDocumentsInWindow, yearWindow } from './shared.js';
import { buildXlsx, type CellValue } from '../xlsx.js';

/**
 * Aggregate a full tax year into the Anlage EUER line set and return a real .xlsx
 * workbook: a summary sheet (Betriebseinnahmen / Betriebsausgaben / Gewinn) and a
 * traceable detail sheet (one row per document with its mapped EUER line).
 *
 * REVIEW REQUIRED: income vs expense is derived from `accountingType`; credit notes
 * / cancellations flip the sign; amounts use net where available. Sign conventions
 * for mixed-direction documents and AfA (a depreciation schedule, not a per-document
 * expense) are NOT handled and need a tax-reviewed implementation.
 */
export const exportEuer: IntegrationHandler<
  ExportEuerInput,
  FileOutput,
  ElsterIntegrationConfig
> = async (input, context): Promise<FileOutput> => {
  const year = Math.trunc(input.year);
  const { startMs, endMs } = yearWindow(year);

  const documents = await listDocumentsInWindow(context, startMs, endMs);
  const { totals, detail, skipped } = collectEuer(documents);

  const summary = buildSummarySheet(year, totals, detail.length, skipped);
  const detailSheet: CellValue[][] = [
    ['Datum', 'Geschäftspartner', 'Kategorie', 'EÜR-Zeile', 'Netto'],
    ...detail,
  ];

  const fileBase64 = buildXlsx([
    { name: 'EUER', rows: summary },
    { name: 'Belege', rows: detailSheet },
  ]);

  return {
    fileBase64,
    filename: `euer-${year}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
};

interface EuerData {
  totals: Map<EuerLine['id'], number>;
  /** Detail rows: [date, partner, category, lineLabel, net]. */
  detail: CellValue[][];
  /** Documents skipped because direction (sale/purchase) was undetermined. */
  skipped: number;
}

function collectEuer(documents: Document[]): EuerData {
  const totals = new Map<EuerLine['id'], number>();
  for (const line of EUER_LINES) totals.set(line.id, 0);

  const detail: CellValue[][] = [];
  let skipped = 0;

  for (const doc of documents) {
    if (doc.deleted || doc.duplicateOfId) continue;
    const side: 'income' | 'expense' | undefined =
      doc.accountingType === 'RECEIVABLE'
        ? 'income'
        : doc.accountingType === 'PAYABLE'
          ? 'expense'
          : undefined;
    if (!side) {
      skipped += 1;
      continue;
    }

    const sign = doc.legalKind === 'CREDIT_NOTE' || doc.legalKind === 'CANCELLATION' ? -1 : 1;
    const amount = round2((doc.netAmount ?? doc.subtotalAmount ?? doc.totalAmount ?? 0) * sign);
    const lineId = mapCategoryToEuerLine(doc.category?.name, side);
    totals.set(lineId, round2((totals.get(lineId) ?? 0) + amount));

    const partner = side === 'income' ? doc.receiver?.name : doc.supplier?.name;
    const lineLabel = EUER_LINES.find((l) => l.id === lineId)?.label ?? lineId;
    detail.push([
      doc.invoiceDate ?? '',
      partner ?? doc.description ?? '',
      doc.category?.name ?? '',
      lineLabel,
      amount,
    ]);
  }

  return { totals, detail, skipped };
}

function buildSummarySheet(
  year: number,
  totals: Map<EuerLine['id'], number>,
  documentCount: number,
  skipped: number
): CellValue[][] {
  const rows: CellValue[][] = [];
  rows.push([`Anlage EÜR ${year}`]);
  rows.push([`Belege berücksichtigt: ${documentCount}`]);
  if (skipped > 0) rows.push([`Ohne Richtung (nicht zugeordnet): ${skipped}`]);
  rows.push([]);

  rows.push(['Betriebseinnahmen']);
  let incomeTotal = 0;
  for (const line of EUER_LINES.filter((l) => l.side === 'income')) {
    const value = round2(totals.get(line.id) ?? 0);
    incomeTotal = round2(incomeTotal + value);
    rows.push([line.label, value]);
  }
  rows.push(['Summe Betriebseinnahmen', incomeTotal]);
  rows.push([]);

  rows.push(['Betriebsausgaben']);
  let expenseTotal = 0;
  for (const line of EUER_LINES.filter((l) => l.side === 'expense')) {
    const value = round2(totals.get(line.id) ?? 0);
    expenseTotal = round2(expenseTotal + value);
    rows.push([line.label, value]);
  }
  rows.push(['Summe Betriebsausgaben', expenseTotal]);
  rows.push([]);

  rows.push(['Gewinn / Verlust', round2(incomeTotal - expenseTotal)]);
  return rows;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
