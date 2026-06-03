/**
 * ELSTER / German Tax integration handler exports.
 * Manifest is defined in manifest.json at package root.
 *
 * Public-mirror safe: this package contains only TypeScript that builds XML/Excel.
 * Export-only: produces ELSTER-ready USt-VA XML and EUER Excel files for manual
 * upload in Mein ELSTER. No native code, no certificates, no ERiC submission.
 */
export { exportUstva, exportEuer, previewUstva } from './handlers/index.js';

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
  FileOutput,
} from './types.js';
