import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ExportZmInput, FileOutput, FinanzOnlineConfig } from '../types';
import { utf8ToBase64 } from '../base64';
import { buildZmXml, parsePeriod } from './shared';

/**
 * Build a FinanzOnline-ready ZM (Zusammenfassende Meldung, art "U13") XML for a
 * period: one line per customer EU-VAT-ID with summed intra-EU B2B net turnover.
 */
export const exportZm: IntegrationHandler<
  ExportZmInput,
  FileOutput,
  FinanzOnlineConfig
> = async (input, context): Promise<FileOutput> => {
  const period = parsePeriod(input.period);
  const xml = await buildZmXml(context, period);
  return {
    fileBase64: utf8ToBase64(xml),
    filename: `zm-${period.canonical}.xml`,
    mimeType: 'application/xml',
  };
};
