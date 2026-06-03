import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

/**
 * Reporting frequency for the USt-Voranmeldung, set once at install time.
 */
export type UstvaReportingPeriod = 'monthly' | 'quarterly';

/**
 * Install-time configuration for the ELSTER integration (manifest configSchema).
 * Export-only: these values are used to populate the generated files.
 */
export interface ElsterIntegrationConfig {
  steuernummer?: string;
  finanzamt?: string;
  ustvaPeriod?: UstvaReportingPeriod;
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

export interface PreviewUstvaResult {
  success: boolean;
  period: string;
  /** USt-VA Kennzahlen keyed by Kennziffer (e.g. "81", "66"). */
  kennzahlen: Record<string, number>;
  /** Computed Zahllast / Erstattung (positive = payable, negative = refund). */
  payable: number;
  documentCount: number;
  message?: string;
  error?: string;
}
