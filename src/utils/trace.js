import { collection, getDocs, limit, orderBy, query, Timestamp, where } from '../data'
import { db } from '../firebase'
import { formatDdmmyy } from './date'
import { withTextPrefix } from './batch'

const ms = (t) => t?.toMillis?.() ?? 0

// The latest batch of one ingredient received on or before a date, or null.
// A few recent batches are read so that, when two share a received date, the
// one entered last wins (e.g. a new bag recorded the same day).
export async function latestBatch(ingredientId, onOrBefore) {
  const snap = await getDocs(
    query(
      collection(db, 'batches'),
      where('ingredientId', '==', ingredientId),
      where('receivedDate', '<=', Timestamp.fromDate(onOrBefore)),
      orderBy('receivedDate', 'desc'),
      limit(10)
    )
  )
  const latest = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        ms(b.receivedDate) - ms(a.receivedDate) ||
        (b.createdAt ? ms(b.createdAt) : Infinity) - (a.createdAt ? ms(a.createdAt) : Infinity)
    )[0]
  return latest || null
}

// The raw materials behind one product on one production date: for each of
// the recipe's ingredients, the latest batch received on or before that date.
// ingredients: [{ id, name }] for display names.
export async function lookupMaterials(recipe, productionDate, ingredients) {
  const ingredientIds = recipe.ingredientIds || []
  // Resolve each name from its ingredient id rather than the recipe's
  // parallel ingredientNames array, which can be stored out of order and
  // would otherwise mismatch the supplier/country/batch columns.
  const nameById = new Map(ingredients.map((i) => [i.id, i.name]))
  const ingredientNames = recipe.ingredientNames || []

  // Query each distinct ingredient only once, even if it appears more than
  // once in the recipe, to avoid duplicate Firestore reads.
  const uniqueIds = [...new Set(ingredientIds)]
  const batchByIngredient = new Map()
  await Promise.all(
    uniqueIds.map(async (ingredientId) => {
      batchByIngredient.set(ingredientId, await latestBatch(ingredientId, productionDate))
    })
  )

  const items = ingredientIds.map((ingredientId, idx) => ({
    ingredientId,
    ingredientName:
      nameById.get(ingredientId) ||
      batchByIngredient.get(ingredientId)?.ingredientName ||
      ingredientNames[idx] ||
      '',
    batch: batchByIngredient.get(ingredientId) || null,
  }))
  items.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName))
  return items
}

// "Current Date" batches have no fixed batch number — they resolve to the
// production date formatted as DDMMYY. All batch numbers carry a leading
// apostrophe so Excel keeps them as text.
export function displayBatchNumber(batch, productionDate) {
  return withTextPrefix(batch.useCurrentDate ? formatDdmmyy(productionDate) : batch.batchNumber)
}

// The raw materials as saved with a Daily Log push: the same columns the
// Traceability results show, fixed at the moment of the push.
export function materialsSnapshot(items, productionDate) {
  return items.map(({ ingredientName, batch }) => ({
    ingredientName,
    supplierName: batch?.supplierName || '',
    country: batch?.country || '',
    batchNumber: batch ? displayBatchNumber(batch, productionDate) : '',
    receivedDate: batch?.receivedDate || null,
    createdAt: batch?.createdAt || null,
    found: !!batch,
  }))
}

// The columns pasted at column D of the sheet for each raw material:
// Ingredient, Supplier Name, Country, Batch Number. materials: as made by
// materialsSnapshot.
export function materialCopyRows(materials) {
  return materials.map((m) => [
    m.ingredientName,
    m.supplierName,
    m.country,
    m.found ? m.batchNumber : 'NO BATCH FOUND',
  ])
}

const str = (v) => String(v ?? '').trim()
const sizeKey = (s) => str(s).toLowerCase()

// Packaging recorded after the raw materials: jars and lids, each with a
// supplier and batch. A size with nothing remembered starts from the usual
// suppliers, and anything can be changed.
export const PACKAGING = [
  { key: 'jar', label: 'Jars', defaultSupplier: 'VISY' },
  { key: 'lid', label: 'Lids', defaultSupplier: 'PB Packaging' },
]
const PACKAGING_FIELDS = PACKAGING.flatMap(({ key }) => [`${key}Supplier`, `${key}Batch`])

// jarSupplier, jarBatch, lidSupplier, lidBatch for a saved size (or none).
export function packagingFromPack(pack) {
  const out = {}
  for (const { key, defaultSupplier } of PACKAGING) {
    out[`${key}Supplier`] = str(pack?.[`${key}Supplier`]) || defaultSupplier
    out[`${key}Batch`] = str(pack?.[`${key}Batch`])
  }
  return out
}

// The packaging as rows in the same shape as materialsSnapshot, so it is
// pushed, shown and copied right after the raw materials. Left out when both
// supplier and batch are blank.
export function packagingSnapshot(values) {
  return PACKAGING.map(({ key, label }) => ({
    ingredientName: label,
    supplierName: str(values[`${key}Supplier`]),
    country: '',
    batchNumber: withTextPrefix(values[`${key}Batch`]),
    receivedDate: null,
    createdAt: null,
    found: true,
    packaging: true,
  })).filter((m) => m.supplierName || m.batchNumber)
}

// A product's remembered sizes after using this size with its barcode and
// packaging: a new size is added, a known size takes the new values. A blank
// value never wipes a saved one, and empty placeholder packs are dropped.
// null means nothing changed, so there is nothing to save.
// pack: { size, barcode, jarSupplier, jarBatch, lidSupplier, lidBatch }
export function rememberPack(packs, pack) {
  const s = str(pack.size)
  if (!s) return null
  const kept = (packs || []).filter((p) => str(p.size) || str(p.barcode))
  const fresh = Object.fromEntries(['barcode', ...PACKAGING_FIELDS].map((f) => [f, str(pack[f])]))
  const i = kept.findIndex((p) => sizeKey(p.size) === sizeKey(s))
  if (i === -1) {
    const extras = Object.fromEntries(PACKAGING_FIELDS.filter((f) => fresh[f]).map((f) => [f, fresh[f]]))
    return [...kept, { size: s, barcode: fresh.barcode, ...extras }]
  }
  const patch = Object.fromEntries(
    Object.entries(fresh).filter(([f, v]) => v && v !== str(kept[i][f]))
  )
  if (!Object.keys(patch).length) return null
  return kept.map((p, x) => (x === i ? { ...p, ...patch } : p))
}
