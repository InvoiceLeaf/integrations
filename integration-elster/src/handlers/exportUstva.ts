import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import type { ElsterIntegrationConfig, ExportUstvaInput, FileOutput } from '../types.js';
import { buildUstva, toBase64Latin1 } from './shared.js';

/**
 * Build an ELSTER-ready USt-VA XML (Mein-ELSTER upload format) for a reporting
 * period and return it as a downloadable file for manual upload in Mein ELSTER.
 */
export const exportUstva: IntegrationHandler<
  ExportUstvaInput,
  FileOutput,
  ElsterIntegrationConfig
> = async (input, context): Promise<FileOutput> => {
  const { period, xml } = await buildUstva(context, input.period);

  return {
    fileBase64: toBase64Latin1(xml),
    filename: `ustva-${period.canonical}.xml`,
    mimeType: 'application/xml',
  };
};
