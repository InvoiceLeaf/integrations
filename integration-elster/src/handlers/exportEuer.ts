import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { Document } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, ExportEuerInput, FileOutput } from '../types.js';
import { EUER_LINES, mapCategoryToEuerLine, type EuerLine } from '../mapping/index.js';
import { listDocumentsInWindow, toBase64, yearWindow } from './shared.js';

/**
 * Aggregate a full tax year into the Anlage EUER line set and return an Excel
 * workbook as a downloadable file.
 *
 * TODO(xlsx): this returns a PLACEHOLDER, NOT a real .xlsx (OOXML) workbook. A real
 *   implementation must build a multi-sheet workbook (summary EUER lines + a
 *   traceable transaction-detail sheet), e.g. via a host capability or a pure-TS
 *   OOXML writer, and set the proper xlsx bytes. The current output is a UTF-8
 *   text summary base64-encoded under an .xlsx filename so the flow is exercisable
 *   end to end, but it will NOT open as Excel.
 */
export const exportEuer: IntegrationHandler<
  ExportEuerInput,
  FileOutput,
  ElsterIntegrationConfig
> = async (input, context): Promise<FileOutput> => {
  const year = Math.trunc(input.year);
  const { startMs, endMs } = yearWindow(year);

  const documents = await listDocumentsInWindow(context, startMs, endMs);
  const totals = aggregateEuerLines(documents);

  // TODO(xlsx): replace this text body with a real workbook builder.
  const placeholder = renderEuerPlaceholder(year, totals, documents.length);

  return {
    fileBase64: toBase64(placeholder),
    filename: `euer-${year}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
};

/**
 * Sum each EUER line from the year's documents using the category mapping.
 *
 * REVIEW REQUIRED: income vs expense is derived from `accountingType`; amounts use
 * net where available. Sign conventions for credit notes, mixed-direction
 * documents, and AfA (which is not a per-document expense but a schedule) are NOT
 * handled — AfA in particular cannot be derived from invoice documents alone.
 */
export function aggregateEuerLines(documents: Document[]): Map<EuerLine['id'], number> {
  const totals = new Map<EuerLine['id'], number>();
  for (const line of EUER_LINES) {
    totals.set(line.id, 0);
  }

  for (const doc of documents) {
    if (doc.deleted || doc.duplicateOfId) continue;
    const side: 'income' | 'expense' | undefined =
      doc.accountingType === 'RECEIVABLE'
        ? 'income'
        : doc.accountingType === 'PAYABLE'
          ? 'expense'
          : undefined;
    if (!side) continue; // TODO(direction): UNKNOWN-direction documents are skipped.

    const amount = doc.netAmount ?? doc.subtotalAmount ?? doc.totalAmount ?? 0;
    const lineId = mapCategoryToEuerLine(doc.category?.name, side);
    totals.set(lineId, round2((totals.get(lineId) ?? 0) + amount));
  }

  return totals;
}

function renderEuerPlaceholder(
  year: number,
  totals: Map<EuerLine['id'], number>,
  documentCount: number
): string {
  const lines: string[] = [];
  lines.push(`Anlage EUER ${year} (PLACEHOLDER — not a real .xlsx; see TODO(xlsx))`);
  lines.push(`Documents aggregated: ${documentCount}`);
  lines.push('');
  lines.push('Betriebseinnahmen:');
  for (const line of EUER_LINES.filter((l) => l.side === 'income')) {
    lines.push(`  ${line.label}: ${(totals.get(line.id) ?? 0).toFixed(2)}`);
  }
  lines.push('');
  lines.push('Betriebsausgaben:');
  for (const line of EUER_LINES.filter((l) => l.side === 'expense')) {
    lines.push(`  ${line.label}: ${(totals.get(line.id) ?? 0).toFixed(2)}`);
  }
  lines.push('');

  const income = sumSide(totals, 'income');
  const expense = sumSide(totals, 'expense');
  lines.push(`Gewinn / Verlust (Einnahmen - Ausgaben): ${(income - expense).toFixed(2)}`);
  lines.push('');
  return lines.join('\n');
}

function sumSide(totals: Map<EuerLine['id'], number>, side: 'income' | 'expense'): number {
  let sum = 0;
  for (const line of EUER_LINES.filter((l) => l.side === side)) {
    sum = round2(sum + (totals.get(line.id) ?? 0));
  }
  return sum;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
