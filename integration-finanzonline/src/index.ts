/**
 * FinanzOnline / Austrian Tax integration handler exports.
 * Manifest is defined in manifest.json at package root.
 *
 * Builds FinanzOnline (BMF) XML via the pure `fon-api` builders — U30
 * (USt-Voranmeldung) and ZM (Zusammenfassende Meldung). Exports produce a file for
 * manual upload; the submit actions file directly via the fon-api SOAP webservice
 * using the credentials stored in the encrypted credential store (the SOAP call runs
 * on the isolate's host-bridged fetch). Submissions default to a non-binding test
 * transmission.
 */
export { exportU30, exportZm, previewU30, submitU30, submitZm } from './handlers/index';

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
  SubmitU30Input,
  SubmitZmInput,
  SubmitResult,
  ReviewItem,
  U30Computation,
  ZmComputation,
  ZmEntryComputed,
  FileOutput,
} from './types';
