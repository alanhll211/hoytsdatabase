import { collection, getDocs, limit, orderBy, query, Timestamp, where } from '../data'
import { db } from '../firebase'
import { formatDdmmyy } from './date'
import { withTextPrefix } from './batch'

const ms = (t) => t?.toMillis?.() ?? 0

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
  const cutoff = Timestamp.fromDate(productionDate)

  // Query each distinct ingredient only once, even if it appears more than
  // once in the recipe, to avoid duplicate Firestore reads. A few recent
  // batches are read so that, when two share a received date, the one
  // entered last wins (e.g. a new bag recorded the same day).
  const uniqueIds = [...new Set(ingredientIds)]
  const batchByIngredient = new Map()
  await Promise.all(
    uniqueIds.map(async (ingredientId) => {
      const snap = await getDocs(
        query(
          collection(db, 'batches'),
          where('ingredientId', '==', ingredientId),
          where('receivedDate', '<=', cutoff),
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
      batchByIngredient.set(ingredientId, latest || null)
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

const sizeKey = (s) => String(s ?? '').trim().toLowerCase()

// A product's remembered sizes after using this size and barcode: a new size
// is added, a known size takes the new barcode. A blank barcode never wipes a
// saved one, and empty placeholder packs are dropped. null means nothing
// changed, so there is nothing to save.
export function rememberPack(packs, size, barcode) {
  const s = String(size ?? '').trim()
  const b = String(barcode ?? '').trim()
  if (!s) return null
  const current = packs || []
  const kept = current.filter((p) => String(p.size ?? '').trim() || String(p.barcode ?? '').trim())
  const i = kept.findIndex((p) => sizeKey(p.size) === sizeKey(s))
  if (i === -1) return [...kept, { size: s, barcode: b }]
  if (!b || String(kept[i].barcode ?? '').trim() === b) return null
  return kept.map((p, x) => (x === i ? { ...p, barcode: b } : p))
}
