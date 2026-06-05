/**
 * ELSTER / German Tax integration handler exports.
 * Manifest is defined in manifest.json at package root.
 *
 * Public-mirror safe: only TypeScript that builds XML/Excel and bridges to the host
 * filing capability. Certificate bytes and PIN never enter this package; filing
 * validate/submit go through `context.filing` (host-side ERiC), and submit passes
 * only a stable certificate handle.
 */
export {
  exportUstva,
  exportEuer,
  previewUstva,
  validateUstva,
  submitUstva,
  filingStatus,
} from './handlers/index.js';

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
  ExportUstvaInput,
  ExportEuerInput,
  PreviewUstvaInput,
  PreviewUstvaResult,
  ValidateUstvaInput,
  ValidateUstvaResult,
  SubmitUstvaInput,
  SubmitUstvaResult,
  FilingStatusInput,
  FilingStatusResult,
  UstvaReviewItem,
  UstvaComputation,
  FileOutput,
} from './types.js';
