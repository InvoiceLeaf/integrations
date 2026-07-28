/**
 * FinanzOnline / Austrian Tax integration handler exports.
 * Manifest is defined in manifest.json at package root.
 *
 * Builds FinanzOnline (BMF) XML via the pure `fon-api` builders — U30
 * (USt-Voranmeldung) and ZM (Zusammenfassende Meldung). Exports produce a file for
 * manual upload. The `validate-*` actions send a non-binding test transmission and file
 * nothing. The `submit-*` actions are internal: they file for real through the host
 * filing bridge, which verifies the approval, blocks a duplicate period and records the
 * TaxFiling audit trail. The SOAP call itself runs on the isolate's host-bridged fetch
 * using the credentials from the encrypted credential store.
 */
export {
  exportU30,
  exportZm,
  previewU30,
  previewZm,
  validateU30,
  validateZm,
  submitU30,
  submitZm,
} from './handlers/index';

export { computeU30, computeZmEntries, normalizeUid } from './mapping/index';

export type {
  FinanzOnlineConfig,
  FonContext,
  FonCredentials,
  PeriodFrequency,
  ExportU30Input,
  ExportZmInput,
  PreviewU30Input,
  PreviewU30Result,
  PreviewZmInput,
  PreviewZmResult,
  ValidateInput,
  ValidateResult,
  SubmitU30Input,
  SubmitZmInput,
  SubmitResult,
  FiledResult,
  ReviewItem,
  U30Computation,
  ZmComputation,
  ZmEntryComputed,
  FileOutput,
} from './types';
