/**
 * ELSTER / German Tax integration handler exports.
 * Manifest is defined in manifest.json at package root.
 *
 * Public-mirror safe: this package contains only TypeScript that builds XML/Excel
 * and calls host capabilities. No native code, no certificates, no ERiC binary.
 */
export { exportUstva, exportEuer, previewUstva, filingStatus, submitUstva } from './handlers/index.js';

export {
  DEFAULT_CATEGORY_MAPPING,
  USTVA_KENNZAHLEN,
  EUER_LINES,
  mapCategoryToEuerLine,
  vatRateBucket,
  normalizeCategoryName,
} from './mapping/index.js';

export type { CategoryMappingRule, UstvaKennzahl, EuerLine, VatRateBucket } from './mapping/index.js';

export type {
  ElsterIntegrationConfig,
  ElsterContext,
  UstvaReportingPeriod,
  ExportMode,
  ExportUstvaInput,
  ExportEuerInput,
  PreviewUstvaInput,
  PreviewUstvaResult,
  FilingStatusInput,
  FilingStatusResult,
  FilingStatusEntry,
  SubmitUstvaInput,
  SubmitUstvaResult,
  FileOutput,
  ValidateReport,
  FilingClient,
  FilingValidateInput,
  FilingValidateResult,
  FilingSubmitInput,
  FilingSubmitResult,
  FilingValidationError,
} from './types.js';
