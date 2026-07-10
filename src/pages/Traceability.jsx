import { useEffect, useState } from 'react'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useFlash } from '../FlashContext'
import DatePickInput from '../components/DatePickInput'
import { parseAuDate, formatAuDate, formatAuDateTime, formatDdmmyy } from '../utils/date'
import { downloadCsv } from '../utils/csv'

export default function Traceability() {
  const { flash } = useFlash()
  const [recipes, setRecipes] = useState([])
  const [ingredients, setIngredients] = useState([])

  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [productionDateStr, setProductionDateStr] = useState('')

  const [results, setResults] = useState(null)
  const [activeRecipe, setActiveRecipe] = useState(null)
  const [activeProductionDate, setActiveProductionDate] = useState(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const unsubRecipes = onSnapshot(query(collection(db, 'recipes'), orderBy('name')), (snap) =>
      setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubIngredients = onSnapshot(collection(db, 'ingredients'), (snap) =>
      setIngredients(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    return () => {
      unsubRecipes()
      unsubIngredients()
    }
  }, [])

  async function runTraceability(recipe, productionDate) {
    const ingredientIds = recipe.ingredientIds || []
    // Resolve each name from its ingredient id rather than the recipe's
    // parallel ingredientNames array, which can be stored out of order and
    // would otherwise mismatch the supplier/country/batch columns.
    const nameById = new Map(ingredients.map((i) => [i.id, i.name]))
    const ingredientNames = recipe.ingredientNames || []
    const cutoff = Timestamp.fromDate(productionDate)

    // Query each distinct ingredient only once, even if it appears more than
    // once in the recipe, to avoid duplicate Firestore reads.
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
            limit(1)
          )
        )
        batchByIngredient.set(
          ingredientId,
          snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
        )
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

  async function handleSubmit(e) {
    e.preventDefault()
    if (!selectedRecipeId || !productionDateStr) {
      flash('Please select a recipe and production date.', 'danger')
      return
    }
    const productionDate = parseAuDate(productionDateStr)
    if (!productionDate) {
      flash('Invalid date. Use DD/MM/YYYY format.', 'danger')
      return
    }
    const recipe = recipes.find((r) => r.id === selectedRecipeId)
    if (!recipe) {
      flash('Recipe not found.', 'danger')
      return
    }

    setRunning(true)
    try {
      const items = await runTraceability(recipe, productionDate)
      setResults(items)
      setActiveRecipe(recipe)
      setActiveProductionDate(productionDate)
    } finally {
      setRunning(false)
    }
  }

  // "Current Date" batches have no fixed batch number — they resolve to the
  // searched production date formatted as DDMMYY.
  function displayBatchNumber(batch) {
    return batch.useCurrentDate ? formatDdmmyy(activeProductionDate) : batch.batchNumber
  }

  function exportCsv() {
    if (!results || !activeRecipe || !activeProductionDate) return
    const rows = [
      ['Recipe', activeRecipe.name],
      ['Production Date', formatAuDate(activeProductionDate)],
      [],
      ['Ingredient', 'Supplier Name', 'Country', 'Batch Number', 'Received Date', 'Record Created Date'],
    ]
    for (const r of results) {
      if (r.batch) {
        rows.push([
          r.ingredientName,
          r.batch.supplierName || '',
          r.batch.country || '',
          displayBatchNumber(r.batch),
          formatAuDate(r.batch.receivedDate),
          r.batch.createdAt ? formatAuDateTime(r.batch.createdAt) : '',
        ])
      } else {
        rows.push([r.ingredientName, '', '', 'NO BATCH FOUND', '', ''])
      }
    }
    const safeName = activeRecipe.name.replace(/ /g, '_').replace(/\//g, '-')
    const d = activeProductionDate
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate()
    ).padStart(2, '0')}`
    downloadCsv(`traceability_${safeName}_${stamp}.csv`, rows)
  }

  const missingCount = results ? results.filter((r) => !r.batch).length : 0

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Traceability Lookup</h1>
          <p className="page-sub">
            Select a recipe and production date to see exactly which ingredient batches were used.
          </p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="row g-3 align-items-end">
              <div className="col-md-5">
                <label className="form-label fw-semibold">Recipe</label>
                <select
                  className="form-select"
                  required
                  value={selectedRecipeId}
                  onChange={(e) => setSelectedRecipeId(e.target.value)}
                >
                  <option value="">— Select a recipe —</option>
                  {recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold">Production Date</label>
                <DatePickInput value={productionDateStr} onChange={setProductionDateStr} required />
              </div>
              <div className="col-md-3">
                <button type="submit" className="btn btn-primary w-100" disabled={running}>
                  <i className="bi bi-search me-1"></i>
                  {running ? 'Searching…' : 'Search'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {results !== null && activeRecipe && activeProductionDate && (
        <div className="card">
          <div className="card-header bg-white d-flex justify-content-between align-items-center py-3">
            <div>
              <span className="fw-semibold fs-6">{activeRecipe.name}</span>
              <span className="text-muted ms-2">
                Production date: {formatAuDate(activeProductionDate)}
              </span>
            </div>
            <button className="btn btn-sm btn-outline-success" onClick={exportCsv}>
              <i className="bi bi-download me-1"></i>Export CSV
            </button>
          </div>

          {results.length > 0 ? (
            <>
              {missingCount > 0 && (
                <div className="alert alert-warning rounded-0 border-0 border-bottom border-warning mb-0 py-2 px-4">
                  <i className="bi bi-exclamation-triangle me-1"></i>
                  {missingCount} ingredient{missingCount !== 1 ? 's' : ''} had no batch recorded on or
                  before this date.
                </div>
              )}
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-4">Ingredient</th>
                      <th>Supplier Name</th>
                      <th>Country</th>
                      <th>Batch Number</th>
                      <th>Received Date</th>
                      <th>Record Created Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, idx) => (
                      <tr key={`${r.ingredientId}-${idx}`} className={!r.batch ? 'table-warning' : ''}>
                        <td className="ps-4">{r.ingredientName}</td>
                        <td>{r.batch?.supplierName || <span className="text-muted">—</span>}</td>
                        <td>{r.batch?.country || <span className="text-muted">—</span>}</td>
                        <td>
                          {r.batch ? (
                            displayBatchNumber(r.batch)
                          ) : (
                            <span className="text-warning fw-semibold">
                              <i className="bi bi-exclamation-triangle me-1"></i>No batch found
                            </span>
                          )}
                        </td>
                        <td>{r.batch ? formatAuDate(r.batch.receivedDate) : <span className="text-muted">—</span>}</td>
                        <td className="text-muted small">
                          {r.batch?.createdAt ? formatAuDateTime(r.batch.createdAt) : <span className="text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-footer text-muted small">
                {results.length} ingredient{results.length !== 1 ? 's' : ''}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <span className="es-icon">
                <i className="bi bi-inbox"></i>
              </span>
              <div className="es-title">No ingredients assigned</div>
              <p>This recipe has no ingredients yet. Edit it on the Recipes page.</p>
            </div>
          )}
        </div>
      )}

      {results === null && recipes.length === 0 && (
        <div className="alert alert-info">
          <i className="bi bi-info-circle me-1"></i>
          No recipes found.{' '}
          <a href="/recipes" className="alert-link">
            Create a recipe
          </a>{' '}
          to get started.
        </div>
      )}
    </>
  )
}
