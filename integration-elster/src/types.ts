import type { IntegrationContext } from '@invoiceleaf/integration-sdk';

/**
 * Reporting frequency for the USt-Voranmeldung, set once at install time.
 */
export type UstvaReportingPeriod = 'monthly' | 'quarterly';

/**
 * Install-time configuration for the ELSTER integration (manifest configSchema).
 *
 * `certificate` and `certificatePin` are SENSITIVE: they are stored encrypted and
 * stripped from the configuration handed to the sandbox (SENSITIVE_CONFIG_KEYS).
 * Handlers therefore must NOT expect these values to be present in `context.config`;
 * the certificate is referenced host-side by a stable handle (see {@link certHandle}).
 */
export interface ElsterIntegrationConfig {
  steuernummer?: string;
  finanzamt?: string;
  ustvaPeriod?: UstvaReportingPeriod;
  // NOTE: certificate / certificatePin are intentionally NOT typed as readable
  // config here — they never enter the isolate. They are managed host-side.
}

/** Shorthand for the typed context used across all ELSTER handlers. */
export type ElsterContext = IntegrationContext<ElsterIntegrationConfig>;

// ---------------------------------------------------------------------------
// Handler inputs
// ---------------------------------------------------------------------------

export type ExportMode = 'download' | 'validate';

export interface ExportUstvaInput {
  /** Reporting period: "YYYY-MM" (monthly) or "YYYY-Qn" (quarterly). */
  period: string;
  /** "download" returns the XML file; "validate" runs context.filing.validate only. */
  mode?: ExportMode;
}

export interface ExportEuerInput {
  /** Full tax year, e.g. 2026. */
  year: number;
}

export interface PreviewUstvaInput {
  period: string;
}

export interface FilingStatusInput {
  /** Optional period filter. */
  period?: string;
}

export interface SubmitUstvaInput {
  period: string;
  /** One-time token minted by the UI confirmation step. Required. */
  confirmToken: string;
  /** Submit against the ERiC test Finanzamt when true. Defaults to true for safety. */
  testMode?: boolean;
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

/** Result returned by exportUstva when mode === "validate". */
export interface ValidateReport {
  success: boolean;
  mode: 'validate';
  period: string;
  ok: boolean;
  errors: FilingValidationError[];
  /** The computed USt-VA Kennzahlen, echoed back for review. */
  kennzahlen: Record<string, number>;
  message?: string;
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

export interface FilingStatusEntry {
  formType: string;
  period: string;
  state: string;
  mode?: string;
  transferTicket?: string;
  submittedAt?: string;
}

export interface FilingStatusResult {
  success: boolean;
  filings: FilingStatusEntry[];
  message?: string;
  error?: string;
}

export interface SubmitUstvaResult {
  success: boolean;
  period: string;
  testMode: boolean;
  transferTicket?: string;
  receiptRef?: string;
  serverResponse?: string;
  message?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Filing host capability (Layer 2)
// ---------------------------------------------------------------------------

export interface FilingValidationError {
  code?: string;
  message: string;
}

export interface FilingValidateInput {
  /** The built ELSTER Nutzdaten / transfer XML. */
  xml: string;
  /** Form type identifier, e.g. "ustva". */
  formType: string;
  /** Period or year context for schema selection. */
  period?: string;
  year?: number;
}

export interface FilingValidateResult {
  ok: boolean;
  errors: FilingValidationError[];
}

export interface FilingSubmitInput {
  xml: string;
  formType: string;
  period?: string;
  year?: number;
  /** Stable handle that references the customer certificate host-side (never the bytes). */
  certHandle: string;
  /** Submit against the ERiC test Finanzamt when true. */
  testMode?: boolean;
}

export interface FilingSubmitResult {
  transferTicket: string;
  receiptRef?: string;
  serverResponse?: string;
}

/**
 * Privileged filing capability bridged into the context for VERIFIED integrations
 * only (spec Layer 2, section 6.4). The certificate bytes / PIN never enter the
 * isolate; the plugin passes only the built XML and a stable {@link FilingSubmitInput.certHandle}.
 *
 * TODO(layer-2): the SDK `IntegrationContext` will gain an optional
 * `filing?: FilingClient` once Layer 2 ships. Until then this package reads it
 * defensively via {@link getFilingClient} so it typechecks standalone.
 */
export interface FilingClient {
  validate(input: FilingValidateInput): Promise<FilingValidateResult>;
  submit(input: FilingSubmitInput): Promise<FilingSubmitResult>;
}
