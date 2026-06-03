import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, ExportUstvaInput, FileOutput } from '../types.js';
import {
  buildUstvaXml,
  computeUstvaKennzahlen,
  listDocumentsInWindow,
  normalizeSteuernummer,
  parsePeriod,
  toBase64Latin1,
  todayYyyymmdd,
} from './shared.js';

/**
 * Build an ELSTER-ready USt-VA XML (Mein-ELSTER upload format) for a reporting
 * period and return it as a downloadable file for manual upload in Mein ELSTER.
 */
export const exportUstva: IntegrationHandler<
  ExportUstvaInput,
  FileOutput,
  ElsterIntegrationConfig
> = async (input, context): Promise<FileOutput> => {
  const period = parsePeriod(input.period);
  const steuernummer = normalizeSteuernummer(context.config.steuernummer);
  const companyName = context.config.companyName?.trim() || 'InvoiceLeaf';

  const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
  const { kennzahlen } = computeUstvaKennzahlen(documents);

  const xml = buildUstvaXml({
    year: period.year,
    zeitraum: period.zeitraum,
    steuernummer,
    companyName,
    erstellungsdatum: todayYyyymmdd(),
    kennzahlen,
  });

  return {
    fileBase64: toBase64Latin1(xml),
    filename: `ustva-${period.canonical}.xml`,
    mimeType: 'application/xml',
  };
};
