/**
 * USt-VA Kennzahlen and Anlage EUER line definitions (scaffold).
 *
 * REVIEW REQUIRED: the Kennziffern and line numbers below are well-known defaults
 * but MUST be verified against the current ELSTER Steuerdatenschema for the target
 * tax year. They are kept in one place so a reviewer can correct them without
 * touching handler logic.
 */

/** VAT-rate bucket used to group taxable turnover. */
export type VatRateBucket = 'standard' | 'reduced' | 'zero';

/**
 * A single USt-VA Kennzahl.
 * - role "base": net taxable turnover for a rate bucket (Bemessungsgrundlage).
 * - role "tax": VAT amount.
 * - role "input": input VAT (Vorsteuer).
 * - role "payable": resulting Zahllast / Erstattung.
 */
export interface UstvaKennzahl {
  /** Official Kennziffer (e.g. "81", "86", "66", "83"). */
  kennziffer: string;
  /** Human-readable label. */
  label: string;
  role: 'base' | 'tax' | 'input' | 'payable';
  /** Rate bucket for base/tax roles. */
  bucket?: VatRateBucket;
}

/**
 * DEFAULT USt-VA Kennzahlen (subset covering the standard domestic cases).
 *
 * REVIEW REQUIRED: Kennziffern are the commonly used ones for domestic turnover at
 * 19% (Kz 81) and 7% (Kz 86), input VAT (Kz 66), and the computed payable (Kz 83).
 * Many other Kennzahlen exist (reverse charge, intra-EU, etc.) and are out of scope
 * for this scaffold.
 */
export const USTVA_KENNZAHLEN: UstvaKennzahl[] = [
  { kennziffer: '81', label: 'Steuerpflichtige Umsätze 19% (Bemessungsgrundlage)', role: 'base', bucket: 'standard' },
  { kennziffer: '86', label: 'Steuerpflichtige Umsätze 7% (Bemessungsgrundlage)', role: 'base', bucket: 'reduced' },
  { kennziffer: '66', label: 'Vorsteuerbeträge (abziehbar)', role: 'input' },
  { kennziffer: '83', label: 'Verbleibende Umsatzsteuer-Vorauszahlung / Überschuss', role: 'payable' },
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
