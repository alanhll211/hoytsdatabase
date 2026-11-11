import { formatAuDate } from './date'
import { withTextPrefix } from './batch'
import { DATE_FORMAT, TEXT_FORMAT, htmlTable } from './excelHtml'

// Builds the traceability block pasted into the production Excel sheet: one
// grey product row followed by one row per raw material, all spanning the
// sheet's 16 columns (A Date ... P Comments) so pasting starts at column A.

export const COLUMN_COUNT = 16
const COL = { date: 0, product: 1, hoytsBn: 2, rawMaterial: 3, size: 7, barcode: 8, phStart: 12, phEnd: 13, document: 14 }
const HEADER_FILL = '#d9d9d9'

// "Not tested" marker the sheet uses in the pH columns.
export const PH_NOT_TESTED = '\\'

// Hoyts BN is the Julian date: day of year (3 digits) + 2-digit year,
// e.g. 04/11/2026 -> 308 + 26 -> "30826". Built from UTC values so daylight
// saving changes can't shift the day count.
export function hoytsBatchNumber(date) {
  const y = date.getFullYear()
  const day =
    Math.round((Date.UTC(y, date.getMonth(), date.getDate()) - Date.UTC(y, 0, 1)) / 86400000) + 1
  return `${String(day).padStart(3, '0')}${String(y % 100).padStart(2, '0')}`
}

// Recipes are named "QR124 - Giardiniera": the QR code is the sheet's Document
// column and the rest is its Product Name. Names without a code stay whole.
export function parseRecipeName(name) {
  const full = String(name ?? '').trim()
  const m = full.match(/^(QR\s*\d+)\s*[-–—]\s*(.+)$/i)
  return m ? { document: m[1], productName: m[2] } : { document: '', productName: full }
}

// Label Barcode column only holds the last 6 digits.
export function normalizeBarcode(value) {
  return String(value ?? '').trim().slice(-6)
}

export function buildExcelRows({ productionDate, recipeName, header, materials }) {
  const first = new Array(COLUMN_COUNT).fill('')
  first[COL.date] = formatAuDate(productionDate)
  first[COL.product] = parseRecipeName(recipeName).productName
  // The batch number shown on screen, which may have been corrected by hand.
  first[COL.hoytsBn] = header.hoytsBn ?? hoytsBatchNumber(productionDate)
  first[COL.size] = header.size
  first[COL.barcode] = header.barcode
  first[COL.phStart] = header.phStart
  first[COL.phEnd] = header.phEnd
  first[COL.document] = header.document

  const rest = materials.map((values) => {
    const row = new Array(COLUMN_COUNT).fill('')
    values.forEach((v, i) => {
      row[COL.rawMaterial + i] = v
    })
    return row
  })
  return [first, ...rest].map((row) => row.map((v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')))
}

// Plain-text fallback for targets that ignore the HTML flavour. Plain text has
// no cell formats, so the code columns need the apostrophe to keep leading
// zeros (a January Hoyts BN like "00526", a barcode like "000028").
export function rowsToTsv(rows) {
  return rows
    .map((row, r) =>
      row
        .map((v, c) => (r === 0 && (c === COL.hoytsBn || c === COL.barcode) ? withTextPrefix(v) : v))
        .join('\t')
    )
    .join('\r\n')
}

// Blank cells get no format, so values typed in later (pH, pallet...) aren't
// forced to text.
export function rowsToHtml(rows) {
  return htmlTable(rows, (v, r, c) => {
    const styles = []
    if (r === 0) styles.push(`background:${HEADER_FILL}`)
    if (v) styles.push(c === COL.date ? DATE_FORMAT : TEXT_FORMAT)
    return styles
  })
}
