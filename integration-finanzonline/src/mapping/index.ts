/**
 * Document -> Austrian U30 Kennzahlen and ZM entry mapping.
 *
 * This is the load-bearing domain piece: export quality is bounded by the accuracy
 * of this routing. The Kennzahl field names (kz000, kz022, ...) are taken from the
 * fon-api U30 schema (the canonical Austrian BMF builder), but the ROUTING of an
 * InvoiceLeaf `taxTreatment` to a given Kennzahl is a best-effort reconstruction.
 *
 * REVIEW REQUIRED: a Steuerberater must confirm the treatment->Kennzahl routing,
 * the standard-rate assignments (AT: 20 % normal, 13 % / 10 % reduced, 19 %
 * Jungholz/Mittelberg), and especially the §19 reverse-charge / intra-community
 * acquisition / import handling before any generated file is relied upon. Cases
 * that cannot be mapped confidently are collected in `review` rather than being
 * silently mis-bucketed. taxTreatment is a free-form string on the SDK Document;
 * the token set matched below is inferred and may not match the backend exactly.
 */

import type { Document } from '@invoiceleaf/integration-sdk';
import type {
  ReviewItem,
  U30Computation,
  ZmComputation,
  ZmEntryComputed,
} from '../types';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

interface ReviewBucket {
  count: number;
  net: number;
}

function makeReviewer(): {
  flag: (reason: string, net: number) => void;
  list: () => ReviewItem[];
} {
  const map = new Map<string, ReviewBucket>();
  return {
    flag(reason: string, net: number): void {
      const cur = map.get(reason) ?? { count: 0, net: 0 };
      cur.count += 1;
      cur.net = round2(cur.net + net);
      map.set(reason, cur);
    },
    list(): ReviewItem[] {
      return [...map.entries()].map(([reason, v]) => ({ reason, count: v.count, net: v.net }));
    },
  };
}

function isReversed(doc: Document): boolean {
  return doc.legalKind === 'CREDIT_NOTE' || doc.legalKind === 'CANCELLATION';
}

/**
 * Compute the Austrian U30 Kennzahlen from a set of documents.
 *
 * Output VAT (incl. self-assessed intra-community acquisitions and §19 reverse
 * charge) minus deductible input VAT yields kz090 (Gutschrift/Zahllast). Credit
 * notes / cancellations flip the sign.
 */
export function computeU30(documents: Document[]): U30Computation {
  const kz: Record<string, number> = {};
  const add = (key: string, amount: number): void => {
    kz[key] = round2((kz[key] ?? 0) + amount);
  };

  let outputVat = 0; // total VAT owed (incl. self-assessed reverse charge / acquisitions)
  let inputVat = 0; // total deductible Vorsteuer
  let documentCount = 0;
  const reviewer = makeReviewer();

  for (const doc of documents) {
    if (doc.deleted || doc.duplicateOfId) continue;
    documentCount += 1;

    const sign = isReversed(doc) ? -1 : 1;
    const treatment = (doc.taxTreatment ?? 'UNKNOWN').toUpperCase();
    const side = doc.accountingType; // 'RECEIVABLE' (sale) | 'PAYABLE' (purchase) | 'UNKNOWN'

    const items = doc.taxItems ?? [];
    if (items.length === 0) {
      reviewer.flag('Document without a tax breakdown (no taxItems)', round2((doc.netAmount ?? 0) * sign));
      continue;
    }

    for (const item of items) {
      const net = round2((item.netAmount ?? 0) * sign);
      const rate = Math.round(item.taxPercentage ?? 0);
      const tax = round2((item.taxAmount ?? item.totalTax ?? (net * rate) / 100) * sign);

      if (side === 'RECEIVABLE') {
        // Seller / output side. Every sale net feeds the total Bemessungsgrundlage.
        add('kz000', net); // [VERIFY] kz000 scope: total base of Lieferungen/Leistungen/Eigenverbrauch
        switch (treatment) {
          case 'DOMESTIC_TAXABLE':
            if (rate === 20) {
              add('kz022', net);
              outputVat = round2(outputVat + net * 0.2);
            } else if (rate === 13) {
              add('kz029', net);
              outputVat = round2(outputVat + net * 0.13);
            } else if (rate === 10) {
              add('kz006', net);
              outputVat = round2(outputVat + net * 0.1);
            } else if (rate === 19) {
              add('kz037', net); // Jungholz / Mittelberg
              outputVat = round2(outputVat + net * 0.19);
            } else if (rate === 0) {
              reviewer.flag('Domestic sale flagged taxable but at 0% rate', net);
            } else {
              reviewer.flag(`Domestic sale at non-standard rate (${rate}%)`, net);
            }
            break;
          case 'EXPORT':
            add('kz011', net); // Ausfuhrlieferungen (§ 7)
            break;
          case 'EU_INTRA_COMMUNITY':
            add('kz015', net); // ig Lieferungen (Art. 6 Abs. 1) — feeds ZM (goods)
            break;
          case 'EU_REVERSE_CHARGE':
            // [VERIFY] cross-border services where the recipient owes the tax.
            // Routed to kz021 (Sonstige Leistungen); kz016 is the alternative.
            add('kz021', net); // feeds ZM (services)
            break;
          case 'DOMESTIC_EXEMPT':
            add('kz020', net); // sonstige steuerfreie Umsätze ohne Vorsteuerabzug
            break;
          case 'SMALL_BUSINESS_EXEMPT':
            reviewer.flag('Kleinunternehmer (§6 Abs 1 Z 27) sale — not reported unless Regelbesteuerung', net);
            break;
          case 'MARGIN_SCHEME':
            reviewer.flag('Margin-scheme sale (§24) — requires special handling, not mapped', net);
            break;
          case 'TRIANGULAR':
            reviewer.flag('Triangular transaction — requires special handling, not mapped (see ZM)', net);
            break;
          default:
            reviewer.flag(`Sale with undetermined tax treatment (${treatment})`, net);
        }
      } else if (side === 'PAYABLE') {
        // Buyer / input / self-assessment side.
        switch (treatment) {
          case 'DOMESTIC_TAXABLE':
            if (tax !== 0) {
              add('kz060', tax); // abziehbare Vorsteuer (außer EUSt)
              inputVat = round2(inputVat + tax);
            }
            break;
          case 'EU_INTRA_COMMUNITY': {
            // Intra-community acquisition: self-assess output VAT, deduct the same as input.
            add('kz070', net); // total base of ig Erwerbe
            let acqVat = 0;
            if (rate === 20) {
              add('kz072', net);
              acqVat = round2(net * 0.2);
            } else if (rate === 13) {
              add('kz073', net);
              acqVat = round2(net * 0.13);
            } else if (rate === 10) {
              add('kz008', net);
              acqVat = round2(net * 0.1);
            } else {
              reviewer.flag(`Intra-community acquisition at a non-standard rate (${rate}%), not mapped`, net);
              break;
            }
            outputVat = round2(outputVat + acqVat);
            add('kz066', acqVat); // Vorsteuern aus ig Erwerb
            inputVat = round2(inputVat + acqVat);
            break;
          }
          case 'EU_REVERSE_CHARGE': {
            // [VERIFY] §19 recipient: self-assess output VAT, deduct the same as input (kz065).
            const rcVat = tax !== 0 ? tax : round2((net * rate) / 100);
            outputVat = round2(outputVat + rcVat);
            add('kz065', rcVat); // Vorsteuern § 19 Abs. 1 zweiter Satz
            inputVat = round2(inputVat + rcVat);
            break;
          }
          case 'IMPORT':
            if (tax !== 0) {
              add('kz061', tax); // entrichtete Einfuhrumsatzsteuer
              inputVat = round2(inputVat + tax);
            }
            break;
          case 'DOMESTIC_EXEMPT':
          case 'EXPORT':
          case 'SMALL_BUSINESS_EXEMPT':
            break; // purchase without deductible VAT — nothing to report
          case 'MARGIN_SCHEME':
          case 'TRIANGULAR':
            reviewer.flag(`Purchase with ${treatment} treatment — requires special handling, not mapped`, net);
            break;
          default:
            reviewer.flag(`Purchase with undetermined tax treatment (${treatment})`, net);
        }
      } else {
        reviewer.flag('Document with UNKNOWN direction (sale vs purchase undetermined)', net);
      }
    }
  }

  const payable = round2(outputVat - inputVat);
  kz['kz090'] = payable;

  // Surface any base / rate bucket that netted negative (credit notes or
  // cancellations exceed sales at that rate). A U30 base cannot be negative, so this
  // needs reconciliation before a file can be produced; only kz090 (Zahllast) is signed.
  for (const [key, value] of Object.entries(kz)) {
    if (key !== 'kz090' && value < 0) {
      reviewer.flag(
        `Kennzahl ${key} nets negative for this period (credit notes/cancellations exceed sales at that rate); reconcile before filing`,
        value
      );
    }
  }

  return { kennzahlen: kz, payable, documentCount, review: reviewer.list() };
}

/**
 * Normalize a customer VAT-ID to a comparable UID: uppercase, stripped of spaces
 * and punctuation, validated as country-prefixed (e.g. "DE123456789"). Returns
 * undefined if it does not look like an EU UID.
 */
export function normalizeUid(value: string | undefined): string | undefined {
  const cleaned = (value ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
  if (!/^[A-Z]{2}[A-Z0-9]{1,13}$/.test(cleaned)) return undefined;
  return cleaned;
}

/**
 * Compute ZM (Zusammenfassende Meldung) entries: one line per customer EU-VAT-ID,
 * summing the net intra-EU B2B turnover and classifying it (KLAG 1/2/3).
 *
 * Qualifying documents are RECEIVABLE supplies with an EU (non-AT) customer UID and
 * a treatment of intra-community delivery (goods), reverse-charge service, or a
 * triangular transaction. SUM_BGL is a signed whole-euro integer.
 *
 * REVIEW REQUIRED: the KLAG classification and whether a given supply belongs in
 * the ZM must be confirmed against the official ZM Ausfüllhilfe.
 */
export function computeZmEntries(documents: Document[]): ZmComputation {
  interface Acc {
    net: number;
    klag: '1' | '2' | '3';
    dreieck?: 'J';
  }
  const byKey = new Map<string, Acc>();
  let documentCount = 0;
  const reviewer = makeReviewer();

  for (const doc of documents) {
    if (doc.deleted || doc.duplicateOfId) continue;
    if (doc.accountingType !== 'RECEIVABLE') continue;

    const treatment = (doc.taxTreatment ?? 'UNKNOWN').toUpperCase();
    let klag: '1' | '2' | '3';
    let dreieck: 'J' | undefined;
    if (treatment === 'EU_INTRA_COMMUNITY') {
      klag = '1';
    } else if (treatment === 'EU_REVERSE_CHARGE') {
      klag = '2';
    } else if (treatment === 'TRIANGULAR') {
      klag = '3';
      dreieck = 'J';
    } else {
      continue; // not a ZM-relevant supply
    }

    const sign = isReversed(doc) ? -1 : 1;
    const net = round2((doc.netAmount ?? 0) * sign);
    const uid = normalizeUid(doc.receiver?.vatId);
    if (!uid) {
      reviewer.flag('Intra-EU supply without a valid customer UID (receiver.vatId)', net);
      continue;
    }
    if (uid.startsWith('AT')) {
      reviewer.flag('Intra-EU supply to an Austrian (AT) UID — not a ZM line', net);
      continue;
    }

    documentCount += 1;
    const key = `${uid}|${klag}`;
    const acc = byKey.get(key) ?? { net: 0, klag, dreieck };
    acc.net = round2(acc.net + net);
    byKey.set(key, acc);
  }

  const entries: ZmEntryComputed[] = [];
  for (const [key, acc] of byKey) {
    const uidMs = key.slice(0, key.lastIndexOf('|'));
    const sumBgl = Math.round(acc.net); // SUM_BGL is a signed whole-euro integer
    if (sumBgl === 0) continue; // nothing to report for this customer
    entries.push({
      uidMs,
      sumBgl,
      klag: acc.klag,
      ...(acc.dreieck ? { dreieck: acc.dreieck } : {}),
    });
  }

  return { entries, documentCount, review: reviewer.list() };
}
