import type { IntegrationHandler } from '@invoiceleaf/integration-sdk';
import { toErrorMessage } from '@invoiceleaf/integration-sdk';
import type {
  ElsterIntegrationConfig,
  ExportUstvaInput,
  FileOutput,
  ValidateReport,
} from '../types.js';
import {
  buildUstvaXml,
  certHandle,
  computeUstvaKennzahlen,
  getFilingClient,
  listDocumentsInWindow,
  parsePeriod,
  toBase64,
} from './shared.js';

/**
 * Build an ELSTER-ready USt-VA XML for a reporting period.
 *
 * - mode "validate": run `context.filing.validate(...)` and return a report.
 * - otherwise: return the XML as a downloadable file ({ fileBase64, filename, mimeType }).
 *
 * This is the AI/UI-safe path (file-only self-upload and validation). The
 * irreversible send lives in {@link submitUstva}.
 */
export const exportUstva: IntegrationHandler<
  ExportUstvaInput,
  FileOutput | ValidateReport,
  ElsterIntegrationConfig
> = async (input, context): Promise<FileOutput | ValidateReport> => {
  const period = parsePeriod(input.period);
  const mode = input.mode ?? 'download';

  const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
  const { kennzahlen } = computeUstvaKennzahlen(documents);

  // TODO(xml): buildUstvaXml currently emits a placeholder, schema-invalid document.
  const xml = buildUstvaXml({
    period: period.canonical,
    steuernummer: context.config.steuernummer,
    finanzamt: context.config.finanzamt,
    kennzahlen,
  });

  if (mode === 'validate') {
    try {
      const filing = getFilingClient(context);
      const result = await filing.validate({
        xml,
        formType: 'ustva',
        period: period.canonical,
      });
      return {
        success: result.ok,
        mode: 'validate',
        period: period.canonical,
        ok: result.ok,
        errors: result.errors,
        kennzahlen,
        message: result.ok
          ? 'USt-VA validated successfully against ERiC.'
          : `USt-VA validation reported ${result.errors.length} issue(s).`,
      };
    } catch (error) {
      context.logger.error('USt-VA validation failed', { error: toErrorMessage(error) });
      return {
        success: false,
        mode: 'validate',
        period: period.canonical,
        ok: false,
        errors: [{ message: toErrorMessage(error) }],
        kennzahlen,
        message: 'USt-VA validation could not be completed.',
      };
    }
  }

  // download mode — return the XML file for manual upload in Mein ELSTER.
  // certHandle is computed here only to document the host-side reference; it is
  // not used for file-only output, but keeps the handle convention in one place.
  void certHandle;

  return {
    fileBase64: toBase64(xml),
    filename: `ustva-${period.canonical}.xml`,
    mimeType: 'application/xml',
  };
};
