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
// supplier, batch and comment. A size with nothing remembered starts from the
// usual suppliers, and anything can be changed. Comments belong to one run,
// so they start blank and are never remembered with the size.
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

// jarComment and lidComment, blank for a new lookup.
export function blankPackagingComments() {
  return Object.fromEntries(PACKAGING.map(({ key }) => [`${key}Comment`, '']))
}

// The packaging as rows in the same shape as materialsSnapshot, so it is
// pushed, shown and copied right after the raw materials. Left out when
// supplier, batch and comment are all blank.
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
    comment: str(values[`${key}Comment`]),
  })).filter((m) => m.supplierName || m.batchNumber || m.comment)
}

// Column P (Comments) of each material row in Copy All; only jars and lids
// have one.
export function materialComments(materials) {
  return materials.map((m) => m.comment || '')
}

// A product's remembered sizes after using this size with its barcode, jar
// size and packaging: a new size is added, a known size takes the new values.
// With a jar size, the jar and lid details are kept with the jar size instead
// (see jarSizeUpdate). A blank value never wipes a saved one, and empty
// placeholder packs are dropped. null means nothing changed, so there is
// nothing to save.
// pack: { size, barcode, jarSize, jarSupplier, jarBatch, lidSupplier, lidBatch }
export function rememberPack(packs, pack) {
  const s = str(pack.size)
  if (!s) return null
  const kept = (packs || []).filter((p) => str(p.size) || str(p.barcode))
  const fields = ['barcode', 'jarSize', ...(str(pack.jarSize) ? [] : PACKAGING_FIELDS)]
  const fresh = Object.fromEntries(fields.map((f) => [f, str(pack[f])]))
  const i = kept.findIndex((p) => sizeKey(p.size) === sizeKey(s))
  if (i === -1) {
    const extras = Object.fromEntries(fields.slice(1).filter((f) => fresh[f]).map((f) => [f, fresh[f]]))
    return [...kept, { size: s, barcode: fresh.barcode, ...extras }]
  }
  const patch = Object.fromEntries(
    Object.entries(fresh).filter(([f, v]) => v && v !== str(kept[i][f]))
  )
  if (!Object.keys(patch).length) return null
  return kept.map((p, x) => (x === i ? { ...p, ...patch } : p))
}

// ---- Jar sizes ----
// Jars come in a few sizes, each with its own lid. The jar and lid supplier
// and batch last used with each jar size are kept in the jarSizes collection
// and shared by every product, so picking a jar size fills them in. A product
// size remembers which jar size it uses.
// jarSizes: [{ id, name, jarSupplier, jarBatch, lidSupplier, lidBatch }]

export function findJarSize(jarSizes, name) {
  const key = sizeKey(name)
  return key ? jarSizes.find((j) => sizeKey(j.name) === key) || null : null
}

// Dropdown options, smallest number first, each hinting its jar / lid batch.
export function jarSizeOptions(jarSizes) {
  return jarSizes
    .filter((j) => str(j.name))
    .sort((a, b) => str(a.name).localeCompare(str(b.name), undefined, { numeric: true }))
    .map((j) => ({ value: str(j.name), hint: [j.jarBatch, j.lidBatch].map(str).filter(Boolean).join(' / ') }))
}

// jarSize plus the jar and lid fields for a product size: from its jar size
// when that is on record, otherwise what the size itself remembers, or the
// usual suppliers.
export function packagingForPack(pack, jarSizes) {
  const jar = findJarSize(jarSizes, pack?.jarSize)
  return { jarSize: str(pack?.jarSize), ...packagingFromPack(jar || pack) }
}

// What to save for the jar size in use: { id, data } to update that jar size
// (id null adds a new one), or null when nothing changed. A blank value never
// wipes a saved one.
export function jarSizeUpdate(jarSizes, values) {
  const name = str(values.jarSize)
  if (!name) return null
  const fresh = Object.entries(Object.fromEntries(PACKAGING_FIELDS.map((f) => [f, str(values[f])])))
  const jar = findJarSize(jarSizes, name)
  if (!jar) return { id: null, data: { name, ...Object.fromEntries(fresh.filter(([, v]) => v)) } }
  const patch = Object.fromEntries(fresh.filter(([f, v]) => v && v !== str(jar[f])))
  return Object.keys(patch).length ? { id: jar.id, data: patch } : null
}
