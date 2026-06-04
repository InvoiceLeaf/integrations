/**
 * Minimal pure-JS .xlsx (OOXML SpreadsheetML) writer.
 *
 * Builds the OOXML parts as XML, packages them in an uncompressed (STORE) ZIP with
 * a hand-rolled CRC32, and base64-encodes the result. No external dependencies and
 * no Node built-ins (Buffer/zlib/crypto), so the integration stays self-contained
 * and bundles for the isolate runtime. Uncompressed ZIP entries are valid OOXML and
 * open in Excel / LibreOffice. Strings are written as inline strings (no
 * sharedStrings part); cells carry no custom styles (default formatting).
 */

import { base64, utf8Bytes } from './encoding.js';

export type CellValue = string | number | null | undefined;

export interface SheetData {
  /** Tab name. ASCII recommended; max 31 chars; must not contain : \\ / ? * [ ] */
  name: string;
  /** Rows of cells. Strings -> inline strings, finite numbers -> numeric cells. */
  rows: CellValue[][];
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 0-based column index -> A1 column letters (0 -> A, 26 -> AA). */
function colName(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function cellXml(value: CellValue, ref: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" t="n"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

function sheetXml(rows: CellValue[][]): string {
  const body = rows
    .map((cells, r) => {
      const rowNum = r + 1;
      const cellsXml = cells
        .map((v, c) => cellXml(v, colName(c) + rowNum))
        .filter((x) => x !== '')
        .join('');
      return `<row r="${rowNum}">${cellsXml}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData>` +
    '</worksheet>'
  );
}

// --- CRC32 (lazy table) ---
let CRC_TABLE: number[] | null = null;
function crcTable(): number[] {
  if (CRC_TABLE) return CRC_TABLE;
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(bytes: number[]): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- minimal STORE ZIP ---
interface ZipEntry {
  name: string;
  data: number[];
}
function pushU16(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >> 8) & 0xff);
}
function pushU32(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
}

function zipStore(entries: ZipEntry[]): number[] {
  const out: number[] = [];
  const central: number[] = [];
  const DOS_DATE = 0x21; // 1980-01-01

  for (const e of entries) {
    const nameBytes = utf8Bytes(e.name);
    const crc = crc32(e.data);
    const offset = out.length;

    // Local file header
    pushU32(out, 0x04034b50);
    pushU16(out, 20); // version needed
    pushU16(out, 0); // flags
    pushU16(out, 0); // method: store
    pushU16(out, 0); // mod time
    pushU16(out, DOS_DATE); // mod date
    pushU32(out, crc);
    pushU32(out, e.data.length); // compressed size
    pushU32(out, e.data.length); // uncompressed size
    pushU16(out, nameBytes.length);
    pushU16(out, 0); // extra length
    for (const b of nameBytes) out.push(b);
    for (const b of e.data) out.push(b);

    // Central directory header
    pushU32(central, 0x02014b50);
    pushU16(central, 20); // version made by
    pushU16(central, 20); // version needed
    pushU16(central, 0); // flags
    pushU16(central, 0); // method
    pushU16(central, 0); // mod time
    pushU16(central, DOS_DATE); // mod date
    pushU32(central, crc);
    pushU32(central, e.data.length);
    pushU32(central, e.data.length);
    pushU16(central, nameBytes.length);
    pushU16(central, 0); // extra length
    pushU16(central, 0); // comment length
    pushU16(central, 0); // disk number start
    pushU16(central, 0); // internal attrs
    pushU32(central, 0); // external attrs
    pushU32(central, offset);
    for (const b of nameBytes) central.push(b);
  }

  const cdOffset = out.length;
  for (const b of central) out.push(b);

  // End of central directory
  pushU32(out, 0x06054b50);
  pushU16(out, 0); // disk number
  pushU16(out, 0); // disk with cd start
  pushU16(out, entries.length); // entries this disk
  pushU16(out, entries.length); // total entries
  pushU32(out, central.length); // central dir size
  pushU32(out, cdOffset); // central dir offset
  pushU16(out, 0); // comment length

  return out;
}

/**
 * Build a multi-sheet .xlsx workbook and return it base64-encoded for FileOutput.
 */
export function buildXlsx(sheets: SheetData[]): string {
  const parts: ZipEntry[] = [];
  const add = (name: string, xml: string): void => {
    parts.push({ name, data: utf8Bytes(xml) });
  };

  add(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('') +
      '</Types>'
  );

  add(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
  );

  add(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('') +
      '</sheets></workbook>'
  );

  add(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join('') +
      '</Relationships>'
  );

  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));

  return base64(zipStore(parts));
}
