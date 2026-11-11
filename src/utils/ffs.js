import { formatAuDate, parseAuDate } from './date'
import { withTextPrefix } from './batch'
import { DATE_FORMAT, TEXT_FORMAT, htmlTable } from './excelHtml'

// Helpers for the 36-40 Alex Ave (FFS) production log. Each entry is one
// machine run of one product, with one or more raw material lines.

export const MACHINES = [1, 2, 3, 4, 5, 6, 7]

export const emptyLine = () => ({ internalIngredient: '', supplier: '', country: '', batchNumber: '' })

const norm = (s) => String(s ?? '').trim().toLowerCase()
const ms = (t) => t?.toMillis?.() ?? (t instanceof Date ? t.getTime() : 0)
// A just-added entry has no server timestamp yet; treat it as the newest.
const createdMs = (e) => (e.createdAt ? ms(e.createdAt) : Number.MAX_SAFE_INTEGER)

// Newest production date first, then most recently entered.
export function sortNewestFirst(entries) {
  return [...entries].sort((a, b) => ms(b.date) - ms(a.date) || createdMs(b) - createdMs(a))
}

// Entries in the order they were typed in, as rows appear in the sheet.
export function sortEntryOrder(entries) {
  return [...entries].sort((a, b) => createdMs(a) - createdMs(b))
}

// Every run on one production date (DD/MM/YYYY), in the order they were
// entered. null when the date can't be read.
export function entriesOnDay(entries, dateText) {
  const d = parseAuDate(dateText)
  if (!d) return null
  const key = formatAuDate(d)
  return sortEntryOrder(entries.filter((e) => formatAuDate(e.date) === key))
}

// Rows a list of runs takes in the sheet: one per raw material line.
export const rowCount = (entries) => entries.reduce((n, e) => n + Math.max(e.lines?.length || 0, 1), 0)

// The functions below take `history` sorted newest first, so the first match
// is the last time something was used.

export function lastEntryFor(history, productName) {
  const key = norm(productName)
  return key ? history.find((e) => norm(e.productName) === key) || null : null
}

export function lastEntryOnMachine(history, machine) {
  return history.find((e) => Number(e.machine) === Number(machine)) || null
}

export function productOptions(history) {
  const byKey = new Map()
  for (const e of history) {
    const key = norm(e.productName)
    if (key && !byKey.has(key)) {
      byKey.set(key, { value: e.productName, hint: `Machine ${e.machine} · ${formatAuDate(e.date)}` })
    }
  }
  return [...byKey.values()].sort((a, b) => a.value.localeCompare(b.value))
}

// Suppliers used for this product come first, with the country and batch
// that picking them fills in. Every other supplier follows.
export function supplierOptions(history, productName) {
  const product = norm(productName)
  const own = new Map()
  const other = new Map()
  for (const e of history) {
    const isOwn = product && norm(e.productName) === product
    for (const l of e.lines || []) {
      const key = norm(l.supplier)
      if (!key) continue
      if (isOwn && !own.has(key)) {
        own.set(key, { value: l.supplier, hint: [l.country, l.batchNumber].filter(Boolean).join(' · ') })
      } else if (!isOwn && !other.has(key)) {
        other.set(key, { value: l.supplier, hint: l.country || '' })
      }
    }
  }
  for (const key of own.keys()) other.delete(key)
  const rest = [...other.values()].sort((a, b) => a.value.localeCompare(b.value))
  if (own.size === 0) return rest
  return [
    ...[...own.values()].map((o) => ({ ...o, group: 'Used for this product' })),
    ...rest.map((o) => ({ ...o, group: 'Other suppliers' })),
  ]
}

// Fields to fill when a supplier is picked: country and batch from the last
// time this product used that supplier (preferring the same internal
// ingredient). A supplier only seen on other products fills the country
// alone, since their batch belongs to a different product.
export function fillForSupplier(history, productName, supplier, internalIngredient) {
  const product = norm(productName)
  const key = norm(supplier)
  const internal = norm(internalIngredient)
  let sameProduct = null
  let otherProduct = null
  for (const e of history) {
    const isOwn = product && norm(e.productName) === product
    for (const l of e.lines || []) {
      if (norm(l.supplier) !== key) continue
      if (isOwn && norm(l.internalIngredient) === internal) {
        return { country: l.country || '', batchNumber: l.batchNumber || '' }
      }
      if (isOwn) sameProduct ??= l
      else otherProduct ??= l
    }
  }
  if (sameProduct) return { country: sameProduct.country || '', batchNumber: sameProduct.batchNumber || '' }
  if (otherProduct) return { country: otherProduct.country || '' }
  return {}
}

export function internalOptions(history, productName) {
  const product = norm(productName)
  const byKey = new Map()
  for (const e of history) {
    if (!product || norm(e.productName) !== product) continue
    for (const l of e.lines || []) {
      const key = norm(l.internalIngredient)
      if (key && !byKey.has(key)) byKey.set(key, { value: l.internalIngredient, hint: l.supplier || '' })
    }
  }
  return [...byKey.values()]
}

// Supplier, country and batch from the last line with this internal ingredient.
export function fillForInternal(history, productName, internalIngredient) {
  const product = norm(productName)
  const key = norm(internalIngredient)
  for (const e of history) {
    if (!product || norm(e.productName) !== product) continue
    const l = (e.lines || []).find((x) => norm(x.internalIngredient) === key)
    if (l) return { supplier: l.supplier || '', country: l.country || '', batchNumber: l.batchNumber || '' }
  }
  return {}
}

export function weightOptions(history, productName) {
  const product = norm(productName)
  const byKey = new Map()
  for (const e of history) {
    if (!product || norm(e.productName) !== product) continue
    const key = norm(e.weightPerBag)
    if (key && !byKey.has(key)) {
      byKey.set(key, { value: e.weightPerBag, hint: e.unitsPerBox ? `${e.unitsPerBox} / box` : '' })
    }
  }
  return [...byKey.values()]
}

// Unit/Box from the last run of this product at this weight, or null.
export function unitsForWeight(history, productName, weight) {
  const product = norm(productName)
  const key = norm(weight)
  const e = history.find((x) => norm(x.productName) === product && norm(x.weightPerBag) === key)
  return e ? e.unitsPerBox || '' : null
}

// ---- Excel copy: columns A-J of the FFS sheet ----

const COL = { date: 0, machine: 1, product: 2, internal: 3, hoyts: 4, supplier: 5, country: 6, batch: 7, weight: 8, units: 9 }
export const FFS_COLUMN_COUNT = 10
const NUMERIC_COLS = new Set([COL.machine, COL.weight, COL.units])
const isNumber = (v) => /^-?\d+(\.\d+)?$/.test(v)

// One row per raw material line. Only the first line of an entry carries the
// date, machine, product, Hoyts batch and packaging, like the sheet.
export function buildFfsRows(entries) {
  const rows = []
  for (const e of entries) {
    const lines = e.lines?.length ? e.lines : [emptyLine()]
    lines.forEach((l, i) => {
      const row = new Array(FFS_COLUMN_COUNT).fill('')
      if (i === 0) {
        row[COL.date] = formatAuDate(e.date)
        row[COL.machine] = e.machine ?? ''
        row[COL.product] = e.productName
        row[COL.hoyts] = e.hoytsBatch
        row[COL.weight] = e.weightPerBag
        row[COL.units] = e.unitsPerBox
      }
      row[COL.internal] = l.internalIngredient
      row[COL.supplier] = l.supplier
      row[COL.country] = l.country
      row[COL.batch] = l.batchNumber
      rows.push(row.map((v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')))
    })
  }
  return rows
}

// Machine, weight and units paste as numbers; everything else as text so
// batch codes keep their leading zeros.
export function ffsRowsToHtml(rows) {
  return htmlTable(rows, (v, r, c) => {
    if (!v) return []
    if (c === COL.date) return [DATE_FORMAT]
    if (NUMERIC_COLS.has(c) && isNumber(v)) return []
    return [TEXT_FORMAT]
  })
}

// Plain-text fallback: codes made only of digits and separators get an
// apostrophe so Excel doesn't turn them into numbers or dates.
export function ffsRowsToTsv(rows) {
  return rows
    .map((row) =>
      row
        .map((v, c) =>
          (c === COL.hoyts || c === COL.batch) && /^[\d\s./-]+$/.test(v) ? withTextPrefix(v) : v
        )
        .join('\t')
    )
    .join('\r\n')
}
