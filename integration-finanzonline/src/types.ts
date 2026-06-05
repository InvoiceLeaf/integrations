import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

/**
 * Reporting frequency for the U30 / ZM, set once at install time.
 */
export type PeriodFrequency = 'monthly' | 'quarterly';

/**
 * Install-time, non-secret configuration for the FinanzOnline integration
 * (manifest configSchema). The actual webservice CREDENTIALS (tid / benid / pin /
 * herstellerid) are NOT kept here — they live in the encrypted credential store
 * (see manifest externalAuth) and are only needed for submission, never for the
 * export-only XML generation this plugin performs.
 */
export interface FinanzOnlineConfig {
  /** 9-digit Austrian Finanzamts- und Steuernummer (FASTNR). */
  steuernummer?: string;
  /**
   * Austrian VAT identification number (UID), "ATU" + 8 digits. Also used as the
   * FinanzOnline Hersteller-ID for submission, unless the connection overrides it.
   */
  uid?: string;
  /** Optional Finanzamt / Dienststelle identifier. */
  finanzamt?: string;
  /** Reporting frequency for the U30 / ZM. */
  periodFrequency?: PeriodFrequency;
  /** Business name written into the generated file (KUNDENINFO). */
  companyName?: string;
}

/** Shorthand for the typed context used across all FinanzOnline handlers. */
export type FonContext = IntegrationContext<FinanzOnlineConfig>;

// ---------------------------------------------------------------------------
// Handler inputs
// ---------------------------------------------------------------------------

export interface ExportU30Input {
  /** Reporting period: "YYYY-MM" (monthly) or "YYYY-Qn" (quarterly). */
  period: string;
}

export interface ExportZmInput {
  period: string;
}

export interface PreviewU30Input {
  period: string;
}

export interface SubmitU30Input {
  period: string;
  /** When true, file for real (uebermittlung "P"). Defaults to a non-binding test ("T"). */
  production?: boolean;
}

export interface SubmitZmInput {
  period: string;
  production?: boolean;
}

/**
 * FinanzOnline webservice credentials, read from the encrypted credential store
 * (stored as one JSON object under the "finanzonline" provider) and passed to
 * fon-api for the SOAP login + upload.
 */
export interface FonCredentials {
  tid: string;
  benid: string;
  pin: string;
  herstellerid: string;
}

// ---------------------------------------------------------------------------
// Handler results
// ---------------------------------------------------------------------------

/**
 * File output shape consumed by the worker integration-export endpoint.
 * `fileBase64` must be well under the PluginExecutor output cap (~10 MB); a
 * U30/ZM XML is only kilobytes.
 */
export interface FileOutput {
  fileBase64: string;
  filename: string;
  mimeType: string;
}

/**
 * A bucket of transactions the computation could not confidently map (or that
 * need attention). Surfaced so gaps are visible rather than silently producing
 * wrong figures.
 */
export interface ReviewItem {
  /** Why these amounts were not mapped / need review. */
  reason: string;
  /** Number of tax line items (or documents) affected. */
  count: number;
  /** Total net amount affected (signed). */
  net: number;
}

/** Result of the U30 Kennzahlen computation. */
export interface U30Computation {
  /** Kennzahlen keyed by fon-api field name (e.g. "kz022", "kz060", "kz090"). */
  kennzahlen: Record<string, number>;
  /** kz090: Gutschrift / Zahllast (positive = payable, negative = credit). */
  payable: number;
  /** Number of documents included. */
  documentCount: number;
  /** Unmapped / review-required buckets. */
  review: ReviewItem[];
}

/** One computed ZM line (one customer EU-VAT-ID). */
export interface ZmEntryComputed {
  /** Customer EU VAT-ID (UID_MS), e.g. "DE123456789". */
  uidMs: string;
  /** Summed net turnover, signed whole euros (SUM_BGL). */
  sumBgl: number;
  /** Klassifikation: 1 = Lieferung, 2 = sonstige Leistung, 3 = Dreiecksgeschäft. */
  klag: '1' | '2' | '3';
  /** Dreiecksgeschäft flag. */
  dreieck?: 'J';
}

/** Result of the ZM computation. */
export interface ZmComputation {
  entries: ZmEntryComputed[];
  documentCount: number;
  review: ReviewItem[];
}

/** Result of a U30/ZM submission to FinanzOnline via fon-api. */
export interface SubmitResult {
  success: boolean;
  /** "test" = non-binding (uebermittlung "T"); "production" = filed (uebermittlung "P"). */
  mode: 'test' | 'production';
  /** BMF returncode from the fileupload response (0 = OK). Absent on a pre-request failure. */
  rc?: number;
  /** Parsed BMF protocol verdict, when the response carried one. */
  status?: 'OK' | 'TWOK' | 'NOK';
  /** BMF message reference id on an accepted submission. */
  messageRefId?: string;
  /** BMF errors/warnings on a rejected or partially-accepted submission. */
  errors?: { code: string; text: string }[];
  message: string;
  error?: string;
}

export interface PreviewU30Result {
  success: boolean;
  period: string;
  /** U30 Kennzahlen keyed by fon-api field name (e.g. "kz022", "kz060"). */
  kennzahlen: Record<string, number>;
  /** Computed Zahllast / Gutschrift (positive = payable, negative = credit). */
  payable: number;
  documentCount: number;
  /** Buckets that could not be mapped confidently — review before filing. */
  review?: ReviewItem[];
  message?: string;
  error?: string;
}
