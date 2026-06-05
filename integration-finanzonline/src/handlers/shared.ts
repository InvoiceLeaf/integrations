/**
 * Shared helpers for the FinanzOnline handlers: period parsing, document
 * aggregation, U30 schema-version selection, and assembling the typed fon-api
 * U30 body from the flat computed Kennzahlen.
 */

import type { Document } from '@invoiceleaf/integration-sdk';
import { build as buildU30Current } from 'fon-api/u30/07_2026';
import { build as buildU30Legacy } from 'fon-api/u30/01_2022';
import type {
  AllgemeineDaten,
  Erklaerung,
  InnergemeinschaftlicheErwerbe,
  LieferungenLeistungenEigenverbrauch,
  Steuerfrei,
  U30Body,
  Versteuert,
  VersteuertIge,
  Vorsteuer,
} from 'fon-api/u30/07_2026';
import { build as buildZm } from 'fon-api/zm/current';
import type { ZMBody } from 'fon-api/zm/current';
import { createClient } from 'fon-api/core';
import type { UploadResult } from 'fon-api/upload';
import { computeU30, computeZmEntries } from '../mapping/index';
import type { FonContext, FonCredentials, SubmitResult } from '../types';

/** Page size used when listing documents for a period. */
const LIST_PAGE_SIZE = 100;
/** Safety cap so a runaway aggregation never loops forever. */
const MAX_PAGES = 500;

// U30 schema validity windows, per fon-api:
//   u30/01_2022  valid 2022-01-01 .. 2026-06-30
//   u30/07_2026  valid 2026-07-01 .. (open)
const U30_EARLIEST_MONTH = '2022-01';
const U30_CUTOVER_MONTH = '2026-07';

export interface ParsedPeriod {
  /** Inclusive start timestamp (ms, UTC) of the period. */
  startMs: number;
  /** Exclusive end timestamp (ms, UTC) of the period. */
  endMs: number;
  /** Normalized canonical period string (echoed in outputs/filenames). */
  canonical: string;
  /** Voranmeldungszeitraum start, "YYYY-MM" (ZRVON). */
  zrvon: string;
  /** Voranmeldungszeitraum end, "YYYY-MM" (ZRBIS). */
  zrbis: string;
}

/**
 * Parse a period string into a date window and the Austrian ZRVON/ZRBIS codes.
 * Accepts "YYYY-MM" (monthly) and "YYYY-Qn" (quarterly). Austrian ZR codes are
 * plain "YYYY-MM" (start and end month), unlike the German ELSTER Zeitraum codes.
 */
export function parsePeriod(period: string): ParsedPeriod {
  const monthly = /^(\d{4})-(\d{2})$/.exec(period);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]); // 1-12
    if (month < 1 || month > 12) {
      throw new Error(`Invalid month in period "${period}".`);
    }
    const startMs = Date.UTC(year, month - 1, 1);
    const endMs = Date.UTC(year, month, 1);
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return { startMs, endMs, canonical: ym, zrvon: ym, zrbis: ym };
  }

  const quarterly = /^(\d{4})-Q([1-4])$/.exec(period);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const quarter = Number(quarterly[2]); // 1-4
    const startMonth = (quarter - 1) * 3; // 0,3,6,9
    const startMs = Date.UTC(year, startMonth, 1);
    const endMs = Date.UTC(year, startMonth + 3, 1);
    const zrvon = `${year}-${String(startMonth + 1).padStart(2, '0')}`;
    const zrbis = `${year}-${String(startMonth + 3).padStart(2, '0')}`;
    return { startMs, endMs, canonical: `${year}-Q${quarter}`, zrvon, zrbis };
  }

  throw new Error(`Unrecognized period format "${period}". Expected "YYYY-MM" or "YYYY-Qn".`);
}

/**
 * List all documents whose date falls in [startMs, endMs), paging through results.
 *
 * REVIEW REQUIRED: this uses `startDate`/`endDate` filters on the list API, which
 * filter on the document's primary date. Whether that is the invoice date or the
 * booking/accounting date must be confirmed for correct period attribution.
 */
export async function listDocumentsInWindow(
  context: FonContext,
  startMs: number,
  endMs: number
): Promise<Document[]> {
  const out: Document[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= MAX_PAGES) {
    const result = await context.data.listDocuments({
      startDate: startMs,
      endDate: endMs,
      page,
      limit: LIST_PAGE_SIZE,
    });
    out.push(...result.items);
    hasMore = result.hasMore;
    page += 1;
  }
  return out;
}

/** A fon-api U30 builder erased to a single body type (the two versions are
 * field-compatible for everything this plugin emits). */
export type U30Builder = (body: U30Body) => string;

/**
 * Pick the U30 schema version for a period and return its builder. Fails loudly on
 * a period before the earliest supported schema rather than silently defaulting.
 */
export function selectU30Builder(zrvon: string): U30Builder {
  if (zrvon < U30_EARLIEST_MONTH) {
    throw new Error(
      `No U30 schema is available for period ${zrvon}; the earliest supported period is ${U30_EARLIEST_MONTH}.`
    );
  }
  const builder = zrvon >= U30_CUTOVER_MONTH ? buildU30Current : buildU30Legacy;
  return builder as unknown as U30Builder;
}

/** Current UTC date/time as the BMF-expected DATUM_ERSTELLUNG / UHRZEIT_ERSTELLUNG. */
export function nowParts(): { date: string; time: string } {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return { date, time };
}

/**
 * A per-submission packet number (PAKET_NR, 1..999_999_999). BMF rejects duplicate
 * paketNr per day / per art / per uploader, so a per-second-unique value derived
 * from the clock is sufficient for manual exports.
 */
export function paketNr(): number {
  const v = Math.floor(Date.now() / 1000) % 1_000_000_000;
  return v < 1 ? 1 : v;
}

/**
 * Convert an unknown thrown value to a message string. Defined locally rather than
 * imported from the SDK: the SDK is a type-only peer here, and importing its
 * runtime barrel would pull Node-only helpers (e.g. `crypto`) into the isolate bundle.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Normalize the configured Steuernummer to the 9-digit FASTNR FinanzOnline requires.
 */
export function normalizeFastnr(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length !== 9) {
    throw new Error(
      'FinanzOnline requires a 9-digit FASTNR (Finanzamts- und Steuernummer). Set it in the integration settings.'
    );
  }
  // fon-api enforces the BMF-valid FASTNR range; check it here so a typo surfaces as
  // a clear settings error rather than an opaque Zod failure inside build().
  const n = Number(digits);
  if (n < 10_000_010 || n > 989_999_999) {
    throw new Error(
      'The FASTNR (Steuernummer) is outside the valid Austrian range. Check it in the integration settings.'
    );
  }
  return digits;
}

/**
 * Truncate to at most `maxUtf16` UTF-16 code units without splitting a surrogate
 * pair. fon-api length-checks KUNDENINFO in code units, but a raw `.slice(0, n)`
 * can cut a non-BMP character in half and emit invalid UTF-8.
 */
export function truncateCodePoints(value: string, maxUtf16: number): string {
  let out = '';
  for (const ch of value) {
    if (out.length + ch.length > maxUtf16) break;
    out += ch;
  }
  return out;
}

/** U30 Kennzahlen that are signed (kzvorz) and may legitimately be negative. */
const U30_SIGNED_KEYS = new Set(['kz090', 'kz063', 'kz067']);

/**
 * The U30 base and VAT Kennzahlen are non-negative in the BMF schema (only the
 * Zahllast kz090 is signed). A credit-note / cancellation-heavy period can drive a
 * base or rate bucket negative; emitting that would either fail the schema (kz000 is
 * `kznull`) or silently drop a base while its VAT stays in kz090. Refuse to build and
 * point the user at the period instead.
 */
export function assertU30Buildable(flat: Record<string, number>): void {
  const negatives = Object.entries(flat)
    .filter(([key, value]) => !U30_SIGNED_KEYS.has(key) && value < 0)
    .map(([key]) => key);
  if (negatives.length > 0) {
    throw new Error(
      `Cannot build a U30: the period nets negative for ${negatives.join(', ')} ` +
        '(credit notes/cancellations exceed sales). A U30 base cannot be negative; ' +
        'reconcile the period before exporting. Use "Preview U30 figures" to inspect it.'
    );
  }
}

/** Turn a fon-api build/validation error into a readable, single-line message. */
export function describeBuildError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues?: Array<{ path?: string; message?: string }> }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      return issues.map((i) => `${i.path ?? ''}: ${i.message ?? ''}`.trim()).join('; ');
    }
  }
  return toErrorMessage(error);
}

// --- U30 body assembly ------------------------------------------------------

/** Round and keep only strictly-positive values (fon-api `kz` requires >= 0.01). */
function positive(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const r = Math.round((value + Number.EPSILON) * 100) / 100;
  return r > 0 ? r : undefined;
}

/** Collect the positive Kennzahlen for a set of keys into a typed sub-object. */
function collect<T extends object>(flat: Record<string, number>, keys: readonly string[]): T {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const v = positive(flat[key]);
    if (v !== undefined) out[key] = v;
  }
  return out as T;
}

const STEUERFREI_KEYS = ['kz011', 'kz015', 'kz016', 'kz020'] as const;
const VERSTEUERT_KEYS = ['kz022', 'kz029', 'kz006', 'kz037'] as const;
const IGE_KEYS = ['kz072', 'kz073', 'kz008'] as const;
const VORSTEUER_POS_KEYS = ['kz060', 'kz061', 'kz065', 'kz066'] as const;

/**
 * Assemble a single typed U30 Erklaerung from the flat computed Kennzahlen.
 * Empty optional groups are omitted; kz000 (base total) and kz090 (Zahllast,
 * signed) are always emitted so a Nullmeldung is well-formed.
 */
export function assembleU30Erklaerung(
  flat: Record<string, number>,
  allgemein: AllgemeineDaten
): Erklaerung {
  const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

  const steuerfrei = collect<Steuerfrei>(flat, STEUERFREI_KEYS);
  const versteuert = collect<Versteuert>(flat, VERSTEUERT_KEYS);
  const lieferungen: LieferungenLeistungenEigenverbrauch = { kz000: round2(flat['kz000'] ?? 0) };
  const kz021 = positive(flat['kz021']);
  if (kz021 !== undefined) lieferungen.kz021 = kz021;
  if (Object.keys(steuerfrei).length > 0) lieferungen.steuerfrei = steuerfrei;
  if (Object.keys(versteuert).length > 0) lieferungen.versteuert = versteuert;

  const versteuertIge = collect<VersteuertIge>(flat, IGE_KEYS);
  const kz070 = positive(flat['kz070']);
  let innergemeinschaftlich: InnergemeinschaftlicheErwerbe | undefined;
  if (kz070 !== undefined || Object.keys(versteuertIge).length > 0) {
    innergemeinschaftlich = {};
    if (kz070 !== undefined) innergemeinschaftlich.kz070 = kz070;
    if (Object.keys(versteuertIge).length > 0) innergemeinschaftlich.versteuertIge = versteuertIge;
  }

  const vorsteuer = collect<Vorsteuer>(flat, VORSTEUER_POS_KEYS);
  vorsteuer.kz090 = round2(flat['kz090'] ?? 0); // signed Gutschrift/Zahllast, always emit

  const erklaerung: Erklaerung = {
    art: 'U30',
    satznr: 1,
    allgemein,
    lieferungen,
    vorsteuer,
  };
  if (innergemeinschaftlich !== undefined) erklaerung.innergemeinschaftlich = innergemeinschaftlich;
  return erklaerung;
}

// --- XML builders (shared by export + submit) -------------------------------

/** List the period's documents, compute the U30, and return the BMF-conformant XML. */
export async function buildU30Xml(context: FonContext, period: ParsedPeriod): Promise<string> {
  const fastnr = normalizeFastnr(context.config.steuernummer);
  const companyName = context.config.companyName?.trim();
  const buildU30 = selectU30Builder(period.zrvon);

  const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
  const { kennzahlen } = computeU30(documents);
  // A U30 base cannot be negative; refuse rather than emit an invalid/inconsistent file.
  assertU30Buildable(kennzahlen);

  const { date, time } = nowParts();
  const kundeninfo = companyName ? truncateCodePoints(companyName, 50) : undefined;
  const erklaerung = assembleU30Erklaerung(kennzahlen, {
    anbringen: 'U30',
    zrvon: period.zrvon,
    zrbis: period.zrbis,
    fastnr,
    ...(kundeninfo ? { kundeninfo } : {}),
  });

  const body: U30Body = {
    info: {
      artIdentifikationsbegriff: 'FASTNR',
      identifikationsbegriff: fastnr,
      paketNr: paketNr(),
      datumErstellung: date,
      uhrzeitErstellung: time,
      anzahlErklaerungen: 1,
    },
    erklaerungen: [erklaerung],
  };

  try {
    return buildU30(body);
  } catch (error) {
    throw new Error(`U30 XML failed BMF schema validation: ${describeBuildError(error)}`);
  }
}

/** List the period's documents, compute the ZM, and return the BMF-conformant XML. */
export async function buildZmXml(context: FonContext, period: ParsedPeriod): Promise<string> {
  const fastnr = normalizeFastnr(context.config.steuernummer);
  const documents = await listDocumentsInWindow(context, period.startMs, period.endMs);
  const { entries } = computeZmEntries(documents);
  if (entries.length === 0) {
    throw new Error(
      `No intra-EU B2B supplies found for ${period.canonical}, so there is nothing to report in a ZM.`
    );
  }

  const { date, time } = nowParts();
  const body: ZMBody = {
    info: {
      artIdentifikationsbegriff: 'FASTNR',
      identifikationsbegriff: fastnr,
      paketNr: paketNr(),
      datumErstellung: date,
      uhrzeitErstellung: time,
      anzahlErklaerungen: 1,
    },
    erklaerungen: [
      {
        art: 'U13',
        satznr: 1,
        allgemein: { anbringen: 'U13', zrvon: period.zrvon, zrbis: period.zrbis, fastnr },
        content: { kind: 'entries', entries },
      },
    ],
  };

  try {
    return buildZm(body);
  } catch (error) {
    throw new Error(`ZM XML failed BMF schema validation: ${describeBuildError(error)}`);
  }
}

// --- Submission -------------------------------------------------------------

/**
 * Read and parse the FinanzOnline webservice credentials from the encrypted
 * credential store. They are stored as one JSON object under the "finanzonline"
 * provider (see the manifest's externalAuth multi-field config).
 */
export async function getFonCredentials(context: FonContext): Promise<FonCredentials> {
  const notConnected =
    'FinanzOnline credentials are not connected. Add them in the integration’s Connections tab.';
  let raw: string;
  try {
    raw = await context.credentials.getApiKey('finanzonline');
  } catch {
    throw new Error(notConnected);
  }
  const trimmed = (raw ?? '').trim();
  if (!trimmed) throw new Error(notConnected);

  let parsed: Partial<FonCredentials>;
  try {
    parsed = JSON.parse(trimmed) as Partial<FonCredentials>;
  } catch {
    throw new Error('Stored FinanzOnline credentials are not valid JSON.');
  }
  const { tid, benid, pin } = parsed;
  if (!tid || !benid || !pin) {
    throw new Error(
      'FinanzOnline credentials are incomplete; tid, benid and pin are all required.'
    );
  }
  // The Hersteller-ID is typically the company's UID (ATU). Use the value entered in
  // the connection if present, otherwise fall back to the configured company UID.
  const configuredUid = (context.config.uid ?? '').replace(/\s+/g, '').toUpperCase();
  const herstellerid = parsed.herstellerid?.trim() || configuredUid;
  if (!herstellerid) {
    throw new Error(
      'No Hersteller-ID available. Enter your company UID (ATU) in the integration settings, or set a Hersteller-ID in the FinanzOnline connection.'
    );
  }
  return { tid, benid, pin, herstellerid };
}

/**
 * Submit a built XML payload to FinanzOnline via fon-api (SOAP login -> upload ->
 * logout). Defaults to a non-binding test transmission; `production` files for real.
 * The SOAP transport runs on the isolate's host-bridged fetch.
 */
export async function submitToFon(
  creds: FonCredentials,
  art: 'U30' | 'U13',
  xml: string,
  production: boolean
): Promise<SubmitResult> {
  const mode: SubmitResult['mode'] = production ? 'production' : 'test';
  const client = createClient({
    tid: creds.tid,
    benid: creds.benid,
    pin: creds.pin,
    herstellerid: creds.herstellerid,
  });

  let result: UploadResult;
  try {
    result = await client.upload({ art, uebermittlung: production ? 'P' : 'T', data: xml });
  } finally {
    await client.logout().catch(() => undefined);
  }

  const parsed = result.parsed;
  const kind = parsed?.kind;
  const success = result.rc === 0 && (kind === undefined || kind === 'OK' || kind === 'TWOK');
  const errors =
    parsed && (parsed.kind === 'NOK' || parsed.kind === 'TWOK')
      ? parsed.errors.map((e) => ({ code: e.code, text: e.text }))
      : undefined;
  const messageRefId = parsed && parsed.kind === 'OK' ? parsed.meta.messageRefId : undefined;
  const message = success
    ? mode === 'test'
      ? 'Test submission accepted by FinanzOnline (non-binding; nothing was filed).'
      : 'Submission filed with FinanzOnline.'
    : `FinanzOnline did not accept the submission (rc ${result.rc}).`;

  return {
    success,
    mode,
    rc: result.rc,
    ...(kind ? { status: kind } : {}),
    ...(messageRefId ? { messageRefId } : {}),
    ...(errors ? { errors } : {}),
    message,
  };
}
