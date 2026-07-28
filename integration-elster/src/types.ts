import type { FilingRecord, IntegrationContext } from '@invoiceleaf/integration-sdk';

/**
 * Reporting frequency for the USt-Voranmeldung, set once at install time.
 */
export type UstvaReportingPeriod = 'monthly' | 'quarterly';

/**
 * Install-time configuration for the ELSTER integration (manifest configSchema).
 * Export-only: these values are used to populate the generated files.
 */
export interface ElsterIntegrationConfig {
  /** 13-digit bundeseinheitliche (federal) Steuernummer. */
  steuernummer?: string;
  finanzamt?: string;
  ustvaPeriod?: UstvaReportingPeriod;
  /** Business / data-supplier name written into the generated ELSTER file. */
  companyName?: string;
}

/** Shorthand for the typed context used across all ELSTER handlers. */
export type ElsterContext = IntegrationContext<ElsterIntegrationConfig>;

// ---------------------------------------------------------------------------
// Handler inputs
// ---------------------------------------------------------------------------

export interface ExportUstvaInput {
  /** Reporting period: "YYYY-MM" (monthly) or "YYYY-Qn" (quarterly). */
  period: string;
}

export interface ExportEuerInput {
  /** Full tax year, e.g. 2026. */
  year: number;
}

export interface PreviewUstvaInput {
  period: string;
}

export interface ValidateUstvaInput {
  /** Reporting period: "YYYY-MM" (monthly) or "YYYY-Qn" (quarterly). */
  period: string;
}

export interface SubmitUstvaInput {
  /** Reporting period: "YYYY-MM" (monthly) or "YYYY-Qn" (quarterly). */
  period: string;
  /**
   * Single-use approval token minted by InvoiceLeaf when the figures were approved.
   * Required: this action always files for real, so the host rejects it without one.
   * For a non-binding dry run, use `validate-ustva` instead.
   */
  confirmToken: string;
  /** Hash of the approved figures, re-checked host side against the approval. */
  figuresHash?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export type FilingStatusInput = Record<string, never>;

// ---------------------------------------------------------------------------
// Handler results
// ---------------------------------------------------------------------------

/**
 * File output shape consumed by the worker integration-export endpoint.
 * `fileBase64` must be <= 10MB (PluginExecutor MAX_OUTPUT_BYTES).
 */
export interface FileOutput {
  fileBase64: string;
  filename: string;
  mimeType: string;
}

/**
 * A bucket of transactions the computation could not confidently map to a
 * Kennzahl (or that need attention). Surfaced so gaps are visible rather than
 * silently producing wrong figures.
 */
export interface UstvaReviewItem {
  /** Why these amounts were not mapped / need review. */
  reason: string;
  /** Number of tax line items affected. */
  count: number;
  /** Total net amount affected (signed). */
  net: number;
}

/** Result of the USt-VA Kennzahlen computation. */
export interface UstvaComputation {
  /** Kennzahlen keyed by Kennziffer (e.g. "81", "66", "83"). */
  kennzahlen: Record<string, number>;
  /** Kz83: verbleibende Vorauszahlung (positive) / Überschuss (negative). */
  payable: number;
  /** Number of documents included. */
  documentCount: number;
  /** Unmapped / review-required buckets. */
  review: UstvaReviewItem[];
}

export interface PreviewUstvaResult {
  success: boolean;
  period: string;
  /** USt-VA Kennzahlen keyed by Kennziffer (e.g. "81", "66"). */
  kennzahlen: Record<string, number>;
  /** Computed Zahllast / Erstattung (positive = payable, negative = refund). */
  payable: number;
  documentCount: number;
  /** Buckets that could not be mapped confidently — review before filing. */
  review?: UstvaReviewItem[];
  message?: string;
  error?: string;
}

export interface ValidateUstvaResult {
  success: boolean;
  period: string;
  /** True when ERiC reports no validation errors. */
  ok: boolean;
  /** ERiC validation messages when not ok. */
  errors: string[];
  message?: string;
  error?: string;
}

export interface SubmitUstvaResult {
  success: boolean;
  period: string;
  /** "test" or "production". */
  mode: string;
  /** Lifecycle state: SUBMITTED | ACCEPTED | REJECTED | ERROR. */
  state?: string;
  /** ELSTER transfer ticket on a successful submission. */
  transferTicket?: string;
  /** GCS reference to the stored receipt PDF, if any. */
  receiptFileSource?: string;
  message?: string;
  error?: string;
}

export interface FilingStatusResult {
  success: boolean;
  filings: FilingRecord[];
  message?: string;
  error?: string;
}
