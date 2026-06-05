import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ExportU30Input, FileOutput, FinanzOnlineConfig } from '../types';
import { utf8ToBase64 } from '../base64';
import { buildU30Xml, parsePeriod } from './shared';

/**
 * Build a FinanzOnline-ready U30 (USt-Voranmeldung) XML for a reporting period and
 * return it as a downloadable file for manual upload in FinanzOnline. The XML is
 * produced by fon-api's typed, Zod-validated, XSD-conformant builder.
 */
export const exportU30: IntegrationHandler<
  ExportU30Input,
  FileOutput,
  FinanzOnlineConfig
> = async (input, context): Promise<FileOutput> => {
  const period = parsePeriod(input.period);
  const xml = await buildU30Xml(context, period);
  return {
    fileBase64: utf8ToBase64(xml),
    filename: `u30-${period.canonical}.xml`,
    mimeType: 'application/xml',
  };
};
