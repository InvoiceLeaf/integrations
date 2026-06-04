/**
 * USt-VA Kennzahlen and Anlage EUER line definitions (scaffold).
 *
 * REVIEW REQUIRED: the Kennziffern and line numbers below are well-known defaults
 * but MUST be verified against the current ELSTER Steuerdatenschema for the target
 * tax year. They are kept in one place so a reviewer can correct them without
 * touching handler logic.
 */

/** VAT-rate bucket used to group taxable turnover (kept for the vatRateBucket helper). */
export type VatRateBucket = 'standard' | 'reduced' | 'zero';

/**
 * A single USt-VA Kennzahl emitted into the XML.
 * - format "euro": Bemessungsgrundlage, reported in whole euros.
 * - format "decimal": tax / input-VAT / payable amount, two decimals.
 */
export interface UstvaKennzahl {
  /** Official Kennziffer (e.g. "81", "66", "83"). */
  kennziffer: string;
  /** Human-readable label. */
  label: string;
  format: 'euro' | 'decimal';
  /** Always emit even when zero (used for the payable Kz83 so a Nullmeldung is well-formed). */
  alwaysEmit?: boolean;
}

/**
 * USt-VA Kennzahlen supported by the computation and builder.
 *
 * REVIEW REQUIRED: the Kennziffern follow the standard German USt-VA form, but a
 * tax professional must confirm them — the §13b reverse-charge, intra-community,
 * and import lines especially — against the current Steuerdatenschema before any
 * filing. The computation in shared.ts decides which Kennzahl each transaction
 * feeds based on the document's taxTreatment, accountingType, and VAT rate.
 */
export const USTVA_KENNZAHLEN: UstvaKennzahl[] = [
  // Output — steuerpflichtige Umsätze (we are the seller)
  { kennziffer: '81', label: 'Steuerpflichtige Umsätze 19% (Bemessungsgrundlage)', format: 'euro' },
  { kennziffer: '86', label: 'Steuerpflichtige Umsätze 7% (Bemessungsgrundlage)', format: 'euro' },
  { kennziffer: '35', label: 'Steuerpflichtige Umsätze zu anderen Steuersätzen (Bemessungsgrundlage)', format: 'euro' },
  { kennziffer: '36', label: 'Steuer zu anderen Steuersätzen', format: 'decimal' },
  // Output — steuerfreie Umsätze
  { kennziffer: '41', label: 'Innergemeinschaftliche Lieferungen (steuerfrei)', format: 'euro' },
  { kennziffer: '43', label: 'Weitere steuerfreie Umsätze mit Vorsteuerabzug (z.B. Ausfuhr)', format: 'euro' },
  { kennziffer: '48', label: 'Steuerfreie Umsätze ohne Vorsteuerabzug', format: 'euro' },
  { kennziffer: '60', label: 'Steuerpflichtige Umsätze, für die der Leistungsempfänger die Steuer schuldet (§13b)', format: 'euro' },
  // Innergemeinschaftliche Erwerbe (we are the buyer)
  { kennziffer: '89', label: 'Innergemeinschaftliche Erwerbe 19% (Bemessungsgrundlage)', format: 'euro' },
  { kennziffer: '93', label: 'Innergemeinschaftliche Erwerbe 7% (Bemessungsgrundlage)', format: 'euro' },
  // §13b as recipient (we owe the tax)
  { kennziffer: '46', label: 'Leistungen §13b, für die ich als Leistungsempfänger die Steuer schulde (Bemessungsgrundlage)', format: 'euro' },
  { kennziffer: '47', label: 'Steuer auf §13b-Leistungen (Leistungsempfänger)', format: 'decimal' },
  // Abziehbare Vorsteuerbeträge (input VAT)
  { kennziffer: '66', label: 'Vorsteuerbeträge aus Rechnungen anderer Unternehmer', format: 'decimal' },
  { kennziffer: '61', label: 'Vorsteuer aus innergemeinschaftlichen Erwerben', format: 'decimal' },
  { kennziffer: '62', label: 'Entrichtete Einfuhrumsatzsteuer', format: 'decimal' },
  { kennziffer: '67', label: 'Vorsteuer aus §13b-Leistungen (Leistungsempfänger)', format: 'decimal' },
  // Result
  { kennziffer: '83', label: 'Verbleibende Umsatzsteuer-Vorauszahlung / Überschuss', format: 'decimal', alwaysEmit: true },
];

/**
 * A single Anlage EUER line.
 */
export interface EuerLine {
  /** Stable internal id referenced by the category mapping. */
  id: string;
  /** Official EUER line number / Zeile (placeholder). */
  lineNumber?: string;
  /** Human-readable label. */
  label: string;
  side: 'income' | 'expense';
}

/**
 * DEFAULT Anlage EUER line set.
 *
 * REVIEW REQUIRED: line numbers are intentionally left undefined where not
 * confirmed; labels follow the official Anlage EUER structure but must be checked
 * against the target-year form.
 */
export const EUER_LINES: EuerLine[] = [
  // Betriebseinnahmen
  { id: 'einnahmen-19', label: 'Betriebseinnahmen zum allgemeinen Steuersatz (19%)', side: 'income' },
  { id: 'einnahmen-7', label: 'Betriebseinnahmen zum ermäßigten Steuersatz (7%)', side: 'income' },
  { id: 'einnahmen-steuerfrei', label: 'Steuerfreie / nicht steuerbare Betriebseinnahmen', side: 'income' },

  // Betriebsausgaben
  { id: 'ausgaben-waren', label: 'Waren, Rohstoffe und Hilfsstoffe', side: 'expense' },
  { id: 'ausgaben-personal', label: 'Ausgaben für eigenes Personal (Löhne und Gehälter)', side: 'expense' },
  { id: 'ausgaben-afa', label: 'Absetzung für Abnutzung (AfA)', side: 'expense' },
  { id: 'ausgaben-raumkosten', label: 'Raumkosten und sonstige Grundstückskosten', side: 'expense' },
  { id: 'ausgaben-kfz', label: 'Kraftfahrzeugkosten und andere Fahrtkosten', side: 'expense' },
  { id: 'ausgaben-reise', label: 'Reisekosten', side: 'expense' },
  { id: 'ausgaben-vorsteuer', label: 'Gezahlte Vorsteuerbeträge', side: 'expense' },
  { id: 'ausgaben-uebrige', label: 'Übrige unbeschränkt abziehbare Betriebsausgaben', side: 'expense' },
];
