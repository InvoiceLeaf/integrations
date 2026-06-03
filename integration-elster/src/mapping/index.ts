/**
 * Category -> official form-line mapping scaffold.
 *
 * This is the load-bearing domain piece (spec 7.3): export quality is bounded by
 * the accuracy of this mapping, so it is where review effort should go. The tables
 * below ship sensible DEFAULTS only.
 *
 * REVIEW REQUIRED: every default here is a best-effort placeholder. A tax
 * professional must confirm the category names, the VAT-rate buckets, the
 * official Kennzahlen, and the EUER line numbers against the current
 * Steuerdatenschema for the relevant tax year before any of this is relied upon.
 *
 * Notes on identity:
 * - App categories are matched here by a normalized name token (lowercase). The
 *   defaults assume the standard InvoiceLeaf seed category names. Per-space
 *   overrides (spec open decision #2) are NOT implemented yet — see TODO below.
 */

import type { UstvaKennzahl, EuerLine, VatRateBucket } from './lines.js';
export type { UstvaKennzahl, EuerLine, VatRateBucket } from './lines.js';
import { USTVA_KENNZAHLEN, EUER_LINES } from './lines.js';
export { USTVA_KENNZAHLEN, EUER_LINES } from './lines.js';

/**
 * A single mapping rule from an app category to one EUER line. USt-VA figures are
 * derived from document VAT amounts/rates rather than category alone, but the
 * EUER classification is category-driven.
 */
export interface CategoryMappingRule {
  /** Normalized (lowercase) category-name token this rule matches. */
  categoryToken: string;
  /** Target EUER line id (see {@link EUER_LINES}). */
  euerLine: EuerLine['id'];
  /** Whether this is income (Betriebseinnahme) or expense (Betriebsausgabe). */
  side: 'income' | 'expense';
}

/**
 * DEFAULT category -> EUER line mapping.
 *
 * REVIEW REQUIRED: tokens and target lines are placeholders. Categories not
 * listed here fall back to the catch-all "uebrige" expense / "einnahmen-19"
 * income line (see {@link mapCategoryToEuerLine}).
 */
export const DEFAULT_CATEGORY_MAPPING: CategoryMappingRule[] = [
  // --- Betriebseinnahmen (income) ---
  { categoryToken: 'umsatz', euerLine: 'einnahmen-19', side: 'income' },
  { categoryToken: 'erloese', euerLine: 'einnahmen-19', side: 'income' },
  { categoryToken: 'sales', euerLine: 'einnahmen-19', side: 'income' },

  // --- Betriebsausgaben (expenses) ---
  { categoryToken: 'wareneinkauf', euerLine: 'ausgaben-waren', side: 'expense' },
  { categoryToken: 'waren', euerLine: 'ausgaben-waren', side: 'expense' },
  { categoryToken: 'goods', euerLine: 'ausgaben-waren', side: 'expense' },
  { categoryToken: 'personal', euerLine: 'ausgaben-personal', side: 'expense' },
  { categoryToken: 'lohn', euerLine: 'ausgaben-personal', side: 'expense' },
  { categoryToken: 'gehalt', euerLine: 'ausgaben-personal', side: 'expense' },
  { categoryToken: 'afa', euerLine: 'ausgaben-afa', side: 'expense' },
  { categoryToken: 'abschreibung', euerLine: 'ausgaben-afa', side: 'expense' },
  { categoryToken: 'miete', euerLine: 'ausgaben-raumkosten', side: 'expense' },
  { categoryToken: 'raumkosten', euerLine: 'ausgaben-raumkosten', side: 'expense' },
  { categoryToken: 'rent', euerLine: 'ausgaben-raumkosten', side: 'expense' },
  { categoryToken: 'kfz', euerLine: 'ausgaben-kfz', side: 'expense' },
  { categoryToken: 'fahrzeug', euerLine: 'ausgaben-kfz', side: 'expense' },
  { categoryToken: 'reise', euerLine: 'ausgaben-reise', side: 'expense' },
  { categoryToken: 'travel', euerLine: 'ausgaben-reise', side: 'expense' },
];

/** Catch-all EUER lines used when no category rule matches. */
export const FALLBACK_INCOME_LINE: EuerLine['id'] = 'einnahmen-19';
export const FALLBACK_EXPENSE_LINE: EuerLine['id'] = 'ausgaben-uebrige';

/**
 * Normalize a category name to a matchable token: lowercased, stripped of German
 * umlaut diacritics and non-alphanumerics. Best-effort only.
 */
export function normalizeCategoryName(name: string | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve an app category name to an EUER line id using {@link DEFAULT_CATEGORY_MAPPING}.
 *
 * REVIEW REQUIRED: substring token matching is intentionally loose and will
 * mis-bucket ambiguous category names. A real implementation should match against
 * confirmed per-space overrides first.
 *
 * TODO(mapping): support per-space mapping overrides (spec open decision #2),
 *   loaded from installation config or a dedicated mapping entity, taking
 *   precedence over these defaults.
 */
export function mapCategoryToEuerLine(
  categoryName: string | undefined,
  side: 'income' | 'expense'
): EuerLine['id'] {
  const token = normalizeCategoryName(categoryName);
  if (token) {
    for (const rule of DEFAULT_CATEGORY_MAPPING) {
      if (rule.side === side && token.includes(rule.categoryToken)) {
        return rule.euerLine;
      }
    }
  }
  return side === 'income' ? FALLBACK_INCOME_LINE : FALLBACK_EXPENSE_LINE;
}

/**
 * Map a VAT percentage to a USt-VA rate bucket.
 *
 * REVIEW REQUIRED: only the two standard German rates (19%, 7%) and a zero/exempt
 * bucket are modeled. Reverse-charge, intra-community, import VAT, and other
 * special cases are NOT handled and would need their own Kennzahlen.
 */
export function vatRateBucket(taxPercentage: number | undefined): VatRateBucket {
  const rate = Math.round(taxPercentage ?? 0);
  if (rate === 19) return 'standard';
  if (rate === 7) return 'reduced';
  return 'zero';
}

/** Look up the USt-VA Kennziffer that carries the net base for a rate bucket. */
export function ustvaBaseKennziffer(bucket: VatRateBucket): UstvaKennzahl['kennziffer'] | undefined {
  const entry = USTVA_KENNZAHLEN.find((k) => k.role === 'base' && k.bucket === bucket);
  return entry?.kennziffer;
}
