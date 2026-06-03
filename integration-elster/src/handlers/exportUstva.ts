import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, ExportUstvaInput, FileOutput } from '../types.js';
import {
  buildUstvaXml,
  computeUstvaKennzahlen,
  listDocumentsInWindow,
  parsePeriod,
  toBase64,
} from './shared.js';

/**
 * Build an ELSTER-ready USt-VA XML for a reporting period and return it as a
 * downloadable file for manual upload in Mein ELSTER.
 */
export const exportUstva: IntegrationHandler<
  ExportUstvaInput,
  FileOutput,
  ElsterIntegrationConfig
> = async (input, context): Promise<FileOutput> => {
  const period = parsePeriod(input.period);

  const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
  const { kennzahlen } = computeUstvaKennzahlen(documents);

  // TODO(xml): buildUstvaXml currently emits a placeholder, schema-invalid document.
  const xml = buildUstvaXml({
    period: period.canonical,
    steuernummer: context.config.steuernummer,
    finanzamt: context.config.finanzamt,
    kennzahlen,
  });

  return {
    fileBase64: toBase64(xml),
    filename: `ustva-${period.canonical}.xml`,
    mimeType: 'application/xml',
  };
};
